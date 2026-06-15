// Shared task list backend: password check + JSONBin proxy (separate bin).
// GET  /api/tasks                    -> { ok, tasks: [...] }
// POST /api/tasks {action,...}       -> mutate (add/toggle/delete), return { ok, tasks }
import { timingSafeEqual } from 'node:crypto';

const JSONBIN_BASE = process.env.JSONBIN_BASE || 'https://api.jsonbin.io/v3/b';
const TASKS_BIN_ID = process.env.TASKS_BIN_ID || '6a2fb787da38895dfec25e5e';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TASKS = 500;

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
  const res = await fetch(`${JSONBIN_BASE}/${TASKS_BIN_ID}/latest`, {
    headers: { 'X-Master-Key': masterKey, 'X-Bin-Meta': 'false' },
  });
  if (!res.ok) throw new Error(`jsonbin GET ${res.status}`);
  return res.json();
}

async function putRecord(masterKey, record) {
  const res = await fetch(`${JSONBIN_BASE}/${TASKS_BIN_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': masterKey },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`jsonbin PUT ${res.status}`);
}

const tasksOf = (record) => (Array.isArray(record?.tasks) ? record.tasks : []);

export default async (req) => {
  if (!passwordOk(req)) return json(401, { ok: false, error: 'unauthorized' });

  const masterKey = process.env.JSONBIN_MASTER_KEY;
  if (!masterKey) return json(500, { ok: false, error: 'misconfigured' });

  try {
    if (req.method === 'GET') {
      const record = await fetchRecord(masterKey);
      return json(200, { ok: true, tasks: tasksOf(record) });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = await req.json();
      } catch {
        return json(400, { ok: false, error: 'invalid json' });
      }
      const { action, id = '', text = '', order = [] } = body || {};

      // A fresh/manually-seeded bin can hold an array or junk; treat anything
      // that isn't a usable object as "empty" and start a clean record rather
      // than 502'ing. The whole tasks array round-trips as one value, so there's
      // no partial-write risk to guard against here.
      const raw = await fetchRecord(masterKey);
      const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      let tasks = tasksOf(record);

      if (action === 'add') {
        const t = typeof text === 'string' ? text.trim() : '';
        if (!t || t.length > 500) return json(400, { ok: false, error: 'invalid text' });
        if (tasks.length >= MAX_TASKS) return json(400, { ok: false, error: 'too many tasks' });
        tasks = [...tasks, { id: crypto.randomUUID(), text: t, done: false, t: new Date().toISOString() }];
      } else if (action === 'toggle') {
        if (!UUID_RE.test(id)) return json(400, { ok: false, error: 'invalid id' });
        tasks = tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task));
      } else if (action === 'delete') {
        if (!UUID_RE.test(id)) return json(400, { ok: false, error: 'invalid id' });
        tasks = tasks.filter((task) => task.id !== id);
      } else if (action === 'reorder') {
        if (!Array.isArray(order) || !order.every((x) => UUID_RE.test(x))) {
          return json(400, { ok: false, error: 'invalid order' });
        }
        // Reorder to match `order`; any task id not listed keeps its place at the end.
        const byId = new Map(tasks.map((t) => [t.id, t]));
        const ranked = order.map((x) => byId.get(x)).filter(Boolean);
        const seen = new Set(ranked.map((t) => t.id));
        tasks = [...ranked, ...tasks.filter((t) => !seen.has(t.id))];
      } else {
        return json(400, { ok: false, error: 'invalid action' });
      }

      record.tasks = tasks;
      if (!record._meta) record._meta = { v: 1 };
      await putRecord(masterKey, record);
      return json(200, { ok: true, tasks });
    }

    return json(405, { ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error('tasks upstream error:', err.message);
    return json(502, { ok: false, error: 'upstream' });
  }
};
