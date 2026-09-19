import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUiProxy } from './ui-proxy.mjs';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const port = Number(process.env.PORT || 3000);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const proxy = createUiProxy();

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

async function getFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const file = normalize(join(root, decoded));
  const relativePath = relative(root, file);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') return null;

  const info = await stat(file).catch(() => null);
  if (!info) return null;
  if (info.isDirectory()) {
    const index = join(file, 'index.html');
    const indexInfo = await stat(index).catch(() => null);
    return indexInfo?.isFile() ? index : null;
  }
  return info.isFile() ? file : null;
}

const server = createServer(async (request, response) => {
  if (proxy.handleRequest(request, response)) return;
  if (!['GET', 'HEAD'].includes(request.method)) {
    send(response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    return;
  }

  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const file = await getFile(url.pathname);
    if (!file) {
      send(response, 404, 'Not Found', { 'content-type': 'text/plain; charset=utf-8' });
      return;
    }

    const body = await readFile(file);
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'max-age=7200',
      'Content-Length': body.byteLength,
      'Content-Type': contentTypes[extname(file)] || 'application/octet-stream',
    };
    response.writeHead(200, headers);
    if (request.method === 'GET') response.end(body);
    else response.end();
  } catch {
    send(response, 400, 'Bad Request', { 'content-type': 'text/plain; charset=utf-8' });
  }
});

server.on('upgrade', (request, socket, head) => {
  if (!proxy.handleUpgrade(request, socket, head)) socket.destroy();
});
server.listen(port);
