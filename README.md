# Säljkartan Stockholm

Password-gated field sales map for two people. 1,402 Stockholm food facilities
(from Livsmedelskollen data) as colored dots:

- **Grey** — not visited
- **Yellow** — visited / in progress
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

## How sharing works

- Both phones use the same password and the same bin.
- Every save returns the full latest state, and the app re-syncs whenever you
  return to it (and via the ↻ button) — so you see each other's progress.
- If a save fails (tunnel, dead spot), it's kept in a local queue and resent
  automatically when you're back online. The dot color updates immediately either way.
- No auto-polling: JSONBin's free tier is 10k requests/month, which is plenty
  for field use but not for polling loops.

## Refreshing facility data

When the source CSVs are re-scraped
(`/Users/savascal/Desktop/kollis-growth-hack/021_livsmedelskollen/out/`):

```bash
npm install        # first time only
npm run data       # regenerates public/data/facilities.json
```

Then redeploy. Statuses are keyed by facility UUID, so existing progress survives.
The script drops ~98 facilities with no coordinates (food trucks, ships) and
verifies the coordinate conversion against a known landmark.

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
