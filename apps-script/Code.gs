// Apps Script backend for AISA Student Hub.
// Paste this into your Apps Script project, set the script properties listed
// in SETUP.md, and redeploy as a new version of the existing Web app
// (Deploy > Manage deployments > Edit > Version: New version > Deploy).
// Keeping the same deployment preserves the URL in config.js.

const ALLOWED_HD = 'aisa.sch.ae';
const EVENTS_SHEET = 'StudentEvents';
const PROMPTS_SHEET = 'Prompts';
const RESPONSES_SHEET = 'Responses';
const COMPLETIONS_SHEET = 'Completions';
const COMPLETIONS_HEADERS = ['id', 'completed_at', 'google_sub', 'student_email', 'prompt_id'];
const CHECKOUTS_SHEET = 'CheckOuts';
const CHECKOUTS_HEADERS = ['id', 'student_email', 'student_name', 'google_sub', 'destination', 'teacher_email', 'notes', 'checked_out_at', 'checked_in_at', 'status', 'warning_sent'];
const DEFAULT_OVERDUE_MINUTES = 10;
const EVENTS_HEADERS = ['server_timestamp', 'email', 'name', 'google_sub', 'action', 'client_timestamp'];
const PROMPTS_HEADERS = ['id', 'created_at', 'teacher_email', 'title', 'body', 'status', 'closes_at', 'audience', 'shared_from'];
const RESPONSES_HEADERS = ['id', 'created_at', 'student_email', 'student_name', 'google_sub', 'prompt_id', 'prompt_title', 'body', 'ai_feedback', 'ai_reviewed_at', 'ai_model', 'flagged', 'flag_reason', 'resolved'];
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
const SUMMARY_SYSTEM_PROMPT =
  "You are an educational consultant reading all student responses to a single " +
  "class prompt. Produce a concise, actionable summary for the teacher as a JSON " +
  "object matching the schema:\n\n" +
  "- overview: 2-3 sentence summary of how the class engaged with the prompt.\n" +
  "- themes: 2-5 short bullet sentences capturing common patterns or ideas.\n" +
  "- misconceptions: 0-3 short bullets describing errors, confusions, or gaps. " +
  "Empty array if none.\n" +
  "- follow_up_students: 0-N objects ({email, reason}) for students whose response " +
  "suggests they need extra support — confusion, minimal effort, or distress. " +
  "Be specific and kind. Empty array if none.\n" +
  "- next_steps: 1-3 short, concrete suggestions for the teacher's next class.\n\n" +
  "Ground every observation in what students actually wrote. Don't invent data.";
const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    themes: { type: 'array', items: { type: 'string' } },
    misconceptions: { type: 'array', items: { type: 'string' } },
    follow_up_students: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['email', 'reason'],
      },
    },
    next_steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['overview', 'themes', 'misconceptions', 'follow_up_students', 'next_steps'],
};

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
        return jsonOut_({ ok: true, prompts: listActivePrompts_(claims) });

      case 'mark_complete':
        return jsonOut_(markComplete_(claims, payload.prompt_id || ''));

      case 'unmark_complete':
        return jsonOut_(unmarkComplete_(claims, payload.prompt_id || ''));

      case 'create_prompt':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({
          ok: true,
          prompt: createPrompt_(claims.email, payload.title || '', payload.body || '', payload.closes_at || '', payload.audience || '', '', 'active'),
        });

      case 'share_prompt':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_(sharePrompt_(claims, payload.prompt_id || '', payload.recipient_email || ''));

      case 'list_drafts':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, drafts: listDraftsForTeacher_(claims.email) });

      case 'publish_draft':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_(publishDraft_(claims, payload));

      case 'discard_draft':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_(discardDraft_(claims.email, payload.draft_id || ''));

      case 'list_responses_for_prompt':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, responses: listResponsesForPrompt_(payload.prompt_id || '') });

      case 'summarize_prompt_responses':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, summary: summarizePromptResponses_(payload.prompt_id || '') });

      case 'list_flagged_responses':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, responses: listFlaggedResponses_(payload.include_resolved === true) });

      case 'resolve_flagged_response':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_(resolveFlaggedResponse_(payload.response_id || ''));

      case 'list_students_for_prompt':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, students: listStudentsForPrompt_(payload.prompt_id || '') });

      case 'get_student_thread':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, thread: getStudentThread_(payload.prompt_id || '', payload.google_sub || '', payload.student_email || '') });

      case 'submit_response':
        return jsonOut_({
          ok: true,
          response: submitResponse_(claims, payload.prompt_id || '', payload.body || ''),
        });

      case 'list_my_responses':
        return jsonOut_({ ok: true, responses: listResponsesForStudent_(claims.sub) });

      case 'im_here':
        return jsonOut_(logEvent_(claims, 'im_here', payload.clientTimestamp || ''));

      case 'list_teachers':
        return jsonOut_({ ok: true, teachers: getTeacherList_() });

      case 'check_out':
        return jsonOut_(checkOut_(claims, payload));

      case 'check_in':
        return jsonOut_(checkIn_(claims, payload.checkout_id || ''));

      case 'get_active_checkout':
        return jsonOut_({ ok: true, checkout: getActiveCheckout_(claims.sub) });

      case 'list_active_checkouts':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, checkouts: listActiveCheckouts_() });

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

function listActivePrompts_(claims) {
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, PROMPTS_HEADERS.length).getValues();
  const viewer = String((claims && claims.email) || '').toLowerCase();
  const viewerSub = (claims && claims.sub) || '';
  const viewerIsTeacher = isTeacher_(viewer);

  const completedSet = (!viewerIsTeacher && viewerSub) ? getCompletedPromptIdsForUser_(viewerSub) : null;

  return values
    .filter(r => String(r[5]).toLowerCase() === 'active')
    .filter(r => {
      if (viewerIsTeacher) return true;
      const audience = String(r[7] || '').trim().toLowerCase();
      if (!audience || audience === 'all' || audience === 'everyone') return true;
      const allowed = audience.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
      return allowed.indexOf(viewer) !== -1;
    })
    .map(r => ({
      id: r[0],
      created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      teacher_email: r[2],
      title: r[3],
      body: r[4],
      status: r[5],
      closes_at: r[6] instanceof Date ? r[6].toISOString() : (r[6] ? String(r[6]) : ''),
      audience: r[7] || '',
      shared_from: r[8] || '',
      completed: completedSet ? completedSet.has(r[0]) : false,
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function getCompletedPromptIdsForUser_(sub) {
  const sheet = getOrCreateSheet_(COMPLETIONS_SHEET, COMPLETIONS_HEADERS);
  const lastRow = sheet.getLastRow();
  const set = new Set();
  if (lastRow < 2) return set;
  const values = sheet.getRange(2, 1, lastRow - 1, COMPLETIONS_HEADERS.length).getValues();
  for (const r of values) {
    if (r[2] === sub) set.add(r[4]);
  }
  return set;
}

function markComplete_(claims, promptId) {
  if (!promptId) return { ok: false, error: 'prompt_id required' };
  const sheet = getOrCreateSheet_(COMPLETIONS_SHEET, COMPLETIONS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, COMPLETIONS_HEADERS.length).getValues();
    for (const r of values) {
      if (r[2] === claims.sub && r[4] === promptId) {
        return { ok: true, already: true };
      }
    }
  }
  sheet.appendRow([
    Utilities.getUuid(),
    new Date(),
    claims.sub,
    claims.email,
    promptId,
  ]);
  return { ok: true };
}

function unmarkComplete_(claims, promptId) {
  if (!promptId) return { ok: false, error: 'prompt_id required' };
  const sheet = getOrCreateSheet_(COMPLETIONS_SHEET, COMPLETIONS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true };
  const values = sheet.getRange(2, 1, lastRow - 1, COMPLETIONS_HEADERS.length).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][2] === claims.sub && values[i][4] === promptId) {
      sheet.deleteRow(i + 2);
      return { ok: true };
    }
  }
  return { ok: true };
}

function getPromptById_(promptId) {
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, PROMPTS_HEADERS.length).getValues();
  for (const r of values) {
    if (r[0] === promptId) {
      return {
        id: r[0],
        created_at: r[1],
        teacher_email: r[2],
        title: r[3],
        body: r[4],
        status: r[5],
        closes_at: r[6] instanceof Date ? r[6].toISOString() : (r[6] ? String(r[6]) : ''),
        audience: r[7] || '',
        shared_from: r[8] || '',
      };
    }
  }
  return null;
}

function isPromptClosed_(prompt) {
  if (!prompt || !prompt.closes_at) return false;
  const closesAt = new Date(prompt.closes_at);
  if (isNaN(closesAt.getTime())) return false;
  return closesAt < new Date();
}

function sharePrompt_(sender, promptId, recipientEmail) {
  if (!promptId) return { ok: false, error: 'prompt_id required' };
  const recipient = String(recipientEmail || '').trim().toLowerCase();
  if (!recipient) return { ok: false, error: 'recipient_email required' };
  if (recipient === String(sender.email).toLowerCase()) {
    return { ok: false, error: "can't share with yourself" };
  }
  if (!recipient.endsWith('@' + ALLOWED_HD)) {
    return { ok: false, error: 'recipient must be an @' + ALLOWED_HD + ' address' };
  }
  if (!isTeacher_(recipient)) {
    return { ok: false, error: 'recipient is not on the teacher allow-list' };
  }
  const prompt = getPromptById_(promptId);
  if (!prompt) return { ok: false, error: 'prompt not found' };

  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const id = Utilities.getUuid();
  const createdAt = new Date();
  sheet.appendRow([
    id,
    createdAt,
    recipient,
    prompt.title,
    prompt.body,
    'draft',
    prompt.closes_at || '',
    prompt.audience || '',
    sender.email,
  ]);
  return { ok: true, draft_id: id, recipient: recipient };
}

function listDraftsForTeacher_(teacherEmail) {
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, PROMPTS_HEADERS.length).getValues();
  const me = String(teacherEmail).toLowerCase();
  return values
    .filter(r => String(r[5]).toLowerCase() === 'draft' && String(r[2]).toLowerCase() === me)
    .map(r => ({
      id: r[0],
      created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      title: r[3],
      body: r[4],
      closes_at: r[6] instanceof Date ? r[6].toISOString() : (r[6] ? String(r[6]) : ''),
      audience: r[7] || '',
      shared_from: r[8] || '',
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function publishDraft_(claims, payload) {
  const draftId = payload.draft_id;
  if (!draftId) return { ok: false, error: 'draft_id required' };
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'no prompts' };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === draftId) {
      const rowIndex = i + 2;
      const rowVals = sheet.getRange(rowIndex, 1, 1, PROMPTS_HEADERS.length).getValues()[0];
      if (String(rowVals[5]).toLowerCase() !== 'draft') return { ok: false, error: 'not a draft' };
      if (String(rowVals[2]).toLowerCase() !== String(claims.email).toLowerCase()) {
        return { ok: false, error: 'not your draft' };
      }
      const title = (payload.title !== undefined) ? payload.title : rowVals[3];
      const body = (payload.body !== undefined) ? payload.body : rowVals[4];
      const closesAt = (payload.closes_at !== undefined) ? payload.closes_at : (rowVals[6] || '');
      const audience = (payload.audience !== undefined) ? payload.audience : (rowVals[7] || '');
      sheet.getRange(rowIndex, 4, 1, 5).setValues([[title, body, 'active', closesAt, audience]]);
      return {
        ok: true,
        prompt: {
          id: draftId,
          created_at: rowVals[1] instanceof Date ? rowVals[1].toISOString() : String(rowVals[1]),
          teacher_email: rowVals[2],
          title: title,
          body: body,
          status: 'active',
          closes_at: closesAt,
          audience: audience,
          shared_from: rowVals[8] || '',
        },
      };
    }
  }
  return { ok: false, error: 'not found' };
}

function discardDraft_(teacherEmail, draftId) {
  if (!draftId) return { ok: false, error: 'draft_id required' };
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'no prompts' };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === draftId) {
      const rowIndex = i + 2;
      const rowVals = sheet.getRange(rowIndex, 1, 1, PROMPTS_HEADERS.length).getValues()[0];
      if (String(rowVals[2]).toLowerCase() !== String(teacherEmail).toLowerCase()) {
        return { ok: false, error: 'not your draft' };
      }
      sheet.getRange(rowIndex, 6).setValue('discarded');
      return { ok: true };
    }
  }
  return { ok: false, error: 'not found' };
}

function submitResponse_(claims, promptId, body) {
  if (!promptId) throw new Error('prompt_id is required');
  if (!String(body).trim()) throw new Error('response is empty');

  const prompt = getPromptById_(promptId);
  if (!prompt) throw new Error('prompt not found');
  if (String(prompt.status).toLowerCase() !== 'active') throw new Error('prompt is not active');
  if (isPromptClosed_(prompt)) throw new Error('this prompt has closed');

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
    false,
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

function summarizePromptResponses_(promptId) {
  if (!promptId) throw new Error('prompt_id is required');
  const prompt = getPromptById_(promptId);
  if (!prompt) throw new Error('prompt not found');

  const responses = listResponsesForPrompt_(promptId);
  const generatedAt = new Date().toISOString();
  if (responses.length === 0) {
    return {
      generated_at: generatedAt,
      response_count: 0,
      overview: 'No student responses yet for this prompt.',
      themes: [],
      misconceptions: [],
      follow_up_students: [],
      next_steps: [],
    };
  }

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;

  const responsesText = responses
    .map((r, i) => '#' + (i + 1) + ' ' + (r.student_name || 'unknown') +
                   ' <' + r.student_email + '>:\n' + r.body)
    .join('\n\n---\n\n');

  const userText =
    'Prompt title: ' + (prompt.title || '(untitled)') + '\n\n' +
    'Prompt:\n' + (prompt.body || '') + '\n\n' +
    'Student responses (' + responses.length + ' total):\n\n' + responsesText;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              encodeURIComponent(model) + ':generateContent?key=' +
              encodeURIComponent(apiKey);
  const requestBody = {
    systemInstruction: { parts: [{ text: SUMMARY_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: SUMMARY_SCHEMA,
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
  const text =
    (candidate.content && candidate.content.parts && candidate.content.parts[0] &&
     candidate.content.parts[0].text) || '';
  if (!text) throw new Error('Empty Gemini response');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('Could not parse summary JSON: ' + text.slice(0, 200));
  }

  return {
    generated_at: generatedAt,
    response_count: responses.length,
    overview: String(parsed.overview || ''),
    themes: Array.isArray(parsed.themes) ? parsed.themes.map(String) : [],
    misconceptions: Array.isArray(parsed.misconceptions) ? parsed.misconceptions.map(String) : [],
    follow_up_students: Array.isArray(parsed.follow_up_students)
      ? parsed.follow_up_students.map(s => ({
          email: String(s.email || ''),
          reason: String(s.reason || ''),
        }))
      : [],
    next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps.map(String) : [],
  };
}

function listFlaggedResponses_(includeResolved) {
  const sheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, RESPONSES_HEADERS.length).getValues();
  return values
    .filter(r => (r[11] === true || String(r[11]).toLowerCase() === 'true'))
    .filter(r => includeResolved || !(r[13] === true || String(r[13]).toLowerCase() === 'true'))
    .map(r => ({
      id: r[0],
      created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      student_email: r[2],
      student_name: r[3],
      prompt_id: r[5],
      prompt_title: r[6],
      body: r[7],
      flag_reason: r[12] || '',
      resolved: r[13] === true || String(r[13]).toLowerCase() === 'true',
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function resolveFlaggedResponse_(responseId) {
  if (!responseId) return { ok: false, error: 'response_id required' };
  const sheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'no responses' };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === responseId) {
      sheet.getRange(i + 2, 14).setValue(true);
      return { ok: true, response_id: responseId };
    }
  }
  return { ok: false, error: 'not found' };
}

function listStudentsForPrompt_(promptId) {
  if (!promptId) return [];
  const sheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, RESPONSES_HEADERS.length).getValues();
  const byStudent = {};
  for (const r of values) {
    if (r[5] !== promptId) continue;
    const sub = r[4] || r[2];
    if (!byStudent[sub]) {
      byStudent[sub] = {
        google_sub: r[4],
        student_email: r[2],
        student_name: r[3],
        response_count: 0,
        last_at: '',
        flagged: false,
      };
    }
    byStudent[sub].response_count++;
    const createdAt = r[1] instanceof Date ? r[1].toISOString() : String(r[1]);
    if (createdAt > byStudent[sub].last_at) byStudent[sub].last_at = createdAt;
    if (r[11] === true || String(r[11]).toLowerCase() === 'true') byStudent[sub].flagged = true;
  }
  return Object.values(byStudent).sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    return a.last_at < b.last_at ? 1 : -1;
  });
}

function getStudentThread_(promptId, googleSub, studentEmail) {
  if (!promptId || (!googleSub && !studentEmail)) return { prompt: null, responses: [] };
  const prompt = getPromptById_(promptId);
  const sheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { prompt: prompt, responses: [] };
  const values = sheet.getRange(2, 1, lastRow - 1, RESPONSES_HEADERS.length).getValues();
  const subMatch = googleSub ? String(googleSub) : '';
  const emailMatch = studentEmail ? String(studentEmail).toLowerCase() : '';
  const responses = values
    .filter(r => r[5] === promptId && (
      (subMatch && r[4] === subMatch) ||
      (emailMatch && String(r[2] || '').toLowerCase() === emailMatch)
    ))
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
      resolved: r[13] === true || String(r[13]).toLowerCase() === 'true',
    }))
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
  return { prompt: prompt, responses: responses };
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

function createPrompt_(teacherEmail, title, body, closesAt, audience, sharedFrom, status) {
  if (!String(title).trim() && !String(body).trim()) throw new Error('prompt is empty');
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const id = Utilities.getUuid();
  const createdAt = new Date();
  sheet.appendRow([
    id,
    createdAt,
    teacherEmail,
    title,
    body,
    status || 'active',
    closesAt || '',
    audience || '',
    sharedFrom || '',
  ]);
  return {
    id,
    created_at: createdAt.toISOString(),
    teacher_email: teacherEmail,
    title,
    body,
    status: status || 'active',
    closes_at: closesAt || '',
    audience: audience || '',
    shared_from: sharedFrom || '',
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

function getTeacherList_() {
  const raw = PropertiesService.getScriptProperties().getProperty('TEACHER_EMAILS') || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function checkOut_(claims, payload) {
  const destination = String(payload.destination || '').trim();
  const teacherEmail = String(payload.teacher_email || '').trim().toLowerCase();
  const notes = String(payload.notes || '').trim();

  if (!destination) return { ok: false, error: 'destination required' };
  if (!teacherEmail) return { ok: false, error: 'teacher_email required' };
  if (!teacherEmail.endsWith('@' + ALLOWED_HD)) return { ok: false, error: 'teacher must be an @' + ALLOWED_HD + ' address' };
  if (!isTeacher_(teacherEmail)) return { ok: false, error: 'selected teacher is not on the allow-list' };

  const active = getActiveCheckout_(claims.sub);
  if (active) return { ok: false, error: 'already checked out for ' + active.destination + '. Check in first.' };

  const sheet = getOrCreateSheet_(CHECKOUTS_SHEET, CHECKOUTS_HEADERS);
  const id = Utilities.getUuid();
  const checkedOutAt = new Date();
  sheet.appendRow([
    id,
    claims.email,
    claims.name || '',
    claims.sub,
    destination,
    teacherEmail,
    notes,
    checkedOutAt,
    '',
    'out',
    false,
  ]);

  try {
    sendCheckoutEmail_(claims, destination, teacherEmail, notes, 'out');
  } catch (err) {
    Logger.log('Failed to send checkout email: ' + err);
  }

  return {
    ok: true,
    checkout: {
      id,
      destination,
      teacher_email: teacherEmail,
      notes,
      checked_out_at: checkedOutAt.toISOString(),
      status: 'out',
    },
  };
}

function checkIn_(claims, checkoutId) {
  if (!checkoutId) return { ok: false, error: 'checkout_id required' };
  const sheet = getOrCreateSheet_(CHECKOUTS_SHEET, CHECKOUTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'no checkouts' };
  const values = sheet.getRange(2, 1, lastRow - 1, CHECKOUTS_HEADERS.length).getValues();
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    if (r[0] === checkoutId && r[3] === claims.sub && String(r[9]).toLowerCase() === 'out') {
      const rowIndex = i + 2;
      const checkedInAt = new Date();
      sheet.getRange(rowIndex, 9, 1, 2).setValues([[checkedInAt, 'in']]);

      const destination = r[4];
      const teacherEmail = r[5];
      const notes = r[6];
      const checkedOutAt = r[7] instanceof Date ? r[7] : new Date(r[7]);
      const durationMinutes = Math.max(0, Math.round((checkedInAt - checkedOutAt) / 60000));

      try {
        sendCheckoutEmail_(claims, destination, teacherEmail, notes, 'in', durationMinutes);
      } catch (err) {
        Logger.log('Failed to send checkin email: ' + err);
      }

      return {
        ok: true,
        checkout: {
          id: r[0],
          destination,
          teacher_email: teacherEmail,
          checked_out_at: checkedOutAt.toISOString(),
          checked_in_at: checkedInAt.toISOString(),
          duration_minutes: durationMinutes,
          status: 'in',
        },
      };
    }
  }
  return { ok: false, error: 'active checkout not found' };
}

function getActiveCheckout_(googleSub) {
  if (!googleSub) return null;
  const sheet = getOrCreateSheet_(CHECKOUTS_SHEET, CHECKOUTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, CHECKOUTS_HEADERS.length).getValues();
  for (const r of values) {
    if (r[3] === googleSub && String(r[9]).toLowerCase() === 'out') {
      return {
        id: r[0],
        destination: r[4],
        teacher_email: r[5],
        notes: r[6],
        checked_out_at: r[7] instanceof Date ? r[7].toISOString() : String(r[7]),
        status: 'out',
      };
    }
  }
  return null;
}

function listActiveCheckouts_() {
  // Send overdue warnings on every fetch so teachers see fresh state.
  try { checkOverdueCheckouts_(); } catch (err) { Logger.log('overdue scan failed: ' + err); }

  const sheet = getOrCreateSheet_(CHECKOUTS_SHEET, CHECKOUTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, CHECKOUTS_HEADERS.length).getValues();
  const overdueAfter = getOverdueThresholdMinutes_();
  const now = Date.now();
  return values
    .filter(r => String(r[9]).toLowerCase() === 'out')
    .map(r => {
      const checkedOutAt = r[7] instanceof Date ? r[7] : new Date(r[7]);
      const minutesAway = Math.max(0, Math.round((now - checkedOutAt.getTime()) / 60000));
      return {
        id: r[0],
        student_email: r[1],
        student_name: r[2],
        destination: r[4],
        teacher_email: r[5],
        notes: r[6],
        checked_out_at: checkedOutAt.toISOString(),
        minutes_away: minutesAway,
        overdue: minutesAway >= overdueAfter,
        warning_sent: r[10] === true || String(r[10]).toLowerCase() === 'true',
      };
    })
    .sort((a, b) => (a.checked_out_at < b.checked_out_at ? 1 : -1));
}

function getOverdueThresholdMinutes_() {
  const raw = PropertiesService.getScriptProperties().getProperty('OVERDUE_THRESHOLD_MINUTES');
  const parsed = parseInt(raw, 10);
  return (parsed && parsed > 0) ? parsed : DEFAULT_OVERDUE_MINUTES;
}

function checkOverdueCheckouts_() {
  const sheet = getOrCreateSheet_(CHECKOUTS_SHEET, CHECKOUTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const thresholdMs = getOverdueThresholdMinutes_() * 60 * 1000;
  const now = new Date();
  const values = sheet.getRange(2, 1, lastRow - 1, CHECKOUTS_HEADERS.length).getValues();
  let sent = 0;
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    if (String(r[9]).toLowerCase() !== 'out') continue;
    const warningSent = r[10] === true || String(r[10]).toLowerCase() === 'true';
    if (warningSent) continue;
    const checkedOutAt = r[7] instanceof Date ? r[7] : new Date(r[7]);
    if (isNaN(checkedOutAt.getTime())) continue;
    if ((now - checkedOutAt) <= thresholdMs) continue;
    try {
      sendOverdueWarning_(r, now);
      sheet.getRange(i + 2, 11).setValue(true);
      sent++;
    } catch (err) {
      Logger.log('Failed to send overdue warning for ' + r[0] + ': ' + err);
    }
  }
  return sent;
}

function sendOverdueWarning_(row, now) {
  const studentName = row[2] || row[1];
  const studentEmail = row[1];
  const destination = row[4];
  const teacherEmail = row[5];
  const notes = row[6];
  const checkedOutAt = row[7] instanceof Date ? row[7] : new Date(row[7]);
  const minutesAway = Math.round((now - checkedOutAt) / 60000);
  const subject = '[AISA Hub] Overdue: ' + studentName + ' has been out ' + minutesAway + ' minutes';
  const body =
    'Overdue check-out warning\n\n' +
    'Student: ' + studentName + ' <' + studentEmail + '>\n' +
    'Destination: ' + destination + '\n' +
    'Checked out at: ' + checkedOutAt.toLocaleString() + '\n' +
    'Time away: ' + minutesAway + ' minutes\n' +
    (notes ? 'Notes: ' + notes + '\n' : '') +
    '\nThey have not yet checked back in. You may want to follow up.\n' +
    'Sent automatically by the AISA Student Hub.';
  MailApp.sendEmail({ to: teacherEmail, subject: subject, body: body });
}

// Public-named function so teachers can wire it to a time-driven trigger
// (Apps Script editor > Triggers > runOverdueCheck every 5 minutes).
function runOverdueCheck() {
  return checkOverdueCheckouts_();
}

function sendCheckoutEmail_(claims, destination, teacherEmail, notes, mode, durationMinutes) {
  const studentLabel = (claims.name || claims.email) + ' <' + claims.email + '>';
  let subject, body;
  if (mode === 'out') {
    subject = '[AISA Hub] ' + (claims.name || claims.email) + ' has stepped out — ' + destination;
    body =
      'Student check-OUT notification\n\n' +
      'Student: ' + studentLabel + '\n' +
      'Destination: ' + destination + '\n' +
      'Time: ' + new Date().toLocaleString() + '\n' +
      (notes ? 'Notes: ' + notes + '\n' : '') +
      '\nThey will check back in when they return. Sent automatically by the AISA Student Hub.';
  } else {
    subject = '[AISA Hub] ' + (claims.name || claims.email) + ' has returned from ' + destination;
    body =
      'Student check-IN notification\n\n' +
      'Student: ' + studentLabel + '\n' +
      'Returned from: ' + destination + '\n' +
      'Time away: ' + durationMinutes + ' minute' + (durationMinutes === 1 ? '' : 's') + '\n' +
      'Returned at: ' + new Date().toLocaleString() + '\n' +
      '\nSent automatically by the AISA Student Hub.';
  }
  MailApp.sendEmail({ to: teacherEmail, subject: subject, body: body });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
