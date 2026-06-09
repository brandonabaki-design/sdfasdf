// menu.js — the teacher-area topbar, rendered from one source.
//
// Every teacher page (teacher.html, dashboard.html, student.html) has just
// <nav class="topbar" data-page="<id>"></nav> in its HTML. This module fills
// it with the brand, role-gated pills, and the account slot. Page-to-page
// navigation lives in the shared hamburger drawer (nav-drawer.js), so the
// menu is identical everywhere — this just supplies the teacher-only pills
// (Flagged, Out now) and the page label in the brand. The pill buttons are
// placeholders; the panel modules (checkouts-panel.js, flagged-panel.js)
// own their behavior and reveal them when their first fetch succeeds.

(function () {
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

    // The hamburger (nav-drawer.js) and account avatar (account-menu.js) inject
    // themselves into this topbar / the #account-slot once their scripts run.
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
