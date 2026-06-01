// Teacher page logic. Auth + api() helpers live in auth.js.

async function showSignedIn(user) {
  document.getElementById('signin-container').hidden = true;
  document.getElementById('status').hidden = true;
  document.getElementById('signed-in').hidden = false;
  document.getElementById('user-name').textContent = user.name || '';
  document.getElementById('user-email').textContent = user.email || '';

  const roleLoading = document.getElementById('role-loading');
  const notTeacher = document.getElementById('not-teacher');
  const tools = document.getElementById('teacher-tools');

  try {
    const me = await api('whoami');
    roleLoading.hidden = true;
    if (me.ok && me.is_teacher) {
      tools.hidden = false;
      loadPrompts();
      refreshFlaggedCount();
    } else {
      notTeacher.hidden = false;
    }
  } catch (err) {
    roleLoading.textContent = `Couldn't check access: ${err.message}`;
  }
}

function showSignedOut() {
  document.getElementById('signed-in').hidden = true;
  document.getElementById('signin-container').hidden = false;
  document.getElementById('status').hidden = false;
  document.getElementById('status').textContent = 'Signed out. Sign in again to continue.';
  document.getElementById('teacher-tools').hidden = true;
  document.getElementById('not-teacher').hidden = true;
  document.getElementById('role-loading').hidden = false;
  document.getElementById('role-loading').textContent = 'Checking access...';
  closeFlaggedPanel();
}

async function loadPrompts() {
  const list = document.getElementById('prompts-list');
  list.textContent = 'Loading prompts...';
  try {
    const data = await api('list_prompts');
    if (!data.ok) {
      list.textContent = `Couldn't load prompts: ${data.error}`;
      return;
    }
    if (data.prompts.length === 0) {
      list.innerHTML = '<p class="muted">No active prompts yet.</p>';
      return;
    }
    list.innerHTML = '';
    for (const p of data.prompts) {
      list.appendChild(renderTeacherPromptCard(p));
    }
  } catch (err) {
    list.textContent = `Network error: ${err.message}`;
  }
}

function renderTeacherPromptCard(p) {
  const card = document.createElement('article');
  card.className = 'prompt-card teacher-prompt-card';
  card.dataset.promptId = p.id;
  const created = new Date(p.created_at).toLocaleString();

  card.innerHTML = `
    <header class="prompt-header">
      <h3 class="font-heading"></h3>
      <p class="prompt-body"></p>
      <p class="muted small">from <span class="prompt-teacher"></span> · <span class="prompt-time"></span></p>
      <div class="prompt-actions">
        <button type="button" class="link-btn toggle-responses">Show responses</button>
        <button type="button" class="link-btn toggle-students">View by student</button>
        <button type="button" class="link-btn summarize-btn">Generate AI summary</button>
      </div>
    </header>
    <div class="responses-panel" hidden>
      <p class="muted small responses-status">Loading...</p>
      <div class="responses-list"></div>
    </div>
    <div class="students-panel" hidden>
      <p class="muted small students-status">Loading...</p>
      <div class="students-list"></div>
      <div class="student-thread" hidden></div>
    </div>
    <div class="summary-panel" hidden></div>
  `;
  card.querySelector('h3').textContent = p.title || '(untitled)';
  card.querySelector('.prompt-body').textContent = p.body || '';
  card.querySelector('.prompt-teacher').textContent = p.teacher_email;
  card.querySelector('.prompt-time').textContent = created;

  // Show responses
  const toggleBtn = card.querySelector('.toggle-responses');
  const responsesPanel = card.querySelector('.responses-panel');
  toggleBtn.addEventListener('click', async () => {
    if (responsesPanel.hidden) {
      responsesPanel.hidden = false;
      toggleBtn.textContent = 'Refresh responses';
      await loadResponsesForPrompt(card, p.id);
    } else {
      responsesPanel.hidden = true;
      toggleBtn.textContent = 'Show responses';
    }
  });

  // View by student
  const studentsBtn = card.querySelector('.toggle-students');
  const studentsPanel = card.querySelector('.students-panel');
  studentsBtn.addEventListener('click', async () => {
    if (studentsPanel.hidden) {
      studentsPanel.hidden = false;
      studentsBtn.textContent = 'Hide students';
      await loadStudentsForPrompt(card, p.id);
    } else {
      studentsPanel.hidden = true;
      studentsBtn.textContent = 'View by student';
    }
  });

  // Class summary
  const summarizeBtn = card.querySelector('.summarize-btn');
  const summaryPanel = card.querySelector('.summary-panel');
  summarizeBtn.addEventListener('click', () => generateSummary(p.id, summarizeBtn, summaryPanel));

  return card;
}

/* ============================================================
   Show responses (flat list, flagged on top)
   ============================================================ */

async function loadResponsesForPrompt(card, promptId) {
  const status = card.querySelector('.responses-status');
  const list = card.querySelector('.responses-list');
  status.textContent = 'Loading...';
  list.innerHTML = '';
  try {
    const data = await api('list_responses_for_prompt', { prompt_id: promptId });
    if (!data.ok) {
      status.textContent = `Couldn't load: ${data.error}`;
      return;
    }
    if (data.responses.length === 0) {
      status.textContent = 'No responses yet.';
      return;
    }
    const flagged = data.responses.filter(r => r.flagged).length;
    status.textContent = `${data.responses.length} response${data.responses.length === 1 ? '' : 's'}` +
      (flagged ? ` · ${flagged} flagged` : '');
    for (const r of data.responses) {
      list.appendChild(renderTeacherResponseCard(r));
    }
  } catch (err) {
    status.textContent = `Network error: ${err.message}`;
  }
}

function renderTeacherResponseCard(r) {
  const card = document.createElement('div');
  card.className = 'teacher-response-card' + (r.flagged ? ' flagged' : '');
  const submitted = new Date(r.created_at).toLocaleString();

  const feedbackHtml = r.ai_feedback
    ? (r.flagged
        ? `<div class="resource-note"><p class="ai-body"></p></div>`
        : `<div class="ai-feedback"><p class="ai-label small">AI feedback shown to student</p><p class="ai-body"></p></div>`)
    : '';

  card.innerHTML = `
    ${r.flagged ? '<p class="flag-banner"></p>' : ''}
    <p class="student-header">
      <strong class="student-name"></strong>
      <span class="muted small"> &lt;<span class="student-email"></span>&gt;</span>
      <span class="muted small"> · <span class="submission-time"></span></span>
    </p>
    <p class="response-body"></p>
    ${feedbackHtml}
  `;

  if (r.flagged) {
    card.querySelector('.flag-banner').textContent = 'FLAGGED — ' + (r.flag_reason || 'review needed');
  }
  card.querySelector('.student-name').textContent = r.student_name || '(no name)';
  card.querySelector('.student-email').textContent = r.student_email;
  card.querySelector('.submission-time').textContent = submitted;
  card.querySelector('.response-body').textContent = r.body;
  if (r.ai_feedback) {
    card.querySelector('.ai-body').textContent = r.ai_feedback;
  }

  return card;
}

/* ============================================================
   View by student (list of students -> their thread)
   ============================================================ */

async function loadStudentsForPrompt(card, promptId) {
  const status = card.querySelector('.students-status');
  const list = card.querySelector('.students-list');
  const thread = card.querySelector('.student-thread');
  thread.hidden = true;
  status.textContent = 'Loading...';
  list.innerHTML = '';
  try {
    const data = await api('list_students_for_prompt', { prompt_id: promptId });
    if (!data.ok) {
      status.textContent = `Couldn't load: ${data.error}`;
      return;
    }
    if (data.students.length === 0) {
      status.textContent = 'No student submissions yet.';
      return;
    }
    status.textContent = `${data.students.length} student${data.students.length === 1 ? '' : 's'} have responded.`;
    for (const s of data.students) {
      list.appendChild(renderStudentRow(s, promptId, card));
    }
  } catch (err) {
    status.textContent = `Network error: ${err.message}`;
  }
}

function renderStudentRow(s, promptId, card) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'student-row' + (s.flagged ? ' has-flag' : '');
  row.dataset.email = s.student_email;
  const initials = (s.student_name || s.student_email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
  const last = s.last_at ? new Date(s.last_at).toLocaleString() : '';
  row.innerHTML = `
    <span class="student-avatar"></span>
    <span class="student-info">
      <span class="student-name-row"></span>
      <span class="student-email-row muted small"></span>
    </span>
    <span class="student-meta">
      <span class="count-chip"></span>
      ${s.flagged ? '<span class="flag-chip">FLAGGED</span>' : ''}
      <span class="last-at muted small"></span>
    </span>
  `;
  row.querySelector('.student-avatar').textContent = initials || '?';
  row.querySelector('.student-name-row').textContent = s.student_name || '(no name)';
  row.querySelector('.student-email-row').textContent = s.student_email || '';
  row.querySelector('.count-chip').textContent = `${s.response_count} resp.`;
  row.querySelector('.last-at').textContent = last;

  row.addEventListener('click', async () => {
    document.querySelectorAll('.student-row.active').forEach(el => el.classList.remove('active'));
    row.classList.add('active');
    await loadStudentThread(card, promptId, s);
  });
  return row;
}

async function loadStudentThread(card, promptId, student) {
  const thread = card.querySelector('.student-thread');
  thread.hidden = false;
  thread.innerHTML = '<p class="muted small">Loading thread...</p>';
  try {
    // The backend needs google_sub which we don't have here; we'll send email
    // and let the backend resolve via the sheet rows.
    const data = await api('get_student_thread', {
      prompt_id: promptId,
      google_sub: student.google_sub || '',
      student_email: student.student_email,
    });
    if (!data.ok) {
      thread.innerHTML = `<p class="muted small">Couldn't load: ${data.error}</p>`;
      return;
    }
    renderStudentThread(thread, student, data.thread);
  } catch (err) {
    thread.innerHTML = `<p class="muted small">Network error: ${err.message}</p>`;
  }
}

function renderStudentThread(container, student, thread) {
  container.innerHTML = `
    <div class="thread-header">
      <span class="student-avatar large"></span>
      <div class="thread-meta">
        <h4 class="font-heading thread-name"></h4>
        <p class="muted small thread-email"></p>
      </div>
      <span class="thread-count muted small"></span>
    </div>
    <div class="thread-body"></div>
  `;
  const initials = (student.student_name || student.student_email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
  container.querySelector('.student-avatar.large').textContent = initials || '?';
  container.querySelector('.thread-name').textContent = student.student_name || '(no name)';
  container.querySelector('.thread-email').textContent = student.student_email || '';
  container.querySelector('.thread-count').textContent =
    `${thread.responses.length} response${thread.responses.length === 1 ? '' : 's'}`;

  const body = container.querySelector('.thread-body');
  if (thread.responses.length === 0) {
    body.innerHTML = '<p class="muted">No responses from this student yet.</p>';
    return;
  }
  for (const r of thread.responses) {
    const bubble = document.createElement('div');
    bubble.className = 'thread-bubble' + (r.flagged ? ' flagged' : '');
    bubble.innerHTML = `
      ${r.flagged ? '<p class="flag-banner"></p>' : ''}
      <p class="muted small thread-time"></p>
      <p class="thread-response"></p>
      ${r.ai_feedback ? `
        <div class="${r.flagged ? 'resource-note' : 'ai-feedback'}">
          ${r.flagged ? '' : '<p class="ai-label small">AI feedback shown to student</p>'}
          <p class="ai-body"></p>
        </div>
      ` : ''}
    `;
    if (r.flagged) {
      bubble.querySelector('.flag-banner').textContent = 'FLAGGED — ' + (r.flag_reason || 'review needed');
    }
    bubble.querySelector('.thread-time').textContent = new Date(r.created_at).toLocaleString();
    bubble.querySelector('.thread-response').textContent = r.body;
    if (r.ai_feedback) {
      bubble.querySelector('.ai-body').textContent = r.ai_feedback;
    }
    body.appendChild(bubble);
  }
}

/* ============================================================
   AI class summary
   ============================================================ */

async function generateSummary(promptId, button, panel) {
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Generating...';
  panel.hidden = false;
  panel.innerHTML = '<p class="muted small">Asking Gemini to summarise responses — this can take 10-30 seconds...</p>';

  try {
    const data = await api('summarize_prompt_responses', { prompt_id: promptId });
    if (!data.ok) {
      panel.innerHTML = `<p class="muted small">Couldn't generate: ${data.error}</p>`;
      return;
    }
    renderSummary(panel, data.summary);
  } catch (err) {
    panel.innerHTML = `<p class="muted small">Network error: ${err.message}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = originalText === 'Generate AI summary' ? 'Regenerate AI summary' : originalText;
  }
}

function renderSummary(container, s) {
  container.innerHTML = `
    <div class="class-summary">
      <p class="summary-meta muted small"></p>
      <h4 class="font-heading">Overview</h4>
      <p class="summary-overview"></p>
      <h4 class="font-heading">Common themes</h4>
      <ul class="summary-themes"></ul>
      <h4 class="font-heading">Misconceptions / gaps</h4>
      <ul class="summary-misconceptions"></ul>
      <h4 class="font-heading">Students to follow up with</h4>
      <ul class="summary-follow-up"></ul>
      <h4 class="font-heading">Suggested next steps</h4>
      <ul class="summary-next-steps"></ul>
    </div>
  `;

  const meta = `${s.response_count} response${s.response_count === 1 ? '' : 's'} · generated ${new Date(s.generated_at).toLocaleString()}`;
  container.querySelector('.summary-meta').textContent = meta;
  container.querySelector('.summary-overview').textContent = s.overview || '(no overview)';

  fillList(container.querySelector('.summary-themes'), s.themes);
  fillList(container.querySelector('.summary-misconceptions'), s.misconceptions);
  fillList(container.querySelector('.summary-next-steps'), s.next_steps);

  const followUpUl = container.querySelector('.summary-follow-up');
  followUpUl.innerHTML = '';
  if (!s.follow_up_students || s.follow_up_students.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'None — looks good across the class.';
    followUpUl.appendChild(li);
  } else {
    for (const f of s.follow_up_students) {
      const li = document.createElement('li');
      li.innerHTML = '<strong></strong> — <span></span>';
      li.querySelector('strong').textContent = f.email;
      li.querySelector('span').textContent = f.reason;
      followUpUl.appendChild(li);
    }
  }
}

function fillList(ul, items) {
  ul.innerHTML = '';
  if (!items || items.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '(none noted)';
    ul.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.appendChild(li);
  }
}

/* ============================================================
   Flagged panel (MagicSchool-style slide-in)
   ============================================================ */

async function refreshFlaggedCount() {
  try {
    const data = await api('list_flagged_responses', { include_resolved: false });
    if (!data.ok) return;
    updateFlaggedButton(data.responses);
    populateFlaggedPanel(data.responses);
  } catch (err) { /* silent */ }
}

function updateFlaggedButton(responses) {
  const btn = document.getElementById('flagged-btn');
  const count = document.getElementById('flagged-count');
  if (!btn || !count) return;
  count.textContent = String(responses.length);
  btn.classList.toggle('empty', responses.length === 0);
}

function populateFlaggedPanel(responses) {
  const list = document.getElementById('flagged-list');
  const sub = document.getElementById('flagged-panel-sub');
  if (!list || !sub) return;
  if (responses.length === 0) {
    sub.textContent = 'No items currently flagged.';
    list.innerHTML = `
      <div class="flagged-empty">
        <span class="empty-icon" aria-hidden="true">✅</span>
        <h3 class="font-heading">All clear</h3>
        <p>No student responses have been flagged for review.</p>
      </div>
    `;
    return;
  }
  sub.textContent = `${responses.length} item${responses.length === 1 ? '' : 's'} need${responses.length === 1 ? 's' : ''} your attention.`;
  list.innerHTML = '';
  for (const r of responses) {
    list.appendChild(renderFlaggedItem(r));
  }
}

function renderFlaggedItem(r) {
  const item = document.createElement('article');
  item.className = 'flagged-item';
  item.dataset.id = r.id;
  const initials = (r.student_name || r.student_email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
  item.innerHTML = `
    <div class="flagged-item-head">
      <span class="flagged-avatar"></span>
      <div class="student-line">
        <p class="student-name"></p>
        <p class="student-email"></p>
      </div>
    </div>
    <p class="prompt-context">On prompt: <strong></strong></p>
    <p class="response-body"></p>
    <div class="flag-reason">
      <span class="reason-label">Why:</span>
      <span class="reason-text"></span>
    </div>
    <div class="flagged-item-footer">
      <span class="submission-time"></span>
      <button type="button" class="btn-success resolve-btn">Mark resolved</button>
    </div>
  `;
  item.querySelector('.flagged-avatar').textContent = initials || '?';
  item.querySelector('.student-name').textContent = r.student_name || '(no name)';
  item.querySelector('.student-email').textContent = r.student_email || '';
  item.querySelector('.prompt-context strong').textContent = r.prompt_title || '(untitled)';
  item.querySelector('.response-body').textContent = r.body || '';
  item.querySelector('.reason-text').textContent = r.flag_reason || 'No reason recorded.';
  item.querySelector('.submission-time').textContent = new Date(r.created_at).toLocaleString();

  const resolveBtn = item.querySelector('.resolve-btn');
  resolveBtn.addEventListener('click', async () => {
    resolveBtn.disabled = true;
    resolveBtn.textContent = 'Resolving...';
    try {
      const data = await api('resolve_flagged_response', { response_id: r.id });
      if (data.ok) {
        item.style.opacity = '0.4';
        setTimeout(() => item.remove(), 250);
        setTimeout(refreshFlaggedCount, 350);
      } else {
        resolveBtn.disabled = false;
        resolveBtn.textContent = 'Mark resolved';
        alert('Error: ' + (data.error || 'unknown'));
      }
    } catch (err) {
      resolveBtn.disabled = false;
      resolveBtn.textContent = 'Mark resolved';
      alert('Network error: ' + err.message);
    }
  });
  return item;
}

function openFlaggedPanel() {
  document.getElementById('flagged-backdrop').classList.add('open');
  const panel = document.getElementById('flagged-panel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  refreshFlaggedCount();
}

function closeFlaggedPanel() {
  document.getElementById('flagged-backdrop').classList.remove('open');
  const panel = document.getElementById('flagged-panel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
}

/* ============================================================
   Prompt publish form
   ============================================================ */

async function submitPrompt(event) {
  event.preventDefault();
  const titleEl = document.getElementById('prompt-title');
  const bodyEl = document.getElementById('prompt-body');
  const result = document.getElementById('result');
  const submitBtn = event.target.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  result.textContent = 'Publishing...';

  try {
    const data = await api('create_prompt', {
      title: titleEl.value.trim(),
      body: bodyEl.value.trim(),
    });
    if (data.ok) {
      result.textContent = 'Published.';
      titleEl.value = '';
      bodyEl.value = '';
      loadPrompts();
    } else {
      result.textContent = `Error: ${data.error || 'unknown'}`;
    }
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('prompt-form').addEventListener('submit', submitPrompt);
  document.getElementById('sign-out').addEventListener('click', signOut);
  document.getElementById('flagged-btn').addEventListener('click', openFlaggedPanel);
  document.getElementById('flagged-close').addEventListener('click', closeFlaggedPanel);
  document.getElementById('flagged-backdrop').addEventListener('click', closeFlaggedPanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFlaggedPanel();
  });
});

document.addEventListener('aisa:signed-in', (e) => showSignedIn(e.detail));
document.addEventListener('aisa:signed-out', showSignedOut);
