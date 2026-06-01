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
const RESPONSES_HEADERS = ['id', 'created_at', 'student_email', 'student_name', 'google_sub', 'prompt_id', 'prompt_title', 'body', 'ai_feedback', 'ai_reviewed_at', 'ai_model', 'flagged', 'flag_reason'];
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const REVIEW_SYSTEM_PROMPT =
  "You are a supportive teacher reviewing a student's response to a class prompt. " +
  "Return a single JSON object matching the provided schema with two fields:\n\n" +
  "1. feedback: Brief 2-4 sentence feedback for the student. Highlight one thing " +
  "they did well and one concrete next step. Speak warmly in the second person, " +
  "plain prose, no lists or headings.\n\n" +
  "2. distress_detected (boolean) and distress_reason (string): Carefully assess " +
  "whether the response shows any signs of distress, self-harm, suicidal ideation, " +
  "abuse, or safety concerns. Set distress_detected to true for any such signs — " +
  "including subtle ones like hopelessness, expressions of worthlessness, isolation, " +
  "or indirect references. When in doubt, prefer true so a teacher can review. " +
  "If true, distress_reason should briefly state what you noticed in one short " +
  "sentence. If false, distress_reason can be empty.\n\n" +
  "The student never sees distress_reason — it is only used to alert their teacher.";
const DEFAULT_RESOURCE_MESSAGE =
  "Thanks for sharing — that took courage. Your teacher has been notified and " +
  "will follow up with you. If you need to talk to someone right now, please reach " +
  "out to your school counsellor or a trusted adult.";

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

      case 'list_responses_for_prompt':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, responses: listResponsesForPrompt_(payload.prompt_id || '') });

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
    '',
    '',
    '',
    false,
    '',
  ]);
  const rowIndex = sheet.getLastRow();

  let aiFeedback = '';
  let aiReviewedAt = '';
  let aiModel = '';
  let flagged = false;
  let flagReason = '';

  try {
    const review = getGeminiReview_(prompt, body);
    const reviewedDate = new Date();
    aiReviewedAt = reviewedDate.toISOString();

    if (review.distress_detected) {
      flagged = true;
      flagReason = review.distress_reason || 'Distress signals detected';
      aiModel = review.model + ' (flagged)';
      aiFeedback = PropertiesService.getScriptProperties().getProperty('STUDENT_RESOURCE_MESSAGE') || DEFAULT_RESOURCE_MESSAGE;
      sheet.getRange(rowIndex, 9, 1, 5).setValues([[aiFeedback, reviewedDate, aiModel, true, flagReason]]);
      try {
        sendDistressAlert_(prompt, claims, body, flagReason);
      } catch (mailErr) {
        Logger.log('Failed to send distress alert: ' + mailErr);
      }
    } else {
      aiFeedback = review.feedback;
      aiModel = review.model;
      sheet.getRange(rowIndex, 9, 1, 5).setValues([[aiFeedback, reviewedDate, aiModel, false, '']]);
    }
  } catch (err) {
    Logger.log('Gemini review failed: ' + err);
  }

  return {
    id,
    created_at: createdAt.toISOString(),
    student_email: claims.email,
    prompt_id: promptId,
    prompt_title: prompt.title,
    body,
    ai_feedback: aiFeedback,
    ai_reviewed_at: aiReviewedAt,
    ai_model: aiModel,
    flagged,
  };
}

function sendDistressAlert_(prompt, claims, responseBody, flagReason) {
  const props = PropertiesService.getScriptProperties();
  const teacherEmail = prompt.teacher_email;
  const adminEmail = props.getProperty('ALERT_EMAIL') || '';

  if (!teacherEmail && !adminEmail) {
    Logger.log('No alert recipient configured');
    return;
  }

  const sheetUrl = getSheetUrl_();
  const subject = '[AISA Student Hub] Student response flagged for review';
  const body =
    'A student response was flagged for possible distress signals and may need follow-up.\n\n' +
    'Student: ' + (claims.name || '') + ' <' + claims.email + '>\n' +
    'Prompt: ' + (prompt.title || '(untitled)') + '\n\n' +
    'Why flagged: ' + (flagReason || 'Detected distress signals') + '\n\n' +
    'Prompt body:\n' + (prompt.body || '') + '\n\n' +
    'Student response:\n' + responseBody + '\n\n' +
    (sheetUrl ? 'Sheet: ' + sheetUrl + '\n\n' : '') +
    'The student saw a supportive resource message instead of AI feedback. ' +
    'This email was sent automatically by the AISA Student Hub.';

  const options = { subject: subject, body: body };
  options.to = teacherEmail || adminEmail;
  if (adminEmail && teacherEmail && adminEmail.toLowerCase() !== teacherEmail.toLowerCase()) {
    options.cc = adminEmail;
  }
  MailApp.sendEmail(options);
}

function getGeminiReview_(prompt, responseBody) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;

  const userText =
    'Prompt title: ' + (prompt.title || '(untitled)') + '\n\n' +
    'Prompt:\n' + (prompt.body || '') + '\n\n' +
    'Student response:\n' + responseBody;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              encodeURIComponent(model) + ':generateContent?key=' +
              encodeURIComponent(apiKey);

  const requestBody = {
    systemInstruction: { parts: [{ text: REVIEW_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          feedback: { type: 'string' },
          distress_detected: { type: 'boolean' },
          distress_reason: { type: 'string' },
        },
        required: ['feedback', 'distress_detected'],
      },
    },
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Gemini API ' + code + ': ' + res.getContentText().slice(0, 200));
  }

  const data = JSON.parse(res.getContentText());
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error('No candidate in Gemini response');

  const finishReason = candidate.finishReason || 'UNKNOWN';
  const text =
    (candidate.content && candidate.content.parts && candidate.content.parts[0] &&
     candidate.content.parts[0].text) || '';

  // If Gemini's safety filter intervened, treat that as distress detected too —
  // the model couldn't even finish, which itself is a strong signal worth a
  // teacher review.
  if (finishReason !== 'STOP') {
    Logger.log('Gemini non-STOP finish: ' + finishReason);
    return {
      feedback: '',
      distress_detected: true,
      distress_reason: 'Gemini safety filter triggered (' + finishReason + ')',
      model,
    };
  }

  if (!text) throw new Error('Empty Gemini response');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('Could not parse JSON from Gemini: ' + text.slice(0, 200));
  }

  return {
    feedback: String(parsed.feedback || '').trim(),
    distress_detected: !!parsed.distress_detected,
    distress_reason: String(parsed.distress_reason || '').trim(),
    model,
  };
}

function listResponsesForPrompt_(promptId) {
  if (!promptId) return [];
  const sheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, RESPONSES_HEADERS.length).getValues();
  return values
    .filter(r => r[5] === promptId)
    .map(r => ({
      id: r[0],
      created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      student_email: r[2],
      student_name: r[3],
      body: r[7],
      ai_feedback: r[8] || '',
      ai_reviewed_at: r[9] instanceof Date ? r[9].toISOString() : (r[9] ? String(r[9]) : ''),
      ai_model: r[10] || '',
      flagged: r[11] === true || String(r[11]).toLowerCase() === 'true',
      flag_reason: r[12] || '',
    }))
    .sort((a, b) => {
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
      return a.created_at < b.created_at ? 1 : -1;
    });
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
      ai_feedback: r[8] || '',
      ai_reviewed_at: r[9] instanceof Date ? r[9].toISOString() : (r[9] ? String(r[9]) : ''),
      ai_model: r[10] || '',
      flagged: r[11] === true || String(r[11]).toLowerCase() === 'true',
      // flag_reason (r[12]) is intentionally not returned to students.
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
  } else {
    ensureHeaders_(sheet, headers);
  }
  return sheet;
}

function ensureHeaders_(sheet, expectedHeaders) {
  const lastCol = sheet.getLastColumn();
  if (lastCol >= expectedHeaders.length) return;
  const startCol = lastCol + 1;
  const newCols = expectedHeaders.slice(lastCol);
  sheet.getRange(1, startCol, 1, newCols.length).setValues([newCols]);
}

function getSheetUrl_() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return sheetId ? 'https://docs.google.com/spreadsheets/d/' + sheetId : null;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
