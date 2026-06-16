// KPI / weekly-targets backend: password check + JSONBin proxy (separate bin).
// A single current week with a flat list of steps {id,label,target,current}.
// GET  /api/kpis                 -> { ok, week, steps: [...] }
// POST /api/kpis {action,...}    -> mutate (set-week/add-step/edit-step/delete-step), return { ok, week, steps }
import { timingSafeEqual } from 'node:crypto';

const JSONBIN_BASE = process.env.JSONBIN_BASE || 'https://api.jsonbin.io/v3/b';
const KPIS_BIN_ID = process.env.KPIS_BIN_ID || '6a31069af5f4af5e29f9d82a';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_STEPS = 50;
const MAX_LABEL = 40;
const MAX_WEEK = 16;
const MAX_NUM = 1_000_000;

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
  const res = await fetch(`${JSONBIN_BASE}/${KPIS_BIN_ID}/latest`, {
    headers: { 'X-Master-Key': masterKey, 'X-Bin-Meta': 'false' },
  });
  if (!res.ok) throw new Error(`jsonbin GET ${res.status}`);
  return res.json();
}

async function putRecord(masterKey, record) {
  const res = await fetch(`${JSONBIN_BASE}/${KPIS_BIN_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': masterKey },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`jsonbin PUT ${res.status}`);
}

const stepsOf = (record) => (Array.isArray(record?.steps) ? record.steps : []);
const weekOf = (record) => (typeof record?.week === 'string' ? record.week : '');

// Coerce to a non-negative integer within [0, MAX_NUM]; returns null if not a finite number.
const clampNum = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_NUM, Math.max(0, n));
};

export default async (req) => {
  if (!passwordOk(req)) return json(401, { ok: false, error: 'unauthorized' });

  const masterKey = process.env.JSONBIN_MASTER_KEY;
  if (!masterKey) return json(500, { ok: false, error: 'misconfigured' });

  try {
    if (req.method === 'GET') {
      const record = await fetchRecord(masterKey);
      return json(200, { ok: true, week: weekOf(record), steps: stepsOf(record) });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = await req.json();
      } catch {
        return json(400, { ok: false, error: 'invalid json' });
      }
      const { action, id = '' } = body || {};

      // A fresh/manually-seeded bin can hold an array or junk; treat anything
      // that isn't a usable object as "empty" and start a clean record rather
      // than 502'ing. The whole record round-trips as one value, so there's no
      // partial-write risk to guard against here.
      const raw = await fetchRecord(masterKey);
      const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      let week = weekOf(record);
      let steps = stepsOf(record);

      if (action === 'set-week') {
        const w = typeof body.week === 'string' ? body.week.trim() : '';
        if (w.length > MAX_WEEK) return json(400, { ok: false, error: 'invalid week' });
        week = w;
      } else if (action === 'add-step') {
        const label = typeof body.label === 'string' ? body.label.trim() : '';
        if (!label || label.length > MAX_LABEL) return json(400, { ok: false, error: 'invalid label' });
        const target = clampNum(body.target);
        if (target == null) return json(400, { ok: false, error: 'invalid target' });
        if (steps.length >= MAX_STEPS) return json(400, { ok: false, error: 'too many steps' });
        steps = [...steps, { id: crypto.randomUUID(), label, target, current: 0 }];
      } else if (action === 'edit-step') {
        if (!UUID_RE.test(id)) return json(400, { ok: false, error: 'invalid id' });
        const patch = {};
        if (body.label !== undefined) {
          const label = typeof body.label === 'string' ? body.label.trim() : '';
          if (!label || label.length > MAX_LABEL) return json(400, { ok: false, error: 'invalid label' });
          patch.label = label;
        }
        if (body.target !== undefined) {
          const target = clampNum(body.target);
          if (target == null) return json(400, { ok: false, error: 'invalid target' });
          patch.target = target;
        }
        if (body.current !== undefined) {
          const current = clampNum(body.current);
          if (current == null) return json(400, { ok: false, error: 'invalid current' });
          patch.current = current;
        }
        steps = steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
      } else if (action === 'delete-step') {
        if (!UUID_RE.test(id)) return json(400, { ok: false, error: 'invalid id' });
        steps = steps.filter((s) => s.id !== id);
      } else {
        return json(400, { ok: false, error: 'invalid action' });
      }

      record.week = week;
      record.steps = steps;
      if (!record._meta) record._meta = { v: 1 };
      await putRecord(masterKey, record);
      return json(200, { ok: true, week, steps });
    }

    return json(405, { ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error('kpis upstream error:', err.message);
    return json(502, { ok: false, error: 'upstream' });
  }
};
