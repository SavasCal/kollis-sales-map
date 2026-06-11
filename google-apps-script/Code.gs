/**
 * Säljkartan -> Google Sheet sync.
 *
 * Install (one time, ~2 minutes):
 * 1. Open the spreadsheet -> Extensions -> Apps Script.
 * 2. Replace the editor contents with this file, save.
 * 3. Deploy -> New deployment -> type "Web app":
 *      Execute as: Me
 *      Who has access: Anyone
 *    -> Deploy, approve the permissions, copy the Web app URL.
 * 4. Put that URL in Netlify env var GSHEET_WEBHOOK_URL (and .env locally).
 *
 * After editing this code later: Deploy -> Manage deployments -> pencil icon
 * -> Version: New version -> Deploy (the URL stays the same).
 *
 * Two tabs are maintained on every save:
 *  - "Status": one row per facility (upsert, keyed by Id) — current state.
 *  - "Logg":   append-only history — every change becomes a new row. Backup.
 * Accepts a single entry or an array (used by backfill).
 */
var STATUS_SHEET = 'Status';
var LOG_SHEET = 'Logg';
var STATUS_HEADERS = ['Id', 'Namn', 'Adress', 'Typ', 'Status', 'Besökt den', 'Återkom den', 'Verktyg', 'Anteckning', 'Uppdaterad'];
var LOG_HEADERS = ['Loggad', 'Namn', 'Adress', 'Typ', 'Status', 'Besökt den', 'Återkom den', 'Verktyg', 'Anteckning', 'Id'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body = JSON.parse(e.postData.contents);
    var entries = Array.isArray(body) ? body : [body];

    var status = getSheet_(STATUS_SHEET, STATUS_HEADERS);
    var log = getSheet_(LOG_SHEET, LOG_HEADERS);
    var last = status.getLastRow();
    var ids = last > 1 ? status.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];

    entries.forEach(function (en) {
      if (!en || !en.id) return;
      var when = en.updated || new Date().toISOString();

      // Append-only backup log: one new row per change, never overwritten
      log.appendRow([
        when, en.name || '', en.address || '', en.business || '',
        en.status || '', en.visited || '', en.comeback || '',
        en.tools || '', en.note || '', en.id,
      ]);

      // Current-state tab: upsert keyed by Id
      var row = [
        en.id, en.name || '', en.address || '', en.business || '',
        en.status || '', en.visited || '', en.comeback || '',
        en.tools || '', en.note || '', when,
      ];
      var idx = ids.indexOf(String(en.id));
      if (idx === -1) {
        status.appendRow(row);
        ids.push(String(en.id));
      } else {
        status.getRange(idx + 2, 1, 1, STATUS_HEADERS.length).setValues([row]);
      }
    });

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, count: entries.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}
