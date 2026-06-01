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
      <h3></h3>
      <p class="prompt-body"></p>
      <p class="muted small">from <span class="prompt-teacher"></span> · <span class="prompt-time"></span></p>
      <button type="button" class="link toggle-responses">Show responses</button>
    </header>
    <div class="responses-panel" hidden>
      <p class="muted small responses-status">Loading...</p>
      <div class="responses-list"></div>
    </div>
  `;
  card.querySelector('h3').textContent = p.title || '(untitled)';
  card.querySelector('.prompt-body').textContent = p.body || '';
  card.querySelector('.prompt-teacher').textContent = p.teacher_email;
  card.querySelector('.prompt-time').textContent = created;

  const toggleBtn = card.querySelector('.toggle-responses');
  const panel = card.querySelector('.responses-panel');
  toggleBtn.addEventListener('click', async () => {
    if (panel.hidden) {
      panel.hidden = false;
      toggleBtn.textContent = 'Refresh responses';
      await loadResponsesForPrompt(card, p.id);
    } else {
      panel.hidden = true;
      toggleBtn.textContent = 'Show responses';
    }
  });

  return card;
}

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
});

document.addEventListener('aisa:signed-in', (e) => showSignedIn(e.detail));
document.addEventListener('aisa:signed-out', showSignedOut);
