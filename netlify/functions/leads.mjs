// Leads check-off backend: password check + JSONBin proxy (separate bin).
// The lead rows themselves are static (hardcoded in the client); this bin only
// stores which leads have been checked off, as an array of stable string keys.
// GET  /api/leads                  -> { ok, done: [...] }
// POST /api/leads {action,key}     -> toggle a key, return { ok, done }
import { timingSafeEqual } from 'node:crypto';

const JSONBIN_BASE = process.env.JSONBIN_BASE || 'https://api.jsonbin.io/v3/b';
const LEADS_BIN_ID = process.env.LEADS_BIN_ID || '6a3a3e99da38895dfef02bd4';
const MAX_KEY = 300;
const MAX_DONE = 2000;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function passwordOk(req) {
  const expected = process.env.APP_PASSWORD || '';
  const given = req.headers.get('x-app-password') || '';
  if (!expected) return false;
  const len = Math.max(expected.length, given.length);
  return timingSafeEqual(
    Buffer.from(expected.padEnd(len, '\0')),
    Buffer.from(given.padEnd(len, '\0'))
  );
}

async function fetchRecord(masterKey) {
  const res = await fetch(`${JSONBIN_BASE}/${LEADS_BIN_ID}/latest`, {
    headers: { 'X-Master-Key': masterKey, 'X-Bin-Meta': 'false' },
  });
  if (!res.ok) throw new Error(`jsonbin GET ${res.status}`);
  return res.json();
}

async function putRecord(masterKey, record) {
  const res = await fetch(`${JSONBIN_BASE}/${LEADS_BIN_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': masterKey },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`jsonbin PUT ${res.status}`);
}

const doneOf = (record) =>
  Array.isArray(record?.done) ? record.done.filter((x) => typeof x === 'string') : [];

export default async (req) => {
  if (!passwordOk(req)) return json(401, { ok: false, error: 'unauthorized' });

  const masterKey = process.env.JSONBIN_MASTER_KEY;
  if (!masterKey) return json(500, { ok: false, error: 'misconfigured' });

  try {
    if (req.method === 'GET') {
      const record = await fetchRecord(masterKey);
      return json(200, { ok: true, done: doneOf(record) });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = await req.json();
      } catch {
        return json(400, { ok: false, error: 'invalid json' });
      }
      const { action, key = '' } = body || {};
      if (action !== 'toggle') return json(400, { ok: false, error: 'invalid action' });
      const k = typeof key === 'string' ? key : '';
      if (!k || k.length > MAX_KEY) return json(400, { ok: false, error: 'invalid key' });

      // A fresh/manually-seeded bin can hold an array or junk; treat anything
      // that isn't a usable object as "empty" and start a clean record rather
      // than 502'ing. The whole record round-trips as one value, so there's no
      // partial-write risk to guard against here.
      const raw = await fetchRecord(masterKey);
      const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      let done = doneOf(record);

      if (done.includes(k)) {
        done = done.filter((x) => x !== k);
      } else {
        if (done.length >= MAX_DONE) return json(400, { ok: false, error: 'too many' });
        done = [...done, k];
      }

      record.done = done;
      if (!record._meta) record._meta = { v: 1 };
      await putRecord(masterKey, record);
      return json(200, { ok: true, done });
    }

    return json(405, { ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error('leads upstream error:', err.message);
    return json(502, { ok: false, error: 'upstream' });
  }
};
