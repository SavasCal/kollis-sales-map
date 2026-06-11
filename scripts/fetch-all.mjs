// Fetch ALL Stockholm food facilities from the Livsmedelskollen API.
// The API caps every response at 1,500 rows, so we sweep the municipality with
// a quadtree of area queries: if a cell comes back capped, split it in 4.
// Output: data-src/all-facilities.json (trimmed rows, deduped by Id).
import { writeFileSync, mkdirSync } from 'node:fs';

const ENDPOINT =
  'https://etjanster.stockholm.se/Livsmedelsinspektioner/Livsmedelsinspektioner/SearchFacilitiesMap';
const CAP = 1500;
const MIN_RADIUS = 400; // meters; below this a cap means a true hyper-dense spot
const DELAY_MS = 300;
const OUT_FILE = new URL('../data-src/all-facilities.json', import.meta.url).pathname;

// Generous SWEREF99 18 00 bounds for Stockholm municipality
const EXTENT = { eMin: 134000, eMax: 172000, nMin: 6554000, nMax: 6602000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(payload, attempt = 1) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: '*/*',
        Origin: 'https://etjanster.stockholm.se',
        Referer: 'https://etjanster.stockholm.se/livsmedelsinspektioner/',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 3) throw err;
    console.log(`  retry ${attempt} after error: ${err.message}`);
    await sleep(2000 * attempt);
    return query(payload, attempt + 1);
  }
}

function trim(row) {
  const inspections = row.InspectionList || [];
  let last = null;
  for (const ins of inspections) {
    if (!last || (ins.InspectionDate || '') > (last.InspectionDate || '')) last = ins;
  }
  return {
    Id: row.Id,
    Name: row.Name,
    Address: row.Address,
    Business: row.Business,
    ReviewLabel: row.ReviewLabel,
    SweRefCoordinateEasting: row.SweRefCoordinateEasting,
    SweRefCoordinateNorthing: row.SweRefCoordinateNorthing,
    LastInspectionDate: last?.InspectionDate ? last.InspectionDate.slice(0, 10) : '',
    LastInspectionText: last?.SummaryText || '',
  };
}

const byId = new Map();
let requests = 0;
let capped = 0;

function addAll(rows) {
  for (const row of rows) if (row.Id && !byId.has(row.Id)) byId.set(row.Id, trim(row));
}

async function sweep(eMin, eMax, nMin, nMax) {
  const east = (eMin + eMax) / 2;
  const north = (nMin + nMax) / 2;
  // Circumscribed circle so the whole rectangle is covered
  const radius = Math.ceil(Math.hypot(eMax - eMin, nMax - nMin) / 2);

  await sleep(DELAY_MS);
  const rows = await query({
    NorthCoordinate: north,
    EastCoordinate: east,
    MaxDistanceAllowedFromPoint: radius,
  });
  requests++;
  process.stdout.write(
    `\r${requests} requests, ${byId.size} unique, cell r=${radius}m -> ${rows.length}   `
  );

  if (rows.length >= CAP && radius > MIN_RADIUS) {
    capped++;
    await sweep(eMin, east, nMin, north);
    await sweep(east, eMax, nMin, north);
    await sweep(eMin, east, north, nMax);
    await sweep(east, eMax, north, nMax);
  } else {
    if (rows.length >= CAP) console.log(`\nWARN: capped at floor radius ${radius}m — some facilities may be missing here`);
    addAll(rows);
  }
}

console.log('Sweeping Stockholm municipality…');
await sweep(EXTENT.eMin, EXTENT.eMax, EXTENT.nMin, EXTENT.nMax);

// One plain query to also catch zero-coordinate mobile units (food trucks etc.)
addAll(await query({}));
requests++;

const all = [...byId.values()];
mkdirSync(new URL('../data-src', import.meta.url).pathname, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(all));

console.log(`\ndone: ${all.length} unique facilities, ${requests} requests, ${capped} capped cells split`);
const labels = {};
for (const f of all) labels[f.ReviewLabel] = (labels[f.ReviewLabel] || 0) + 1;
console.log('by review label:', labels);
