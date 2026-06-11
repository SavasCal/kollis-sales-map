// Entire backend: password check + JSONBin proxy.
// GET  /api/state            -> current overrides map
// POST /api/state {id, s, n} -> merge one facility's status/note, return full overrides
import { timingSafeEqual } from 'node:crypto';

const JSONBIN_BASE = process.env.JSONBIN_BASE || 'https://api.jsonbin.io/v3/b';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['none', 'visited', 'converted']);

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function passwordOk(req) {
  const expected = process.env.APP_PASSWORD || '';
  const given = req.headers.get('x-app-password') || '';
  if (!expected) return false;
  // Pad to equal length so timingSafeEqual never throws on length mismatch
  const len = Math.max(expected.length, given.length);
  return timingSafeEqual(
    Buffer.from(expected.padEnd(len, '\0')),
    Buffer.from(given.padEnd(len, '\0'))
  );
}

async function fetchOverrides(binId, masterKey) {
  const res = await fetch(`${JSONBIN_BASE}/${binId}/latest`, {
    headers: { 'X-Master-Key': masterKey, 'X-Bin-Meta': 'false' },
  });
  if (!res.ok) throw new Error(`jsonbin GET ${res.status}`);
  return res.json();
}

function publicView(record) {
  const { _meta, ...overrides } = record;
  return overrides;
}

export default async (req) => {
  if (!passwordOk(req)) return json(401, { ok: false, error: 'unauthorized' });

  const binId = process.env.JSONBIN_BIN_ID;
  const masterKey = process.env.JSONBIN_MASTER_KEY;
  if (!binId || !masterKey) return json(500, { ok: false, error: 'misconfigured' });

  try {
    if (req.method === 'GET') {
      const record = await fetchOverrides(binId, masterKey);
      return json(200, { ok: true, overrides: publicView(record) });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = await req.json();
      } catch {
        return json(400, { ok: false, error: 'invalid json' });
      }
      const { id, s = 'none', n = '' } = body || {};
      if (!UUID_RE.test(id || '') || !STATUSES.has(s) || typeof n !== 'string' || n.length > 2000) {
        return json(400, { ok: false, error: 'invalid payload' });
      }

      // Read-modify-write: always merge into the latest full record before PUT —
      // JSONBin PUT replaces the entire bin contents.
      const record = await fetchOverrides(binId, masterKey);
      const note = n.trim();
      if (s === 'none' && !note) {
        delete record[id];
      } else {
        const entry = { t: new Date().toISOString() };
        if (s !== 'none') entry.s = s;
        if (note) entry.n = note;
        record[id] = entry;
      }
      if (!record._meta) record._meta = { v: 1 };

      const putRes = await fetch(`${JSONBIN_BASE}/${binId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': masterKey },
        body: JSON.stringify(record),
      });
      if (!putRes.ok) throw new Error(`jsonbin PUT ${putRes.status}`);

      return json(200, { ok: true, overrides: publicView(record) });
    }

    return json(405, { ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error('jsonbin upstream error:', err.message);
    return json(502, { ok: false, error: 'upstream' });
  }
};
