// menu.js — the teacher-area topbar, rendered from one source.
//
// Every teacher page (teacher.html, dashboard.html, student.html) has just
// <nav class="topbar" data-page="<id>"></nav> in its HTML. This module fills
// it with brand + nav links + role-gated pills + user chip on load, so the
// nav stays identical wherever you are. Pill buttons here are placeholders;
// the matching panel modules (checkouts-panel.js, flagged-panel.js) own the
// behavior and reveal the pills when their first fetch succeeds.

(function () {
  const TEACHER_LINKS = [
    { id: 'teacher', href: 'teacher.html', label: 'Studio', emoji: '✍️' },
    { id: 'dashboard', href: 'dashboard.html', label: 'Dashboard', emoji: '📊' },
  ];

  const PAGE_LABELS = {
    teacher: 'Teacher Studio',
    dashboard: 'Dashboard',
    student: 'Student Profile',
  };

  function render(nav, pageId) {
    nav.setAttribute('aria-label', 'Primary');
    nav.innerHTML = `
      <a href="teacher.html" class="brand">
        <span class="brand-mark" aria-hidden="true">🦁</span>
        <span class="brand-text">
          <span class="brand-name">AISA</span>
          <span class="brand-sub" id="menu-page-label"></span>
        </span>
      </a>

      <div class="menu-links" id="menu-links" role="navigation"></div>

      <div class="topbar-meta">
        <span id="menu-page-actions" class="menu-page-actions"></span>
        <button id="checkouts-btn" class="checkouts-btn empty" type="button" hidden>
          <span class="checkouts-icon">🚪</span>
          <span>Out now</span>
          <span class="checkouts-count" id="checkouts-count">0</span>
        </button>
        <button id="flagged-btn" class="flagged-btn empty" type="button" hidden>
          <span class="flagged-icon">🚩</span>
          <span>Flagged</span>
          <span class="flagged-count" id="flagged-count">0</span>
        </button>
        <div id="account-slot"></div>
      </div>
    `;

    document.getElementById('menu-page-label').textContent = PAGE_LABELS[pageId] || 'AISA';

    const linksEl = document.getElementById('menu-links');
    for (const p of TEACHER_LINKS) {
      const a = document.createElement('a');
      a.href = p.href;
      a.className = 'menu-link' + (p.id === pageId ? ' is-current' : '');
      if (p.id === pageId) a.setAttribute('aria-current', 'page');
      a.innerHTML = `<span class="menu-link-icon" aria-hidden="true">${p.emoji}</span><span>${p.label}</span>`;
      linksEl.appendChild(a);
    }

    // Account avatar + dropdown are owned by account-menu.js, which fills
    // the #account-slot we rendered above.
  }

  function hideAll() {
    ['checkouts-btn', 'flagged-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  }

  // Page-specific actions can be appended into the menu without each page
  // needing its own topbar HTML. Returns the host span so the caller can
  // append buttons / anchors of any shape.
  window.menuPageActions = function () {
    return document.getElementById('menu-page-actions');
  };

  document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('nav.topbar');
    if (!nav) return;
    render(nav, nav.dataset.page || '');
  });

  document.addEventListener('aisa:signed-out', hideAll);
})();
