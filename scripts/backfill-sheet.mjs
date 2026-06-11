// One-time backfill: push everything already saved in JSONBin to the Google Sheet.
// Usage: node --env-file=.env scripts/backfill-sheet.mjs
// Needs JSONBIN_BIN_ID, JSONBIN_MASTER_KEY and GSHEET_WEBHOOK_URL in .env.
import { readFileSync } from 'node:fs';

const { JSONBIN_BIN_ID, JSONBIN_MASTER_KEY, GSHEET_WEBHOOK_URL } = process.env;
if (!JSONBIN_BIN_ID || !JSONBIN_MASTER_KEY || !GSHEET_WEBHOOK_URL) {
  console.error('Missing JSONBIN_BIN_ID / JSONBIN_MASTER_KEY / GSHEET_WEBHOOK_URL in .env');
  process.exit(1);
}

const base = process.env.JSONBIN_BASE || 'https://api.jsonbin.io/v3/b';
const res = await fetch(`${base}/${JSONBIN_BIN_ID}/latest`, {
  headers: { 'X-Master-Key': JSONBIN_MASTER_KEY, 'X-Bin-Meta': 'false' },
});
if (!res.ok) throw new Error(`jsonbin GET ${res.status}`);
const { _meta, ...overrides } = await res.json();

const facilities = JSON.parse(
  readFileSync(new URL('../public/data/facilities.json', import.meta.url))
);
const byId = new Map(facilities.map((f) => [f.id, f]));

const entries = Object.entries(overrides).map(([id, o]) => {
  const f = byId.get(id);
  return {
    id,
    name: f?.n || '',
    address: f?.a || '',
    business: f?.b || '',
    status: o.s || '',
    visited: o.v || '',
    comeback: o.c || '',
    tools: o.tools || '',
    note: o.n || '',
    updated: o.t || '',
  };
});

if (!entries.length) {
  console.log('Nothing saved in the bin yet — sheet left untouched.');
  process.exit(0);
}

// Apps Script accepts arrays; chunk to stay well under request limits
for (let i = 0; i < entries.length; i += 100) {
  const chunk = entries.slice(i, i + 100);
  const r = await fetch(GSHEET_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chunk),
    redirect: 'follow',
  });
  console.log(`sent ${i + chunk.length}/${entries.length} -> ${r.status}`);
}
console.log('backfill done');
