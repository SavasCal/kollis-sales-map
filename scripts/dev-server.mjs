// Local dev server: serves public/ and mounts the Netlify function at /api/state.
// Use together with mock-jsonbin.mjs and .env (no real JSONBin needed).
// Usage: node --env-file=.env scripts/dev-server.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import handler from '../netlify/functions/state.mjs';

const PUBLIC = new URL('../public', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png',
};

createServer(async (req, res) => {
  if (req.url.startsWith('/api/state')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  try {
    const path = normalize(req.url.split('?')[0]).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, path === '/' ? 'index.html' : path);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(8888, () => console.log('dev server on http://localhost:8888'));
