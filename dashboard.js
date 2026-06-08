// Dashboard page logic. Auth + api() helpers live in auth.js.

const DOWNLOADS = [
  { kind: 'responses', label: 'All responses', icon: '📝', help: 'Every response to your prompts.' },
  { kind: 'prompts',   label: 'Your prompts',  icon: '📋', help: 'All prompts you published or drafted.' },
  { kind: 'students',  label: 'Student roster', icon: '🎒', help: 'Everyone who responded to your prompts.' },
  { kind: 'flagged',   label: 'Flagged only',  icon: '🚩', help: 'Just the responses flagged by the AI classifier.' },
  { kind: 'checkouts', label: 'Check-outs',    icon: '🚪', help: 'Bathroom/Nurse/Counsellor trips routed to you.' },
];

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
  await loadDashboard();
}

function showSignedOut() {
  document.getElementById('signed-in').hidden = true;
  document.getElementById('signin-container').hidden = false;
  document.getElementById('status').hidden = false;
  document.getElementById('status').textContent = 'Signed out. Sign in again to continue.';
}

async function loadDashboard() {
  const roleLoading = document.getElementById('role-loading');
  const notTeacher = document.getElementById('not-teacher');
  const content = document.getElementById('dashboard-content');
  roleLoading.hidden = false;
  roleLoading.textContent = 'Loading dashboard...';
  notTeacher.hidden = true;
  content.hidden = true;

  try {
    const me = await api('whoami');
    if (!me.ok || !me.is_teacher) {
      roleLoading.hidden = true;
      notTeacher.hidden = false;
      return;
    }
    const data = await api('get_teacher_dashboard');
    if (!data.ok) {
      roleLoading.textContent = `Couldn't load: ${friendlyError(data.error)}`;
      return;
    }
    roleLoading.hidden = true;
    content.hidden = false;
    renderDashboard(data.dashboard);
  } catch (err) {
    roleLoading.textContent = `Network error: ${err.message}`;
  }
}

function renderDashboard(d) {
  renderStats(d.summary);
  renderDownloads();
  renderPromptsTable(d.prompts);
  renderStudentsTable(d.students);
  renderActivity(d.activity);
}

function renderStats(s) {
  const grid = document.getElementById('stats-grid');
  const cards = [
    { label: 'Prompts published', value: s.total_prompts, accent: 'indigo' },
    { label: 'Total responses', value: s.total_responses, accent: 'cyan' },
    { label: 'Students reached', value: s.total_students, accent: 'violet' },
    { label: 'Flagged', value: s.flagged_count, accent: 'rose', sub: s.unresolved_flagged ? `${s.unresolved_flagged} unresolved` : 'all resolved' },
    { label: 'Check-outs routed to you', value: s.total_checkouts, accent: 'amber', sub: s.active_checkouts ? `${s.active_checkouts} active` : 'none active' },
  ];
  grid.innerHTML = '';
  for (const c of cards) {
    const el = document.createElement('div');
    el.className = `stat-card stat-${c.accent}`;
    el.innerHTML = `
      <p class="stat-label"></p>
      <p class="stat-value"></p>
      ${c.sub ? '<p class="stat-sub muted small"></p>' : ''}
    `;
    el.querySelector('.stat-label').textContent = c.label;
    el.querySelector('.stat-value').textContent = c.value;
    if (c.sub) el.querySelector('.stat-sub').textContent = c.sub;
    grid.appendChild(el);
  }
}

function renderDownloads() {
  const row = document.getElementById('download-row');
  row.innerHTML = '';
  for (const d of DOWNLOADS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'download-btn';
    btn.dataset.kind = d.kind;
    btn.innerHTML = `
      <span class="download-icon" aria-hidden="true">${d.icon}</span>
      <span class="download-meta">
        <span class="download-label">${d.label}</span>
        <span class="download-help muted small">${d.help}</span>
      </span>
      <span class="download-cta">CSV ↓</span>
    `;
    btn.addEventListener('click', () => downloadCsv(d.kind, d.label, btn));
    row.appendChild(btn);
  }
}

async function downloadCsv(kind, label, button) {
  const original = button.querySelector('.download-cta').textContent;
  button.disabled = true;
  button.querySelector('.download-cta').textContent = 'Preparing...';
  try {
    const data = await api('export_csv', { kind });
    if (!data.ok) { alert(friendlyError(data.error)); return; }
    const blob = new Blob([data.csv || ''], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `aisa-${kind}-${now}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Network error: ' + err.message);
  } finally {
    button.disabled = false;
    button.querySelector('.download-cta').textContent = original;
  }
}

function renderPromptsTable(prompts) {
  const tbody = document.querySelector('#prompts-table tbody');
  tbody.innerHTML = '';
  if (!prompts || prompts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No prompts published yet.</td></tr>';
    return;
  }
  for (const p of prompts) {
    const tr = document.createElement('tr');
    if (p.flagged_count > 0) tr.classList.add('row-has-flagged');
    tr.innerHTML = `
      <td><span class="row-title"></span></td>
      <td><span class="type-pill type-${p.type}"></span></td>
      <td class="row-time"></td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num row-flagged"></td>
    `;
    tr.querySelector('.row-title').textContent = p.title || '(untitled)';
    tr.querySelector('.type-pill').textContent = TYPE_LABELS[p.type] || p.type;
    tr.querySelector('.row-time').textContent = friendlyTime(p.created_at);
    tr.cells[3].textContent = p.response_count;
    tr.cells[4].textContent = p.unique_students;
    tr.querySelector('.row-flagged').textContent = p.flagged_count;
    tbody.appendChild(tr);
  }
}

function renderStudentsTable(students) {
  const tbody = document.querySelector('#students-table tbody');
  tbody.innerHTML = '';
  if (!students || students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No student responses yet.</td></tr>';
    return;
  }
  for (const s of students) {
    const tr = document.createElement('tr');
    if (s.flagged_count > 0) tr.classList.add('row-has-flagged');
    tr.classList.add('row-clickable');
    const params = new URLSearchParams();
    if (s.google_sub) params.set('sub', s.google_sub);
    if (s.email) params.set('email', s.email);
    const href = 'student.html?' + params.toString();
    tr.dataset.href = href;
    tr.setAttribute('role', 'link');
    tr.setAttribute('tabindex', '0');
    tr.setAttribute('aria-label', `Open profile for ${s.name || s.email}`);
    tr.innerHTML = `
      <td><a class="row-link" href="${href}"><span class="row-title"></span></a></td>
      <td><code class="row-email"></code></td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num row-flagged"></td>
      <td class="row-time"></td>
    `;
    tr.querySelector('.row-title').textContent = s.name || '(no name)';
    tr.querySelector('.row-email').textContent = s.email || '';
    tr.cells[2].textContent = s.response_count;
    tr.cells[3].textContent = s.prompts_responded;
    tr.querySelector('.row-flagged').textContent = s.flagged_count;
    tr.querySelector('.row-time').textContent = friendlyTime(s.last_active);
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      window.location.href = href;
    });
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = href; }
    });
    tbody.appendChild(tr);
  }
}

function renderActivity(items) {
  const feed = document.getElementById('activity-feed');
  feed.innerHTML = '';
  if (!items || items.length === 0) {
    feed.innerHTML = '<li class="activity-empty muted">No activity yet.</li>';
    return;
  }
  for (const a of items) {
    const li = document.createElement('li');
    li.className = 'activity-item' + (a.type === 'flag' ? ' is-flag' : '');
    const verb = a.type === 'flag' ? 'was flagged on' : 'responded to';
    li.innerHTML = `
      <span class="activity-time"></span>
      <span class="activity-dot" aria-hidden="true"></span>
      <span class="activity-text">
        <strong class="activity-who"></strong>
        <span class="activity-verb"></span>
        <em class="activity-target"></em>
      </span>
    `;
    li.querySelector('.activity-time').textContent = friendlyTime(a.timestamp);
    li.querySelector('.activity-who').textContent = a.student_name || a.student_email;
    li.querySelector('.activity-verb').textContent = ' ' + verb + ' ';
    li.querySelector('.activity-target').textContent = a.prompt_title || '(untitled)';
    feed.appendChild(li);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sign-out').addEventListener('click', signOut);
  document.getElementById('refresh-btn').addEventListener('click', loadDashboard);
});

document.addEventListener('aisa:signed-in', (e) => showSignedIn(e.detail));
document.addEventListener('aisa:signed-out', showSignedOut);
