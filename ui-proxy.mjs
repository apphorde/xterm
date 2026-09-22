import { randomBytes } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';

const authOrigin = new URL(process.env.AUTH_PROVIDER || 'https://auth.api.apphor.de');
if (authOrigin.pathname === '/api') authOrigin.pathname = '/';
const tokenLifetime = 60_000;
const proxyTokens = new Map();
const bridge = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

function sessionCookie(request) {
  const cookies = request.headers.cookie || '';
  const session = cookies.split(';').map((item) => item.trim()).find((item) => item.startsWith('connect.sid='));
  return session || '';
}

function requestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16 * 1024) {
        request.destroy();
        reject(new Error('Request too large'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function propertyKeys(request) {
  const forwardedHost = request.headers['x-forwarded-host'];
  const host = (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0] : request.headers.host || '').trim();
  const hostname = host.replace(/:\d+$/, '');
  return [`${host}:servers`, `${hostname}:servers`];
}

async function getSavedServers(request) {
  const cookie = sessionCookie(request);
  if (!cookie) return null;

  const profile = await fetch(new URL('/profile', authOrigin), { headers: { Cookie: cookie } });
  if (!profile.ok) return null;
  const properties = await fetch(new URL('/properties', authOrigin), { headers: { Cookie: cookie } });
  if (!properties.ok) return null;
  const keys = propertyKeys(request);
  const property = (await properties.json()).find((item) => keys.includes(item.key));
  if (!property) return [];

  try {
    const servers = JSON.parse(property.value);
    return Array.isArray(servers) ? servers : [];
  } catch {
    return [];
  }
}

function websocketEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Unsupported endpoint protocol');
  return url;
}

async function authenticate(request, response) {
  try {
    const body = JSON.parse(await requestBody(request));
    if (typeof body.endpoint !== 'string' || typeof body.key !== 'string') {
      json(response, 400, { error: 'Endpoint and key are required' });
      return;
    }

    const endpoint = new URL(body.endpoint);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(endpoint.protocol)) {
      json(response, 400, { error: 'Unsupported endpoint protocol' });
      return;
    }

    const servers = await getSavedServers(request);
    const saved = servers?.some((server) => server.endpoint === endpoint.toString() && server.key === body.key);
    if (!saved) {
      json(response, 403, { error: 'Server is not saved for this account' });
      return;
    }

    const authEndpoint = websocketEndpoint(endpoint.toString());
    authEndpoint.protocol = authEndpoint.protocol === 'wss:' ? 'https:' : 'http:';
    const authResponse = await fetch(new URL('/auth', authEndpoint), {
      body: JSON.stringify({ key: body.key }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    if (!authResponse.ok) {
      json(response, authResponse.status, { error: 'Terminal authentication failed' });
      return;
    }

    const remote = await authResponse.json();
    if (typeof remote.token !== 'string') throw new Error('Terminal did not return a token');
    const token = randomBytes(32).toString('base64url');
    proxyTokens.set(token, { endpoint: authEndpoint, remoteToken: remote.token, expiresAt: Date.now() + tokenLifetime });
    json(response, 200, { token });
  } catch (error) {
    json(response, 400, { error: error.message || 'Invalid proxy request' });
  }
}

export function createUiProxy() {
  return {
    handleRequest(request, response) {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname !== '/proxy/auth') return false;
      if (request.method !== 'POST') {
        json(response, 405, { error: 'Method Not Allowed' });
        return true;
      }
      authenticate(request, response);
      return true;
    },

    handleUpgrade(request, socket, head) {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname !== '/proxy/connect') return false;
      const token = url.searchParams.get('token');
      const details = proxyTokens.get(token);
      proxyTokens.delete(token);
      if (!details || details.expiresAt <= Date.now()) {
        socket.destroy();
        return true;
      }

      bridge.handleUpgrade(request, socket, head, (client) => {
        const target = new URL(details.endpoint);
        target.searchParams.set('token', details.remoteToken);
        const upstream = new WebSocket(target, { maxPayload: 1024 * 1024 });
        const pending = [];
        const close = () => {
          if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close();
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
        };
        client.on('message', (data) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
          else if (upstream.readyState === WebSocket.CONNECTING) pending.push(data);
        });
        upstream.on('open', () => {
          for (const data of pending) upstream.send(data);
          pending.length = 0;
        });
        upstream.on('message', (data) => {
          if (client.readyState === WebSocket.OPEN) client.send(data.toString('utf8'));
        });
        client.on('close', close);
        upstream.on('close', close);
        client.on('error', close);
        upstream.on('error', close);
      });
      return true;
    },
  };
}
