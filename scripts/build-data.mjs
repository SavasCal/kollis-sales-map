// One-time data generation: facilities.csv (+ enriched emails) -> public/data/facilities.json
// Converts SWEREF99 18 00 coordinates to WGS84 and drops rows without coordinates.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import proj4 from 'proj4';

const SRC_DIR = '/Users/savascal/Desktop/kollis-growth-hack/021_livsmedelskollen/out';
const OUT_FILE = new URL('../public/data/facilities.json', import.meta.url).pathname;

const SWEREF99_1800 =
  '+proj=tmerc +lat_0=0 +lon_0=18 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +units=m +no_defs';

const facilities = parse(readFileSync(`${SRC_DIR}/facilities.csv`), { columns: true });
const enriched = parse(readFileSync(`${SRC_DIR}/enriched_facilities.csv`), { columns: true });

const enrichmentById = new Map();
for (const row of enriched) {
  if (row.email || row.website) {
    enrichmentById.set(row.id, { email: row.email || '', website: row.website || '' });
  }
}

const out = [];
const skipped = [];
let emailsMerged = 0;

for (const row of facilities) {
  const easting = Number(row.sweref_easting);
  const northing = Number(row.sweref_northing);
  // Mobile units (food trucks, ships) have 0,0 coordinates and can't be pinned
  if (!easting || !northing || easting < 100000 || northing < 6000000) {
    skipped.push(`${row.name} (${row.address || 'no address'})`);
    continue;
  }
  const [lng, lat] = proj4(SWEREF99_1800, 'EPSG:4326', [easting, northing]);

  const f = {
    id: row.id,
    n: row.name,
    a: row.address,
    b: row.business.replace(/^\d+\.\s*/, ''),
    r: row.review_label,
    d: row.last_inspection_date,
    t: row.last_inspection_result_text,
    la: Math.round(lat * 1e5) / 1e5,
    lo: Math.round(lng * 1e5) / 1e5,
  };
  const extra = enrichmentById.get(row.id);
  if (extra) {
    if (extra.email) { f.e = extra.email; emailsMerged++; }
    if (extra.website) f.w = extra.website;
  }
  out.push(f);
}

// Landmark assertion: Poppina Vitti, Klarabergsviadukten 61, next to Stockholm Central.
// Catches axis-order or projection mistakes permanently.
const landmark = out.find((f) => f.n === 'Poppina Vitti');
if (!landmark || Math.abs(landmark.la - 59.332) > 0.01 || Math.abs(landmark.lo - 18.056) > 0.01) {
  throw new Error(
    `Landmark check failed: Poppina Vitti at ${landmark?.la},${landmark?.lo}, expected ~59.332,18.056`
  );
}

mkdirSync(new URL('../public/data', import.meta.url).pathname, { recursive: true });
const json = JSON.stringify(out);
writeFileSync(OUT_FILE, json);

console.log(`mapped=${out.length} skipped=${skipped.length} withEmail=${emailsMerged} bytes=${json.length}`);
console.log(`landmark OK: Poppina Vitti at ${landmark.la}, ${landmark.lo}`);
if (skipped.length) console.log(`skipped (no coordinates):\n  ${skipped.join('\n  ')}`);
