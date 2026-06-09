// Teacher page logic. Auth + api() helpers live in auth.js.

let currentDraftId = null;
let currentEditPromptId = null;
let currentSharePromptId = null;

const TYPE_LABELS = {
  open: 'Open response',
  multiple_choice: 'Multiple choice',
  acknowledgment: 'Acknowledgment',
  rating: 'Rating',
  poll: 'Poll',
};

function formatTypeBadge(type) {
  return TYPE_LABELS[type] || 'Open response';
}

function renderPromptDetails(p) {
  const type = (p.type || 'open').toLowerCase();
  if (type === 'multiple_choice' || type === 'poll') {
    const opts = (p.options || []).map((label, i) => {
      const idx = i + 1;
      const correct = type === 'multiple_choice' && parseInt(p.correct_option, 10) === idx;
      return `<li${correct ? ' class="correct-option"' : ''}>${escapeHtml(label)}${correct ? ' <span class="correct-mark">correct</span>' : ''}</li>`;
    }).join('');
    return `<ol class="prompt-options-list">${opts}</ol>`;
  }
  if (type === 'rating') {
    return `<p class="muted small">Scale: 1 to ${parseInt(p.rating_scale, 10) || 5}</p>`;
  }
  return '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const PROMPT_TEMPLATES = [
  {
    id: 'exit-ticket', label: '🎫 Exit ticket', type: 'open',
    title: 'Exit ticket',
    body: "In 2–3 sentences:\n• One thing you learned today\n• One question you still have",
  },
  {
    id: 'reflection', label: '💭 Reflection', type: 'open',
    title: 'Lesson reflection',
    body: "Take a few minutes to reflect on today's lesson. What did you find challenging? What surprised you? What do you want to learn more about?",
  },
  {
    id: 'mood', label: '🌡️ Mood check-in', type: 'rating', rating_scale: 5,
    title: 'How are you feeling today?',
    body: "Pick a number that best reflects how you're feeling right now.\n1 = struggling   ·   5 = great",
  },
  {
    id: 'confidence', label: '📈 Confidence', type: 'rating', rating_scale: 5,
    title: 'How confident do you feel about today\'s lesson?',
    body: 'Rate your confidence with the material we covered today.\n1 = totally lost   ·   5 = I could teach it',
  },
  {
    id: 'poll', label: '🤔 Quick poll', type: 'poll',
    title: 'Quick poll',
    body: 'Which of these feels most true to you right now?',
    options: ['Option 1', 'Option 2', 'Option 3'],
  },
  {
    id: 'knowledge', label: '❓ Knowledge check', type: 'multiple_choice',
    title: 'Knowledge check',
    body: 'Choose the best answer.',
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct_option: 1,
  },
  {
    id: 'acknowledgment', label: '✅ Announcement', type: 'acknowledgment',
    title: 'Important announcement',
    body: 'Please confirm you have read and understood the message below.\n\n[Replace this paragraph with your announcement.]',
  },
];

function renderTemplatesRow() {
  const row = document.getElementById('templates-row');
  if (!row) return;
  row.innerHTML = '';
  for (const t of PROMPT_TEMPLATES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'template-chip';
    chip.textContent = t.label;
    chip.title = `${TYPE_LABELS[t.type] || t.type} · click to fill the form`;
    chip.addEventListener('click', () => applyTemplate(t));
    row.appendChild(chip);
  }
}

function applyTemplate(t) {
  document.getElementById('prompt-type').value = t.type;
  document.getElementById('prompt-title').value = t.title || '';
  document.getElementById('prompt-body').value = t.body || '';
  document.getElementById('prompt-options').value = (t.options || []).join('\n');
  document.getElementById('prompt-correct').value = t.correct_option || '';
  document.getElementById('prompt-rating-scale').value = t.rating_scale || 5;
  applyFormTypeUI(t.type);
  document.getElementById('prompt-title').focus();
  document.getElementById('prompt-title').select();
}

/* ============================================================
   AI suggest modal
   ============================================================ */

let currentSuggestion = null;

function openSuggestModal() {
  currentSuggestion = null;
  const modal = document.getElementById('suggest-modal');
  document.getElementById('suggest-topic').value = '';
  document.getElementById('suggest-type').value = document.getElementById('prompt-type').value || 'open';
  document.getElementById('suggest-result').textContent = '';
  document.getElementById('suggest-preview').hidden = true;
  document.getElementById('suggest-use').hidden = true;
  document.getElementById('suggest-generate').hidden = false;
  document.getElementById('suggest-backdrop').hidden = false;
  modal.hidden = false;
  modalOpen(modal, '#suggest-topic');
}

function closeSuggestModal() {
  document.getElementById('suggest-backdrop').hidden = true;
  document.getElementById('suggest-modal').hidden = true;
  currentSuggestion = null;
  modalClose();
}

async function generateSuggestion() {
  const topic = document.getElementById('suggest-topic').value.trim();
  const type = document.getElementById('suggest-type').value;
  const result = document.getElementById('suggest-result');
  const generateBtn = document.getElementById('suggest-generate');
  if (!topic) { result.textContent = 'Enter a topic.'; return; }
  generateBtn.disabled = true;
  result.textContent = 'Asking Gemini — this can take a few seconds...';
  document.getElementById('suggest-preview').hidden = true;
  document.getElementById('suggest-use').hidden = true;
  try {
    const data = await api('suggest_prompt', { topic, type });
    if (!data.ok) {
      result.textContent = `Error: ${friendlyError(data.error)}`;
      return;
    }
    currentSuggestion = data.suggestion;
    result.textContent = '';
    renderSuggestionPreview(data.suggestion);
    document.getElementById('suggest-use').hidden = false;
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    generateBtn.disabled = false;
  }
}

function renderSuggestionPreview(s) {
  const preview = document.getElementById('suggest-preview');
  preview.hidden = false;
  preview.querySelector('.suggest-preview-title').textContent = s.title || '(untitled)';
  preview.querySelector('.suggest-preview-body').textContent = s.body || '';
  const opts = preview.querySelector('.suggest-preview-options');
  opts.hidden = true;
  opts.innerHTML = '';
  if (s.options && s.options.length) {
    opts.hidden = false;
    for (let i = 0; i < s.options.length; i++) {
      const li = document.createElement('li');
      const correct = s.type === 'multiple_choice' && s.correct_option === i + 1;
      li.innerHTML = correct
        ? `<strong></strong> <span class="correct-mark">correct</span>`
        : '<span></span>';
      (li.querySelector('strong') || li.querySelector('span')).textContent = s.options[i];
      opts.appendChild(li);
    }
  }
}

function applyCurrentSuggestion() {
  if (!currentSuggestion) return;
  const s = currentSuggestion;
  document.getElementById('prompt-type').value = s.type;
  document.getElementById('prompt-title').value = s.title || '';
  document.getElementById('prompt-body').value = s.body || '';
  document.getElementById('prompt-options').value = (s.options || []).join('\n');
  document.getElementById('prompt-correct').value = s.correct_option || '';
  applyFormTypeUI(s.type);
  closeSuggestModal();
  document.getElementById('prompt-title').focus();
}

async function showSignedIn(user) {
  document.getElementById('signin-container').hidden = true;
  document.getElementById('status').hidden = true;
  document.getElementById('signed-in').hidden = false;

  const roleLoading = document.getElementById('role-loading');
  const notTeacher = document.getElementById('not-teacher');
  const tools = document.getElementById('teacher-tools');

  try {
    const me = await api('whoami');
    roleLoading.hidden = true;
    if (me.ok && me.is_teacher) {
      tools.hidden = false;
      loadPrompts();
      loadDrafts();
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
}

async function loadPrompts() {
  const list = document.getElementById('prompts-list');
  list.textContent = 'Loading prompts...';
  try {
    const data = await api('list_prompts');
    if (!data.ok) {
      list.textContent = `Couldn't load prompts: ${friendlyError(data.error)}`;
      return;
    }
    const tabCount = document.getElementById('tab-count-active');
    if (tabCount) tabCount.textContent = String(data.prompts.length);
    if (data.prompts.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📝</span>
          <h3>No active prompts yet</h3>
          <p>Use the form on the left to publish your first assignment.</p>
        </div>`;
      return;
    }
    list.innerHTML = '';
    for (const p of data.prompts) {
      list.appendChild(renderTeacherPromptCard(p));
    }
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><h3>Network error</h3><p>${err.message}</p></div>`;
  }
}

function switchTeacherTab(name) {
  document.querySelectorAll('.tab-nav .tab').forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.hidden = panel.id !== `panel-${name}`;
  });
}

let teacherNotesTimer = null;
function setupTeacherNotes() {
  const textarea = document.getElementById('notes-textarea');
  const status = document.getElementById('notes-status');
  if (!textarea || !status) return;
  document.addEventListener('aisa:signed-in', () => {
    try {
      const key = 'aisa.notes.' + (currentUser && currentUser.email ? currentUser.email : 'anon');
      const saved = localStorage.getItem(key);
      if (saved != null) {
        textarea.value = saved;
        status.textContent = 'Saved on this device.';
      } else {
        status.textContent = 'Start typing — your notes save automatically.';
      }
    } catch (_) {}
  });
  textarea.addEventListener('input', () => {
    status.textContent = 'Saving…';
    if (teacherNotesTimer) clearTimeout(teacherNotesTimer);
    teacherNotesTimer = setTimeout(() => {
      try {
        const key = 'aisa.notes.' + (currentUser && currentUser.email ? currentUser.email : 'anon');
        localStorage.setItem(key, textarea.value);
        status.textContent = 'Saved on this device · ' + friendlyTime(new Date().toISOString());
      } catch (err) {
        status.textContent = "Couldn't save (storage full?)";
      }
    }, 400);
  });
}

function renderTeacherPromptCard(p) {
  const card = document.createElement('article');
  card.className = 'prompt-card teacher-prompt-card';
  card.dataset.promptId = p.id;
  const created = friendlyTime(p.created_at);

  const closesAt = p.closes_at ? new Date(p.closes_at) : null;
  const closed = closesAt && !isNaN(closesAt.getTime()) && closesAt < new Date();
  const audienceText = formatAudience(p.audience);
  const type = (p.type || 'open').toLowerCase();
  const typeBadge = formatTypeBadge(type);

  card.innerHTML = `
    <header class="prompt-header">
      <div class="prompt-card-top">
        <span class="type-badge type-${type}">${typeBadge}</span>
      </div>
      <h3 class="font-heading"></h3>
      <p class="prompt-body"></p>
      ${renderPromptDetails(p)}
      <div class="prompt-meta">
        <span class="meta-item"><span class="meta-label">From</span> <span class="prompt-teacher"></span></span>
        <span class="meta-item"><span class="meta-label">Published</span> <span class="prompt-time"></span></span>
        <span class="meta-item audience-meta"><span class="meta-label">Audience</span> <span class="prompt-audience"></span></span>
        <span class="meta-item closes-meta" hidden><span class="meta-label closes-label">Closes</span> <span class="prompt-closes"></span></span>
      </div>
      <div class="prompt-actions">
        <button type="button" class="link-btn toggle-responses">Show responses</button>
        <button type="button" class="link-btn toggle-students">View by student</button>
        <button type="button" class="link-btn summarize-btn">Generate AI summary</button>
        <button type="button" class="link-btn share-btn">Share with teacher</button>
        <button type="button" class="link-btn edit-btn">Edit</button>
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
  card.querySelector('.prompt-audience').textContent = audienceText;

  if (closesAt && !isNaN(closesAt.getTime())) {
    const closesMeta = card.querySelector('.closes-meta');
    closesMeta.hidden = false;
    closesMeta.querySelector('.prompt-closes').textContent = friendlyTime(closesAt.toISOString());
    if (closed) {
      closesMeta.classList.add('closed');
      closesMeta.querySelector('.closes-label').textContent = 'Closed';
    }
  }

  card.querySelector('.share-btn').addEventListener('click', () => openShareModal(p));
  card.querySelector('.edit-btn').addEventListener('click', () => beginEditPrompt(p));

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
  summarizeBtn.textContent = summaryButtonLabel(type);
  summarizeBtn.addEventListener('click', () => generateSummary(p, summarizeBtn, summaryPanel));

  return card;
}

function summaryButtonLabel(type) {
  if (type === 'multiple_choice' || type === 'poll') return 'Show results';
  if (type === 'rating') return 'Show rating breakdown';
  if (type === 'acknowledgment') return 'Who acknowledged?';
  return 'Generate AI summary';
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
      status.textContent = `Couldn't load: ${friendlyError(data.error)}`;
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
  const submitted = friendlyTime(r.created_at);

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
      status.textContent = `Couldn't load: ${friendlyError(data.error)}`;
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
  const last = s.last_at ? friendlyTime(s.last_at) : '';
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
    bubble.querySelector('.thread-time').textContent = friendlyTime(r.created_at);
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

async function generateSummary(prompt, button, panel) {
  const type = (prompt.type || 'open').toLowerCase();
  button.disabled = true;
  const originalText = button.textContent;
  panel.hidden = false;

  try {
    if (type === 'open') {
      button.textContent = 'Generating...';
      panel.innerHTML = '<p class="muted small">Asking Gemini to summarise responses — this can take 10-30 seconds...</p>';
      const data = await api('summarize_prompt_responses', { prompt_id: prompt.id });
      if (!data.ok) {
        panel.innerHTML = `<p class="muted small">Couldn't generate: ${data.error}</p>`;
      } else {
        renderSummary(panel, data.summary);
      }
    } else {
      button.textContent = 'Loading...';
      panel.innerHTML = '<p class="muted small">Loading results...</p>';
      const data = await api('get_prompt_summary', { prompt_id: prompt.id });
      if (!data.ok) {
        panel.innerHTML = `<p class="muted small">Couldn't load: ${data.error}</p>`;
      } else {
        renderStructuredSummary(panel, data.summary);
      }
    }
  } catch (err) {
    panel.innerHTML = `<p class="muted small">Network error: ${err.message}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = originalText.startsWith('Generate') ? 'Regenerate AI summary' : originalText;
  }
}

function renderStructuredSummary(container, s) {
  const generated = friendlyTime(s.generated_at);
  if (s.type === 'multiple_choice' || s.type === 'poll') {
    const correctLine = (s.type === 'multiple_choice' && typeof s.correct_percent === 'number')
      ? `<p class="summary-overview"><strong>${s.correct_percent}%</strong> of ${s.total} students picked the correct answer.</p>` : '';
    const bars = (s.options || []).map(o => `
      <li class="result-bar${o.is_correct ? ' correct' : ''}">
        <div class="result-bar-row">
          <span class="result-bar-label">${escapeHtml(o.label)}${o.is_correct ? ' <span class="correct-mark">correct</span>' : ''}</span>
          <span class="result-bar-count">${o.count} · ${o.percent}%</span>
        </div>
        <div class="result-bar-track"><div class="result-bar-fill" style="width:${o.percent}%"></div></div>
      </li>`).join('');
    container.innerHTML = `
      <div class="structured-summary">
        <p class="summary-meta muted small">${s.total} response${s.total === 1 ? '' : 's'} · generated ${generated}</p>
        ${correctLine}
        <ul class="result-bars">${bars}</ul>
      </div>`;
    return;
  }
  if (s.type === 'rating') {
    const bars = (s.distribution || []).map(d => `
      <li class="result-bar">
        <div class="result-bar-row">
          <span class="result-bar-label">${d.value}</span>
          <span class="result-bar-count">${d.count} · ${d.percent}%</span>
        </div>
        <div class="result-bar-track"><div class="result-bar-fill" style="width:${d.percent}%"></div></div>
      </li>`).join('');
    container.innerHTML = `
      <div class="structured-summary">
        <p class="summary-meta muted small">${s.total} response${s.total === 1 ? '' : 's'} · generated ${generated}</p>
        <p class="summary-overview"><strong>Average:</strong> ${s.average} / ${s.rating_scale}</p>
        <ul class="result-bars">${bars}</ul>
      </div>`;
    return;
  }
  if (s.type === 'acknowledgment') {
    const list = (s.acknowledged_by || []).map(a => `
      <li><strong>${escapeHtml(a.name || '(no name)')}</strong> <span class="muted small">${escapeHtml(a.email || '')}</span></li>`).join('');
    container.innerHTML = `
      <div class="structured-summary">
        <p class="summary-meta muted small">${s.total} acknowledgement${s.total === 1 ? '' : 's'} · generated ${generated}</p>
        <ul class="ack-list">${list || '<li class="muted">No one has acknowledged yet.</li>'}</ul>
      </div>`;
    return;
  }
  container.innerHTML = '<p class="muted small">No structured summary for this type.</p>';
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

  const meta = `${s.response_count} response${s.response_count === 1 ? '' : 's'} · generated ${friendlyTime(s.generated_at)}`;
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
   Flagged panel (handled by flagged-panel.js)
   ============================================================ */


/* ============================================================
   Drafts
   ============================================================ */

async function loadDrafts() {
  const section = document.getElementById('drafts-section');
  const list = document.getElementById('drafts-list');
  const count = document.getElementById('drafts-count');
  const empty = document.getElementById('drafts-empty');
  const tabCount = document.getElementById('tab-count-drafts');
  try {
    const data = await api('list_drafts');
    const drafts = (data.ok && data.drafts) ? data.drafts : [];
    if (tabCount) tabCount.textContent = String(drafts.length);
    if (drafts.length === 0) {
      if (section) section.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    section.hidden = false;
    count.textContent = `${drafts.length} draft${drafts.length === 1 ? '' : 's'}`;
    list.innerHTML = '';
    for (const d of drafts) {
      list.appendChild(renderDraftCard(d));
    }
  } catch (err) {
    if (section) section.hidden = true;
    if (empty) empty.hidden = false;
  }
}

function renderDraftCard(d) {
  const card = document.createElement('article');
  card.className = 'draft-card';
  card.innerHTML = `
    <p class="muted small">From <strong class="draft-from"></strong> · <span class="draft-time"></span></p>
    <h3 class="font-heading draft-title"></h3>
    <p class="draft-preview"></p>
    <div class="draft-actions">
      <button type="button" class="btn btn-primary customise-btn">Customise &amp; publish</button>
      <button type="button" class="btn btn-ghost discard-btn">Discard</button>
    </div>
  `;
  card.querySelector('.draft-from').textContent = d.shared_from || 'Unknown';
  card.querySelector('.draft-time').textContent = friendlyTime(d.created_at);
  card.querySelector('.draft-title').textContent = d.title || '(untitled)';
  card.querySelector('.draft-preview').textContent = d.body || '';

  card.querySelector('.customise-btn').addEventListener('click', () => beginDraftCustomisation(d));
  card.querySelector('.discard-btn').addEventListener('click', () => discardDraft(d.id));
  return card;
}

function beginEditPrompt(p) {
  // Cancel any draft customisation in progress.
  if (currentDraftId) cancelDraftCustomisation();
  currentEditPromptId = p.id;
  document.getElementById('prompt-type').value = p.type || 'open';
  document.getElementById('prompt-title').value = p.title || '';
  document.getElementById('prompt-body').value = p.body || '';
  document.getElementById('prompt-audience').value = p.audience || '';
  document.getElementById('prompt-closes-at').value = isoToDatetimeLocal(p.closes_at);
  document.getElementById('prompt-options').value = (p.options || []).join('\n');
  document.getElementById('prompt-correct').value = p.correct_option || '';
  document.getElementById('prompt-rating-scale').value = p.rating_scale || 5;
  applyFormTypeUI(p.type || 'open');

  document.getElementById('form-title').textContent = 'Edit prompt';
  document.getElementById('form-subtitle').textContent = 'Update the prompt. Students who already responded keep their submissions.';
  document.getElementById('publish-btn').textContent = 'Save changes';

  document.getElementById('edit-banner').hidden = false;
  document.getElementById('edit-title-display').textContent = p.title || '(untitled)';

  document.getElementById('prompt-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('prompt-title').focus();
}

function cancelEditPrompt() {
  currentEditPromptId = null;
  document.getElementById('prompt-form').reset();
  document.getElementById('prompt-type').value = 'open';
  document.getElementById('prompt-rating-scale').value = 5;
  applyFormTypeUI('open');
  document.getElementById('form-title').textContent = 'Create a prompt';
  document.getElementById('form-subtitle').textContent = 'Publish a question or activity. Students see it instantly.';
  document.getElementById('publish-btn').textContent = 'Publish prompt';
  document.getElementById('edit-banner').hidden = true;
  document.getElementById('result').textContent = '';
}

function beginDraftCustomisation(d) {
  if (currentEditPromptId) cancelEditPrompt();
  currentDraftId = d.id;
  document.getElementById('prompt-type').value = d.type || 'open';
  document.getElementById('prompt-title').value = d.title || '';
  document.getElementById('prompt-body').value = d.body || '';
  document.getElementById('prompt-audience').value = d.audience || '';
  document.getElementById('prompt-closes-at').value = isoToDatetimeLocal(d.closes_at);
  document.getElementById('prompt-options').value = (d.options || []).join('\n');
  document.getElementById('prompt-correct').value = d.correct_option || '';
  document.getElementById('prompt-rating-scale').value = d.rating_scale || 5;
  applyFormTypeUI(d.type || 'open');

  document.getElementById('form-title').textContent = 'Customise & publish draft';
  document.getElementById('form-subtitle').textContent = 'Edit anything and publish under your own account.';
  document.getElementById('publish-btn').textContent = 'Publish draft';

  const banner = document.getElementById('draft-banner');
  banner.hidden = false;
  document.getElementById('draft-from').textContent = d.shared_from || 'another teacher';

  document.getElementById('prompt-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('prompt-title').focus();
}

function cancelDraftCustomisation() {
  currentDraftId = null;
  document.getElementById('prompt-form').reset();
  document.getElementById('prompt-type').value = 'open';
  document.getElementById('prompt-rating-scale').value = 5;
  applyFormTypeUI('open');
  document.getElementById('form-title').textContent = 'Create a prompt';
  document.getElementById('form-subtitle').textContent = 'Publish a question or activity. Students see it instantly.';
  document.getElementById('publish-btn').textContent = 'Publish prompt';
  document.getElementById('draft-banner').hidden = true;
  document.getElementById('result').textContent = '';
}

async function discardDraft(draftId) {
  if (!confirm('Discard this draft? This can\'t be undone from the UI.')) return;
  try {
    const data = await api('discard_draft', { draft_id: draftId });
    if (data.ok) {
      if (currentDraftId === draftId) cancelDraftCustomisation();
      loadDrafts();
    } else {
      alert('Error: ' + (friendlyError(data.error)));
    }
  } catch (err) {
    alert('Network error: ' + err.message);
  }
}

function isoToDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(local) {
  if (!local) return '';
  const d = new Date(local);
  if (isNaN(d.getTime())) return '';
  return d.toISOString();
}

function formatAudience(audience) {
  const text = String(audience || '').trim();
  if (!text || text.toLowerCase() === 'all' || text.toLowerCase() === 'everyone') {
    return 'Everyone (all aisa.sch.ae)';
  }
  const list = text.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (list.length === 1) return list[0];
  return `${list.length} students`;
}

/* ============================================================
   Share modal
   ============================================================ */

function openShareModal(prompt) {
  currentSharePromptId = prompt.id;
  const modal = document.getElementById('share-modal');
  document.getElementById('share-prompt-title').textContent = prompt.title || '(untitled)';
  document.getElementById('share-recipient').value = '';
  document.getElementById('share-result').textContent = '';
  document.getElementById('share-backdrop').hidden = false;
  modal.hidden = false;
  modalOpen(modal, '#share-recipient');
}

function closeShareModal() {
  currentSharePromptId = null;
  document.getElementById('share-backdrop').hidden = true;
  document.getElementById('share-modal').hidden = true;
  modalClose();
}

async function sendShare() {
  if (!currentSharePromptId) return;
  const recipient = document.getElementById('share-recipient').value.trim();
  const result = document.getElementById('share-result');
  if (!recipient) {
    result.textContent = 'Enter a recipient email.';
    return;
  }
  const sendBtn = document.getElementById('share-send');
  sendBtn.disabled = true;
  result.textContent = 'Sending...';
  try {
    const data = await api('share_prompt', {
      prompt_id: currentSharePromptId,
      recipient_email: recipient,
    });
    if (data.ok) {
      result.textContent = `Sent to ${data.recipient}. They'll see it under "Shared with you" on their dashboard.`;
      announce(`Draft sent to ${data.recipient}.`);
      setTimeout(closeShareModal, 1500);
    } else {
      result.textContent = `Error: ${friendlyError(data.error)}`;
    }
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    sendBtn.disabled = false;
  }
}

/* ============================================================
   Prompt publish form (handles both new prompts and draft publish)
   ============================================================ */

function parseOptionsTextarea() {
  const raw = document.getElementById('prompt-options').value;
  return raw.split('\n').map(s => s.trim()).filter(Boolean);
}

function applyFormTypeUI(type) {
  type = type || 'open';
  const optionsField = document.getElementById('options-field');
  const correctField = document.getElementById('correct-field');
  const ratingField = document.getElementById('rating-field');
  const bodyLabel = document.getElementById('body-label');
  const bodyEl = document.getElementById('prompt-body');

  optionsField.hidden = !(type === 'multiple_choice' || type === 'poll');
  correctField.hidden = type !== 'multiple_choice';
  ratingField.hidden = type !== 'rating';

  if (type === 'acknowledgment') {
    bodyLabel.textContent = 'Message to acknowledge';
    bodyEl.placeholder = 'e.g. Please review the new uniform policy.';
  } else if (type === 'multiple_choice' || type === 'poll') {
    bodyLabel.textContent = 'Question';
    bodyEl.placeholder = 'e.g. Which process produces oxygen in plants?';
  } else if (type === 'rating') {
    bodyLabel.textContent = 'Question';
    bodyEl.placeholder = 'e.g. How confident do you feel about today\'s lesson?';
  } else {
    bodyLabel.textContent = 'Prompt body';
    bodyEl.placeholder = 'What would you like the students to work on?';
  }
}

async function submitPrompt(event) {
  event.preventDefault();
  const titleEl = document.getElementById('prompt-title');
  const bodyEl = document.getElementById('prompt-body');
  const audienceEl = document.getElementById('prompt-audience');
  const closesAtEl = document.getElementById('prompt-closes-at');
  const typeEl = document.getElementById('prompt-type');
  const result = document.getElementById('result');
  const submitBtn = document.getElementById('publish-btn');

  const type = typeEl.value;

  submitBtn.disabled = true;
  result.textContent = 'Publishing...';

  const payload = {
    title: titleEl.value.trim(),
    body: bodyEl.value.trim(),
    audience: audienceEl.value.trim(),
    closes_at: datetimeLocalToIso(closesAtEl.value),
    type,
  };
  if (type === 'multiple_choice' || type === 'poll') {
    payload.options = parseOptionsTextarea();
    if (payload.options.length < 2) {
      result.textContent = 'Add at least two options.';
      submitBtn.disabled = false;
      return;
    }
  }
  if (type === 'multiple_choice') {
    const c = parseInt(document.getElementById('prompt-correct').value, 10);
    if (c >= 1 && c <= payload.options.length) payload.correct_option = c;
  }
  if (type === 'rating') {
    payload.rating_scale = parseInt(document.getElementById('prompt-rating-scale').value, 10) || 5;
  }

  try {
    let data;
    if (currentEditPromptId) {
      data = await api('update_prompt', { prompt_id: currentEditPromptId, ...payload });
    } else if (currentDraftId) {
      data = await api('publish_draft', { draft_id: currentDraftId, ...payload });
    } else {
      data = await api('create_prompt', payload);
    }
    if (data.ok) {
      const msg = currentEditPromptId ? 'Saved.' : (currentDraftId ? 'Draft published.' : 'Published.');
      result.textContent = msg;
      announce(msg);
      const wasDraft = !!currentDraftId;
      const wasEdit = !!currentEditPromptId;
      if (wasEdit) cancelEditPrompt();
      else cancelDraftCustomisation();
      loadPrompts();
      if (wasDraft) loadDrafts();
    } else {
      result.textContent = `Error: ${friendlyError(data.error)}`;
    }
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('prompt-form').addEventListener('submit', submitPrompt);
  document.getElementById('cancel-draft').addEventListener('click', cancelDraftCustomisation);
  document.getElementById('cancel-edit').addEventListener('click', cancelEditPrompt);
  document.getElementById('prompt-type').addEventListener('change', (e) => applyFormTypeUI(e.target.value));
  applyFormTypeUI('open');
  renderTemplatesRow();

  // Tabs
  document.querySelectorAll('.tab-nav .tab').forEach(tab => {
    tab.addEventListener('click', () => switchTeacherTab(tab.dataset.tab));
  });
  setupTeacherNotes();

  document.getElementById('suggest-ai-btn').addEventListener('click', openSuggestModal);
  document.getElementById('suggest-close').addEventListener('click', closeSuggestModal);
  document.getElementById('suggest-cancel').addEventListener('click', closeSuggestModal);
  document.getElementById('suggest-backdrop').addEventListener('click', closeSuggestModal);
  document.getElementById('suggest-generate').addEventListener('click', generateSuggestion);
  document.getElementById('suggest-use').addEventListener('click', applyCurrentSuggestion);

  // sign-out is wired by menu.js. Flagged + Out-now panels are wired by
  // flagged-panel.js / checkouts-panel.js. Only page-specific behavior here.

  document.getElementById('share-close').addEventListener('click', closeShareModal);
  document.getElementById('share-cancel').addEventListener('click', closeShareModal);
  document.getElementById('share-backdrop').addEventListener('click', closeShareModal);
  document.getElementById('share-send').addEventListener('click', sendShare);
  document.getElementById('share-recipient').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendShare();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeShareModal();
      closeSuggestModal();
    }
  });
});

document.addEventListener('aisa:signed-in', (e) => showSignedIn(e.detail));
document.addEventListener('aisa:signed-out', showSignedOut);
