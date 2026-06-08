// Student profile page. Auth + api() live in auth.js.

const TYPE_LABELS = {
  open: 'Open response',
  multiple_choice: 'Multiple choice',
  acknowledgment: 'Acknowledgment',
  rating: 'Rating',
  poll: 'Poll',
};

function getQueryParam(name) {
  const p = new URLSearchParams(location.search);
  return p.get(name) || '';
}

let currentProfile = null;

async function showSignedIn(user) {
  document.getElementById('signin-container').hidden = true;
  document.getElementById('status').hidden = true;
  document.getElementById('signed-in').hidden = false;
  document.getElementById('user-name').textContent = user.name || '';
  await loadProfile();
}

function showSignedOut() {
  document.getElementById('signed-in').hidden = true;
  document.getElementById('signin-container').hidden = false;
}

async function loadProfile() {
  const loading = document.getElementById('loading');
  const content = document.getElementById('profile-content');
  loading.hidden = false;
  content.hidden = true;

  const sub = getQueryParam('sub');
  const email = getQueryParam('email');
  if (!sub && !email) {
    loading.innerHTML = '<div class="alert alert-error"><span class="alert-icon">⚠️</span><div>No student selected. Open this page from the Teacher Dashboard.</div></div>';
    return;
  }
  try {
    const data = await api('get_student_profile', { google_sub: sub, student_email: email });
    if (!data.ok) {
      loading.innerHTML = `<div class="alert alert-error"><span class="alert-icon">⚠️</span><div>${friendlyError(data.error)}</div></div>`;
      return;
    }
    currentProfile = data.profile;
    loading.hidden = true;
    content.hidden = false;
    renderProfile(currentProfile);
  } catch (err) {
    loading.innerHTML = `<div class="alert alert-error"><span class="alert-icon">⚠️</span><div>Network error: ${err.message}</div></div>`;
  }
}

function renderProfile(p) {
  renderStudentHero(p);
  renderStats(p.summary);
  renderHeatmap(p.heatmap);
  renderFlagged(p.flagged);
  renderPrompts(p.prompts);
  renderResponseHistory(p.responses);
  renderCheckouts(p.checkouts, p.summary);
}

function renderStudentHero(p) {
  const hero = document.getElementById('student-hero');
  const initials = (p.student.name || p.student.email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
  hero.innerHTML = `
    <div class="student-hero-avatar"></div>
    <div class="student-hero-info">
      <p class="muted small student-hero-eyebrow">Student profile</p>
      <h2 class="student-hero-name font-heading"></h2>
      <p class="student-hero-email"></p>
      <p class="student-hero-last muted small" hidden></p>
    </div>
  `;
  hero.querySelector('.student-hero-avatar').textContent = initials;
  hero.querySelector('.student-hero-name').textContent = p.student.name || '(no name)';
  hero.querySelector('.student-hero-email').textContent = p.student.email || '';
  if (p.summary.last_active) {
    const lastEl = hero.querySelector('.student-hero-last');
    lastEl.hidden = false;
    lastEl.textContent = 'Last active ' + friendlyTime(p.summary.last_active);
  }
}

function renderStats(s) {
  const grid = document.getElementById('stats-grid');
  const cards = [
    { label: 'Responses', value: s.total_responses, sub: `to ${s.prompts_responded} of ${s.prompts_available} prompts`, tone: 'indigo' },
    { label: 'Streak', value: s.streak, sub: s.streak >= 1 ? (s.streak === 1 ? 'day' : 'days in a row') : 'no streak', tone: 'amber' },
    { label: 'Completed', value: s.completed_count, sub: `of ${s.prompts_available} prompts`, tone: 'violet' },
    { label: 'Time out of class', value: s.checkout_minutes + ' min', sub: `${s.checkout_trips} trip${s.checkout_trips === 1 ? '' : 's'}`, tone: 'cyan' },
  ];
  if (s.flagged_count > 0) {
    cards.push({ label: 'Flagged', value: s.flagged_count, sub: s.unresolved_flagged_count + ' unresolved', tone: 'rose' });
  }
  if (s.avg_rating != null) {
    cards.push({ label: 'Avg self-rating', value: s.avg_rating, sub: 'across check-ins', tone: 'cyan' });
  }
  grid.innerHTML = '';
  for (const c of cards) {
    const el = document.createElement('div');
    el.className = `stat-card stat-${c.tone}`;
    el.innerHTML = `<p class="stat-label"></p><p class="stat-value"></p><p class="stat-sub"></p>`;
    el.querySelector('.stat-label').textContent = c.label;
    el.querySelector('.stat-value').textContent = c.value;
    el.querySelector('.stat-sub').textContent = c.sub;
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
  const cols = 9, rows = 7;
  const dayLabels = ['Mon', '', 'Wed', '', 'Fri', '', ''];
  const labelCol = document.createElement('div');
  labelCol.className = 'heat-labels';
  for (let r = 0; r < rows; r++) {
    const lbl = document.createElement('span');
    lbl.className = 'heat-day-label';
    lbl.textContent = dayLabels[r] || '';
    labelCol.appendChild(lbl);
  }
  container.appendChild(labelCol);
  for (let c = 0; c < cols; c++) {
    const col = document.createElement('div');
    col.className = 'heat-col';
    for (let r = 0; r < rows; r++) {
      const idx = c * rows + r;
      const day = days[idx];
      const cell = document.createElement('span');
      cell.className = `heatmap-cell l${day ? bucketForCount(day.count) : 0}`;
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

function renderFlagged(flagged) {
  const section = document.getElementById('flagged-section');
  const list = document.getElementById('flagged-list-profile');
  if (!flagged || flagged.length === 0) { section.hidden = true; return; }
  section.hidden = false;
  list.innerHTML = '';
  for (const r of flagged) {
    const item = document.createElement('article');
    item.className = 'teacher-response-card flagged';
    item.innerHTML = `
      <p class="flag-banner"></p>
      <p class="student-header">
        <span class="muted small submission-time"></span>
      </p>
      <p class="response-body"></p>
    `;
    item.querySelector('.flag-banner').textContent = 'FLAGGED — ' + (r.flag_reason || 'review needed');
    item.querySelector('.submission-time').textContent = friendlyTime(r.created_at);
    item.querySelector('.response-body').textContent = r.body;
    list.appendChild(item);
  }
}

function renderPrompts(prompts) {
  const list = document.getElementById('prompts-list');
  list.innerHTML = '';
  if (!prompts || prompts.length === 0) {
    list.innerHTML = '<p class="muted">No active prompts.</p>';
    return;
  }
  for (const p of prompts) {
    const row = document.createElement('div');
    row.className = 'progress-row' + (p.completed ? ' completed' : '');
    row.innerHTML = `
      <span class="progress-check" aria-hidden="true"></span>
      <div class="progress-info">
        <p class="progress-title font-heading"></p>
        <p class="progress-meta muted small">
          <span class="type-pill"></span>
        </p>
      </div>
      <div class="progress-counts">
        <p class="progress-count"></p>
        <p class="progress-last muted small"></p>
      </div>
    `;
    row.querySelector('.progress-check').textContent = p.completed ? '✓' : (p.response_count > 0 ? '◐' : '○');
    row.querySelector('.progress-title').textContent = p.title || '(untitled)';
    const pill = row.querySelector('.type-pill');
    pill.className = 'type-pill type-' + p.type;
    pill.textContent = TYPE_LABELS[p.type] || p.type;
    row.querySelector('.progress-count').textContent =
      p.response_count === 0 ? 'No response' :
      p.response_count === 1 ? '1 response' : `${p.response_count} responses`;
    row.querySelector('.progress-last').textContent = p.last_response_at ? friendlyTime(p.last_response_at) : '';
    list.appendChild(row);
  }
}

function renderResponseHistory(responses) {
  const list = document.getElementById('response-history');
  list.innerHTML = '';
  if (!responses || responses.length === 0) {
    list.innerHTML = '<p class="muted">No submissions yet.</p>';
    return;
  }
  for (const r of responses) {
    const card = document.createElement('article');
    card.className = 'teacher-response-card' + (r.flagged ? ' flagged' : '');
    const feedbackHtml = r.ai_feedback
      ? (r.flagged
          ? `<div class="resource-note"><p class="ai-body"></p></div>`
          : `<div class="ai-feedback"><p class="ai-label small">AI feedback shown to student</p><p class="ai-body"></p></div>`)
      : '';
    card.innerHTML = `
      ${r.flagged ? '<p class="flag-banner"></p>' : ''}
      <p class="student-header">
        <strong></strong>
        <span class="muted small"> · <span class="submission-time"></span></span>
      </p>
      <p class="response-body"></p>
      ${feedbackHtml}
    `;
    if (r.flagged) card.querySelector('.flag-banner').textContent = 'FLAGGED — ' + (r.flag_reason || 'review needed');
    card.querySelector('strong').textContent = r.prompt_title || '(untitled)';
    card.querySelector('.submission-time').textContent = friendlyTime(r.created_at);
    card.querySelector('.response-body').textContent = r.body;
    if (r.ai_feedback) card.querySelector('.ai-body').textContent = r.ai_feedback;
    list.appendChild(card);
  }
}

function renderCheckouts(checkouts, summary) {
  const section = document.getElementById('checkouts-section');
  const list = document.getElementById('checkouts-list-profile');
  if (!checkouts || checkouts.length === 0) { section.hidden = true; return; }
  section.hidden = false;

  const dest = summary.checkout_destinations || {};
  const destEntries = Object.keys(dest).map(d => `${d}: ${dest[d]}`).join(' · ');

  list.innerHTML = `
    <p class="muted small" style="margin: 0 0 14px;">${destEntries}</p>
    <div class="leaderboard"></div>
  `;
  const ldb = list.querySelector('.leaderboard');
  for (const c of checkouts) {
    const item = document.createElement('div');
    item.className = 'lb-row';
    item.innerHTML = `
      <span class="lb-rank"></span>
      <span class="lb-name"></span>
      <span class="lb-trips muted small"></span>
      <span class="lb-time"></span>
    `;
    item.querySelector('.lb-rank').textContent = destinationEmoji(c.destination);
    item.querySelector('.lb-name').textContent = c.destination + (c.notes ? ' — ' + c.notes : '');
    item.querySelector('.lb-trips').textContent = friendlyTime(c.checked_out_at);
    item.querySelector('.lb-time').textContent = c.minutes + ' min';
    ldb.appendChild(item);
  }
}

function destinationEmoji(d) {
  const k = String(d || '').toLowerCase();
  if (k.indexOf('bathroom') !== -1) return '🚻';
  if (k.indexOf('nurse') !== -1) return '⚕️';
  if (k.indexOf('counsellor') !== -1 || k.indexOf('counselor') !== -1) return '💬';
  return '🚪';
}

/* ============================================================
   AI summary
   ============================================================ */

async function generateSummary() {
  if (!currentProfile) return;
  const btn = document.getElementById('generate-summary-btn');
  const panel = document.getElementById('ai-summary');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  panel.innerHTML = '<p class="muted small">Asking Gemini — this can take 10-30 seconds…</p>';
  try {
    const data = await api('summarize_student', {
      google_sub: currentProfile.student.google_sub,
      student_email: currentProfile.student.email,
    });
    if (!data.ok) {
      panel.innerHTML = `<div class="alert alert-error"><span class="alert-icon">⚠️</span><div>${friendlyError(data.error)}</div></div>`;
      return;
    }
    renderAiSummary(panel, data.summary);
    announce('AI summary generated.');
  } catch (err) {
    panel.innerHTML = `<div class="alert alert-error"><span class="alert-icon">⚠️</span><div>Network error: ${err.message}</div></div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Regenerate';
  }
}

function renderAiSummary(container, s) {
  container.innerHTML = `
    <p class="ai-summary-meta muted small">Generated ${friendlyTime(s.generated_at)}</p>
    <div class="engagement-row">
      <div class="engagement-score">
        <div class="engagement-number"></div>
        <div class="engagement-of muted small">/ 10 engagement</div>
      </div>
      <p class="engagement-reason"></p>
    </div>
    <p class="snapshot"></p>
    <div class="summary-cols">
      <div class="summary-col strengths">
        <h4 class="font-heading">✨ Strengths</h4>
        <ul></ul>
      </div>
      <div class="summary-col growth">
        <h4 class="font-heading">🌱 Growth areas</h4>
        <ul></ul>
      </div>
    </div>
    <div class="next-steps">
      <h4 class="font-heading">→ Next steps</h4>
      <ul></ul>
    </div>
  `;
  container.querySelector('.engagement-number').textContent = s.engagement_score;
  container.querySelector('.engagement-reason').textContent = s.engagement_reason || '';
  container.querySelector('.snapshot').textContent = s.snapshot;
  fillUl(container.querySelector('.strengths ul'), s.strengths);
  fillUl(container.querySelector('.growth ul'), s.growth_areas);
  fillUl(container.querySelector('.next-steps ul'), s.next_steps);
}

function fillUl(ul, items) {
  ul.innerHTML = '';
  if (!items || items.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '(none)';
    ul.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.appendChild(li);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sign-out').addEventListener('click', signOut);
  document.getElementById('generate-summary-btn').addEventListener('click', generateSummary);
});

document.addEventListener('aisa:signed-in', (e) => showSignedIn(e.detail));
document.addEventListener('aisa:signed-out', showSignedOut);
