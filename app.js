// Student page logic. Auth + api() helpers live in auth.js.

let allResponses = [];
let allPrompts = [];

const TYPE_LABELS = {
  open: 'Open response',
  multiple_choice: 'Multiple choice',
  acknowledgment: 'Acknowledgment',
  rating: 'Rating',
  poll: 'Poll',
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderResponseInput(card, p) {
  const container = card.querySelector('.response-input');
  const type = (p.type || 'open').toLowerCase();
  if (type === 'open') {
    container.innerHTML = `
      <form class="response-form">
        <label>Your response
          <textarea rows="4" required placeholder="Type your response..."></textarea>
        </label>
        <button type="submit" class="btn btn-primary">Submit response</button>
        <p class="result muted small" aria-live="polite"></p>
      </form>`;
    container.querySelector('.response-form').addEventListener('submit', (e) => submitOpenResponse(e, p, card));
    return;
  }
  if (type === 'multiple_choice' || type === 'poll') {
    const opts = (p.options || []).map((label, i) => `
      <label class="choice-row">
        <input type="radio" name="choice-${p.id}" value="${i + 1}" />
        <span class="choice-pill"><span class="choice-letter">${String.fromCharCode(65 + i)}</span> ${escapeHtml(label)}</span>
      </label>`).join('');
    container.innerHTML = `
      <form class="response-form choice-form">
        <fieldset class="choice-fieldset">
          <legend>Pick one</legend>
          ${opts}
        </fieldset>
        <button type="submit" class="btn btn-primary">Submit answer</button>
        <p class="result muted small" aria-live="polite"></p>
      </form>`;
    container.querySelector('.response-form').addEventListener('submit', (e) => submitChoice(e, p, card));
    return;
  }
  if (type === 'rating') {
    const max = parseInt(p.rating_scale, 10) || 5;
    const buttons = Array.from({ length: max }, (_, i) => i + 1).map(v => `
      <label class="rating-row">
        <input type="radio" name="rating-${p.id}" value="${v}" />
        <span class="rating-pill">${v}</span>
      </label>`).join('');
    container.innerHTML = `
      <form class="response-form rating-form">
        <fieldset class="rating-fieldset">
          <legend>Pick a value (1 — low, ${max} — high)</legend>
          <div class="rating-row-wrap">${buttons}</div>
        </fieldset>
        <button type="submit" class="btn btn-primary">Submit rating</button>
        <p class="result muted small" aria-live="polite"></p>
      </form>`;
    container.querySelector('.response-form').addEventListener('submit', (e) => submitRating(e, p, card));
    return;
  }
  if (type === 'acknowledgment') {
    container.innerHTML = `
      <form class="response-form ack-form">
        <p class="muted small">Click below to confirm you've read this message.</p>
        <button type="submit" class="btn btn-primary">I acknowledge</button>
        <p class="result muted small" aria-live="polite"></p>
      </form>`;
    container.querySelector('.response-form').addEventListener('submit', (e) => submitAck(e, p, card));
    return;
  }
}

function showSignedIn(user) {
  document.getElementById('signin-container').hidden = true;
  document.getElementById('status').hidden = true;
  document.getElementById('signed-in').hidden = false;
  document.getElementById('user-name').textContent = user.name || '';
  document.getElementById('user-email').textContent = user.email || '';
  const first = (user.name || user.email || '').split(/[\s@]/)[0] || 'friend';
  const hubName = document.getElementById('hub-name');
  if (hubName) hubName.textContent = first;
  const hubGreet = document.getElementById('hub-greeting-text');
  if (hubGreet) hubGreet.textContent = greetingForTime();
  const hubDate = document.getElementById('hub-date');
  if (hubDate) {
    hubDate.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  loadPrompts();
  loadTeachers();
  refreshCheckoutState();
}

function greetingForTime() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Working late';
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
  activeCheckout = null;
  if (checkoutTimerId) { clearInterval(checkoutTimerId); checkoutTimerId = null; }
  updateAssignmentsBadge([]);
  closeAssignmentsPanel();
  closeCheckoutModal();
  const card = document.getElementById('checkout-card');
  if (card) card.classList.remove('is-active');
}

async function loadPrompts() {
  const todoList = document.getElementById('prompts-list');
  const workList = document.getElementById('work-list');
  todoList.innerHTML = '<div class="skeleton-stack"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>';
  try {
    const [promptsData, responsesData] = await Promise.all([
      api('list_prompts'),
      api('list_my_responses'),
    ]);
    if (!promptsData.ok) {
      todoList.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><h3>Couldn't load</h3><p>${friendlyError(promptsData.error)}</p></div>`;
      return;
    }
    allResponses = responsesData.ok ? responsesData.responses : [];
    allPrompts = promptsData.prompts;
    updateAssignmentsBadge(allPrompts);
    renderPromptTabs();
  } catch (err) {
    todoList.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><h3>Network error</h3><p>${err.message}</p></div>`;
  }
}

function renderPromptTabs() {
  const todo = allPrompts.filter(p => !p.completed);
  const work = allPrompts.filter(p => p.completed);

  // Hub stat numbers
  const hubTodo = document.getElementById('hub-todo-count');
  const hubWork = document.getElementById('hub-work-count');
  if (hubTodo) hubTodo.textContent = String(todo.length);
  if (hubWork) hubWork.textContent = String(work.length);

  // Tool card badge
  const badge = document.getElementById('tool-badge-assignments');
  if (badge) {
    if (todo.length > 0) { badge.hidden = false; badge.textContent = String(todo.length); }
    else { badge.hidden = true; }
  }

  // Hero subtitle
  const subtitle = document.getElementById('hub-subtitle');
  if (subtitle) {
    if (todo.length === 0) subtitle.textContent = "🎉 All caught up — enjoy a tool below.";
    else if (todo.length === 1) subtitle.textContent = "You have 1 assignment to work on today.";
    else subtitle.textContent = `You have ${todo.length} assignments to work on today.`;
  }

  // Up next focus card
  renderUpNext(todo);

  // To Do view
  const todoList = document.getElementById('prompts-list');
  if (todoList) {
    todoList.innerHTML = '';
    if (todo.length === 0) {
      todoList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🎉</span>
          <h3>All caught up</h3>
          <p>You don't have any pending assignments right now. Nice work.</p>
        </div>`;
    } else {
      for (const p of todo) todoList.appendChild(renderPromptCard(p));
    }
  }

  // My Work view
  const workList = document.getElementById('work-list');
  if (workList) {
    workList.innerHTML = '';
    if (work.length === 0) {
      workList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📁</span>
          <h3>Nothing here yet</h3>
          <p>Completed assignments will show up here along with the AI feedback you received.</p>
        </div>`;
    } else {
      for (const p of work) workList.appendChild(renderPromptCard(p));
    }
  }

  renderRecentActivity();
  renderHubStats();
}

function renderUpNext(todo) {
  const container = document.getElementById('up-next');
  if (!container) return;
  if (todo.length === 0) {
    container.innerHTML = `
      <div class="up-next-empty">
        <span class="up-next-emoji">🌱</span>
        <p class="up-next-empty-text">You're all caught up. Try the AI Study Buddy or set a new goal below.</p>
      </div>`;
    return;
  }
  // Pick the oldest (most overdue / waiting longest)
  const p = todo[0];
  const closesAt = p.closes_at ? new Date(p.closes_at) : null;
  const closesNote = (closesAt && !isNaN(closesAt.getTime()))
    ? `Closes ${friendlyTime(closesAt.toISOString())}`
    : 'No deadline';
  container.innerHTML = `
    <article class="up-next-card">
      <div class="up-next-meta">
        <span class="up-next-pill">📝 Next up</span>
        <span class="up-next-closes muted">${escapeHtmlSafe(closesNote)}</span>
      </div>
      <h3 class="up-next-title font-heading"></h3>
      <p class="up-next-body"></p>
      <button class="btn btn-primary up-next-cta" type="button" data-view="assignments">Open assignment →</button>
    </article>`;
  container.querySelector('.up-next-title').textContent = p.title || '(untitled)';
  const bodyEl = container.querySelector('.up-next-body');
  const bodyText = String(p.body || '');
  bodyEl.textContent = bodyText.length > 220 ? bodyText.slice(0, 220) + '…' : bodyText;
}

function escapeHtmlSafe(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderHubStats() {
  // Streak: count consecutive days back from today with a response
  const byDay = {};
  for (const r of allResponses) {
    const key = String(r.created_at).slice(0, 10);
    byDay[key] = true;
  }
  let streak = 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (byDay[key]) streak++;
    else if (i === 0) continue;
    else break;
  }
  const hubStreak = document.getElementById('hub-streak');
  if (hubStreak) hubStreak.textContent = String(streak);

  // Badges (cheap derivation; matches progress page logic)
  const totalResponses = allResponses.length;
  const badges = [
    totalResponses >= 1,
    totalResponses >= 5,
    totalResponses >= 25,
    streak >= 3,
    streak >= 7,
  ].filter(Boolean).length;
  const hubBadges = document.getElementById('hub-badges');
  if (hubBadges) hubBadges.textContent = String(badges);
}

function renderRecentActivity() {
  const feed = document.getElementById('hub-recent-feed');
  if (!feed) return;
  feed.innerHTML = '';
  if (!allResponses || allResponses.length === 0) {
    feed.innerHTML = `
      <li class="hub-recent-empty">
        <span class="muted">Your recent responses and AI feedback will appear here.</span>
      </li>`;
    return;
  }
  const recent = allResponses.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5);
  for (const r of recent) {
    const li = document.createElement('li');
    li.className = 'hub-recent-item';
    const icon = r.flagged ? '⚠️' : (r.ai_feedback ? '✨' : '✓');
    li.innerHTML = `
      <span class="hub-recent-icon" aria-hidden="true"></span>
      <div class="hub-recent-text">
        <p class="hub-recent-title"></p>
        <p class="hub-recent-meta muted small"></p>
      </div>
      <span class="hub-recent-time muted small"></span>
    `;
    li.querySelector('.hub-recent-icon').textContent = icon;
    li.querySelector('.hub-recent-title').textContent = `Responded to "${r.prompt_title || '(untitled)'}"`;
    const meta = r.ai_feedback ? 'AI feedback ready' : (r.flagged ? 'A teacher will follow up' : 'Submission saved');
    li.querySelector('.hub-recent-meta').textContent = meta;
    li.querySelector('.hub-recent-time').textContent = friendlyTime(r.created_at);
    feed.appendChild(li);
  }
}

function renderPromptCard(p) {
  const card = document.createElement('article');
  card.className = 'prompt-card';
  card.dataset.promptId = p.id;
  const created = friendlyTime(p.created_at);
  const closesAt = p.closes_at ? new Date(p.closes_at) : null;
  const closed = closesAt && !isNaN(closesAt.getTime()) && closesAt < new Date();
  const type = (p.type || 'open').toLowerCase();
  const typeLabel = TYPE_LABELS[type] || 'Open response';

  if (p.completed) card.classList.add('is-completed');
  card.classList.add('prompt-type-' + type);

  card.innerHTML = `
    <header class="prompt-card-head">
      <div class="prompt-card-title">
        <span class="type-badge type-${type}">${typeLabel}</span>
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
    <div class="response-input"></div>
    ${closed ? '<p class="closed-banner">This assignment has closed. New submissions are no longer accepted.</p>' : ''}
  `;
  card.querySelector('h3').textContent = p.title || '(untitled)';
  card.querySelector('.prompt-body').textContent = p.body || '';
  card.querySelector('.prompt-teacher').textContent = p.teacher_email;
  card.querySelector('.prompt-time').textContent = created;

  if (closesAt && !isNaN(closesAt.getTime())) {
    const closesMeta = card.querySelector('.closes-meta');
    closesMeta.hidden = false;
    closesMeta.querySelector('.prompt-closes').textContent = friendlyTime(closesAt.toISOString());
    if (closed) {
      closesMeta.classList.add('closed');
      closesMeta.querySelector('.closes-label').textContent = 'Closed';
    }
  }

  renderResponsesInCard(card, p.id);
  if (!closed) {
    renderResponseInput(card, p);
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
    bubble.querySelector('.response-time').textContent = friendlyTime(r.created_at);
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

async function submitOpenResponse(event, p, card) {
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
    const data = await api('submit_response', { prompt_id: p.id, body });
    if (!data.ok) { result.textContent = `Error: ${friendlyError(data.error)}`; return; }
    allResponses.push(data.response);
    result.textContent = data.response.ai_feedback
      ? 'Submitted. AI feedback below.'
      : 'Submitted.';
    announce(data.response.ai_feedback ? 'Response submitted, AI feedback ready.' : 'Response submitted.');
    textarea.value = '';
    renderResponsesInCard(card, p.id);
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

async function submitChoice(event, p, card) {
  event.preventDefault();
  const form = event.target;
  const result = form.querySelector('.result');
  const button = form.querySelector('button[type="submit"]');
  const chosen = form.querySelector(`input[name="choice-${p.id}"]:checked`);
  if (!chosen) { result.textContent = 'Pick an option.'; return; }
  button.disabled = true;
  result.textContent = 'Submitting...';
  try {
    const data = await api('submit_response', { prompt_id: p.id, option_index: parseInt(chosen.value, 10) });
    if (!data.ok) { result.textContent = `Error: ${friendlyError(data.error)}`; return; }
    allResponses.push(data.response);
    result.textContent = 'Submitted.';
    renderResponsesInCard(card, p.id);
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

async function submitRating(event, p, card) {
  event.preventDefault();
  const form = event.target;
  const result = form.querySelector('.result');
  const button = form.querySelector('button[type="submit"]');
  const chosen = form.querySelector(`input[name="rating-${p.id}"]:checked`);
  if (!chosen) { result.textContent = 'Pick a value.'; return; }
  button.disabled = true;
  result.textContent = 'Submitting...';
  try {
    const data = await api('submit_response', { prompt_id: p.id, rating_value: parseInt(chosen.value, 10) });
    if (!data.ok) { result.textContent = `Error: ${friendlyError(data.error)}`; return; }
    allResponses.push(data.response);
    result.textContent = 'Submitted.';
    renderResponsesInCard(card, p.id);
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

async function submitAck(event, p, card) {
  event.preventDefault();
  const form = event.target;
  const result = form.querySelector('.result');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  result.textContent = 'Acknowledging...';
  try {
    const data = await api('submit_response', { prompt_id: p.id });
    if (!data.ok) { result.textContent = `Error: ${friendlyError(data.error)}`; return; }
    allResponses.push(data.response);
    result.textContent = 'Acknowledged.';
    renderResponsesInCard(card, p.id);
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
      result.textContent = `Error: ${friendlyError(data.error)}`;
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
    closes.querySelector('.closes-time').textContent = friendlyTime(closesAt.toISOString());
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
  const panel = document.getElementById('assignments-panel');
  document.getElementById('assignments-backdrop').classList.add('open');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  modalOpen(panel, '#assignments-close');
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
  modalClose();
}

/* ============================================================
   Check out / check in
   ============================================================ */

let teacherList = [];
let activeCheckout = null;
let checkoutPendingDestination = null;
let checkoutTimerId = null;

async function loadTeachers() {
  try {
    const data = await api('list_teachers');
    if (data.ok) teacherList = data.teachers || [];
  } catch (err) { /* silent */ }
}

async function refreshCheckoutState() {
  try {
    const data = await api('get_active_checkout');
    if (data.ok) {
      activeCheckout = data.checkout;
      renderCheckoutState();
    }
  } catch (err) { /* silent */ }
}

function hasValidActiveCheckout() {
  // Guard: a row with empty destination is treated as no checkout
  // (defends against stale rows left behind by earlier testing).
  return !!(activeCheckout && String(activeCheckout.destination || '').trim());
}

function renderCheckoutState() {
  const btn = document.getElementById('step-out-btn');
  if (!btn) return;
  const labelEl = btn.querySelector('.step-out-label');

  if (hasValidActiveCheckout()) {
    btn.classList.add('is-active');
    btn.setAttribute('aria-label', `Currently out at ${activeCheckout.destination}`);
    updateSinceTimer();
    if (checkoutTimerId) clearInterval(checkoutTimerId);
    checkoutTimerId = setInterval(updateSinceTimer, 30000);
  } else {
    btn.classList.remove('is-active');
    btn.setAttribute('aria-label', 'Step out of class');
    if (labelEl) labelEl.textContent = 'Step out';
    if (checkoutTimerId) {
      clearInterval(checkoutTimerId);
      checkoutTimerId = null;
    }
  }
}

function updateSinceTimer() {
  if (!hasValidActiveCheckout()) return;
  const start = new Date(activeCheckout.checked_out_at);
  const mins = Math.max(0, Math.round((Date.now() - start.getTime()) / 60000));
  const friendly = mins === 0 ? 'just now' : `${mins} min${mins === 1 ? '' : 's'} ago`;
  const sinceEl = document.getElementById('checkout-since');
  if (sinceEl) sinceEl.textContent = friendly;
  const btnLabel = document.querySelector('#step-out-btn .step-out-label');
  if (btnLabel) {
    btnLabel.textContent = mins === 0 ? 'Out · just now' : `Out · ${mins}m`;
  }
}

function openCheckoutModal() {
  const modal = document.getElementById('checkout-modal');
  const idle = document.getElementById('checkout-modal-idle');
  const active = document.getElementById('checkout-modal-active');
  const heading = document.getElementById('checkout-modal-heading');

  if (hasValidActiveCheckout()) {
    idle.hidden = true;
    active.hidden = false;
    heading.textContent = 'Currently out';
    document.getElementById('checkout-destination-active').textContent = activeCheckout.destination;
    document.getElementById('checkout-teacher-active').textContent = activeCheckout.teacher_email || '—';
    updateSinceTimer();
    document.getElementById('checkout-modal-active-result').textContent = '';
  } else {
    idle.hidden = false;
    active.hidden = true;
    heading.textContent = 'Step out';
    // Reset form
    document.querySelectorAll('input[name="dest"]').forEach(r => { r.checked = false; });
    document.getElementById('checkout-notes').value = '';
    document.getElementById('checkout-modal-result').textContent = '';
  }

  // Populate the teacher dropdown (in case it wasn't loaded yet).
  const select = document.getElementById('checkout-teacher-select');
  if (select && select.options.length === 0) {
    if (teacherList.length === 0) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = 'No teachers configured'; opt.disabled = true;
      select.appendChild(opt);
    } else {
      for (const email of teacherList) {
        const opt = document.createElement('option');
        opt.value = email; opt.textContent = email;
        select.appendChild(opt);
      }
    }
  }

  document.getElementById('checkout-modal-backdrop').hidden = false;
  modal.hidden = false;
  modalOpen(modal, hasValidActiveCheckout() ? '#checkin-btn' : 'input[name="dest"]');
}

function closeCheckoutModal() {
  document.getElementById('checkout-modal-backdrop').hidden = true;
  document.getElementById('checkout-modal').hidden = true;
  modalClose();
}

async function submitCheckout() {
  const destEl = document.querySelector('input[name="dest"]:checked');
  if (!destEl) {
    document.getElementById('checkout-modal-result').textContent = 'Pick where you are going.';
    return;
  }
  const destination = destEl.value;
  const teacherEmail = document.getElementById('checkout-teacher-select').value;
  const notes = document.getElementById('checkout-notes').value.trim();
  const result = document.getElementById('checkout-modal-result');
  const btn = document.getElementById('checkout-modal-submit');

  if (!teacherEmail) {
    result.textContent = 'Choose a teacher.';
    return;
  }
  btn.disabled = true;
  result.textContent = 'Notifying teacher...';
  try {
    const data = await api('check_out', {
      destination: destination,
      teacher_email: teacherEmail,
      notes: notes,
    });
    if (data.ok) {
      activeCheckout = data.checkout;
      renderCheckoutState();
      closeCheckoutModal();
      announce("You're checked out. Your teacher has been notified.");
    } else {
      result.textContent = `Error: ${friendlyError(data.error)}`;
    }
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function submitCheckIn() {
  if (!activeCheckout) return;
  const btn = document.getElementById('checkin-btn');
  const result = document.getElementById('checkout-modal-active-result');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Checking in...';
  if (result) result.textContent = '';
  try {
    const data = await api('check_in', { checkout_id: activeCheckout.id });
    if (data.ok) {
      activeCheckout = null;
      renderCheckoutState();
      closeCheckoutModal();
      announce('Welcome back. Your check-in has been logged.');
    } else {
      if (result) result.textContent = friendlyError(data.error);
      // If the row was stale (no longer 'out' on the server), clear locally too.
      if ((data.error || '').toLowerCase().includes('active checkout not found')) {
        activeCheckout = null;
        renderCheckoutState();
        closeCheckoutModal();
      }
    }
  } catch (err) {
    if (result) result.textContent = 'Network error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('im-here').addEventListener('click', logImHere);
  document.getElementById('sign-out').addEventListener('click', signOut);
  document.getElementById('assignments-btn').addEventListener('click', openAssignmentsPanel);
  document.getElementById('assignments-close').addEventListener('click', closeAssignmentsPanel);
  document.getElementById('assignments-backdrop').addEventListener('click', closeAssignmentsPanel);

  document.getElementById('step-out-btn').addEventListener('click', openCheckoutModal);
  document.getElementById('checkin-btn').addEventListener('click', submitCheckIn);
  document.getElementById('checkout-modal-close').addEventListener('click', closeCheckoutModal);
  document.getElementById('checkout-modal-cancel').addEventListener('click', closeCheckoutModal);
  document.getElementById('checkout-active-cancel').addEventListener('click', closeCheckoutModal);
  document.getElementById('checkout-modal-backdrop').addEventListener('click', closeCheckoutModal);
  document.getElementById('checkout-modal-submit').addEventListener('click', submitCheckout);

  // Hub: tool cards + back buttons
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', (e) => {
      const view = el.dataset.view;
      if (view) { e.preventDefault(); switchView(view); }
    });
  });
  document.querySelectorAll('[data-back]').forEach(el => {
    el.addEventListener('click', () => switchView('hub'));
  });

  // Notes — load saved + autosave on input
  setupNotes();
  // AI Study Buddy
  setupStudyBuddy();
  // Focus Timer
  setupFocusTimer();
  // Goals
  setupGoals();
  // Hub-level "I'm here" button
  const imHereBig = document.getElementById('im-here-big');
  if (imHereBig) imHereBig.addEventListener('click', () => logImHereBig());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAssignmentsPanel();
      closeCheckoutModal();
    }
  });
});

function switchView(name) {
  document.querySelectorAll('#signed-in .view').forEach(view => {
    view.hidden = view.id !== `view-${name}`;
  });
  // Scroll to top of the freshly opened view
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function notesStorageKey() {
  const email = currentUser && currentUser.email ? currentUser.email : 'anon';
  return 'aisa.notes.' + email;
}

let notesSaveTimer = null;
let notesClassifyTimer = null;
let lastClassifiedNoteSnapshot = '';
function setupNotes() {
  const textarea = document.getElementById('notes-textarea');
  const status = document.getElementById('notes-status');
  if (!textarea || !status) return;

  // Load saved notes once the user is signed in (so we can key by email).
  document.addEventListener('aisa:signed-in', () => {
    try {
      const saved = localStorage.getItem(notesStorageKey());
      if (saved != null) {
        textarea.value = saved;
        status.textContent = 'Saved on this device.';
        lastClassifiedNoteSnapshot = saved;
      } else {
        status.textContent = 'Start typing — your notes save automatically.';
      }
    } catch (_) {}
  });

  textarea.addEventListener('input', () => {
    status.textContent = 'Saving…';
    if (notesSaveTimer) clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(notesStorageKey(), textarea.value);
        status.textContent = 'Saved on this device · ' + friendlyTime(new Date().toISOString());
      } catch (err) {
        status.textContent = "Couldn't save (storage full?)";
      }
    }, 400);

    // Separately, debounce a safety classification — fire-and-forget.
    // The server only stores the note's body if it's flagged; otherwise
    // nothing is logged. Privacy preserved while still catching distress.
    if (notesClassifyTimer) clearTimeout(notesClassifyTimer);
    notesClassifyTimer = setTimeout(() => maybeClassifyNote(textarea.value), 3000);
  });

  // Also classify when the user navigates away from the notes view or
  // closes the tab — catches edits that might never have triggered the
  // 3-second debounce.
  document.querySelectorAll('[data-back]').forEach(el => {
    el.addEventListener('click', () => maybeClassifyNote(textarea.value));
  });
  window.addEventListener('beforeunload', () => maybeClassifyNote(textarea.value));
}

async function maybeClassifyNote(body) {
  const text = String(body || '').trim();
  if (!text) return;
  // Skip if nothing materially changed since last classification.
  if (text === lastClassifiedNoteSnapshot) return;
  lastClassifiedNoteSnapshot = text;
  try {
    await api('classify_note', { body: text });
  } catch (_) { /* silent — safety call shouldn't disturb the student */ }
}

/* ============================================================
   AI Study Buddy
   ============================================================ */

let studyHistory = [];

function setupStudyBuddy() {
  const form = document.getElementById('study-form');
  const input = document.getElementById('study-input');
  const messages = document.getElementById('study-messages');
  if (!form || !input || !messages) return;

  document.addEventListener('aisa:signed-in', () => {
    studyHistory = [];
    messages.innerHTML = `
      <div class="study-msg study-msg-model">
        <span class="study-msg-avatar">🤖</span>
        <div class="study-msg-bubble">
          <p>Hi! I'm your Study Buddy. Ask me anything — I'll explain it in plain language and help you think it through. What are you working on?</p>
        </div>
      </div>`;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    appendStudyMessage('user', text);
    studyHistory.push({ role: 'user', text });
    input.value = '';
    input.focus();
    appendStudyMessage('model', '…', 'study-msg-loading');
    try {
      const data = await api('ask_study_buddy', { messages: studyHistory });
      // Remove the loading bubble
      const loading = messages.querySelector('.study-msg-loading');
      if (loading) loading.remove();
      if (!data.ok) {
        appendStudyMessage('model', friendlyError(data.error));
        return;
      }
      const reply = String(data.reply || '').trim() || "Sorry, I couldn't think of a reply.";
      studyHistory.push({ role: 'model', text: reply });
      appendStudyMessage('model', reply);
    } catch (err) {
      const loading = messages.querySelector('.study-msg-loading');
      if (loading) loading.remove();
      appendStudyMessage('model', 'Network error: ' + err.message);
    }
  });
}

function appendStudyMessage(role, text, extraClass) {
  const messages = document.getElementById('study-messages');
  if (!messages) return;
  const wrap = document.createElement('div');
  wrap.className = `study-msg study-msg-${role}` + (extraClass ? ' ' + extraClass : '');
  wrap.innerHTML = `
    <span class="study-msg-avatar"></span>
    <div class="study-msg-bubble"></div>
  `;
  wrap.querySelector('.study-msg-avatar').textContent = role === 'user' ? '🧑' : '🤖';
  wrap.querySelector('.study-msg-bubble').textContent = text;
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
}

/* ============================================================
   Focus Timer (Pomodoro)
   ============================================================ */

const FOCUS_WORK_SECONDS = 25 * 60;
const FOCUS_REST_SECONDS = 5 * 60;
let focusMode = 'work';
let focusSecondsLeft = FOCUS_WORK_SECONDS;
let focusTimerId = null;
let focusSessionsToday = 0;

function setupFocusTimer() {
  const startBtn = document.getElementById('focus-start');
  const resetBtn = document.getElementById('focus-reset');
  if (!startBtn || !resetBtn) return;
  startBtn.addEventListener('click', toggleFocusTimer);
  resetBtn.addEventListener('click', resetFocusTimer);
  // Restore sessions count for today
  try {
    const key = focusStorageKey();
    const raw = localStorage.getItem(key);
    if (raw) {
      const obj = JSON.parse(raw);
      const todayKey = new Date().toISOString().slice(0, 10);
      if (obj.date === todayKey) focusSessionsToday = obj.sessions || 0;
    }
  } catch (_) {}
  renderFocus();
}

function focusStorageKey() {
  const email = currentUser && currentUser.email ? currentUser.email : 'anon';
  return 'aisa.focus.' + email;
}

function persistFocusSessions() {
  try {
    const todayKey = new Date().toISOString().slice(0, 10);
    localStorage.setItem(focusStorageKey(), JSON.stringify({ date: todayKey, sessions: focusSessionsToday }));
  } catch (_) {}
}

function toggleFocusTimer() {
  const startBtn = document.getElementById('focus-start');
  if (focusTimerId) {
    clearInterval(focusTimerId);
    focusTimerId = null;
    startBtn.textContent = 'Start';
  } else {
    startBtn.textContent = 'Pause';
    focusTimerId = setInterval(() => {
      focusSecondsLeft--;
      if (focusSecondsLeft <= 0) {
        if (focusMode === 'work') {
          focusSessionsToday++;
          persistFocusSessions();
          focusMode = 'rest';
          focusSecondsLeft = FOCUS_REST_SECONDS;
          announce("Time for a break. Five minutes.");
        } else {
          focusMode = 'work';
          focusSecondsLeft = FOCUS_WORK_SECONDS;
          announce("Break's over. Let's focus again.");
        }
      }
      renderFocus();
    }, 1000);
  }
}

function resetFocusTimer() {
  if (focusTimerId) { clearInterval(focusTimerId); focusTimerId = null; }
  document.getElementById('focus-start').textContent = 'Start';
  focusMode = 'work';
  focusSecondsLeft = FOCUS_WORK_SECONDS;
  renderFocus();
}

function renderFocus() {
  const m = Math.floor(focusSecondsLeft / 60);
  const s = focusSecondsLeft % 60;
  const timeEl = document.getElementById('focus-time');
  if (timeEl) timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
  const modeEl = document.getElementById('focus-mode');
  if (modeEl) modeEl.textContent = focusMode === 'work' ? 'Focus' : 'Break';
  const card = document.getElementById('focus-card');
  if (card) card.classList.toggle('mode-rest', focusMode === 'rest');
  // Ring progress
  const total = focusMode === 'work' ? FOCUS_WORK_SECONDS : FOCUS_REST_SECONDS;
  const fraction = focusSecondsLeft / total;
  const fill = document.getElementById('focus-ring-fill');
  if (fill) {
    const circumference = 2 * Math.PI * 46;
    fill.style.strokeDasharray = `${circumference}`;
    fill.style.strokeDashoffset = `${circumference * (1 - fraction)}`;
  }
  const stats = document.getElementById('focus-stats');
  if (stats) {
    stats.textContent = focusSessionsToday === 0
      ? '0 sessions today — start your first one!'
      : `${focusSessionsToday} session${focusSessionsToday === 1 ? '' : 's'} today 🎉`;
  }
}

/* ============================================================
   Goals
   ============================================================ */

let goals = [];

function setupGoals() {
  const form = document.getElementById('goal-form');
  const input = document.getElementById('goal-input');
  if (!form || !input) return;
  document.addEventListener('aisa:signed-in', () => {
    try {
      const raw = localStorage.getItem(goalsStorageKey());
      goals = raw ? JSON.parse(raw) : [];
    } catch (_) { goals = []; }
    renderGoals();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    goals.unshift({ id: Date.now(), text, done: false, created_at: new Date().toISOString() });
    persistGoals();
    input.value = '';
    renderGoals();
  });
}

function goalsStorageKey() {
  const email = currentUser && currentUser.email ? currentUser.email : 'anon';
  return 'aisa.goals.' + email;
}

function persistGoals() {
  try { localStorage.setItem(goalsStorageKey(), JSON.stringify(goals)); } catch (_) {}
}

function renderGoals() {
  const list = document.getElementById('goals-list');
  if (!list) return;
  list.innerHTML = '';
  if (goals.length === 0) {
    list.innerHTML = `
      <li class="empty-state goals-empty">
        <span class="empty-icon">🎯</span>
        <h3>No goals yet</h3>
        <p>Add a goal above — keep it small and specific.</p>
      </li>`;
    return;
  }
  for (const g of goals) {
    const li = document.createElement('li');
    li.className = 'goal-row' + (g.done ? ' is-done' : '');
    li.innerHTML = `
      <label class="goal-check">
        <input type="checkbox" />
        <span class="goal-tick" aria-hidden="true">✓</span>
      </label>
      <span class="goal-text"></span>
      <button class="goal-delete" type="button" aria-label="Delete goal">×</button>
    `;
    li.querySelector('input').checked = g.done;
    li.querySelector('.goal-text').textContent = g.text;
    li.querySelector('input').addEventListener('change', (e) => {
      g.done = e.target.checked;
      persistGoals();
      li.classList.toggle('is-done', g.done);
      if (g.done) announce('Goal completed!');
    });
    li.querySelector('.goal-delete').addEventListener('click', () => {
      goals = goals.filter(x => x.id !== g.id);
      persistGoals();
      renderGoals();
    });
    list.appendChild(li);
  }
}

/* ============================================================
   I'm here (hub button + tool view)
   ============================================================ */

async function logImHereBig() {
  const btn = document.getElementById('im-here-big');
  const status = document.getElementById('im-here-status');
  btn.disabled = true;
  if (status) status.textContent = 'Logging…';
  try {
    const data = await api('im_here', { clientTimestamp: new Date().toISOString() });
    if (data.ok) {
      if (status) status.textContent = `Logged at ${new Date(data.timestamp).toLocaleTimeString()}.`;
      announce("You're marked here today.");
    } else {
      if (status) status.textContent = friendlyError(data.error);
    }
  } catch (err) {
    if (status) status.textContent = 'Network error: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('aisa:signed-in', (e) => showSignedIn(e.detail));
document.addEventListener('aisa:signed-out', showSignedOut);
