// API wrapper: password handling, /api/state calls, offline retry queue.

const PASSWORD_KEY = 'salesmap_password';
const QUEUE_KEY = 'salesmap_pending';

export const getPassword = () => localStorage.getItem(PASSWORD_KEY) || '';
export const setPassword = (pw) => localStorage.setItem(PASSWORD_KEY, pw);
export const clearPassword = () => localStorage.removeItem(PASSWORD_KEY);

async function request(method, body) {
  const res = await fetch('/api/state', {
    method,
    headers: {
      'x-app-password': getPassword(),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    clearPassword();
    window.dispatchEvent(new Event('auth-failed'));
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `http ${res.status}`);
  return data;
}

export const getState = () => request('GET');
export const saveOverride = (payload) => request('POST', payload);

// ---- Pending-save queue (survives reloads; last write wins per facility) ----

const readQueue = () => {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
};
const writeQueue = (q) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));

export function enqueueSave(item) {
  const q = readQueue().filter((p) => p.id !== item.id);
  q.push(item);
  writeQueue(q);
}

export const pendingCount = () => readQueue().length;

let flushing = false;
// Sends queued saves one by one; on the first failure, stops and keeps the rest.
export async function flushQueue(onFlushed) {
  if (flushing) return;
  flushing = true;
  try {
    let q = readQueue();
    while (q.length) {
      const item = q[0];
      const data = await saveOverride(item);
      q = q.slice(1);
      writeQueue(q);
      onFlushed?.(data.overrides);
    }
  } catch {
    /* still offline or upstream down — queue is preserved */
  } finally {
    flushing = false;
  }
}
