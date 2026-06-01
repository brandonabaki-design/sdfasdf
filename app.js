// Student page logic. Auth + api() helpers live in auth.js.

let allResponses = [];
let allPrompts = [];

function showSignedIn(user) {
  document.getElementById('signin-container').hidden = true;
  document.getElementById('status').hidden = true;
  document.getElementById('signed-in').hidden = false;
  document.getElementById('user-name').textContent = user.name || '';
  document.getElementById('user-email').textContent = user.email || '';
  loadPrompts();
}

function showSignedOut() {
  document.getElementById('signed-in').hidden = true;
  document.getElementById('signin-container').hidden = false;
  document.getElementById('status').hidden = false;
  document.getElementById('status').textContent = 'Signed out. Sign in again to continue.';
  document.getElementById('result').textContent = '';
  document.getElementById('prompts-list').innerHTML = '';
  allResponses = [];
  allPrompts = [];
  updateAssignmentsBadge([]);
  closeAssignmentsPanel();
}

async function loadPrompts() {
  const list = document.getElementById('prompts-list');
  list.textContent = 'Loading prompts...';
  try {
    const [promptsData, responsesData] = await Promise.all([
      api('list_prompts'),
      api('list_my_responses'),
    ]);
    if (!promptsData.ok) {
      list.textContent = `Couldn't load prompts: ${promptsData.error}`;
      return;
    }
    allResponses = responsesData.ok ? responsesData.responses : [];
    allPrompts = promptsData.prompts;
    updateAssignmentsBadge(allPrompts);

    if (promptsData.prompts.length === 0) {
      list.innerHTML = '<p class="muted">No active prompts yet. Check back later.</p>';
      return;
    }

    list.innerHTML = '';
    for (const p of promptsData.prompts) {
      list.appendChild(renderPromptCard(p));
    }
  } catch (err) {
    list.textContent = `Network error: ${err.message}`;
  }
}

function renderPromptCard(p) {
  const card = document.createElement('article');
  card.className = 'prompt-card';
  card.dataset.promptId = p.id;
  const created = new Date(p.created_at).toLocaleString();
  const closesAt = p.closes_at ? new Date(p.closes_at) : null;
  const closed = closesAt && !isNaN(closesAt.getTime()) && closesAt < new Date();

  if (p.completed) card.classList.add('is-completed');

  card.innerHTML = `
    <header class="prompt-card-head">
      <div class="prompt-card-title">
        <h3 class="font-heading"></h3>
        <p class="prompt-body"></p>
      </div>
      <label class="complete-toggle" title="Mark complete">
        <input type="checkbox" class="complete-checkbox" />
        <span class="complete-pill">
          <span class="complete-text">Mark complete</span>
        </span>
      </label>
    </header>
    <div class="prompt-meta">
      <span class="meta-item"><span class="meta-label">From</span> <span class="prompt-teacher"></span></span>
      <span class="meta-item"><span class="meta-label">Published</span> <span class="prompt-time"></span></span>
      <span class="meta-item closes-meta" hidden><span class="meta-label closes-label">Closes</span> <span class="prompt-closes"></span></span>
    </div>

    <div class="responses"></div>

    <form class="response-form" ${closed ? 'hidden' : ''}>
      <label>
        Your response
        <textarea rows="4" required placeholder="Type your response..."></textarea>
      </label>
      <button type="submit" class="btn btn-primary">Submit response</button>
      <p class="result muted small" aria-live="polite"></p>
    </form>
    ${closed ? '<p class="closed-banner">This assignment has closed. New submissions are no longer accepted.</p>' : ''}
  `;
  card.querySelector('h3').textContent = p.title || '(untitled)';
  card.querySelector('.prompt-body').textContent = p.body || '';
  card.querySelector('.prompt-teacher').textContent = p.teacher_email;
  card.querySelector('.prompt-time').textContent = created;

  if (closesAt && !isNaN(closesAt.getTime())) {
    const closesMeta = card.querySelector('.closes-meta');
    closesMeta.hidden = false;
    closesMeta.querySelector('.prompt-closes').textContent = closesAt.toLocaleString();
    if (closed) {
      closesMeta.classList.add('closed');
      closesMeta.querySelector('.closes-label').textContent = 'Closed';
    }
  }

  renderResponsesInCard(card, p.id);
  if (!closed) {
    card.querySelector('.response-form').addEventListener('submit', (e) => submitResponse(e, p.id, card));
  }

  // Mark-complete checkbox
  const checkbox = card.querySelector('.complete-checkbox');
  const completeText = card.querySelector('.complete-text');
  checkbox.checked = !!p.completed;
  completeText.textContent = p.completed ? 'Completed' : 'Mark complete';
  checkbox.addEventListener('change', async () => {
    const desired = checkbox.checked;
    checkbox.disabled = true;
    try {
      const action = desired ? 'mark_complete' : 'unmark_complete';
      const data = await api(action, { prompt_id: p.id });
      if (data.ok) {
        p.completed = desired;
        card.classList.toggle('is-completed', desired);
        completeText.textContent = desired ? 'Completed' : 'Mark complete';
        // Sync to in-memory store so the count badge updates.
        const cached = allPrompts.find(x => x.id === p.id);
        if (cached) cached.completed = desired;
        updateAssignmentsBadge(allPrompts);
        renderAssignmentsList();
      } else {
        checkbox.checked = !desired;
      }
    } catch (err) {
      checkbox.checked = !desired;
    } finally {
      checkbox.disabled = false;
    }
  });

  return card;
}

function renderResponsesInCard(card, promptId) {
  const container = card.querySelector('.responses');
  container.innerHTML = '';
  const mine = allResponses.filter(r => r.prompt_id === promptId);
  if (mine.length === 0) return;

  const header = document.createElement('p');
  header.className = 'muted small';
  header.textContent = mine.length === 1 ? 'Your response:' : `Your responses (${mine.length}):`;
  container.appendChild(header);

  for (const r of mine) {
    const bubble = document.createElement('div');
    bubble.className = 'response-bubble';
    bubble.innerHTML = `
      <p class="response-body"></p>
      <p class="muted small response-time"></p>
    `;
    bubble.querySelector('.response-body').textContent = r.body;
    bubble.querySelector('.response-time').textContent = new Date(r.created_at).toLocaleString();
    container.appendChild(bubble);

    if (r.ai_feedback) {
      const fb = document.createElement('div');
      if (r.flagged) {
        fb.className = 'resource-note';
        fb.innerHTML = '<p class="ai-body"></p>';
      } else {
        fb.className = 'ai-feedback';
        fb.innerHTML = `
          <p class="ai-label small">AI feedback</p>
          <p class="ai-body"></p>
        `;
      }
      fb.querySelector('.ai-body').textContent = r.ai_feedback;
      container.appendChild(fb);
    }
  }
}

async function submitResponse(event, promptId, card) {
  event.preventDefault();
  const form = event.target;
  const textarea = form.querySelector('textarea');
  const result = form.querySelector('.result');
  const button = form.querySelector('button[type="submit"]');

  const body = textarea.value.trim();
  if (!body) return;

  button.disabled = true;
  result.textContent = 'Submitting and getting AI feedback...';

  try {
    const data = await api('submit_response', { prompt_id: promptId, body });
    if (!data.ok) {
      result.textContent = `Error: ${data.error || 'unknown'}`;
      return;
    }
    allResponses.push(data.response);
    result.textContent = data.response.ai_feedback
      ? 'Submitted. AI feedback below.'
      : 'Submitted. (AI feedback unavailable — check GEMINI_API_KEY.)';
    textarea.value = '';
    renderResponsesInCard(card, promptId);
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

async function logImHere() {
  const btn = document.getElementById('im-here');
  const result = document.getElementById('result');
  btn.disabled = true;
  result.textContent = 'Logging...';
  try {
    const data = await api('im_here', { clientTimestamp: new Date().toISOString() });
    if (data.ok) {
      result.textContent = `Logged at ${new Date(data.timestamp).toLocaleTimeString()}.`;
    } else {
      result.textContent = `Error: ${data.error || 'unknown'}`;
    }
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

/* ============================================================
   Assignments slide-in panel
   ============================================================ */

function updateAssignmentsBadge(prompts) {
  const btn = document.getElementById('assignments-btn');
  const count = document.getElementById('assignments-count');
  if (!btn || !count) return;
  const incomplete = prompts.filter(p => !p.completed).length;
  count.textContent = String(incomplete);
  btn.classList.toggle('empty', incomplete === 0);
}

function renderAssignmentsList() {
  const list = document.getElementById('assignments-list');
  const sub = document.getElementById('assignments-panel-sub');
  if (!list || !sub) return;

  const incomplete = allPrompts.filter(p => !p.completed);
  const completed = allPrompts.filter(p => p.completed);

  sub.textContent = incomplete.length === 0
    ? 'Nothing pending — great work.'
    : `${incomplete.length} pending · ${completed.length} completed`;

  list.innerHTML = '';

  if (allPrompts.length === 0) {
    list.innerHTML = `
      <div class="assignments-empty">
        <span class="empty-icon" aria-hidden="true">📭</span>
        <h3 class="font-heading">Nothing here yet</h3>
        <p>Your teachers haven't published any prompts for you yet.</p>
      </div>
    `;
    return;
  }

  if (incomplete.length > 0) {
    const header = document.createElement('p');
    header.className = 'list-section-header';
    header.textContent = 'Pending';
    list.appendChild(header);
    for (const p of incomplete) list.appendChild(renderAssignmentRow(p));
  }
  if (completed.length > 0) {
    const header = document.createElement('p');
    header.className = 'list-section-header dim';
    header.textContent = 'Completed';
    list.appendChild(header);
    for (const p of completed) list.appendChild(renderAssignmentRow(p));
  }
}

function renderAssignmentRow(p) {
  const row = document.createElement('article');
  row.className = 'assignment-row' + (p.completed ? ' completed' : '');
  const closesAt = p.closes_at ? new Date(p.closes_at) : null;
  const closed = closesAt && !isNaN(closesAt.getTime()) && closesAt < new Date();
  row.innerHTML = `
    <label class="complete-toggle compact" title="Mark complete">
      <input type="checkbox" class="complete-checkbox" />
      <span class="complete-pill"><span class="check-mark">✓</span></span>
    </label>
    <div class="assignment-info">
      <p class="assignment-title font-heading"></p>
      <p class="assignment-meta muted small">
        <span class="from"></span>
        <span class="closes" hidden> · <span class="closes-label">Closes</span> <span class="closes-time"></span></span>
      </p>
    </div>
  `;
  row.querySelector('.assignment-title').textContent = p.title || '(untitled)';
  row.querySelector('.from').textContent = 'From ' + (p.teacher_email || 'unknown');
  if (closesAt && !isNaN(closesAt.getTime())) {
    const closes = row.querySelector('.closes');
    closes.hidden = false;
    closes.querySelector('.closes-time').textContent = closesAt.toLocaleString();
    if (closed) closes.querySelector('.closes-label').textContent = 'Closed';
  }

  const checkbox = row.querySelector('.complete-checkbox');
  checkbox.checked = !!p.completed;
  checkbox.addEventListener('change', async () => {
    const desired = checkbox.checked;
    checkbox.disabled = true;
    try {
      const action = desired ? 'mark_complete' : 'unmark_complete';
      const data = await api(action, { prompt_id: p.id });
      if (data.ok) {
        p.completed = desired;
        updateAssignmentsBadge(allPrompts);
        renderAssignmentsList();
        const mainCard = document.querySelector(`.prompt-card[data-prompt-id="${p.id}"]`);
        if (mainCard) {
          mainCard.classList.toggle('is-completed', desired);
          const cb = mainCard.querySelector('.complete-checkbox');
          if (cb) cb.checked = desired;
          const text = mainCard.querySelector('.complete-text');
          if (text) text.textContent = desired ? 'Completed' : 'Mark complete';
        }
      } else {
        checkbox.checked = !desired;
      }
    } catch (err) {
      checkbox.checked = !desired;
    } finally {
      checkbox.disabled = false;
    }
  });

  // Clicking the row (anywhere but the checkbox) scrolls to the card on the main view.
  row.addEventListener('click', (e) => {
    if (e.target.closest('.complete-toggle')) return;
    closeAssignmentsPanel();
    const target = document.querySelector(`.prompt-card[data-prompt-id="${p.id}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  return row;
}

function openAssignmentsPanel() {
  document.getElementById('assignments-backdrop').classList.add('open');
  const panel = document.getElementById('assignments-panel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  renderAssignmentsList();
}

function closeAssignmentsPanel() {
  const backdrop = document.getElementById('assignments-backdrop');
  const panel = document.getElementById('assignments-panel');
  if (backdrop) backdrop.classList.remove('open');
  if (panel) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('im-here').addEventListener('click', logImHere);
  document.getElementById('sign-out').addEventListener('click', signOut);
  document.getElementById('assignments-btn').addEventListener('click', openAssignmentsPanel);
  document.getElementById('assignments-close').addEventListener('click', closeAssignmentsPanel);
  document.getElementById('assignments-backdrop').addEventListener('click', closeAssignmentsPanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAssignmentsPanel();
  });
});

document.addEventListener('aisa:signed-in', (e) => showSignedIn(e.detail));
document.addEventListener('aisa:signed-out', showSignedOut);
