# Säljkartan Stockholm

Password-gated field sales map for two people. 1,402 Stockholm food facilities
(from Livsmedelskollen data) as colored dots:

- **Grey** — not visited
- **Blue** — visited / in progress
- **Yellow** — avvakta (hold off: not in target group right now, hotels etc.)
- **Green** — converted customer
- **Red outline** — "Med avvikelser" at last inspection (a sales opening)

Tap a dot → bottom sheet with facility info, status buttons, and shared notes.
Status + notes are stored in a JSONBin.io bin, shared live between both phones.
Facility data itself is baked into the deploy (`public/data/facilities.json`).

## One-time setup

### 1. Create the JSONBin bin

```bash
curl -X POST https://api.jsonbin.io/v3/b \
  -H "X-Master-Key: <YOUR_JSONBIN_MASTER_KEY>" \
  -H "Content-Type: application/json" \
  -H "X-Bin-Private: true" \
  -H "X-Bin-Name: sales-map-state" \
  -d '{"_meta":{"v":1}}'
```

Copy `metadata.id` from the response — that is your `JSONBIN_BIN_ID`.
(Master key: jsonbin.io → API Keys.)

### 2. Deploy to Netlify

Either connect this folder as a GitHub repo to Netlify (no build command,
publish directory `public`), or use the CLI:

```bash
netlify deploy --prod
```

> Note: if the CLI fails with `EACCES … Preferences/netlify/config.json`,
> the config is root-owned from an old sudo install. Fix once with:
> `sudo chown -R $(whoami) ~/Library/Preferences/netlify`

### 3. Set environment variables (Netlify → Site settings → Environment variables)

| Variable | Value |
|---|---|
| `JSONBIN_MASTER_KEY` | your JSONBin master key |
| `JSONBIN_BIN_ID` | from step 1 |
| `APP_PASSWORD` | the shared password you and your friend use |

Done. Open the site on your phones, enter the password, start knocking on doors.

## Google Sheet sync (optional)

Every save can also be mirrored to a Google Sheet, into two tabs:
**"Status"** — current state, one row per facility (upserted), and
**"Logg"** — append-only history where every change adds a row (backup;
nothing is ever overwritten).

1. Open your spreadsheet → Extensions → Apps Script → paste
   `google-apps-script/Code.gs` → save.
2. Deploy → New deployment → Web app → Execute as **Me**, access **Anyone**
   → copy the web app URL.
3. Add env var `GSHEET_WEBHOOK_URL=<that URL>` in Netlify (and `.env` locally).

To push everything already saved in the bin into the sheet once:

```bash
node --env-file=.env scripts/backfill-sheet.mjs
```

If the env var is unset the app works exactly as before; webhook failures
never block a save (JSONBin stays the source of truth).

## How sharing works

- Both phones use the same password and the same bin.
- Every save returns the full latest state, and the app re-syncs whenever you
  return to it (and via the ↻ button) — so you see each other's progress.
- If a save fails (tunnel, dead spot), it's kept in a local queue and resent
  automatically when you're back online. The dot color updates immediately either way.
- No auto-polling: JSONBin's free tier is 10k requests/month, which is plenty
  for field use but not for polling loops.

## Refreshing facility data

```bash
yarn install       # first time only
yarn fetch         # sweeps the Stockholm API -> data-src/all-facilities.json (~1 min)
yarn data          # regenerates public/data/facilities.json
```

Then redeploy. Statuses are keyed by facility UUID, so existing progress survives.

The Stockholm API caps every response at 1,500 rows, so `yarn fetch` sweeps the
municipality with area queries (splitting any capped cell in four) and dedupes —
~8,500 facilities as of June 2026. `yarn data` drops ~97 facilities with no
coordinates (food trucks, ships), converts SWEREF99 → WGS84, and verifies the
conversion against a known landmark. Email/website enrichment still merges from
`/Users/savascal/Desktop/kollis-growth-hack/021_livsmedelskollen/out/enriched_facilities.csv`.

## Local development

```bash
yarn dev    # app + function on :8888, mock JSONBin on :9999
```

Open http://localhost:8888 — password `testpass`. The mock JSONBin only starts
when `JSONBIN_BASE` in `.env` points at localhost; point `.env` at your real
bin (and remove `JSONBIN_BASE`) to test against production data.

`.env` (gitignored) for local dev:

```
APP_PASSWORD=testpass
JSONBIN_BIN_ID=localbin
JSONBIN_MASTER_KEY=test-master-key
JSONBIN_BASE=http://localhost:9999/v3/b
```

In production the function talks to the real JSONBin (don't set `JSONBIN_BASE`).

## Known limits

- Two users saving **different** facilities in the same instant has a ~300 ms
  lost-update window (JSONBin has no conditional writes). Acceptable for 2 users;
  every save and every app-focus re-syncs both phones.
- The JSONBin master key never reaches the browser — all traffic goes through
  the Netlify Function (`netlify/functions/state.mjs`), which checks the password
  server-side.
