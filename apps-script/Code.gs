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
const FLAGGED_INTERACTIONS_SHEET = 'FlaggedInteractions';
const FLAGGED_INTERACTIONS_HEADERS = ['id', 'created_at', 'student_email', 'student_name', 'google_sub', 'source', 'context', 'body', 'flag_reason', 'resolved'];
const RESOLUTIONS_SHEET = 'Resolutions';
const RESOLUTIONS_HEADERS = ['id', 'flag_id', 'flag_source', 'student_email', 'student_name', 'google_sub', 'resolved_by_email', 'resolved_by_name', 'resolved_at', 'action_taken', 'severity', 'followup', 'notes'];

// Closed list of allowed values for each report dropdown. Same constants used
// in the frontend so the menus stay in sync with what the sheet accepts.
const RESOLUTION_ACTIONS = [
  'Spoke with student in person',
  'Contacted parents / guardians',
  'Referred to school counsellor',
  'Referred to admin / principal',
  'Logged for monitoring',
  'False positive — no action needed',
  'Other',
];
const RESOLUTION_SEVERITIES = [
  'Low — minor concern',
  'Moderate — needs attention',
  'Serious — safeguarding concern',
  'Critical — emergency response',
  'False positive',
];
const RESOLUTION_FOLLOWUPS = [
  'None needed',
  'Check in tomorrow',
  'Check in this week',
  'Ongoing weekly support',
  'Ongoing safeguarding case',
];
const DEFAULT_OVERDUE_MINUTES = 10;
const EVENTS_HEADERS = ['server_timestamp', 'email', 'name', 'google_sub', 'action', 'client_timestamp'];
const PROMPTS_HEADERS = ['id', 'created_at', 'teacher_email', 'title', 'body', 'status', 'closes_at', 'audience', 'shared_from', 'type', 'options_json', 'correct_option', 'rating_scale'];
const RESPONSES_HEADERS = ['id', 'created_at', 'student_email', 'student_name', 'google_sub', 'prompt_id', 'prompt_title', 'body', 'ai_feedback', 'ai_reviewed_at', 'ai_model', 'flagged', 'flag_reason', 'resolved', 'response_type', 'option_index', 'rating_value'];
const VALID_PROMPT_TYPES = ['open', 'multiple_choice', 'acknowledgment', 'rating', 'poll'];
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
  "will check in with you within the next day or two. You don't have to wait — " +
  "if you'd like to talk to someone right now, please reach out to your school " +
  "counsellor or a trusted adult.";
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
          prompt: createPrompt_(claims.email, {
            title: payload.title || '',
            body: payload.body || '',
            closes_at: payload.closes_at || '',
            audience: payload.audience || '',
            shared_from: '',
            status: 'active',
            type: payload.type || 'open',
            options: payload.options || [],
            correct_option: payload.correct_option,
            rating_scale: payload.rating_scale,
          }),
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

      case 'update_prompt':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_(updatePrompt_(claims, payload));

      case 'get_teacher_dashboard':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, dashboard: getTeacherDashboard_(claims) });

      case 'get_student_dashboard':
        return jsonOut_({ ok: true, dashboard: getStudentDashboard_(claims) });

      case 'get_checkout_leaderboard':
        return jsonOut_({ ok: true, leaderboard: getCheckoutLeaderboard_(claims) });

      case 'get_engagement_leaderboards':
        return jsonOut_({ ok: true, leaderboards: getEngagementLeaderboards_(claims) });

      case 'get_student_profile':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, profile: getStudentProfile_(claims, payload.google_sub || '', payload.student_email || '') });

      case 'summarize_student':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, summary: summarizeStudent_(claims, payload.google_sub || '', payload.student_email || '') });

      case 'export_csv':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, csv: exportCsv_(claims, payload.kind || 'responses'), kind: payload.kind || 'responses' });

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
        return jsonOut_(resolveFlaggedResponse_(claims, payload));

      case 'get_resolution_options':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, options: getResolutionOptions_() });

      case 'list_students_for_prompt':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, students: listStudentsForPrompt_(payload.prompt_id || '') });

      case 'get_student_thread':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, thread: getStudentThread_(payload.prompt_id || '', payload.google_sub || '', payload.student_email || '') });

      case 'submit_response':
        return jsonOut_({
          ok: true,
          response: submitResponse_(claims, payload),
        });

      case 'get_prompt_summary':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, summary: getStructuredSummary_(payload.prompt_id || '') });

      case 'get_poll_results':
        return jsonOut_({ ok: true, results: getPollResults_(payload.prompt_id || '') });

      case 'suggest_prompt':
        if (!isTeacher_(claims.email)) return jsonOut_({ ok: false, error: 'not a teacher' });
        return jsonOut_({ ok: true, suggestion: suggestPrompt_(payload.topic || '', payload.type || 'open') });

      case 'ask_study_buddy':
        return jsonOut_({ ok: true, reply: askStudyBuddy_(claims, payload.messages || []) });

      case 'classify_note':
        return jsonOut_({ ok: true, flagged: classifyNote_(claims, payload.body || '') });

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

// Returns the assigned teacher's email for a given student, or null.
// Read order: STUDENT_TEACHER_MAP script property (JSON) takes precedence,
// then a small built-in fallback we can ship safe defaults in.
function getAssignedTeacher_(studentEmail) {
  const email = String(studentEmail || '').toLowerCase();
  if (!email) return null;
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('STUDENT_TEACHER_MAP');
    if (raw) {
      const map = JSON.parse(raw);
      for (const k of Object.keys(map)) {
        if (String(k).toLowerCase() === email) return String(map[k]).toLowerCase();
      }
    }
  } catch (err) { /* fall through to default map */ }
  const DEFAULT_MAP = {
    'bbaki@aisa.sch.ae': 'bbaki@aisa.sch.ae',
    'hodai@aisa.sch.ae': 'bbaki@aisa.sch.ae',
  };
  return DEFAULT_MAP[email] || null;
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
      type: String(r[9] || 'open').toLowerCase(),
      options: parsePromptOptions_(r[10]),
      correct_option: r[11] || null,
      rating_scale: r[12] || null,
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
        type: String(r[9] || 'open').toLowerCase(),
        options: parsePromptOptions_(r[10]),
        correct_option: r[11] || null,
        rating_scale: r[12] || null,
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
    String(prompt.type || 'open').toLowerCase(),
    JSON.stringify(prompt.options || []),
    prompt.correct_option || '',
    prompt.rating_scale || '',
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
      type: String(r[9] || 'open').toLowerCase(),
      options: parsePromptOptions_(r[10]),
      correct_option: r[11] || null,
      rating_scale: r[12] || null,
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

function getMyPromptRows_(claims) {
  const myEmail = String(claims.email).toLowerCase();
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, PROMPTS_HEADERS.length).getValues();
  return values.filter(r => String(r[2]).toLowerCase() === myEmail);
}

function getStudentDashboard_(claims) {
  const sub = claims.sub;
  const myEmail = String(claims.email || '').toLowerCase();

  // Pull this student's own responses.
  const respSheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const respLast = respSheet.getLastRow();
  const myResponses = [];
  if (respLast >= 2) {
    const values = respSheet.getRange(2, 1, respLast - 1, RESPONSES_HEADERS.length).getValues();
    for (const r of values) {
      if (r[4] !== sub) continue;
      myResponses.push({
        id: r[0],
        created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
        prompt_id: r[5],
        prompt_title: r[6],
        body: r[7],
        ai_feedback: r[8] || '',
        flagged: r[11] === true || String(r[11]).toLowerCase() === 'true',
        response_type: String(r[14] || 'open').toLowerCase(),
        option_index: parseInt(r[15], 10) || null,
        rating_value: parseInt(r[16], 10) || null,
      });
    }
  }

  // Active prompts addressed to this student.
  const promptsSheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const promptsLast = promptsSheet.getLastRow();
  const availablePrompts = [];
  if (promptsLast >= 2) {
    const values = promptsSheet.getRange(2, 1, promptsLast - 1, PROMPTS_HEADERS.length).getValues();
    for (const r of values) {
      if (String(r[5]).toLowerCase() !== 'active') continue;
      const audience = String(r[7] || '').trim().toLowerCase();
      const allowedToAll = !audience || audience === 'all' || audience === 'everyone';
      if (!allowedToAll) {
        const list = audience.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
        if (list.indexOf(myEmail) === -1) continue;
      }
      availablePrompts.push({
        id: r[0],
        title: r[3],
        type: String(r[9] || 'open').toLowerCase(),
        teacher_email: r[2],
        created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      });
    }
  }

  // Completions
  const completedIds = getCompletedPromptIdsForUser_(sub);

  // Per-day activity (UTC date keys YYYY-MM-DD) for streak + heatmap
  const responsesByDay = {};
  for (const r of myResponses) {
    const key = String(r.created_at).slice(0, 10);
    responsesByDay[key] = (responsesByDay[key] || 0) + 1;
  }

  // Current streak: consecutive days ending today (or yesterday if today is empty).
  let streak = 0;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (responsesByDay[key]) {
      streak++;
    } else if (i === 0) {
      // Today empty — that's allowed; keep going to count yesterday's streak.
      continue;
    } else {
      break;
    }
  }

  // 63-day heatmap (9 weeks × 7 days), oldest first
  const heatmap = [];
  const heatStart = new Date(start);
  heatStart.setUTCDate(heatStart.getUTCDate() - 62);
  for (let i = 0; i < 63; i++) {
    const d = new Date(heatStart);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    heatmap.push({ date: key, count: responsesByDay[key] || 0 });
  }

  // Per-prompt progress
  const respByPrompt = {};
  for (const r of myResponses) {
    if (!respByPrompt[r.prompt_id]) respByPrompt[r.prompt_id] = [];
    respByPrompt[r.prompt_id].push(r);
  }
  const promptProgress = availablePrompts.map(p => {
    const rs = respByPrompt[p.id] || [];
    rs.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    return {
      id: p.id,
      title: p.title,
      type: p.type,
      teacher_email: p.teacher_email,
      response_count: rs.length,
      last_response_at: rs.length ? rs[rs.length - 1].created_at : null,
      completed: completedIds.has(p.id),
    };
  });

  // Recent AI feedback (open-response only — only those have AI text)
  const feedbackEntries = myResponses
    .filter(r => r.ai_feedback && r.response_type === 'open' && !r.flagged)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5)
    .map(r => ({
      created_at: r.created_at,
      prompt_title: r.prompt_title,
      feedback: r.ai_feedback,
    }));

  // Ratings the student has given themselves
  const ratingResponses = myResponses.filter(r => r.response_type === 'rating' && r.rating_value);
  const avgRating = ratingResponses.length
    ? Math.round((ratingResponses.reduce((sum, r) => sum + r.rating_value, 0) / ratingResponses.length) * 10) / 10
    : null;

  const totalResponses = myResponses.length;
  const pendingCount = promptProgress.filter(p => !p.completed).length;
  const totalAvailable = availablePrompts.length;

  // Check-out summary for this student (all-time + last 7 days)
  const coSheet = getOrCreateSheet_(CHECKOUTS_SHEET, CHECKOUTS_HEADERS);
  const coLast = coSheet.getLastRow();
  const myCheckouts = [];
  const byDestination = {};
  let weekMinutes = 0;
  let allMinutes = 0;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (coLast >= 2) {
    const values = coSheet.getRange(2, 1, coLast - 1, CHECKOUTS_HEADERS.length).getValues();
    for (const r of values) {
      if (r[3] !== sub) continue;
      const outAt = r[7] instanceof Date ? r[7] : new Date(r[7]);
      const inAt = r[8] instanceof Date ? r[8] : (r[8] ? new Date(r[8]) : null);
      const status = String(r[9] || '').toLowerCase();
      const destination = r[4] || 'Other';
      let minutes = 0;
      if (status === 'in' && inAt) {
        minutes = Math.max(0, Math.round((inAt - outAt) / 60000));
      } else if (status === 'out') {
        minutes = Math.max(0, Math.round((Date.now() - outAt.getTime()) / 60000));
      }
      myCheckouts.push({
        destination,
        notes: r[6] || '',
        checked_out_at: outAt.toISOString(),
        checked_in_at: inAt ? inAt.toISOString() : '',
        status,
        minutes,
      });
      byDestination[destination] = (byDestination[destination] || 0) + 1;
      allMinutes += minutes;
      if (outAt.getTime() >= sevenDaysAgo) weekMinutes += minutes;
    }
  }
  myCheckouts.sort((a, b) => (a.checked_out_at < b.checked_out_at ? 1 : -1));

  // Achievements
  const achievements = [
    { id: 'first', label: 'First response', emoji: '🎉', desc: 'Submitted your first response', earned: totalResponses >= 1 },
    { id: 'five', label: 'Off the ground', emoji: '🌱', desc: '5 responses submitted', earned: totalResponses >= 5 },
    { id: 'twentyfive', label: 'Regular voice', emoji: '📚', desc: '25 responses submitted', earned: totalResponses >= 25 },
    { id: 'streak3', label: 'On a roll', emoji: '🔥', desc: '3-day activity streak', earned: streak >= 3 },
    { id: 'streak7', label: 'Week strong', emoji: '💪', desc: '7-day activity streak', earned: streak >= 7 },
    { id: 'allcaught', label: 'All caught up', emoji: '⭐', desc: 'No assignments pending', earned: totalAvailable > 0 && pendingCount === 0 },
    { id: 'inclass', label: 'Class champion', emoji: '🎯', desc: 'Under 10 mins out of class this week', earned: totalResponses >= 1 && weekMinutes < 10 },
  ];

  return {
    summary: {
      total_responses: totalResponses,
      total_available: totalAvailable,
      completed_count: completedIds.size,
      pending_count: pendingCount,
      streak,
      avg_rating: avgRating,
    },
    heatmap,
    achievements,
    prompt_progress: promptProgress.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const aLast = a.last_response_at || '';
      const bLast = b.last_response_at || '';
      return aLast < bLast ? 1 : -1;
    }),
    recent_feedback: feedbackEntries,
    checkouts: {
      total_trips: myCheckouts.length,
      total_minutes: allMinutes,
      week_minutes: weekMinutes,
      by_destination: byDestination,
      recent: myCheckouts.slice(0, 5),
    },
  };
}

function getEngagementLeaderboards_(claims) {
  const respSheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const respLast = respSheet.getLastRow();
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const byStudent = {};
  if (respLast >= 2) {
    const values = respSheet.getRange(2, 1, respLast - 1, RESPONSES_HEADERS.length).getValues();
    for (const r of values) {
      const sub = r[4];
      if (!sub) continue;
      if (!byStudent[sub]) byStudent[sub] = { sub, email: r[2], name: r[3], week_responses: 0, total_responses: 0, days: {} };
      byStudent[sub].total_responses++;
      const createdAt = r[1] instanceof Date ? r[1] : new Date(r[1]);
      const dayKey = createdAt.toISOString().slice(0, 10);
      byStudent[sub].days[dayKey] = true;
      if (createdAt.getTime() >= sevenDaysAgo) byStudent[sub].week_responses++;
    }
  }

  // Streak = consecutive days back from today with activity (today empty OK).
  function streakFor(daysMap) {
    let streak = 0;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (daysMap[key]) streak++;
      else if (i === 0) continue;
      else break;
    }
    return streak;
  }

  const initials = (n) => String(n || '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
  const list = Object.values(byStudent).map(s => ({
    sub: s.sub,
    email: s.email,
    name: s.name,
    week_responses: s.week_responses,
    total_responses: s.total_responses,
    streak: streakFor(s.days),
  }));

  const isTeacher = isTeacher_(claims.email);
  const myselfRow = list.find(s => s.sub === claims.sub) || null;
  function format(rows, sortFn, valueField) {
    const sorted = rows.slice().sort(sortFn);
    for (let i = 0; i < sorted.length; i++) sorted[i].rank = i + 1;
    const top = sorted.slice(0, 5).map(s => ({
      rank: s.rank,
      display_name: isTeacher ? s.name : (s.sub === claims.sub ? s.name : (initials(s.name) || 'Anon')),
      email: isTeacher ? s.email : undefined,
      sub: isTeacher ? s.sub : undefined,
      value: s[valueField],
      streak: s.streak,
      is_me: s.sub === claims.sub,
    }));
    const me = sorted.find(s => s.sub === claims.sub);
    return {
      top: top,
      my_rank: me ? me.rank : null,
      my_value: me ? me[valueField] : 0,
      total_students: sorted.length,
    };
  }

  return {
    most_active: format(list, (a, b) => b.week_responses - a.week_responses || b.total_responses - a.total_responses, 'week_responses'),
    streak_champions: format(list, (a, b) => b.streak - a.streak || b.total_responses - a.total_responses, 'streak'),
  };
}

function getStudentProfile_(claims, googleSub, studentEmail) {
  if (!googleSub && !studentEmail) throw new Error('google_sub or student_email required');
  const myEmail = String(claims.email).toLowerCase();
  const myPromptIds = new Set(getMyPromptRows_(claims).map(r => r[0]));
  const subKey = googleSub || '';
  const emailKey = (studentEmail || '').toLowerCase();

  // Find this student's responses against the teacher's prompts only (privacy).
  const respSheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const respLast = respSheet.getLastRow();
  const responses = [];
  let studentName = '', studentEmailOut = '', subOut = '';
  if (respLast >= 2) {
    const values = respSheet.getRange(2, 1, respLast - 1, RESPONSES_HEADERS.length).getValues();
    for (const r of values) {
      const matchSub = subKey && r[4] === subKey;
      const matchEmail = emailKey && String(r[2] || '').toLowerCase() === emailKey;
      if (!matchSub && !matchEmail) continue;
      if (!myPromptIds.has(r[5])) continue;
      studentName = studentName || r[3];
      studentEmailOut = studentEmailOut || r[2];
      subOut = subOut || r[4];
      responses.push({
        id: r[0],
        created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
        prompt_id: r[5],
        prompt_title: r[6],
        body: r[7],
        ai_feedback: r[8] || '',
        flagged: r[11] === true || String(r[11]).toLowerCase() === 'true',
        flag_reason: r[12] || '',
        resolved: r[13] === true || String(r[13]).toLowerCase() === 'true',
        response_type: String(r[14] || 'open').toLowerCase(),
        option_index: parseInt(r[15], 10) || null,
        rating_value: parseInt(r[16], 10) || null,
      });
    }
  }
  if (!studentEmailOut && !subOut) {
    throw new Error("This student hasn't responded to any of your prompts yet.");
  }
  responses.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // Checkouts notified to me from this student.
  const coSheet = getOrCreateSheet_(CHECKOUTS_SHEET, CHECKOUTS_HEADERS);
  const coLast = coSheet.getLastRow();
  const checkouts = [];
  let totalMinutesOut = 0;
  const destinationCounts = {};
  if (coLast >= 2) {
    const values = coSheet.getRange(2, 1, coLast - 1, CHECKOUTS_HEADERS.length).getValues();
    for (const r of values) {
      const sub = r[3];
      if (subOut && sub !== subOut) continue;
      if (!subOut && String(r[1] || '').toLowerCase() !== emailKey) continue;
      // Only those routed to me
      if (String(r[5] || '').toLowerCase() !== myEmail) continue;
      const outAt = r[7] instanceof Date ? r[7] : new Date(r[7]);
      const inAt = r[8] instanceof Date ? r[8] : (r[8] ? new Date(r[8]) : null);
      const status = String(r[9] || '').toLowerCase();
      let minutes = 0;
      if (status === 'in' && inAt) minutes = Math.max(0, Math.round((inAt - outAt) / 60000));
      else if (status === 'out') minutes = Math.max(0, Math.round((Date.now() - outAt.getTime()) / 60000));
      totalMinutesOut += minutes;
      destinationCounts[r[4]] = (destinationCounts[r[4]] || 0) + 1;
      checkouts.push({
        id: r[0],
        destination: r[4],
        notes: r[6] || '',
        checked_out_at: outAt.toISOString(),
        checked_in_at: inAt ? inAt.toISOString() : '',
        minutes: minutes,
        status: status,
      });
    }
  }
  checkouts.sort((a, b) => (a.checked_out_at < b.checked_out_at ? 1 : -1));

  // Completions from my prompts only.
  const compIds = getCompletedPromptIdsForUser_(subOut);
  let completedMine = 0;
  myPromptIds.forEach(id => { if (compIds.has(id)) completedMine++; });

  // Build per-prompt summary across my prompts
  const respByPrompt = {};
  for (const r of responses) {
    if (!respByPrompt[r.prompt_id]) respByPrompt[r.prompt_id] = [];
    respByPrompt[r.prompt_id].push(r);
  }
  const myPromptDetails = [];
  for (const row of getMyPromptRows_(claims)) {
    if (String(row[5]).toLowerCase() !== 'active') continue;
    const rs = respByPrompt[row[0]] || [];
    myPromptDetails.push({
      id: row[0],
      title: row[3],
      type: String(row[9] || 'open').toLowerCase(),
      response_count: rs.length,
      last_response_at: rs.length ? rs[0].created_at : null,
      completed: compIds.has(row[0]),
      last_ai_feedback: rs[0] && rs[0].ai_feedback ? rs[0].ai_feedback : '',
    });
  }
  myPromptDetails.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const aL = a.last_response_at || '', bL = b.last_response_at || '';
    return aL < bL ? 1 : -1;
  });

  // Rating responses
  const ratings = responses.filter(r => r.response_type === 'rating' && r.rating_value);
  const avgRating = ratings.length
    ? Math.round((ratings.reduce((s, r) => s + r.rating_value, 0) / ratings.length) * 10) / 10
    : null;

  // Activity by day (last 63 days)
  const responsesByDay = {};
  for (const r of responses) {
    const key = String(r.created_at).slice(0, 10);
    responsesByDay[key] = (responsesByDay[key] || 0) + 1;
  }
  const heatmap = [];
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 62);
  for (let i = 0; i < 63; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    heatmap.push({ date: key, count: responsesByDay[key] || 0 });
  }

  // Current streak
  let streak = 0;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const d = new Date(todayStart);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (responsesByDay[key]) streak++;
    else if (i === 0) continue;
    else break;
  }

  const flagged = responses.filter(r => r.flagged);

  return {
    student: { google_sub: subOut, email: studentEmailOut, name: studentName },
    summary: {
      total_responses: responses.length,
      flagged_count: flagged.length,
      unresolved_flagged_count: flagged.filter(r => !r.resolved).length,
      resolved_count: countResolutionsForStudent_(subOut, studentEmailOut),
      avg_rating: avgRating,
      prompts_responded: Object.keys(respByPrompt).length,
      prompts_available: myPromptDetails.length,
      completed_count: completedMine,
      streak: streak,
      checkout_trips: checkouts.length,
      checkout_minutes: totalMinutesOut,
      checkout_destinations: destinationCounts,
      last_active: responses.length ? responses[0].created_at : null,
    },
    heatmap: heatmap,
    responses: responses,
    prompts: myPromptDetails,
    flagged: flagged,
    checkouts: checkouts,
    resolutions: recentResolutionsForStudent_(subOut, studentEmailOut, 25),
  };
}

function summarizeStudent_(claims, googleSub, studentEmail) {
  const profile = getStudentProfile_(claims, googleSub, studentEmail);
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;

  // Build the user text
  const lines = [];
  lines.push('Student: ' + (profile.student.name || profile.student.email));
  lines.push('Total responses: ' + profile.summary.total_responses);
  lines.push('Current streak: ' + profile.summary.streak + ' days');
  if (profile.summary.avg_rating != null) lines.push('Average self-rating: ' + profile.summary.avg_rating + ' / 5');
  lines.push('Prompts available: ' + profile.summary.prompts_available);
  lines.push('Prompts responded to: ' + profile.summary.prompts_responded);
  lines.push('Prompts marked complete: ' + profile.summary.completed_count);
  lines.push('Flagged responses: ' + profile.summary.flagged_count + ' (' + profile.summary.unresolved_flagged_count + ' unresolved)');
  lines.push('Check-out trips: ' + profile.summary.checkout_trips + ' (~' + profile.summary.checkout_minutes + ' minutes out of class total)');
  lines.push('');
  lines.push('Recent responses (newest first, up to 20):');
  for (const r of profile.responses.slice(0, 20)) {
    lines.push('— ' + r.prompt_title + ' [' + r.response_type + ']');
    if (r.response_type === 'open') {
      lines.push('   Response: ' + String(r.body || '').slice(0, 800));
      if (r.ai_feedback) lines.push('   AI feedback (already given): ' + String(r.ai_feedback).slice(0, 300));
    } else if (r.response_type === 'multiple_choice' || r.response_type === 'poll') {
      lines.push('   Picked: ' + r.body);
    } else if (r.response_type === 'rating') {
      lines.push('   Rated: ' + r.body);
    } else {
      lines.push('   ' + r.body);
    }
    if (r.flagged) lines.push('   FLAGGED for review: ' + (r.flag_reason || ''));
  }
  const userText = lines.join('\n');

  const systemPrompt =
    'You are an experienced K-12 teacher writing a private end-of-term summary about ONE student ' +
    'based on the activity log below. Be specific (cite a response or pattern when you can), ' +
    'kind, professional, and concrete. The student will not see this — it is for the teacher.\n\n' +
    'Return a JSON object matching the schema:\n' +
    '- snapshot: 2-3 sentence overall snapshot of how this student is doing.\n' +
    '- strengths: 2-4 short bullets (each a complete sentence) of what is going well.\n' +
    '- growth_areas: 2-4 short bullets of where they can grow, framed as opportunities.\n' +
    '- next_steps: 1-3 short, specific things the teacher could do next week with this student.\n' +
    '- engagement_score: integer 1 (low) to 10 (high) based on volume + recency + completion.\n' +
    '- engagement_reason: 1 sentence explaining the score.\n' +
    'Ground every point in the data. Do not invent feelings or assessments the data does not show.';

  const schema = {
    type: 'object',
    properties: {
      snapshot: { type: 'string' },
      strengths: { type: 'array', items: { type: 'string' } },
      growth_areas: { type: 'array', items: { type: 'string' } },
      next_steps: { type: 'array', items: { type: 'string' } },
      engagement_score: { type: 'integer' },
      engagement_reason: { type: 'string' },
    },
    required: ['snapshot', 'strengths', 'growth_areas', 'next_steps', 'engagement_score'],
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const requestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1800,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini API ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
  const data = JSON.parse(res.getContentText());
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error('No candidate in Gemini response');
  const text = (candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) || '';
  if (!text) throw new Error('Empty Gemini response');
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error('Could not parse summary'); }
  return {
    generated_at: new Date().toISOString(),
    student_name: profile.student.name,
    student_email: profile.student.email,
    snapshot: String(parsed.snapshot || ''),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    growth_areas: Array.isArray(parsed.growth_areas) ? parsed.growth_areas.map(String) : [],
    next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps.map(String) : [],
    engagement_score: parseInt(parsed.engagement_score, 10) || 0,
    engagement_reason: String(parsed.engagement_reason || ''),
  };
}

function getCheckoutLeaderboard_(claims) {
  const isTeacher = isTeacher_(claims.email);
  const studentMap = {};
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Seed roster from anyone who has responded (so 0-trip students appear).
  const respSheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const respLast = respSheet.getLastRow();
  if (respLast >= 2) {
    const values = respSheet.getRange(2, 1, respLast - 1, RESPONSES_HEADERS.length).getValues();
    for (const r of values) {
      const sub = r[4];
      if (!sub || studentMap[sub]) continue;
      studentMap[sub] = { sub, email: r[2], name: r[3], trips: 0, minutes: 0 };
    }
  }

  // Accumulate checkouts within the 7-day window.
  const coSheet = getOrCreateSheet_(CHECKOUTS_SHEET, CHECKOUTS_HEADERS);
  const coLast = coSheet.getLastRow();
  if (coLast >= 2) {
    const values = coSheet.getRange(2, 1, coLast - 1, CHECKOUTS_HEADERS.length).getValues();
    for (const r of values) {
      const sub = r[3];
      if (!sub) continue;
      if (!studentMap[sub]) studentMap[sub] = { sub, email: r[1], name: r[2], trips: 0, minutes: 0 };
      const outAt = r[7] instanceof Date ? r[7] : new Date(r[7]);
      if (outAt.getTime() < sevenDaysAgo) continue;
      const inAt = r[8] instanceof Date ? r[8] : (r[8] ? new Date(r[8]) : null);
      const status = String(r[9] || '').toLowerCase();
      let minutes = 0;
      if (status === 'in' && inAt) minutes = Math.max(0, Math.round((inAt - outAt) / 60000));
      else if (status === 'out') minutes = Math.max(0, Math.round((now - outAt.getTime()) / 60000));
      studentMap[sub].trips++;
      studentMap[sub].minutes += minutes;
    }
  }

  const list = Object.values(studentMap)
    .sort((a, b) => a.minutes - b.minutes || a.trips - b.trips || String(a.name).localeCompare(String(b.name)));
  for (let i = 0; i < list.length; i++) list[i].rank = i + 1;

  if (isTeacher) {
    return {
      window_days: 7,
      total_students: list.length,
      leaderboard: list.map(s => ({
        rank: s.rank,
        name: s.name,
        email: s.email,
        trips: s.trips,
        minutes: s.minutes,
      })),
    };
  }

  // Students get a tighter, partially-anonymised view.
  const myRow = list.find(s => s.sub === claims.sub) || null;
  const initials = (n) => String(n || '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
  return {
    window_days: 7,
    total_students: list.length,
    leaderboard: list.slice(0, 5).map(s => ({
      rank: s.rank,
      display_name: s.sub === claims.sub ? s.name : initials(s.name) || 'Anon',
      trips: s.trips,
      minutes: s.minutes,
      is_me: s.sub === claims.sub,
    })),
    my_rank: myRow ? myRow.rank : null,
    my_minutes: myRow ? myRow.minutes : 0,
    my_trips: myRow ? myRow.trips : 0,
  };
}

function getTeacherDashboard_(claims) {
  const myEmail = String(claims.email).toLowerCase();
  const myRows = getMyPromptRows_(claims);

  const promptList = myRows
    .filter(r => String(r[5]).toLowerCase() !== 'discarded')
    .map(r => ({
      id: r[0],
      created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      title: r[3],
      status: String(r[5] || 'active').toLowerCase(),
      closes_at: r[6] instanceof Date ? r[6].toISOString() : (r[6] ? String(r[6]) : ''),
      audience: r[7] || '',
      type: String(r[9] || 'open').toLowerCase(),
    }));
  const myPromptIds = new Set(promptList.map(p => p.id));
  const titleByPromptId = {};
  for (const p of promptList) titleByPromptId[p.id] = p.title;

  // Responses for my prompts
  const respSheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const respLast = respSheet.getLastRow();
  const myResponses = [];
  if (respLast >= 2) {
    const values = respSheet.getRange(2, 1, respLast - 1, RESPONSES_HEADERS.length).getValues();
    for (const r of values) {
      if (myPromptIds.has(r[5])) {
        myResponses.push({
          id: r[0],
          created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
          student_email: r[2],
          student_name: r[3],
          google_sub: r[4],
          prompt_id: r[5],
          prompt_title: r[6],
          flagged: r[11] === true || String(r[11]).toLowerCase() === 'true',
          resolved: r[13] === true || String(r[13]).toLowerCase() === 'true',
        });
      }
    }
  }

  // Per-prompt aggregation
  const promptStats = {};
  for (const p of promptList) {
    promptStats[p.id] = { responses: 0, flagged: 0, students: new Set() };
  }
  for (const r of myResponses) {
    const s = promptStats[r.prompt_id];
    if (!s) continue;
    s.responses++;
    if (r.flagged) s.flagged++;
    s.students.add(r.google_sub || r.student_email);
  }
  const promptsForUI = promptList.map(p => {
    const s = promptStats[p.id];
    return Object.assign({}, p, {
      response_count: s.responses,
      unique_students: s.students.size,
      flagged_count: s.flagged,
    });
  }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // Per-student aggregation
  const studentStats = {};
  for (const r of myResponses) {
    const key = r.google_sub || r.student_email;
    if (!studentStats[key]) {
      studentStats[key] = {
        email: r.student_email,
        name: r.student_name,
        google_sub: r.google_sub,
        response_count: 0,
        flagged_count: 0,
        prompts: new Set(),
        last_active: r.created_at,
      };
    }
    studentStats[key].response_count++;
    if (r.flagged) studentStats[key].flagged_count++;
    studentStats[key].prompts.add(r.prompt_id);
    if (r.created_at > studentStats[key].last_active) studentStats[key].last_active = r.created_at;
  }
  const studentsForUI = Object.values(studentStats).map(s => ({
    email: s.email,
    name: s.name,
    google_sub: s.google_sub,
    response_count: s.response_count,
    flagged_count: s.flagged_count,
    resolved_count: countResolutionsForStudent_(s.google_sub, s.email),
    prompts_responded: s.prompts.size,
    last_active: s.last_active,
  })).sort((a, b) => (a.last_active < b.last_active ? 1 : -1));

  // Recent activity (last 25 across responses + checkouts where I was notified)
  const activity = myResponses.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const activityItems = activity.slice(0, 25).map(r => ({
    type: r.flagged ? 'flag' : 'response',
    timestamp: r.created_at,
    student_email: r.student_email,
    student_name: r.student_name,
    prompt_title: r.prompt_title,
  }));

  // Pull checkouts notified to me
  const coSheet = getOrCreateSheet_(CHECKOUTS_SHEET, CHECKOUTS_HEADERS);
  const coLast = coSheet.getLastRow();
  let checkoutsForMe = [];
  if (coLast >= 2) {
    const values = coSheet.getRange(2, 1, coLast - 1, CHECKOUTS_HEADERS.length).getValues();
    checkoutsForMe = values
      .filter(r => String(r[5] || '').toLowerCase() === myEmail)
      .map(r => ({
        id: r[0],
        student_email: r[1],
        student_name: r[2],
        destination: r[4],
        notes: r[6],
        checked_out_at: r[7] instanceof Date ? r[7].toISOString() : String(r[7]),
        checked_in_at: r[8] instanceof Date ? r[8].toISOString() : (r[8] ? String(r[8]) : ''),
        status: r[9] || 'in',
      }));
  }

  // Resolutions handled this teacher this week
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const myEmailLower = String(claims.email).toLowerCase();
  let resolvedByMeThisWeek = 0;
  const resSheet = getOrCreateSheet_(RESOLUTIONS_SHEET, RESOLUTIONS_HEADERS);
  const resLast = resSheet.getLastRow();
  if (resLast >= 2) {
    const values = resSheet.getRange(2, 1, resLast - 1, RESOLUTIONS_HEADERS.length).getValues();
    for (const r of values) {
      if (String(r[6] || '').toLowerCase() !== myEmailLower) continue;
      const ts = r[8] instanceof Date ? r[8].getTime() : new Date(r[8]).getTime();
      if (ts >= sevenDaysAgo) resolvedByMeThisWeek++;
    }
  }

  return {
    summary: {
      total_prompts: promptList.length,
      total_responses: myResponses.length,
      total_students: studentsForUI.length,
      flagged_count: myResponses.filter(r => r.flagged).length,
      unresolved_flagged: myResponses.filter(r => r.flagged && !r.resolved).length,
      resolved_this_week: resolvedByMeThisWeek,
      total_checkouts: checkoutsForMe.length,
      active_checkouts: checkoutsForMe.filter(c => String(c.status).toLowerCase() === 'out').length,
    },
    prompts: promptsForUI,
    students: studentsForUI,
    activity: activityItems,
    checkouts_for_me: checkoutsForMe.sort((a, b) => (a.checked_out_at < b.checked_out_at ? 1 : -1)),
  };
}

function exportCsv_(claims, kind) {
  const myEmail = String(claims.email).toLowerCase();
  const myRows = getMyPromptRows_(claims);
  const myPromptIds = new Set(myRows.map(r => r[0]));

  let rows = [];
  if (kind === 'responses') {
    rows.push(['created_at', 'student_email', 'student_name', 'prompt_title', 'body', 'response_type', 'option_index', 'rating_value', 'ai_feedback', 'flagged', 'flag_reason', 'resolved']);
    const sheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, RESPONSES_HEADERS.length).getValues();
      for (const r of values) {
        if (!myPromptIds.has(r[5])) continue;
        rows.push([
          r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
          r[2], r[3], r[6], r[7],
          r[14] || 'open', r[15] || '', r[16] || '',
          r[8] || '',
          (r[11] === true || String(r[11]).toLowerCase() === 'true') ? 'TRUE' : 'FALSE',
          r[12] || '',
          (r[13] === true || String(r[13]).toLowerCase() === 'true') ? 'TRUE' : 'FALSE',
        ]);
      }
    }
  } else if (kind === 'prompts') {
    rows.push(['created_at', 'title', 'body', 'type', 'status', 'closes_at', 'audience', 'options', 'correct_option', 'rating_scale']);
    for (const r of myRows) {
      rows.push([
        r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
        r[3], r[4],
        String(r[9] || 'open').toLowerCase(),
        r[5], r[6] || '', r[7] || '',
        r[10] || '', r[11] || '', r[12] || '',
      ]);
    }
  } else if (kind === 'students') {
    rows.push(['email', 'name', 'response_count', 'flagged_count', 'prompts_responded', 'last_active']);
    const dash = getTeacherDashboard_(claims);
    for (const s of dash.students) {
      rows.push([s.email, s.name, s.response_count, s.flagged_count, s.prompts_responded, s.last_active]);
    }
  } else if (kind === 'flagged') {
    rows.push(['created_at', 'student_email', 'student_name', 'prompt_title', 'response_body', 'flag_reason', 'resolved']);
    const sheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, RESPONSES_HEADERS.length).getValues();
      for (const r of values) {
        if (!myPromptIds.has(r[5])) continue;
        const flagged = r[11] === true || String(r[11]).toLowerCase() === 'true';
        if (!flagged) continue;
        rows.push([
          r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
          r[2], r[3], r[6], r[7], r[12] || '',
          (r[13] === true || String(r[13]).toLowerCase() === 'true') ? 'TRUE' : 'FALSE',
        ]);
      }
    }
  } else if (kind === 'checkouts') {
    rows.push(['student_email', 'student_name', 'destination', 'teacher_email', 'notes', 'checked_out_at', 'checked_in_at', 'status']);
    const sheet = getOrCreateSheet_(CHECKOUTS_SHEET, CHECKOUTS_HEADERS);
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, CHECKOUTS_HEADERS.length).getValues();
      for (const r of values) {
        if (String(r[5] || '').toLowerCase() !== myEmail) continue;
        rows.push([
          r[1], r[2], r[4], r[5], r[6],
          r[7] instanceof Date ? r[7].toISOString() : String(r[7]),
          r[8] instanceof Date ? r[8].toISOString() : (r[8] ? String(r[8]) : ''),
          r[9] || '',
        ]);
      }
    }
  } else {
    throw new Error('unknown export kind: ' + kind);
  }
  return rowsToCsv_(rows);
}

function rowsToCsv_(rows) {
  return rows.map(row =>
    row.map(cell => {
      const s = (cell == null) ? '' : String(cell);
      if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')
  ).join('\n');
}

function updatePrompt_(claims, payload) {
  const promptId = payload.prompt_id;
  if (!promptId) return { ok: false, error: 'prompt_id required' };
  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'no prompts' };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] !== promptId) continue;
    const rowIndex = i + 2;
    const rowVals = sheet.getRange(rowIndex, 1, 1, PROMPTS_HEADERS.length).getValues()[0];
    if (String(rowVals[2]).toLowerCase() !== String(claims.email).toLowerCase()) {
      return { ok: false, error: 'you can only edit your own prompts' };
    }

    const type = String(rowVals[9] || 'open').toLowerCase();
    const title = (payload.title !== undefined) ? String(payload.title) : rowVals[3];
    const body  = (payload.body !== undefined)  ? String(payload.body)  : rowVals[4];
    const closesAt = (payload.closes_at !== undefined) ? payload.closes_at : (rowVals[6] || '');
    const audience = (payload.audience !== undefined) ? payload.audience : (rowVals[7] || '');

    let optionsJson = rowVals[10] || '';
    let correctOption = rowVals[11] || '';
    let ratingScale = rowVals[12] || '';

    if ((type === 'multiple_choice' || type === 'poll') && payload.options !== undefined) {
      const optionsArr = Array.isArray(payload.options)
        ? payload.options.map(s => String(s || '').trim()).filter(Boolean)
        : [];
      if (optionsArr.length < 2) return { ok: false, error: 'at least 2 options required' };
      if (optionsArr.length > 8) return { ok: false, error: 'at most 8 options' };
      optionsJson = JSON.stringify(optionsArr);
    }
    if (type === 'multiple_choice' && payload.correct_option !== undefined) {
      const c = parseInt(payload.correct_option, 10);
      const opts = parsePromptOptions_(optionsJson);
      correctOption = (c >= 1 && c <= opts.length) ? c : '';
    }
    if (type === 'rating' && payload.rating_scale !== undefined) {
      const s = parseInt(payload.rating_scale, 10);
      ratingScale = (s >= 2 && s <= 10) ? s : 5;
    }

    sheet.getRange(rowIndex, 4).setValue(title);
    sheet.getRange(rowIndex, 5).setValue(body);
    sheet.getRange(rowIndex, 7).setValue(closesAt);
    sheet.getRange(rowIndex, 8).setValue(audience);
    sheet.getRange(rowIndex, 11, 1, 3).setValues([[optionsJson, correctOption, ratingScale]]);

    return {
      ok: true,
      prompt: {
        id: promptId,
        created_at: rowVals[1] instanceof Date ? rowVals[1].toISOString() : String(rowVals[1]),
        teacher_email: rowVals[2],
        title,
        body,
        status: rowVals[5],
        closes_at: closesAt,
        audience,
        shared_from: rowVals[8] || '',
        type,
        options: parsePromptOptions_(optionsJson),
        correct_option: correctOption || null,
        rating_scale: ratingScale || null,
      },
    };
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

function submitResponse_(claims, payload) {
  const promptId = payload.prompt_id || '';
  if (!promptId) throw new Error('prompt_id is required');

  const prompt = getPromptById_(promptId);
  if (!prompt) throw new Error('prompt not found');
  if (String(prompt.status).toLowerCase() !== 'active') throw new Error('prompt is not active');
  if (isPromptClosed_(prompt)) throw new Error('this prompt has closed');

  const type = String(prompt.type || 'open').toLowerCase();
  let body = '';
  let optionIndex = '';
  let ratingValue = '';
  let runAi = false;

  if (type === 'open') {
    body = String(payload.body || '').trim();
    if (!body) throw new Error('response is empty');
    runAi = true;
  } else if (type === 'multiple_choice' || type === 'poll') {
    const options = prompt.options || [];
    const idx = parseInt(payload.option_index, 10);
    if (!idx || idx < 1 || idx > options.length) throw new Error('invalid option');
    optionIndex = idx;
    body = options[idx - 1];
  } else if (type === 'rating') {
    const max = parseInt(prompt.rating_scale, 10) || 5;
    const val = parseInt(payload.rating_value, 10);
    if (!val || val < 1 || val > max) throw new Error('invalid rating');
    ratingValue = val;
    body = val + '/' + max;
  } else if (type === 'acknowledgment') {
    body = 'Acknowledged';
  } else {
    throw new Error('unknown type: ' + type);
  }

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
    type,
    optionIndex,
    ratingValue,
  ]);
  const rowIndex = sheet.getLastRow();

  let aiFeedback = '';
  let aiReviewedAt = '';
  let aiModel = '';
  let flagged = false;

  if (runAi) {
    try {
      const review = getGeminiReview_(prompt, body);
      const reviewedDate = new Date();
      aiReviewedAt = reviewedDate.toISOString();
      if (review.distress_detected) {
        flagged = true;
        const flagReason = review.distress_reason || 'Distress signals detected';
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
    response_type: type,
    option_index: optionIndex || null,
    rating_value: ratingValue || null,
  };
}

function getStructuredSummary_(promptId) {
  const prompt = getPromptById_(promptId);
  if (!prompt) throw new Error('prompt not found');
  const sheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const lastRow = sheet.getLastRow();
  const responses = [];
  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, RESPONSES_HEADERS.length).getValues();
    for (const r of values) {
      if (r[5] !== promptId) continue;
      responses.push({
        student_email: r[2],
        student_name: r[3],
        body: r[7],
        option_index: parseInt(r[15], 10) || null,
        rating_value: parseInt(r[16], 10) || null,
      });
    }
  }
  const type = String(prompt.type || 'open').toLowerCase();
  const result = {
    type,
    total: responses.length,
    prompt_title: prompt.title,
    generated_at: new Date().toISOString(),
  };

  if (type === 'multiple_choice' || type === 'poll') {
    const options = prompt.options || [];
    const counts = options.map(() => 0);
    for (const r of responses) {
      if (r.option_index && r.option_index >= 1 && r.option_index <= options.length) {
        counts[r.option_index - 1]++;
      }
    }
    result.options = options.map((label, i) => ({
      label,
      index: i + 1,
      count: counts[i],
      percent: responses.length ? Math.round((counts[i] / responses.length) * 100) : 0,
      is_correct: type === 'multiple_choice' && prompt.correct_option && parseInt(prompt.correct_option, 10) === (i + 1),
    }));
    if (type === 'multiple_choice' && prompt.correct_option) {
      const correctIdx = parseInt(prompt.correct_option, 10);
      const correctCount = counts[correctIdx - 1] || 0;
      result.correct_percent = responses.length ? Math.round((correctCount / responses.length) * 100) : 0;
    }
  } else if (type === 'rating') {
    const max = parseInt(prompt.rating_scale, 10) || 5;
    const values = responses.map(r => r.rating_value).filter(v => v);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const buckets = Array(max).fill(0);
    for (const v of values) {
      if (v >= 1 && v <= max) buckets[v - 1]++;
    }
    result.rating_scale = max;
    result.average = Math.round(avg * 10) / 10;
    result.distribution = buckets.map((count, i) => ({
      value: i + 1,
      count,
      percent: values.length ? Math.round((count / values.length) * 100) : 0,
    }));
  } else if (type === 'acknowledgment') {
    result.acknowledged_by = responses.map(r => ({ name: r.student_name, email: r.student_email }));
  }
  return result;
}

function getPollResults_(promptId) {
  const prompt = getPromptById_(promptId);
  if (!prompt) throw new Error('prompt not found');
  if (String(prompt.type || '').toLowerCase() !== 'poll') return { type: 'poll', total: 0, options: [] };
  const summary = getStructuredSummary_(promptId);
  return { type: 'poll', total: summary.total, options: summary.options };
}

/* ============================================================
   Unified safety pipeline — used by responses, notes, study chats
   ============================================================ */

// First-line keyword safety net. Runs unconditionally — no API dependency —
// so a missing/expired Gemini key, an outage, or a rate-limit doesn't disable
// detection of the obvious phrases. The Gemini classifier still runs after
// for subtler cases. Each regex below is checked case-insensitively against
// the student's text; word boundaries are used to avoid false matches inside
// other words (e.g. "killer" won't match "kill").
const DISTRESS_KEYWORDS = [
  // self-harm / suicidal ideation
  { re: /\b(kill\s*(?:myself|me)|end\s+(?:my\s+life|it\s+all)|want\s+to\s+die|wanna\s+die|don'?t\s+want\s+to\s+(?:live|be\s+alive|exist)|wish\s+i\s+(?:was\s+dead|were\s+dead|never\s+existed)|no\s+reason\s+to\s+live|better\s+off\s+(?:dead|without\s+me))\b/i, why: 'Suicidal ideation phrase' },
  { re: /\b(self\s*-?\s*harm|cut\s+myself|cutting\s+myself|hurt\s+myself|harm\s+myself)\b/i, why: 'Self-harm phrase' },
  { re: /\bsuicid(?:e|al)\b/i, why: 'Mention of suicide' },
  // hopelessness / worthlessness
  { re: /\b(?:i\s+)?(?:hate\s+myself|i'?m\s+worthless|i'?m\s+a\s+failure|i'?m\s+nothing|no\s+one\s+(?:cares|would\s+miss\s+me)|nobody\s+loves\s+me|hate\s+my\s+life)\b/i, why: 'Hopelessness/worthlessness phrase' },
  // abuse signals
  { re: /\b(being\s+abused|someone\s+(?:is\s+)?hurting\s+me|hit\s+me\s+at\s+home|scared\s+to\s+go\s+home|don'?t\s+feel\s+safe\s+at\s+home)\b/i, why: 'Possible abuse signal' },
];

function keywordDistressMatch_(body) {
  const text = String(body || '');
  if (!text) return null;
  for (const k of DISTRESS_KEYWORDS) {
    if (k.re.test(text)) return k.why;
  }
  return null;
}

// Lightweight distress-only classifier (yes/no + reason). Much faster than
// the full feedback classifier — used wherever we want safety triage without
// also generating teacher-readable feedback.
function classifyDistress_(body) {
  // Layer 1: keyword net. Always runs, no API dependency. Catches obvious
  // phrases even if the Gemini key is missing or the API is down.
  const keywordWhy = keywordDistressMatch_(body);
  if (keywordWhy) {
    return { distress_detected: true, distress_reason: 'Keyword match: ' + keywordWhy };
  }

  // Layer 2: Gemini classifier. Catches subtler / paraphrased signals the
  // keyword net misses. Falls through cleanly if the API isn't available.
  const text = String(body || '').trim();
  if (!text) return { distress_detected: false, distress_reason: '' };

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) return { distress_detected: false, distress_reason: '' };
  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;

  const systemPrompt =
    'You are a safety classifier for a K-12 school app. Read the text below ' +
    'and decide if it shows signs of distress, self-harm, suicidal ideation, ' +
    'abuse, or other safety concerns. Include subtle signs: hopelessness, ' +
    'expressions of worthlessness, isolation, indirect references. When in ' +
    'doubt, set distress_detected to true so a teacher can review.';

  const schema = {
    type: 'object',
    properties: {
      distress_detected: { type: 'boolean' },
      distress_reason: { type: 'string' },
    },
    required: ['distress_detected'],
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              encodeURIComponent(model) + ':generateContent?key=' +
              encodeURIComponent(apiKey);
  const requestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: text.slice(0, 4000) }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 200,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };

  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      return { distress_detected: false, distress_reason: '' };
    }
    const data = JSON.parse(res.getContentText());
    const candidate = data.candidates && data.candidates[0];
    if (!candidate) return { distress_detected: false, distress_reason: '' };
    const finishReason = candidate.finishReason || 'STOP';
    if (finishReason !== 'STOP') {
      // Safety filter intervened — treat as distress.
      return { distress_detected: true, distress_reason: 'Safety filter triggered (' + finishReason + ')' };
    }
    const out = (candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) || '';
    if (!out) return { distress_detected: false, distress_reason: '' };
    const parsed = JSON.parse(out);
    return {
      distress_detected: !!parsed.distress_detected,
      distress_reason: String(parsed.distress_reason || '').trim(),
    };
  } catch (err) {
    Logger.log('classifyDistress_ failed: ' + err);
    return { distress_detected: false, distress_reason: '' };
  }
}

// Classify a piece of student text from a non-prompt source (notes or study
// chats). If flagged, log to FlaggedInteractions and email a teacher. Returns
// true if flagged, false otherwise.
// Count how many flag rows we've stored for one student over the last N days.
// Looks across both the Responses sheet and FlaggedInteractions. Used to drive
// the "escalation" CC to a safeguarding lead.
function countRecentFlagsForStudent_(studentEmail, googleSub, withinDays) {
  const email = String(studentEmail || '').toLowerCase();
  const sub = String(googleSub || '');
  const sinceMs = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  let count = 0;

  const respSheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const respLast = respSheet.getLastRow();
  if (respLast >= 2) {
    const values = respSheet.getRange(2, 1, respLast - 1, RESPONSES_HEADERS.length).getValues();
    for (const r of values) {
      const flagged = r[11] === true || String(r[11]).toLowerCase() === 'true';
      if (!flagged) continue;
      const matches = (sub && r[4] === sub) || (email && String(r[2] || '').toLowerCase() === email);
      if (!matches) continue;
      const ts = r[1] instanceof Date ? r[1].getTime() : new Date(r[1]).getTime();
      if (ts >= sinceMs) count++;
    }
  }

  const intSheet = getOrCreateSheet_(FLAGGED_INTERACTIONS_SHEET, FLAGGED_INTERACTIONS_HEADERS);
  const intLast = intSheet.getLastRow();
  if (intLast >= 2) {
    const values = intSheet.getRange(2, 1, intLast - 1, FLAGGED_INTERACTIONS_HEADERS.length).getValues();
    for (const r of values) {
      const matches = (sub && r[4] === sub) || (email && String(r[2] || '').toLowerCase() === email);
      if (!matches) continue;
      const ts = r[1] instanceof Date ? r[1].getTime() : new Date(r[1]).getTime();
      if (ts >= sinceMs) count++;
    }
  }
  return count;
}

// Returns { ccEmail, note } for the safeguarding escalation, or null if the
// threshold isn't met or the safeguarding lead isn't configured.
function maybeEscalate_(claims) {
  const props = PropertiesService.getScriptProperties();
  const safeguarding = String(props.getProperty('SAFEGUARDING_EMAIL') || '').toLowerCase();
  if (!safeguarding) return null;
  const threshold = parseInt(props.getProperty('ESCALATION_THRESHOLD'), 10) || 2;
  const windowDays = parseInt(props.getProperty('ESCALATION_WINDOW_DAYS'), 10) || 7;
  // Note: at the time of this call the current flag has already been written
  // to the sheet, so the count includes it. We escalate when count >= threshold.
  const count = countRecentFlagsForStudent_(claims.email, claims.sub, windowDays);
  if (count < threshold) return null;
  return {
    ccEmail: safeguarding,
    note: '⚠️ Escalation: this student has been flagged ' + count +
          ' time' + (count === 1 ? '' : 's') + ' in the past ' + windowDays + ' days. ' +
          'Safeguarding lead has been CC\'d on this email.',
  };
}

function classifyAndMaybeFlag_(claims, body, source, context) {
  if (!body || !String(body).trim()) return false;
  const result = classifyDistress_(body);
  if (!result.distress_detected) return false;

  const sheet = getOrCreateSheet_(FLAGGED_INTERACTIONS_SHEET, FLAGGED_INTERACTIONS_HEADERS);
  const id = Utilities.getUuid();
  sheet.appendRow([
    id,
    new Date(),
    claims.email,
    claims.name || '',
    claims.sub,
    source,
    context || '',
    body,
    result.distress_reason || 'Distress signals detected',
    false,
  ]);

  try {
    sendInteractionAlert_(claims, source, body, result.distress_reason || '', context || '');
  } catch (err) {
    Logger.log('sendInteractionAlert_ failed: ' + err);
  }
  return true;
}

function sendInteractionAlert_(claims, source, body, reason, context) {
  const props = PropertiesService.getScriptProperties();
  const adminEmail = String(props.getProperty('ALERT_EMAIL') || '').toLowerCase();
  const teachers = (props.getProperty('TEACHER_EMAILS') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const assignedTeacher = String(getAssignedTeacher_(claims.email) || '').toLowerCase();

  // Primary: assigned teacher → ALERT_EMAIL → first teacher on the allow-list.
  const to = assignedTeacher || adminEmail || teachers[0];
  if (!to) { Logger.log('No alert recipient configured for interaction flag'); return; }
  const ccSet = {};
  if (adminEmail && adminEmail !== to) ccSet[adminEmail] = true;
  const escalation = maybeEscalate_(claims);
  if (escalation && escalation.ccEmail && escalation.ccEmail !== to) ccSet[escalation.ccEmail] = true;
  const cc = Object.keys(ccSet).join(',');

  const sourceLabel = {
    note: 'private note',
    study_chat: 'AI Study Buddy message',
  }[source] || source;

  const studentLabel = (claims.name || claims.email) + ' <' + claims.email + '>';
  const sheetUrl = getSheetUrl_();
  const subject = (escalation ? '🚨 URGENT · ESCALATED — ' : '🚨 URGENT — ') +
                  'flagged ' + sourceLabel + ' · ' + (claims.name || claims.email);
  const emailBody =
    'URGENT: a student\'s ' + sourceLabel + ' was flagged for distress signals and needs review TODAY.\n\n' +
    (escalation ? escalation.note + '\n\n' : '') +
    'Student: ' + studentLabel + '\n' +
    'Time: ' + new Date().toLocaleString() + '\n\n' +
    'Why flagged: ' + (reason || 'Detected distress signals') + '\n\n' +
    'Content:\n' + body + '\n\n' +
    (context ? 'Context:\n' + context + '\n\n' : '') +
    (sheetUrl ? 'Sheet: ' + sheetUrl + '\n\n' : '') +
    'Please follow up with the student in person today. The content above is ' +
    'logged in the FlaggedInteractions tab and visible in Teacher Studio\'s ' +
    'Flagged panel.\n\n' +
    'Sent automatically by the AISA Student Hub.';

  const options = { to: to, subject: subject, body: emailBody };
  if (cc) options.cc = cc;
  MailApp.sendEmail(options);
}

function classifyNote_(claims, body) {
  return classifyAndMaybeFlag_(claims, body, 'note', '');
}

function askStudyBuddy_(claims, messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('no message');

  // Safety triage on the latest user message BEFORE we let the chat respond.
  // Don't block the reply — the model already has a tutoring system prompt
  // that redirects distress to a trusted adult. But we DO want a teacher
  // notified.
  try {
    const lastUser = messages.slice().reverse().find(m => String(m.role || 'user') === 'user');
    if (lastUser && lastUser.text) {
      const recent = messages.slice(-4)
        .map(m => (m.role || 'user') + ': ' + String(m.text || '').slice(0, 200))
        .join('\n');
      classifyAndMaybeFlag_(claims, String(lastUser.text), 'study_chat', recent);
    }
  } catch (err) {
    Logger.log('Study chat safety triage failed: ' + err);
  }

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;

  // Length guard to stop runaway prompts
  const cleanedMessages = messages.slice(-12).map(m => ({
    role: String(m.role || 'user') === 'model' ? 'model' : 'user',
    parts: [{ text: String(m.text || '').slice(0, 4000) }],
  }));

  const systemPrompt =
    "You are AISA Study Buddy — a kind, patient tutor talking to a K-12 student at " +
    "the American International School in Abu Dhabi. " +
    "Rules:\n" +
    "1. Be warm and encouraging. Use plain language, short sentences, and concrete examples.\n" +
    "2. Match the student's apparent level — don't talk down, don't go over their head.\n" +
    "3. Help the student think — when they ask homework questions, guide them toward the " +
    "answer with hints and small steps rather than dumping the solution. Only give the " +
    "answer if they ask directly for it.\n" +
    "4. Never write a whole essay or response for them. You can help brainstorm or fix one " +
    "sentence at a time.\n" +
    "5. If the student shows distress, gently encourage them to talk to a trusted adult and " +
    "stop trying to solve the academic problem.\n" +
    "6. Keep replies to 4-8 short sentences unless they explicitly ask for more detail.\n" +
    "7. Don't pretend to remember previous sessions — only use the current chat.\n" +
    "8. Stay culturally neutral and age-appropriate for the UAE school context.";

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const requestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: cleanedMessages,
    generationConfig: { temperature: 0.6, maxOutputTokens: 800 },
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini API ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
  const data = JSON.parse(res.getContentText());
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error('No reply');
  const finishReason = candidate.finishReason || 'STOP';
  const text = (candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) || '';
  if (finishReason !== 'STOP') {
    // Distress safety block or similar — guide the student to a human.
    return "I'd rather you talk to a trusted adult about this — a teacher, counsellor, or family member can really help. I'll be here when you want to study something together.";
  }
  if (!text) throw new Error('Empty reply');
  return String(text).trim();
}

function suggestPrompt_(topic, type) {
  topic = String(topic || '').trim();
  if (!topic) throw new Error('topic required');
  type = String(type || 'open').toLowerCase();
  if (VALID_PROMPT_TYPES.indexOf(type) === -1) type = 'open';

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;

  const typeGuidance = {
    open: 'An open-ended question that invites a 2-4 sentence written reflection or explanation.',
    multiple_choice: 'A multiple-choice question with 4 plausible options. Set correct_option to the 1-based index of the right answer. Distractors should be reasonable but clearly wrong on reflection.',
    poll: 'A neutral, opinion-style poll question with 3-5 options. Do NOT set correct_option.',
    rating: 'A self-reflection or check-in question to be answered on a 1-5 scale (1 low, 5 high). Do NOT include options.',
    acknowledgment: 'A short message students need to read and confirm. The body should be the announcement text itself.',
  };

  const systemPrompt =
    'You are an experienced teacher helping a colleague draft a classroom activity. ' +
    'Given a topic and an activity type, generate a complete, classroom-ready prompt as JSON.\n\n' +
    'Type for this request: ' + type + '\n' +
    'Guidance: ' + (typeGuidance[type] || typeGuidance.open) + '\n\n' +
    'Return:\n' +
    '- title: 3-7 word activity title (no quotes around it)\n' +
    '- body: the question or message itself, written directly to the student\n' +
    '- options: array of strings (only for multiple_choice and poll)\n' +
    '- correct_option: 1-based index (only for multiple_choice)\n' +
    'Keep language age-appropriate and culturally neutral (school is in the UAE).';

  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
      correct_option: { type: 'integer' },
    },
    required: ['title', 'body'],
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              encodeURIComponent(model) + ':generateContent?key=' +
              encodeURIComponent(apiKey);
  const requestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: 'Topic: ' + topic }] }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini API ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
  const data = JSON.parse(res.getContentText());
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error('No candidate in Gemini response');
  const text =
    (candidate.content && candidate.content.parts && candidate.content.parts[0] &&
     candidate.content.parts[0].text) || '';
  if (!text) throw new Error('Empty Gemini response');
  let parsed;
  try { parsed = JSON.parse(text); } catch (err) {
    throw new Error('Could not parse suggestion: ' + text.slice(0, 200));
  }
  return {
    type,
    title: String(parsed.title || '').trim(),
    body: String(parsed.body || '').trim(),
    options: Array.isArray(parsed.options) ? parsed.options.map(s => String(s).trim()).filter(Boolean) : [],
    correct_option: (typeof parsed.correct_option === 'number') ? parsed.correct_option : null,
  };
}

function sendDistressAlert_(prompt, claims, responseBody, flagReason) {
  const props = PropertiesService.getScriptProperties();
  const promptTeacher = String(prompt.teacher_email || '').toLowerCase();
  const adminEmail = String(props.getProperty('ALERT_EMAIL') || '').toLowerCase();
  const assignedTeacher = String(getAssignedTeacher_(claims.email) || '').toLowerCase();

  // Primary = assigned teacher (preferred — they know the student best),
  // then prompt's teacher, then ALERT_EMAIL. Everyone else relevant gets CC'd.
  const to = assignedTeacher || promptTeacher || adminEmail;
  if (!to) { Logger.log('No alert recipient configured'); return; }
  const ccSet = {};
  [promptTeacher, adminEmail].forEach(e => { if (e && e !== to) ccSet[e] = true; });
  const escalation = maybeEscalate_(claims);
  if (escalation && escalation.ccEmail && escalation.ccEmail !== to) ccSet[escalation.ccEmail] = true;
  const cc = Object.keys(ccSet).join(',');

  const sheetUrl = getSheetUrl_();
  const subject = (escalation ? '🚨 URGENT · ESCALATED — ' : '🚨 URGENT — ') +
                  'flagged student response · ' + (claims.name || claims.email);
  const body =
    'URGENT: a student response was flagged for possible distress signals and needs review TODAY.\n\n' +
    (escalation ? escalation.note + '\n\n' : '') +
    'Student: ' + (claims.name || '') + ' <' + claims.email + '>\n' +
    'Prompt: ' + (prompt.title || '(untitled)') + '\n' +
    'Submitted: ' + new Date().toLocaleString() + '\n\n' +
    'Why flagged: ' + (flagReason || 'Detected distress signals') + '\n\n' +
    'Prompt body:\n' + (prompt.body || '') + '\n\n' +
    'Student response:\n' + responseBody + '\n\n' +
    (sheetUrl ? 'Sheet: ' + sheetUrl + '\n\n' : '') +
    'The student saw a supportive resource message instead of AI feedback. ' +
    'Please follow up with them in person today.\n\n' +
    'Sent automatically by the AISA Student Hub.';

  const options = { to: to, subject: subject, body: body };
  if (cc) options.cc = cc;
  MailApp.sendEmail(options);
}

function getGeminiReview_(prompt, responseBody) {
  // Layer 1: keyword distress check runs unconditionally. If it matches we
  // can flag the response and skip Gemini entirely, which also means safety
  // still works if the API key is missing.
  const keywordReason = keywordDistressMatch_(responseBody);
  if (keywordReason) {
    return {
      feedback: '',
      distress_detected: true,
      distress_reason: 'Keyword match: ' + keywordReason,
      model: 'keyword_filter',
    };
  }
  // Layer 2: full Gemini classifier (feedback + distress in one structured call).
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
  const items = [];

  // Flagged prompt responses
  const respSheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const respLast = respSheet.getLastRow();
  if (respLast >= 2) {
    const values = respSheet.getRange(2, 1, respLast - 1, RESPONSES_HEADERS.length).getValues();
    for (const r of values) {
      const flagged = r[11] === true || String(r[11]).toLowerCase() === 'true';
      if (!flagged) continue;
      const resolved = r[13] === true || String(r[13]).toLowerCase() === 'true';
      if (!includeResolved && resolved) continue;
      items.push({
        id: r[0],
        created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
        student_email: r[2],
        student_name: r[3],
        source: 'response',
        prompt_id: r[5],
        prompt_title: r[6],
        body: r[7],
        flag_reason: r[12] || '',
        resolved: resolved,
      });
    }
  }

  // Flagged notes + study chats
  const intSheet = getOrCreateSheet_(FLAGGED_INTERACTIONS_SHEET, FLAGGED_INTERACTIONS_HEADERS);
  const intLast = intSheet.getLastRow();
  if (intLast >= 2) {
    const values = intSheet.getRange(2, 1, intLast - 1, FLAGGED_INTERACTIONS_HEADERS.length).getValues();
    for (const r of values) {
      const resolved = r[9] === true || String(r[9]).toLowerCase() === 'true';
      if (!includeResolved && resolved) continue;
      items.push({
        id: r[0],
        created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
        student_email: r[2],
        student_name: r[3],
        source: String(r[5] || 'other'),
        prompt_id: '',
        prompt_title: '',
        context: r[6] || '',
        body: r[7],
        flag_reason: r[8] || '',
        resolved: resolved,
      });
    }
  }

  // Attach the resolution report to each resolved item so the panel can show
  // who handled it, how, and when, without a second API round-trip.
  if (includeResolved && items.some(i => i.resolved)) {
    const byFlagId = getResolutionsByFlagIdMap_();
    for (const item of items) {
      if (item.resolved && byFlagId[item.id]) item.resolution = byFlagId[item.id];
    }
  }

  // Triage order: oldest unresolved flag rises to the top so a forgotten
  // flag never hides at the bottom.
  return items.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

function getResolutionsByFlagIdMap_() {
  const sheet = getOrCreateSheet_(RESOLUTIONS_SHEET, RESOLUTIONS_HEADERS);
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;
  const values = sheet.getRange(2, 1, lastRow - 1, RESOLUTIONS_HEADERS.length).getValues();
  for (const r of values) {
    const flagId = String(r[1] || '');
    if (!flagId) continue;
    map[flagId] = {
      resolution_id: r[0],
      flag_source: r[2],
      resolved_by_email: r[6],
      resolved_by_name: r[7],
      resolved_at: r[8] instanceof Date ? r[8].toISOString() : String(r[8]),
      action_taken: r[9],
      severity: r[10],
      followup: r[11],
      notes: r[12] || '',
    };
  }
  return map;
}

function resolveFlaggedResponse_(claims, payload) {
  const id = String(payload.response_id || '').trim();
  if (!id) return { ok: false, error: 'response_id required' };

  const action = String(payload.action_taken || '').trim();
  const severity = String(payload.severity || '').trim();
  const followup = String(payload.followup || '').trim();
  const notes = String(payload.notes || '').slice(0, 500);

  if (!action) return { ok: false, error: 'action_taken required' };
  if (!severity) return { ok: false, error: 'severity required' };
  if (!followup) return { ok: false, error: 'followup required' };
  if (RESOLUTION_ACTIONS.indexOf(action) === -1) return { ok: false, error: 'invalid action_taken' };
  if (RESOLUTION_SEVERITIES.indexOf(severity) === -1) return { ok: false, error: 'invalid severity' };
  if (RESOLUTION_FOLLOWUPS.indexOf(followup) === -1) return { ok: false, error: 'invalid followup' };

  let flagSource = '';
  let student = null;

  // Try the Responses sheet first (resolved column = 14)
  const respSheet = getOrCreateSheet_(RESPONSES_SHEET, RESPONSES_HEADERS);
  const respLast = respSheet.getLastRow();
  if (respLast >= 2) {
    const values = respSheet.getRange(2, 1, respLast - 1, RESPONSES_HEADERS.length).getValues();
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] === id) {
        respSheet.getRange(i + 2, 14).setValue(true);
        student = { email: values[i][2], name: values[i][3], sub: values[i][4] };
        flagSource = 'response';
        break;
      }
    }
  }
  // Then FlaggedInteractions (resolved column = 10)
  if (!student) {
    const intSheet = getOrCreateSheet_(FLAGGED_INTERACTIONS_SHEET, FLAGGED_INTERACTIONS_HEADERS);
    const intLast = intSheet.getLastRow();
    if (intLast >= 2) {
      const values = intSheet.getRange(2, 1, intLast - 1, FLAGGED_INTERACTIONS_HEADERS.length).getValues();
      for (let i = 0; i < values.length; i++) {
        if (values[i][0] === id) {
          intSheet.getRange(i + 2, 10).setValue(true);
          student = { email: values[i][2], name: values[i][3], sub: values[i][4] };
          flagSource = String(values[i][5] || 'interaction');
          break;
        }
      }
    }
  }
  if (!student) return { ok: false, error: 'flag not found' };

  // Log the resolution report
  const resSheet = getOrCreateSheet_(RESOLUTIONS_SHEET, RESOLUTIONS_HEADERS);
  const resolutionId = Utilities.getUuid();
  resSheet.appendRow([
    resolutionId,
    id,
    flagSource,
    student.email,
    student.name || '',
    student.sub,
    claims.email,
    claims.name || '',
    new Date(),
    action,
    severity,
    followup,
    notes,
  ]);

  return { ok: true, flag_id: id, resolution_id: resolutionId };
}

// Surfaces the closed-list option sets to the client so dropdown menus stay
// in sync with what the backend will accept.
function getResolutionOptions_() {
  return {
    actions: RESOLUTION_ACTIONS,
    severities: RESOLUTION_SEVERITIES,
    followups: RESOLUTION_FOLLOWUPS,
  };
}

// All-time resolutions for one student (matched by sub when available,
// falling back to email).
function countResolutionsForStudent_(sub, email) {
  const sheet = getOrCreateSheet_(RESOLUTIONS_SHEET, RESOLUTIONS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, 1, lastRow - 1, RESOLUTIONS_HEADERS.length).getValues();
  const subKey = String(sub || '');
  const emailKey = String(email || '').toLowerCase();
  let count = 0;
  for (const r of values) {
    const matchSub = subKey && r[5] === subKey;
    const matchEmail = emailKey && String(r[3] || '').toLowerCase() === emailKey;
    if (matchSub || matchEmail) count++;
  }
  return count;
}

// Returns the most recent N resolution rows for one student.
function recentResolutionsForStudent_(sub, email, max) {
  const sheet = getOrCreateSheet_(RESOLUTIONS_SHEET, RESOLUTIONS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, RESOLUTIONS_HEADERS.length).getValues();
  const subKey = String(sub || '');
  const emailKey = String(email || '').toLowerCase();
  const out = [];
  for (const r of values) {
    const matchSub = subKey && r[5] === subKey;
    const matchEmail = emailKey && String(r[3] || '').toLowerCase() === emailKey;
    if (!(matchSub || matchEmail)) continue;
    out.push({
      id: r[0],
      flag_id: r[1],
      flag_source: r[2],
      resolved_by_email: r[6],
      resolved_by_name: r[7],
      resolved_at: r[8] instanceof Date ? r[8].toISOString() : String(r[8]),
      action_taken: r[9],
      severity: r[10],
      followup: r[11],
      notes: r[12] || '',
    });
  }
  out.sort((a, b) => (a.resolved_at < b.resolved_at ? 1 : -1));
  return max ? out.slice(0, max) : out;
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
      response_type: String(r[14] || 'open').toLowerCase(),
      option_index: parseInt(r[15], 10) || null,
      rating_value: parseInt(r[16], 10) || null,
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
      response_type: String(r[14] || 'open').toLowerCase(),
      option_index: parseInt(r[15], 10) || null,
      rating_value: parseInt(r[16], 10) || null,
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
      response_type: String(r[14] || 'open').toLowerCase(),
      option_index: parseInt(r[15], 10) || null,
      rating_value: parseInt(r[16], 10) || null,
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function createPrompt_(teacherEmail, opts) {
  opts = opts || {};
  const title = String(opts.title || '').trim();
  const body = String(opts.body || '').trim();
  const type = String(opts.type || 'open').toLowerCase();
  if (VALID_PROMPT_TYPES.indexOf(type) === -1) throw new Error('unknown type: ' + type);
  if (!title && !body) throw new Error('prompt is empty');

  // Per-type validation
  let optionsArr = [];
  let optionsJson = '';
  let correctOption = '';
  let ratingScale = '';

  if (type === 'multiple_choice' || type === 'poll') {
    optionsArr = (Array.isArray(opts.options) ? opts.options : [])
      .map(s => String(s || '').trim())
      .filter(Boolean);
    if (optionsArr.length < 2) throw new Error('at least 2 options required');
    if (optionsArr.length > 8) throw new Error('at most 8 options');
    optionsJson = JSON.stringify(optionsArr);
    if (type === 'multiple_choice' && opts.correct_option) {
      const idx = parseInt(opts.correct_option, 10);
      if (idx >= 1 && idx <= optionsArr.length) correctOption = idx;
    }
  } else if (type === 'rating') {
    const scale = parseInt(opts.rating_scale, 10);
    ratingScale = (scale >= 2 && scale <= 10) ? scale : 5;
  }

  const sheet = getOrCreateSheet_(PROMPTS_SHEET, PROMPTS_HEADERS);
  const id = Utilities.getUuid();
  const createdAt = new Date();
  sheet.appendRow([
    id,
    createdAt,
    teacherEmail,
    title,
    body,
    opts.status || 'active',
    opts.closes_at || '',
    opts.audience || '',
    opts.shared_from || '',
    type,
    optionsJson,
    correctOption,
    ratingScale,
  ]);
  return {
    id,
    created_at: createdAt.toISOString(),
    teacher_email: teacherEmail,
    title,
    body,
    status: opts.status || 'active',
    closes_at: opts.closes_at || '',
    audience: opts.audience || '',
    shared_from: opts.shared_from || '',
    type,
    options: optionsArr,
    correct_option: correctOption || null,
    rating_scale: ratingScale || null,
  };
}

function parsePromptOptions_(rawJson) {
  const s = String(rawJson || '').trim();
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (err) { return []; }
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
