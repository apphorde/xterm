import { randomBytes } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";

const oidcIssuer = process.env.OIDC_ISSUER;
if (!oidcIssuer) {
  throw new Error("OIDC_ISSUER is required");
}
const authSourceResponse = await fetch(
  `${oidcIssuer.replace(/\/$/, "")}/node.mjs`,
);
if (!authSourceResponse.ok) {
  throw new Error(`Could not load OIDC client: ${authSourceResponse.status}`);
}
const authSource = await authSourceResponse.text();
const { createAuthClient } = await import(
  `data:text/javascript,${encodeURIComponent(authSource)}`
);
const auth = createAuthClient({
  clientId: process.env.OIDC_CLIENT_ID,
  issuer: oidcIssuer,
});
const tokenLifetime = 60_000;
const proxyTokens = new Map();
const bridge = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

function debug(...args) {
  if (process.env.DEBUG) {
    console.debug("[ui-proxy]", ...args);
  }
}

function requestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16 * 1024) {
        request.destroy();
        reject(new Error("Request too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function propertyKeys(request) {
  const hosts = new Set();
  const addHost = (value) => {
    if (!value) {
      return;
    }
    try {
      const parsed = new URL(value.includes("://") ? value : `http://${value}`);
      hosts.add(parsed.host);
      hosts.add(parsed.hostname);
    } catch {
      const host = value.split(",")[0].trim().replace(/:\d+$/, "");
      if (host) {
        hosts.add(host);
      }
    }
  };

  addHost(request.headers.origin);
  addHost(request.headers["x-forwarded-host"]);
  addHost(request.headers.host);
  return [...hosts].map((host) => `${host}:servers`);
}

async function getSavedServers(request) {
  const profile = await auth.getProfile(request);
  if (!profile) {
    debug("session rejected");
    return null;
  }
  const keys = propertyKeys(request);
  let property;
  for (const key of keys) {
    property = await auth.getProperty(request, key);
    if (property) {
      break;
    }
  }
  if (!property) {
    return [];
  }

  try {
    const servers = JSON.parse(property.value);
    return Array.isArray(servers) ? servers : [];
  } catch {
    return [];
  }
}

function websocketEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  if (!["ws:", "wss:"].includes(url.protocol)) {
    throw new Error("Unsupported endpoint protocol");
  }
  return url;
}

async function authenticate(request, response) {
  try {
    const body = JSON.parse(await requestBody(request));
    if (
      typeof body.endpoint !== "string" ||
      typeof body.key !== "string" ||
      typeof body.connectionId !== "string"
    ) {
      json(response, 400, { error: "Endpoint and key are required" });
      return;
    }

    const endpoint = new URL(body.endpoint);
    if (!["http:", "https:", "ws:", "wss:"].includes(endpoint.protocol)) {
      json(response, 400, { error: "Unsupported endpoint protocol" });
      return;
    }

    const servers = await getSavedServers(request);
    const saved = servers?.some(
      (server) =>
        server.endpoint === endpoint.toString() && server.key === body.key,
    );
    if (!saved) {
      debug("server authorization failed", { endpoint: endpoint.hostname });
      json(response, 403, { error: "Server is not saved for this account" });
      return;
    }

    const remoteEndpoint = websocketEndpoint(endpoint.toString());
    const authEndpoint = new URL(remoteEndpoint);
    authEndpoint.protocol =
      authEndpoint.protocol === "wss:" ? "https:" : "http:";
    const authResponse = await fetch(new URL("/auth", authEndpoint), {
      body: JSON.stringify({ key: body.key, sessionId: body.connectionId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!authResponse.ok) {
      debug("remote terminal authentication failed", {
        endpoint: endpoint.hostname,
        status: authResponse.status,
      });
      json(response, authResponse.status, {
        error: "Terminal authentication failed",
      });
      return;
    }

    const remote = await authResponse.json();
    if (typeof remote.token !== "string") {
      throw new Error("Terminal did not return a token");
    }
    const token = randomBytes(32).toString("base64url");
    proxyTokens.set(token, {
      endpoint: remoteEndpoint,
      remoteToken: remote.token,
      expiresAt: Date.now() + tokenLifetime,
    });
    debug("proxy token issued", {
      connectionId: body.connectionId,
      endpoint: endpoint.hostname,
    });
    json(response, 200, { token });
  } catch (error) {
    debug("proxy authentication error", { error: error.message });
    json(response, 400, { error: error.message || "Invalid proxy request" });
  }
}

export function createUiProxy() {
  return {
    handleRequest(request, response) {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname !== "/proxy/auth") {
        return false;
      }
      if (request.method !== "POST") {
        json(response, 405, { error: "Method Not Allowed" });
        return true;
      }
      authenticate(request, response);
      return true;
    },

    handleUpgrade(request, socket, head) {
      const url = new URL(request.url, "http://localhost");
      debug("websocket upgrade received", {
        path: url.pathname,
        token: Boolean(url.searchParams.get("token")),
      });
      if (url.pathname !== "/proxy/connect") {
        return false;
      }
      const token = url.searchParams.get("token");
      const details = proxyTokens.get(token);
      proxyTokens.delete(token);
      if (!details || details.expiresAt <= Date.now()) {
        debug("proxy websocket token rejected");
        socket.destroy();
        return true;
      }

      bridge.handleUpgrade(request, socket, head, (client) => {
        const target = new URL(details.endpoint);
        target.searchParams.set("token", details.remoteToken);
        let upstream;
        try {
          upstream = new WebSocket(target, { maxPayload: 1024 * 1024 });
        } catch (error) {
          debug("proxy upstream websocket creation failed", {
            endpoint: details.endpoint.hostname,
            error: error.message,
          });
          client.close();
          return;
        }
        const pending = [];
        debug("proxy websocket bridge opened", {
          endpoint: details.endpoint.hostname,
        });
        const close = () => {
          debug("proxy websocket bridge closed", {
            endpoint: details.endpoint.hostname,
          });
          if (
            client.readyState === WebSocket.OPEN ||
            client.readyState === WebSocket.CONNECTING
          ) {
            client.close();
          }
          if (
            upstream.readyState === WebSocket.OPEN ||
            upstream.readyState === WebSocket.CONNECTING
          ) {
            upstream.close();
          }
        };
        client.on("message", (data) => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data);
          } else if (upstream.readyState === WebSocket.CONNECTING) {
            pending.push(data);
          }
        });
        upstream.on("open", () => {
          for (const data of pending) {
            upstream.send(data);
          }
          pending.length = 0;
        });
        upstream.on("message", (data) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data.toString("utf8"));
          }
        });
        client.on("close", close);
        upstream.on("close", close);
        client.on("error", close);
        upstream.on("error", (error) => {
          debug("proxy upstream websocket error", {
            endpoint: details.endpoint.hostname,
            error: error.message,
          });
          close();
        });
      });
      return true;
    },
  };
}
