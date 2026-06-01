// Apps Script backend for AISA Student Hub.
// Paste this into your Apps Script project, set the script properties listed
// in SETUP.md, and redeploy as a new version of the existing Web app
// (Deploy > Manage deployments > Edit > Version: New version > Deploy).
// Keeping the same deployment preserves the URL in config.js.

const ALLOWED_HD = 'aisa.sch.ae';
const EVENTS_SHEET = 'StudentEvents';
const PROMPTS_SHEET = 'Prompts';
const RESPONSES_SHEET = 'Responses';
const EVENTS_HEADERS = ['server_timestamp', 'email', 'name', 'google_sub', 'action', 'client_timestamp'];
const PROMPTS_HEADERS = ['id', 'created_at', 'teacher_email', 'title', 'body', 'status'];
const RESPONSES_HEADERS = ['id', 'created_at', 'student_email', 'student_name', 'google_sub', 'prompt_id', 'prompt_title', 'body'];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || '';
    const idToken = payload.idToken;
    if (!idToken) return jsonOut_({ ok: false, error: 'missing idToken' });

    const claims = verifyIdToken_(idToken);
    if (!claims) return jsonOut_({ ok: false, error: 'invalid idToken' });
    if (claims.hd !== ALLOWED_HD) return jsonOut_({ ok: false, error: 'wrong domain' });

    switch (action) {
      case 'whoami':
        return jsonOut_({
          ok: true,
          email: claims.email,
          name: claims.name || '',
          is_teacher: isTeacher_(claims.email),
        });

      case 'list_prompts':
        return jsonOut_({ ok: true, prompts: listActivePrompts_() });

      case 'create_prompt':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({
          ok: true,
          prompt: createPrompt_(claims.email, payload.title || '', payload.body || ''),
        });

      case 'submit_response':
        return jsonOut_({
          ok: true,
          response: submitResponse_(claims, payload.prompt_id || '', payload.body || ''),
        });

      case 'list_my_responses':
        return jsonOut_({ ok: true, responses: listResponsesForStudent_(claims.sub) });

      case 'im_here':
        return jsonOut_(logEvent_(claims, 'im_here', payload.clientTimestamp || ''));

      default:
        return jsonOut_({ ok: false, error: 'unknown action: ' + action });
    }
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

function isTeacher_(email) {
  const raw = PropertiesService.getScriptProperties().getProperty('TEACHER_EMAILS') || '';
  const allowed = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return allowed.indexOf(String(email).toLowerCase()) !== -1;
}

function logEvent_(claims, action, clientTimestamp) {
  const sheet = getOrCreateSheet_(EVENTS_SHEET, EVENTS_HEADERS);
  const serverTimestamp = new Date();
  sheet.appendRow([
    serverTimestamp,
    claims.email,
    claims.name || '',
    claims.sub,
    action,
    clientTimestamp,
  ]);
  return { ok: true, timestamp: serverTimestamp.toISOString() };
}

function listActivePrompts_() {
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, PROMPTS_HEADERS.length).getValues();
  return values
    .filter(r => String(r[5]).toLowerCase() === 'active')
    .map(r => ({
      id: r[0],
      created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      teacher_email: r[2],
      title: r[3],
      body: r[4],
      status: r[5],
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function getPromptById_(promptId) {
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, PROMPTS_HEADERS.length).getValues();
  for (const r of values) {
    if (r[0] === promptId) {
      return { id: r[0], created_at: r[1], teacher_email: r[2], title: r[3], body: r[4], status: r[5] };
    }
  }
  return null;
}

function submitResponse_(claims, promptId, body) {
  if (!promptId) throw new Error('prompt_id is required');
  if (!String(body).trim()) throw new Error('response is empty');

  const prompt = getPromptById_(promptId);
  if (!prompt) throw new Error('prompt not found');
  if (String(prompt.status).toLowerCase() !== 'active') throw new Error('prompt is not active');

  const sheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const id = Utilities.getUuid();
  const createdAt = new Date();
  sheet.appendRow([
    id,
    createdAt,
    claims.email,
    claims.name || '',
    claims.sub,
    promptId,
    prompt.title,
    body,
  ]);
  return {
    id,
    created_at: createdAt.toISOString(),
    student_email: claims.email,
    prompt_id: promptId,
    prompt_title: prompt.title,
    body,
  };
}

function listResponsesForStudent_(googleSub) {
  const sheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, RESPONSES_HEADERS.length).getValues();
  return values
    .filter(r => r[4] === googleSub)
    .map(r => ({
      id: r[0],
      created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      prompt_id: r[5],
      prompt_title: r[6],
      body: r[7],
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function createPrompt_(teacherEmail, title, body) {
  if (!String(title).trim() && !String(body).trim()) throw new Error('prompt is empty');
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const id = Utilities.getUuid();
  const createdAt = new Date();
  sheet.appendRow([id, createdAt, teacherEmail, title, body, 'active']);
  return {
    id,
    created_at: createdAt.toISOString(),
    teacher_email: teacherEmail,
    title,
    body,
    status: 'active',
  };
}

function getOrCreateSheet_(name, headers) {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('SHEET_ID');
  let ss;
  if (sheetId) {
    ss = SpreadsheetApp.openById(sheetId);
  } else {
    ss = SpreadsheetApp.create('AISA Student Hub - Events');
    props.setProperty('SHEET_ID', ss.getId());
  }
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
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
