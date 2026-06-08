// Student progress dashboard. Auth + api() helpers live in auth.js.

const TYPE_LABELS = {
  open: 'Open response',
  multiple_choice: 'Multiple choice',
  acknowledgment: 'Acknowledgment',
  rating: 'Rating',
  poll: 'Poll',
};

const LEVELS = [
  { min: 0,   name: 'Sprout',   emoji: '🌱', tone: 'green' },
  { min: 3,   name: 'Bloom',    emoji: '🌷', tone: 'pink' },
  { min: 8,   name: 'Voice',    emoji: '🎤', tone: 'cyan' },
  { min: 18,  name: 'Explorer', emoji: '🧭', tone: 'indigo' },
  { min: 35,  name: 'Scholar',  emoji: '🎓', tone: 'violet' },
  { min: 70,  name: 'Champion', emoji: '🏆', tone: 'amber' },
  { min: 150, name: 'Legend',   emoji: '👑', tone: 'gold'  },
];

const BADGE_THEMES = {
  first:       { tone: 'cyan',   chip: 'EARNED' },
  five:        { tone: 'green',  chip: '+5'     },
  twentyfive:  { tone: 'indigo', chip: '+25'    },
  streak3:     { tone: 'amber',  chip: '3 days' },
  streak7:     { tone: 'rose',   chip: '7 days' },
  allcaught:   { tone: 'violet', chip: 'CLEAR'  },
};

function getLevel(responses) {
  let current = LEVELS[0];
  let next = null;
  for (const lv of LEVELS) {
    if (responses >= lv.min) current = lv;
    else if (!next) next = lv;
  }
  const span = next ? next.min - current.min : 1;
  const within = Math.max(0, responses - current.min);
  return {
    current,
    next,
    xpInLevel: within,
    xpToNext: next ? next.min - responses : 0,
    spanXp: span,
    progress: next ? Math.min(1, within / span) : 1,
  };
}

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
    const [dash, leaderboard] = await Promise.all([
      api('get_student_dashboard'),
      api('get_checkout_leaderboard'),
    ]);
    if (!dash.ok) {
      loading.textContent = `Couldn't load: ${friendlyError(dash.error)}`;
      return;
    }
    loading.hidden = true;
    content.hidden = false;
    renderDashboard(dash.dashboard, currentUser, leaderboard.ok ? leaderboard.leaderboard : null);
  } catch (err) {
    loading.textContent = `Network error: ${err.message}`;
  }
}

function renderDashboard(d, user, lb) {
  renderLevelHero(d, user);
  renderStats(d.summary);
  renderHeatmap(d.heatmap);
  renderAchievements(d.achievements);
  renderCheckoutSummary(d.checkouts, lb);
  renderLeaderboard(lb);
  renderFeedback(d.recent_feedback);
  renderPromptProgress(d.prompt_progress);
}

function destinationEmoji(d) {
  const k = String(d || '').toLowerCase();
  if (k.indexOf('bathroom') !== -1 || k.indexOf('restroom') !== -1) return '🚻';
  if (k.indexOf('nurse') !== -1) return '⚕️';
  if (k.indexOf('counsellor') !== -1 || k.indexOf('counselor') !== -1) return '💬';
  return '🚪';
}

function renderCheckoutSummary(co, lb) {
  const el = document.getElementById('checkout-summary');
  if (!co) { el.innerHTML = '<p class="muted">No check-out data yet.</p>'; return; }
  const dest = co.by_destination || {};
  const destEntries = Object.keys(dest).map(d => ({ label: d, count: dest[d] }));
  destEntries.sort((a, b) => b.count - a.count);

  el.innerHTML = `
    <div class="checkout-stat-row">
      <div class="checkout-stat">
        <p class="checkout-stat-label">Trips this week</p>
        <p class="checkout-stat-value"></p>
      </div>
      <div class="checkout-stat">
        <p class="checkout-stat-label">Minutes out this week</p>
        <p class="checkout-stat-value"></p>
      </div>
      <div class="checkout-stat">
        <p class="checkout-stat-label">Trips all-time</p>
        <p class="checkout-stat-value"></p>
      </div>
      <div class="checkout-stat">
        <p class="checkout-stat-label">Your rank</p>
        <p class="checkout-stat-value rank-value"></p>
      </div>
    </div>
    <div class="checkout-destinations">
      <p class="checkout-section-label">By destination</p>
      <div class="dest-chips" id="dest-chips"></div>
    </div>
  `;
  // Week trips estimate: count trips in co.recent within last 7 days. We don't have a direct count
  // so use total_trips for "all-time" and week_minutes for "this week minutes".
  const weekTrips = (co.recent || []).filter(t => {
    const ts = new Date(t.checked_out_at);
    return (Date.now() - ts.getTime()) < 7 * 24 * 60 * 60 * 1000;
  }).length;
  el.querySelectorAll('.checkout-stat-value')[0].textContent = weekTrips;
  el.querySelectorAll('.checkout-stat-value')[1].textContent = (co.week_minutes || 0) + ' min';
  el.querySelectorAll('.checkout-stat-value')[2].textContent = co.total_trips || 0;
  el.querySelector('.rank-value').textContent = lb && lb.my_rank ? `#${lb.my_rank} of ${lb.total_students}` : '—';

  const chipsContainer = el.querySelector('#dest-chips');
  if (destEntries.length === 0) {
    chipsContainer.innerHTML = '<p class="muted small">No check-outs yet.</p>';
  } else {
    for (const d of destEntries) {
      const chip = document.createElement('span');
      chip.className = 'dest-chip';
      chip.innerHTML = `
        <span class="dest-chip-emoji" aria-hidden="true"></span>
        <span class="dest-chip-label"></span>
        <span class="dest-chip-count"></span>
      `;
      chip.querySelector('.dest-chip-emoji').textContent = destinationEmoji(d.label);
      chip.querySelector('.dest-chip-label').textContent = d.label;
      chip.querySelector('.dest-chip-count').textContent = d.count + (d.count === 1 ? ' trip' : ' trips');
      chipsContainer.appendChild(chip);
    }
  }
}

function renderLeaderboard(lb) {
  const el = document.getElementById('leaderboard');
  if (!lb || !lb.leaderboard || lb.leaderboard.length === 0) {
    el.innerHTML = '<p class="muted">Not enough data for a leaderboard yet.</p>';
    return;
  }
  el.innerHTML = '';
  for (const row of lb.leaderboard) {
    const item = document.createElement('div');
    item.className = 'lb-row' + (row.is_me ? ' is-me' : '') + (row.rank <= 3 ? ' is-podium' : '');
    const medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : '#' + row.rank;
    item.innerHTML = `
      <span class="lb-rank"></span>
      <span class="lb-name"></span>
      <span class="lb-trips muted small"></span>
      <span class="lb-time"></span>
    `;
    item.querySelector('.lb-rank').textContent = medal;
    item.querySelector('.lb-name').textContent = row.display_name + (row.is_me ? ' (you)' : '');
    item.querySelector('.lb-trips').textContent = row.trips + (row.trips === 1 ? ' trip' : ' trips');
    item.querySelector('.lb-time').textContent = row.minutes + ' min';
    el.appendChild(item);
  }
  if (lb.my_rank && lb.my_rank > 5) {
    const me = document.createElement('div');
    me.className = 'lb-row is-me lb-below';
    me.innerHTML = `
      <span class="lb-rank">#${lb.my_rank}</span>
      <span class="lb-name">You</span>
      <span class="lb-trips muted small">${lb.my_trips} trips</span>
      <span class="lb-time">${lb.my_minutes} min</span>
    `;
    el.appendChild(me);
  }
}

function renderLevelHero(d, user) {
  const level = getLevel(d.summary.total_responses);
  const earnedBadges = d.achievements.filter(a => a.earned).length;
  const initials = (user.name || user.email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

  const hero = document.getElementById('level-hero');
  hero.className = `level-hero tone-${level.current.tone}`;
  hero.innerHTML = `
    <div class="hero-avatar">
      <span class="hero-avatar-initials"></span>
      <span class="hero-avatar-level"></span>
    </div>
    <div class="hero-level-info">
      <p class="hero-level-eyebrow">Level ${LEVELS.indexOf(level.current) + 1}</p>
      <h2 class="hero-level-name font-heading">
        <span class="hero-level-emoji" aria-hidden="true"></span>
        <span class="hero-level-text"></span>
      </h2>
      <div class="hero-xp-bar">
        <div class="hero-xp-fill" style="width: ${Math.round(level.progress * 100)}%"></div>
      </div>
      <p class="hero-xp-meta muted small"></p>
      <p class="hero-snapshot">
        <span class="hero-chip"><strong></strong> responses</span>
        <span class="hero-chip"><strong></strong> day streak</span>
        <span class="hero-chip"><strong></strong> badges</span>
      </p>
    </div>
  `;
  hero.querySelector('.hero-avatar-initials').textContent = initials || '?';
  hero.querySelector('.hero-avatar-level').textContent = LEVELS.indexOf(level.current) + 1;
  hero.querySelector('.hero-level-emoji').textContent = level.current.emoji;
  hero.querySelector('.hero-level-text').textContent = level.current.name;
  hero.querySelector('.hero-xp-meta').textContent = level.next
    ? `${level.xpInLevel} / ${level.spanXp} XP · ${level.xpToNext} response${level.xpToNext === 1 ? '' : 's'} to ${level.next.name} ${level.next.emoji}`
    : 'Max level reached — incredible work.';
  const chips = hero.querySelectorAll('.hero-chip strong');
  chips[0].textContent = d.summary.total_responses;
  chips[1].textContent = d.summary.streak || 0;
  chips[2].textContent = `${earnedBadges} / ${d.achievements.length}`;
}

function animateCount(el, to, duration) {
  const from = 0;
  const t0 = performance.now();
  duration = duration || 800;
  function tick(now) {
    const k = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - k, 3);
    const val = Math.round(from + (to - from) * eased);
    el.textContent = val;
    if (k < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderStats(s) {
  const grid = document.getElementById('stats-grid');
  const cards = [
    { label: 'Responses', value: s.total_responses, sub: s.total_responses === 1 ? 'one submission' : 'submissions to date', tone: 'indigo', icon: '📝' },
    { label: 'Streak', value: s.streak || 0, sub: s.streak >= 1 ? (s.streak === 1 ? 'day · keep going' : 'days in a row') : 'respond today to start one', tone: 'amber', icon: s.streak >= 3 ? '🔥' : '✨' },
    { label: 'Pending', value: s.pending_count, sub: s.pending_count === 0 ? 'all caught up' : (s.pending_count === 1 ? 'one to go' : 'still to complete'), tone: s.pending_count === 0 ? 'cyan' : 'rose', icon: s.pending_count === 0 ? '✅' : '⏳' },
    { label: 'Completed', value: s.completed_count, sub: `of ${s.total_available} prompts available`, tone: 'violet', icon: '🎯' },
  ];
  if (s.avg_rating != null) {
    cards.push({ label: 'Avg rating given', value: s.avg_rating, sub: 'across your check-ins', tone: 'cyan', icon: '⭐' });
  }
  grid.innerHTML = '';
  for (const c of cards) {
    const el = document.createElement('div');
    el.className = `stat-card stat-${c.tone} stat-vivid`;
    el.innerHTML = `
      <div class="stat-top">
        <span class="stat-label"></span>
        <span class="stat-icon" aria-hidden="true"></span>
      </div>
      <p class="stat-value-big"><span class="stat-num">0</span></p>
      <p class="stat-sub muted small"></p>
    `;
    el.querySelector('.stat-label').textContent = c.label;
    el.querySelector('.stat-icon').textContent = c.icon;
    el.querySelector('.stat-sub').textContent = c.sub || '';
    grid.appendChild(el);
    // Count-up animation
    const numEl = el.querySelector('.stat-num');
    const target = typeof c.value === 'number' ? c.value : 0;
    if (typeof c.value === 'number') {
      animateCount(numEl, target, 800);
    } else {
      numEl.textContent = c.value;
    }
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
  const cols = 9;
  const rows = 7;
  const dayLabels = ['Mon', '', 'Wed', '', 'Fri', '', ''];

  // Day-of-week labels column
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
      const bucket = day ? bucketForCount(day.count) : 0;
      cell.className = `heatmap-cell l${bucket}`;
      cell.style.animationDelay = (idx * 8) + 'ms';
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
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const theme = BADGE_THEMES[a.id] || { tone: 'indigo', chip: 'EARNED' };
    const card = document.createElement('div');
    card.className = `badge-card ${a.earned ? 'earned' : 'locked'} tone-${theme.tone}`;
    card.style.animationDelay = (i * 70) + 'ms';
    card.innerHTML = `
      <div class="badge-medal">
        <div class="badge-disc">
          <span class="badge-emoji" aria-hidden="true"></span>
        </div>
        <span class="badge-lock" aria-hidden="true">🔒</span>
        ${a.earned ? '<span class="badge-chip"></span>' : ''}
      </div>
      <p class="badge-name font-heading"></p>
      <p class="badge-desc muted small"></p>
    `;
    card.querySelector('.badge-emoji').textContent = a.emoji;
    card.querySelector('.badge-name').textContent = a.label;
    card.querySelector('.badge-desc').textContent = a.desc;
    if (a.earned) {
      card.querySelector('.badge-chip').textContent = theme.chip;
    }
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
      <span class="feedback-quote" aria-hidden="true">"</span>
      <p class="feedback-body"></p>
      <p class="feedback-meta muted small">
        On <strong class="feedback-on"></strong>
        · <span class="feedback-time"></span>
      </p>
    `;
    card.querySelector('.feedback-on').textContent = e.prompt_title || '(untitled)';
    card.querySelector('.feedback-time').textContent = friendlyTime(e.created_at);
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
      ? 'Last: ' + friendlyTime(p.last_response_at)
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
