import { createServer } from 'node:http';
import { timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';

const authKey = process.env.WS_AUTH_KEY || '';
const port = Number(process.env.PORT || 8000);
const tokenLifetime = 60_000;
const killTimeout = Number(process.env.KILL_TIMEOUT || 10_000);
const tokens = new Map();
const sessions = new Map();
const rateLimits = new Map();
const server = createServer(onHttpRequest);
const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  return (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : request.socket.remoteAddress) || 'unknown';
}

function allowRequest(ip) {
  const record = rateLimits.get(ip);
  return !record || record.lockUntil <= Date.now();
}

function recordFailure(ip) {
  const record = rateLimits.get(ip) || { attempts: 0, lockUntil: 0 };
  record.attempts += 1;
  if (record.attempts >= 5) record.lockUntil = Date.now() + 5 * 60_000;
  rateLimits.set(ip, record);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Access-Control-Allow-Origin': '*',
  };
}

function respond(response, status, body, headers = {}) {
  response.writeHead(status, { ...corsHeaders(), ...headers });
  response.end(body);
}

function matchesSecret(candidate) {
  if (!authKey || typeof candidate !== 'string') return false;
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(authKey);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function issueToken(response, ip, body) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    respond(response, 400, 'Bad Request');
    return;
  }

  if (!matchesSecret(payload.key)) {
    recordFailure(ip);
    respond(response, 401, 'Unauthorized');
    return;
  }

  const sessionId = typeof payload.sessionId === 'string' && payload.sessionId.length <= 128
    ? payload.sessionId
    : randomUUID();
  const token = randomBytes(32).toString('hex');
  tokens.set(token, { expiresAt: Date.now() + tokenLifetime, sessionId });
  respond(response, 200, JSON.stringify({ token }), { 'Content-Type': 'application/json' });
}

function onHttpRequest(request, response) {
  const ip = clientIp(request);

  if (request.method === 'OPTIONS') {
    respond(response, 204);
    return;
  }

  if (request.method === 'POST' && new URL(request.url, 'http://localhost').pathname === '/auth') {
    if (!allowRequest(ip)) {
      respond(response, 429, 'Too Many Requests');
      return;
    }

    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16 * 1024) request.destroy();
    });
    request.on('end', () => issueToken(response, ip, body));
    return;
  }

  respond(response, 200, 'OK', { 'Content-Type': 'text/plain; charset=utf-8' });
}

function validToken(request, socket) {
  const url = new URL(request.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const details = tokens.get(token);
  tokens.delete(token);
  if (!details || details.expiresAt <= Date.now()) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return false;
  }
  return details;
}

function onUpgrade(request, socket, head) {
  const ip = clientIp(request);
  const details = allowRequest(ip) && validToken(request, socket);
  if (!details) {
    if (!socket.destroyed) socket.destroy();
    return;
  }

  sockets.handleUpgrade(request, socket, head, (websocket) => {
    sockets.emit('connection', websocket, request, details);
  });
}

function createShell(session) {
  const shellEnv = { ...process.env };
  delete shellEnv.WS_AUTH_KEY;
  const shell = pty.spawn('login', [], {
    cols: 80,
    cwd: process.env.HOME || process.cwd(),
    env: shellEnv,
    name: 'xterm-color',
    rows: 30,
  });

  shell.onData((data) => {
    if (session.websocket?.readyState === session.websocket.OPEN) {
      session.websocket.send(JSON.stringify({ type: 'stdout', data }));
    } else {
      session.output.push(data);
      if (session.output.length > 100) session.output.shift();
    }
  });
  shell.onExit(() => {
    if (session.websocket?.readyState === session.websocket.OPEN) session.websocket.send(JSON.stringify({ type: 'close' }));
    cleanup(session);
  });
  return shell;
}

function cleanup(session) {
  if (session.killTimer) clearTimeout(session.killTimer);
  sessions.delete(session.id);
  if (session.shell && !session.shell.closed) {
    session.shell.kill();
    session.shell.closed = true;
  }
}

function disconnect(session, websocket) {
  if (session.websocket !== websocket) return;
  session.websocket = null;
  if (websocket.readyState === websocket.OPEN) websocket.close();
  if (!session.killTimer) session.killTimer = setTimeout(() => cleanup(session), killTimeout);
}

sockets.on('connection', (websocket, request, details) => {
  let session = sessions.get(details.sessionId);
  if (session?.killTimer) {
    clearTimeout(session.killTimer);
    session.killTimer = null;
  }
  if (!session) {
    session = { id: details.sessionId, output: [], websocket: null, shell: null, killTimer: null };
    session.shell = createShell(session);
    sessions.set(session.id, session);
  }
  session.websocket = websocket;
  for (const data of session.output) websocket.send(JSON.stringify({ type: 'stdout', data }));
  session.output.length = 0;
  websocket.on('error', (error) => console.error('Websocket error:', error.message));
  websocket.on('message', (data) => {
    let event;
    try {
      event = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }

    if (session.shell?.closed) {
      disconnect(session, websocket);
      return;
    }

    if (event.type === 'input' && typeof event.data === 'string') {
      session.shell.write(event.data);
    } else if (event.type === 'resize') {
      const cols = Number(event.data?.cols);
      const rows = Number(event.data?.rows);
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= 500 && rows <= 200) {
        session.shell.resize(cols, rows);
      }
    } else if (event.type === 'close') {
      cleanup(session);
      if (websocket.readyState === websocket.OPEN) websocket.close();
    }
  });
  websocket.on('close', () => disconnect(session, websocket));
});

setInterval(() => {
  const now = Date.now();
  for (const [token, details] of tokens) if (details.expiresAt <= now) tokens.delete(token);
  for (const [ip, record] of rateLimits) if (record.lockUntil <= now) rateLimits.delete(ip);
}, 30_000).unref();

server.on('upgrade', onUpgrade);
server.listen(port, '0.0.0.0', () => {
  console.log(`Terminal websocket server listening on port ${port}`);
});
