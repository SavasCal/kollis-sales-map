// Wishlist ("features we need in the wild") backend: password check + JSONBin proxy (separate bin).
// GET  /api/wishes                       -> { ok, wishes: [...] }
// POST /api/wishes {action,...}          -> mutate (add/edit/delete/vote), return { ok, wishes }
import { timingSafeEqual } from 'node:crypto';

const JSONBIN_BASE = process.env.JSONBIN_BASE || 'https://api.jsonbin.io/v3/b';
const WISHES_BIN_ID = process.env.WISHES_BIN_ID || '6a301e38f5f4af5e29f5fc40';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WISHES = 500;

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
  const res = await fetch(`${JSONBIN_BASE}/${WISHES_BIN_ID}/latest`, {
    headers: { 'X-Master-Key': masterKey, 'X-Bin-Meta': 'false' },
  });
  if (!res.ok) throw new Error(`jsonbin GET ${res.status}`);
  return res.json();
}

async function putRecord(masterKey, record) {
  const res = await fetch(`${JSONBIN_BASE}/${WISHES_BIN_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': masterKey },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`jsonbin PUT ${res.status}`);
}

const wishesOf = (record) => (Array.isArray(record?.wishes) ? record.wishes : []);

export default async (req) => {
  if (!passwordOk(req)) return json(401, { ok: false, error: 'unauthorized' });

  const masterKey = process.env.JSONBIN_MASTER_KEY;
  if (!masterKey) return json(500, { ok: false, error: 'misconfigured' });

  try {
    if (req.method === 'GET') {
      const record = await fetchRecord(masterKey);
      return json(200, { ok: true, wishes: wishesOf(record) });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = await req.json();
      } catch {
        return json(400, { ok: false, error: 'invalid json' });
      }
      const { action, id = '', text = '', vote = 1 } = body || {};

      // A fresh/manually-seeded bin can hold an array or junk; treat anything
      // that isn't a usable object as "empty" and start a clean record rather
      // than 502'ing. The whole wishes array round-trips as one value, so there's
      // no partial-write risk to guard against here.
      const raw = await fetchRecord(masterKey);
      const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      let wishes = wishesOf(record);

      if (action === 'add') {
        const t = typeof text === 'string' ? text.trim() : '';
        if (!t || t.length > 500) return json(400, { ok: false, error: 'invalid text' });
        if (wishes.length >= MAX_WISHES) return json(400, { ok: false, error: 'too many wishes' });
        wishes = [...wishes, { id: crypto.randomUUID(), text: t, votes: 0, t: new Date().toISOString() }];
      } else if (action === 'edit') {
        if (!UUID_RE.test(id)) return json(400, { ok: false, error: 'invalid id' });
        const t = typeof text === 'string' ? text.trim() : '';
        if (!t || t.length > 500) return json(400, { ok: false, error: 'invalid text' });
        wishes = wishes.map((w) => (w.id === id ? { ...w, text: t } : w));
      } else if (action === 'delete') {
        if (!UUID_RE.test(id)) return json(400, { ok: false, error: 'invalid id' });
        wishes = wishes.filter((w) => w.id !== id);
      } else if (action === 'vote') {
        if (!UUID_RE.test(id)) return json(400, { ok: false, error: 'invalid id' });
        const step = vote === -1 ? -1 : 1;
        wishes = wishes.map((w) =>
          w.id === id ? { ...w, votes: Math.max(0, (w.votes || 0) + step) } : w
        );
      } else {
        return json(400, { ok: false, error: 'invalid action' });
      }

      record.wishes = wishes;
      if (!record._meta) record._meta = { v: 1 };
      await putRecord(masterKey, record);
      return json(200, { ok: true, wishes });
    }

    return json(405, { ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error('wishes upstream error:', err.message);
    return json(502, { ok: false, error: 'upstream' });
  }
};
