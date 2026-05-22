// Apps Script backend for AISA Student Hub.
// Paste this into a new Apps Script project, set the two script properties
// listed in SETUP.md, and deploy as a Web app (Execute as: Me, Access: Anyone).

const ALLOWED_HD = 'aisa.sch.ae';
const SHEET_NAME = 'StudentEvents';
const HEADERS = ['server_timestamp', 'email', 'name', 'google_sub', 'action', 'client_timestamp'];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const idToken = payload.idToken;
    const action = payload.action || '';
    const clientTimestamp = payload.clientTimestamp || '';

    if (!idToken) return jsonOut_({ ok: false, error: 'missing idToken' });

    const claims = verifyIdToken_(idToken);
    if (!claims) return jsonOut_({ ok: false, error: 'invalid idToken' });
    if (claims.hd !== ALLOWED_HD) return jsonOut_({ ok: false, error: 'wrong domain' });

    const sheet = getOrCreateSheet_();
    const serverTimestamp = new Date();
    sheet.appendRow([
      serverTimestamp,
      claims.email,
      claims.name || '',
      claims.sub,
      action,
      clientTimestamp,
    ]);
    return jsonOut_({ ok: true, timestamp: serverTimestamp.toISOString() });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut_({ ok: true, service: 'AISA Student Hub', sheet: getSheetUrl_() });
}

function verifyIdToken_(idToken) {
  const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const info = JSON.parse(res.getContentText());
  const expectedAud = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!expectedAud) throw new Error('GOOGLE_CLIENT_ID script property not set');
  if (info.aud !== expectedAud) return null;
  if (Number(info.exp) * 1000 < Date.now()) return null;
  return info;
}

function getOrCreateSheet_() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('SHEET_ID');
  let ss;
  if (sheetId) {
    ss = SpreadsheetApp.openById(sheetId);
  } else {
    ss = SpreadsheetApp.create('AISA Student Hub - Events');
    props.setProperty('SHEET_ID', ss.getId());
  }
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSheetUrl_() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return sheetId ? 'https://docs.google.com/spreadsheets/d/' + sheetId : null;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
