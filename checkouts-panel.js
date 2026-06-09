// checkouts-panel.js — the "Out now" pill + slide-in panel.
//
// Injects its own DOM on load, polls list_active_checkouts every 60s while
// signed in, and reveals its pill on the first successful fetch. Non-teachers
// get { ok: false, error: 'not a teacher' } and the pill stays hidden, so
// this module is safe to load on every page.

(function () {
  let pollId = null;

  function injectPanel() {
    if (document.getElementById('checkouts-panel')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="checkouts-backdrop" class="checkouts-backdrop"></div>
      <aside id="checkouts-panel" class="checkouts-panel" aria-hidden="true">
        <header class="checkouts-panel-header">
          <div>
            <h2 class="font-heading">
              <span class="panel-icon checkouts-panel-icon" aria-hidden="true">🚪</span>
              Students out now
            </h2>
            <p class="panel-sub" id="checkouts-panel-sub">Loading...</p>
          </div>
          <button class="checkouts-close" id="checkouts-close" aria-label="Close panel">×</button>
        </header>
        <div class="checkouts-list" id="checkouts-list"></div>
      </aside>
    `;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  function destinationEmoji(d) {
    const key = String(d || '').toLowerCase();
    if (key.includes('bathroom') || key.includes('restroom')) return '🚻';
    if (key.includes('nurse')) return '⚕️';
    if (key.includes('counsellor') || key.includes('counselor')) return '💬';
    return '🚪';
  }

  function renderCheckoutItem(c) {
    const item = document.createElement('article');
    item.className = 'checkout-item' + (c.overdue ? ' overdue' : '');
    const initials = (c.student_name || c.student_email || '?')
      .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
    item.innerHTML = `
      <div class="checkout-item-head">
        <span class="checkout-item-avatar"></span>
        <div class="checkout-student-line">
          <p class="student-name"></p>
          <p class="student-email"></p>
        </div>
        <span class="checkout-destination-chip">
          <span class="dest-emoji"></span>
          <span class="dest-text"></span>
        </span>
      </div>
      <p class="checkout-meta">
        <span class="time-away muted small"></span>
        <span class="notified muted small"></span>
      </p>
      <p class="checkout-notes muted small" hidden></p>
      ${c.overdue ? '<p class="overdue-banner">OVERDUE — warning email sent to teacher</p>' : ''}
    `;
    item.querySelector('.checkout-item-avatar').textContent = initials || '?';
    item.querySelector('.student-name').textContent = c.student_name || '(no name)';
    item.querySelector('.student-email').textContent = c.student_email || '';
    item.querySelector('.dest-emoji').textContent = destinationEmoji(c.destination);
    item.querySelector('.dest-text').textContent = c.destination || '—';
    item.querySelector('.time-away').textContent = `Out ${c.minutes_away} min${c.minutes_away === 1 ? '' : 's'}`;
    item.querySelector('.notified').textContent = `· Notified ${c.teacher_email}`;
    if (c.notes) {
      const notes = item.querySelector('.checkout-notes');
      notes.hidden = false;
      notes.textContent = 'Note: ' + c.notes;
    }
    return item;
  }

  function updateButton(checkouts) {
    const btn = document.getElementById('checkouts-btn');
    const count = document.getElementById('checkouts-count');
    if (!btn || !count) return;
    btn.hidden = false;
    count.textContent = String(checkouts.length);
    btn.classList.toggle('empty', checkouts.length === 0);
    btn.classList.toggle('has-overdue', checkouts.some(c => c.overdue));
  }

  function populatePanel(checkouts) {
    const list = document.getElementById('checkouts-list');
    const sub = document.getElementById('checkouts-panel-sub');
    if (!list || !sub) return;
    if (checkouts.length === 0) {
      sub.textContent = 'Everyone is in class.';
      list.innerHTML = `
        <div class="checkouts-empty">
          <span class="empty-icon" aria-hidden="true">🎒</span>
          <h3 class="font-heading">No one is out</h3>
          <p>No students are currently checked out.</p>
        </div>
      `;
      return;
    }
    const overdueCount = checkouts.filter(c => c.overdue).length;
    sub.textContent = `${checkouts.length} student${checkouts.length === 1 ? '' : 's'} out`
      + (overdueCount ? ` · ${overdueCount} overdue` : '');
    list.innerHTML = '';
    for (const c of checkouts) list.appendChild(renderCheckoutItem(c));
  }

  async function refresh() {
    try {
      const data = await api('list_active_checkouts');
      if (!data.ok) return;
      updateButton(data.checkouts);
      populatePanel(data.checkouts);
    } catch (_) { /* silent — next poll will retry */ }
  }

  function startPolling() {
    if (pollId) clearInterval(pollId);
    pollId = setInterval(refresh, 60000);
  }
  function stopPolling() {
    if (pollId) { clearInterval(pollId); pollId = null; }
  }

  function openPanel() {
    const panel = document.getElementById('checkouts-panel');
    document.getElementById('checkouts-backdrop').classList.add('open');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    if (typeof modalOpen === 'function') modalOpen(panel, '#checkouts-close');
    refresh();
  }
  function closePanel() {
    const backdrop = document.getElementById('checkouts-backdrop');
    const panel = document.getElementById('checkouts-panel');
    if (backdrop) backdrop.classList.remove('open');
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
    if (typeof modalClose === 'function') modalClose();
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectPanel();
    const btn = document.getElementById('checkouts-btn');
    if (btn) btn.addEventListener('click', openPanel);
    document.getElementById('checkouts-close').addEventListener('click', closePanel);
    document.getElementById('checkouts-backdrop').addEventListener('click', closePanel);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });
  });

  document.addEventListener('aisa:signed-in', () => {
    refresh();
    startPolling();
  });
  document.addEventListener('aisa:signed-out', () => {
    stopPolling();
    closePanel();
    const btn = document.getElementById('checkouts-btn');
    if (btn) btn.hidden = true;
  });
})();
