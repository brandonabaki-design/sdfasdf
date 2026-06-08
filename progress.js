// Student progress dashboard. Auth + api() helpers live in auth.js.

const TYPE_LABELS = {
  open: 'Open response',
  multiple_choice: 'Multiple choice',
  acknowledgment: 'Acknowledgment',
  rating: 'Rating',
  poll: 'Poll',
};

async function showSignedIn(user) {
  document.getElementById('signin-container').hidden = true;
  document.getElementById('status').hidden = true;
  document.getElementById('signed-in').hidden = false;
  document.getElementById('user-name').textContent = user.name || '';
  document.getElementById('user-email').textContent = user.email || '';
  document.getElementById('hello-name').textContent = (user.name || user.email || '').split(' ')[0];
  await loadDashboard();
}

function showSignedOut() {
  document.getElementById('signed-in').hidden = true;
  document.getElementById('signin-container').hidden = false;
  document.getElementById('status').hidden = false;
  document.getElementById('status').textContent = 'Signed out. Sign in again to continue.';
}

async function loadDashboard() {
  const loading = document.getElementById('loading');
  const content = document.getElementById('dashboard-content');
  loading.hidden = false;
  content.hidden = true;
  try {
    const data = await api('get_student_dashboard');
    if (!data.ok) {
      loading.textContent = `Couldn't load: ${data.error}`;
      return;
    }
    loading.hidden = true;
    content.hidden = false;
    renderDashboard(data.dashboard);
  } catch (err) {
    loading.textContent = `Network error: ${err.message}`;
  }
}

function renderDashboard(d) {
  renderStats(d.summary);
  renderHeatmap(d.heatmap);
  renderAchievements(d.achievements);
  renderFeedback(d.recent_feedback);
  renderPromptProgress(d.prompt_progress);
}

function renderStats(s) {
  const grid = document.getElementById('stats-grid');
  const cards = [
    { label: 'Responses', value: s.total_responses, sub: s.total_responses === 1 ? 'one submission' : 'submissions to date', accent: 'indigo' },
    { label: 'Streak', value: s.streak || 0, sub: s.streak >= 1 ? (s.streak === 1 ? 'day · keep going' : 'days in a row') : 'respond today to start one', accent: 'amber', icon: s.streak >= 3 ? '🔥' : '' },
    { label: 'Pending', value: s.pending_count, sub: s.pending_count === 0 ? 'all caught up' : (s.pending_count === 1 ? 'one to go' : 'still to complete'), accent: s.pending_count === 0 ? 'cyan' : 'rose' },
    { label: 'Completed', value: s.completed_count, sub: `of ${s.total_available} prompts available`, accent: 'violet' },
  ];
  if (s.avg_rating != null) {
    cards.push({ label: 'Avg rating you gave', value: s.avg_rating, sub: 'across your check-ins', accent: 'cyan' });
  }
  grid.innerHTML = '';
  for (const c of cards) {
    const el = document.createElement('div');
    el.className = `stat-card stat-${c.accent}`;
    el.innerHTML = `
      <p class="stat-label"></p>
      <p class="stat-value"><span class="stat-icon" aria-hidden="true"></span><span class="stat-num"></span></p>
      <p class="stat-sub muted small"></p>
    `;
    el.querySelector('.stat-label').textContent = c.label;
    el.querySelector('.stat-icon').textContent = c.icon || '';
    el.querySelector('.stat-num').textContent = c.value;
    el.querySelector('.stat-sub').textContent = c.sub || '';
    grid.appendChild(el);
  }
}

function bucketForCount(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n <= 2) return 2;
  if (n <= 4) return 3;
  return 4;
}

function renderHeatmap(days) {
  const container = document.getElementById('heatmap');
  container.innerHTML = '';
  // 9 weeks × 7 days, columns = weeks (oldest left), rows = days (Mon–Sun ish)
  // We received 63 days oldest first. Arrange as 9 columns × 7 rows.
  const cols = 9;
  const rows = 7;
  for (let c = 0; c < cols; c++) {
    const col = document.createElement('div');
    col.className = 'heat-col';
    for (let r = 0; r < rows; r++) {
      const idx = c * rows + r;
      const day = days[idx];
      const cell = document.createElement('span');
      const bucket = day ? bucketForCount(day.count) : 0;
      cell.className = `heatmap-cell l${bucket}`;
      if (day) {
        const labelDate = new Date(day.date + 'T00:00:00');
        const friendly = labelDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        cell.title = `${friendly}: ${day.count} response${day.count === 1 ? '' : 's'}`;
      }
      col.appendChild(cell);
    }
    container.appendChild(col);
  }
}

function renderAchievements(items) {
  const grid = document.getElementById('achievements-grid');
  grid.innerHTML = '';
  for (const a of items) {
    const card = document.createElement('div');
    card.className = 'achievement-card' + (a.earned ? ' earned' : ' locked');
    card.innerHTML = `
      <div class="achievement-emoji" aria-hidden="true"></div>
      <div class="achievement-text">
        <p class="achievement-label"></p>
        <p class="achievement-desc muted small"></p>
      </div>
      <span class="achievement-status"></span>
    `;
    card.querySelector('.achievement-emoji').textContent = a.emoji;
    card.querySelector('.achievement-label').textContent = a.label;
    card.querySelector('.achievement-desc').textContent = a.desc;
    card.querySelector('.achievement-status').textContent = a.earned ? 'Earned' : 'Locked';
    grid.appendChild(card);
  }
}

function renderFeedback(entries) {
  const stack = document.getElementById('feedback-stack');
  stack.innerHTML = '';
  if (!entries || entries.length === 0) {
    stack.innerHTML = '<p class="muted">No AI feedback yet — submit a written response to a prompt to get one.</p>';
    return;
  }
  for (const e of entries) {
    const card = document.createElement('article');
    card.className = 'feedback-card';
    card.innerHTML = `
      <p class="feedback-meta muted small">
        On <strong class="feedback-on"></strong>
        · <span class="feedback-time"></span>
      </p>
      <p class="feedback-body"></p>
    `;
    card.querySelector('.feedback-on').textContent = e.prompt_title || '(untitled)';
    card.querySelector('.feedback-time').textContent = new Date(e.created_at).toLocaleString();
    card.querySelector('.feedback-body').textContent = e.feedback;
    stack.appendChild(card);
  }
}

function renderPromptProgress(items) {
  const list = document.getElementById('prompt-progress-list');
  list.innerHTML = '';
  if (!items || items.length === 0) {
    list.innerHTML = '<p class="muted">No active prompts addressed to you yet.</p>';
    return;
  }
  for (const p of items) {
    const row = document.createElement('div');
    row.className = 'progress-row' + (p.completed ? ' completed' : '');
    row.innerHTML = `
      <span class="progress-check" aria-hidden="true"></span>
      <div class="progress-info">
        <p class="progress-title font-heading"></p>
        <p class="progress-meta muted small">
          <span class="type-pill"></span>
          <span class="dot">·</span>
          <span class="progress-teacher"></span>
        </p>
      </div>
      <div class="progress-counts">
        <p class="progress-count"></p>
        <p class="progress-last muted small"></p>
      </div>
    `;
    row.querySelector('.progress-check').textContent = p.completed ? '✓' : '○';
    row.querySelector('.progress-title').textContent = p.title || '(untitled)';
    const pill = row.querySelector('.type-pill');
    pill.className = 'type-pill type-' + p.type;
    pill.textContent = TYPE_LABELS[p.type] || p.type;
    row.querySelector('.progress-teacher').textContent = p.teacher_email || '';
    row.querySelector('.progress-count').textContent =
      p.response_count === 0 ? 'No response yet' :
      p.response_count === 1 ? '1 response' :
      `${p.response_count} responses`;
    row.querySelector('.progress-last').textContent = p.last_response_at
      ? 'Last: ' + new Date(p.last_response_at).toLocaleDateString()
      : '';
    list.appendChild(row);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sign-out').addEventListener('click', signOut);
  document.getElementById('refresh-btn').addEventListener('click', loadDashboard);
});

document.addEventListener('aisa:signed-in', (e) => showSignedIn(e.detail));
document.addEventListener('aisa:signed-out', showSignedOut);
