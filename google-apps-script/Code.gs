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
 * Every save in the app then upserts one row per facility (keyed by Id)
 * into a "Status" tab. Accepts a single entry or an array (used by backfill).
 */
var SHEET_NAME = 'Status';
var HEADERS = ['Id', 'Namn', 'Adress', 'Typ', 'Status', 'Besökt den', 'Återkom den', 'Verktyg', 'Anteckning', 'Uppdaterad'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body = JSON.parse(e.postData.contents);
    var entries = Array.isArray(body) ? body : [body];
    var sh = getSheet_();
    var last = sh.getLastRow();
    var ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];

    entries.forEach(function (en) {
      if (!en || !en.id) return;
      var row = [
        en.id, en.name || '', en.address || '', en.business || '',
        en.status || '', en.visited || '', en.comeback || '',
        en.tools || '', en.note || '', en.updated || new Date().toISOString(),
      ];
      var idx = ids.indexOf(String(en.id));
      if (idx === -1) {
        sh.appendRow(row);
        ids.push(String(en.id));
      } else {
        sh.getRange(idx + 2, 1, 1, HEADERS.length).setValues([row]);
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

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}
