import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { onRequestGet, onRequestPost } from './cloud-functions/api/game.js';
import { onRequestGet as presence } from './cloud-functions/api/presence.js';
import { openStore } from './store.js';

const port = Number(process.env.PORT || 18891);
const origin = process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:' + port;
const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
const transaction = openStore(process.env.DB_PATH || fileURLToPath(new URL('./rooms.sqlite', import.meta.url)));
const files = new Map([
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/script.js', 'script.js', 'text/javascript; charset=utf-8'],
  ['/ai.js', 'ai.js', 'text/javascript; charset=utf-8'],
  ['/go-mcts-worker.js', 'go-mcts-worker.js', 'text/javascript; charset=utf-8'],
  ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
  ['/favicon.ico', 'favicon.ico', 'image/x-icon'],
  ['/apple-touch-icon.png', 'apple-touch-icon.png', 'image/png'],
  ['/LICENSE', '../LICENSE', 'text/plain; charset=utf-8'],
].map(([key, filename, type]) => [key, { type, data: readFileSync(new URL('./public/' + filename, import.meta.url)) }]));
const handlers = new Map([
  ['GET /api/game', onRequestGet],
  ['POST /api/game', onRequestPost],
  ['GET /api/presence', presence],
]);
const rates = new Map();

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function allow(request) {
  const address = process.env.TRUST_PROXY === '1'
    ? request.headers['x-forwarded-for']?.split(',').at(-1).trim() || request.socket.remoteAddress
    : request.socket.remoteAddress;
  const writing = request.method === 'POST';
  const key = address + ':' + writing;
  const now = Date.now();
  let record = rates.get(key);
  if (!record || record.until <= now) {
    if (!record && rates.size >= 10_000) return false;
    record = { count: 0, until: now + 60_000 };
    rates.set(key, record);
  }
  return ++record.count <= (writing ? 180 : 600);
}

async function readBody(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 2048) {
      request.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function route(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url = new URL(request.url, origin);
  if (!url.pathname.startsWith(base + '/')) return reply(response, 404, { error: '页面不存在' });
  const path = url.pathname.slice(base.length);
  const file = files.get(path);
  if (file && ['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(200, { 'Content-Type': file.type });
    return response.end(request.method === 'HEAD' ? undefined : file.data);
  }
  if (request.method === 'GET' && path === '/health') return reply(response, 200, { ok: true });
  const handler = handlers.get(request.method + ' ' + path);
  if (!handler) return reply(response, 404, { error: '页面不存在' });
  if (request.method === 'POST' && request.headers.origin !== origin) return reply(response, 403, { error: '请从游戏页面操作' });
  if (!allow(request)) return reply(response, 429, { error: '请求太频繁' });

  let body;
  if (request.method === 'POST') {
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') return reply(response, 415, { error: '请求格式无效' });
    body = await readBody(request);
    if (body === null) return reply(response, 413, { error: '请求过大' });
    let message;
    try { message = JSON.parse(body); }
    catch { return reply(response, 400, { error: '请求格式无效' }); }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return reply(response, 400, { error: '请求格式无效' });
    if (message.type === 'match:join') return reply(response, 400, { error: '请选择好友房或人机对局' });
    if (['room:create', 'ai:create'].includes(message.type)) {
      body = JSON.stringify({ ...message, payload: { ...message.payload, gameType: 'go' } });
    }
  }
  const result = await transaction(() => handler({
    request: new Request(url, { method: request.method, body }),
  }));
  response.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(await result.text());
}

setInterval(() => {
  for (const [key, rate] of rates) if (rate.until <= Date.now()) rates.delete(key);
}, 60_000).unref();
const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 16_384 }, (request, response) => {
  route(request, response).catch(error => {
    console.error(error);
    if (response.headersSent) response.destroy();
    else reply(response, 500, { error: '服务暂时不可用' });
  });
});
server.maxConnections = 1024;
if (process.connected) process.on('disconnect', () => process.exit(0));
server.listen(port, '127.0.0.1', () => console.log('Weiqi ready at ' + origin + base + '/'));
