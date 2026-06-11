// Local JSONBin emulator for testing the Netlify function without a real account.
// Implements GET /v3/b/:id/latest and PUT /v3/b/:id with an in-memory record.
import { createServer } from 'node:http';

let record = { _meta: { v: 1 } };
let sheetRows = [];

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    // Emulates the Google Apps Script webhook (no auth, like the real one)
    if (req.url.startsWith('/sheet')) {
      if (req.method === 'POST') {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        sheetRows.push(...(Array.isArray(body) ? body : [body]));
        console.log('sheet webhook received:', JSON.stringify(body));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rows: sheetRows }));
      return;
    }
    if (req.headers['x-master-key'] !== 'test-master-key') {
      res.writeHead(401).end('{"message":"bad key"}');
      return;
    }
    if (req.method === 'GET' && req.url.endsWith('/latest')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(record));
    } else if (req.method === 'PUT') {
      record = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ record, metadata: {} }));
    } else {
      res.writeHead(404).end();
    }
  });
}).listen(9999, () => console.log('mock jsonbin on :9999'));
