// nav-drawer.js — the universal hamburger menu, shared by every page.
//
// Drops a hamburger button into the left of any <nav class="topbar"> and a
// slide-in drawer onto the body. The drawer is role-aware: the "Teaching"
// section (Teacher Studio, Dashboard) only appears for accounts that
// whoami reports as teachers, so the old always-visible footer "Teacher
// view" link is gone — students never see it, teachers reach it from the
// same menu on every page.
//
// It listens to the shared auth events:
//   aisa:signed-in  -> reveal the burger + fill identity
//   aisa:role       -> reveal the Teaching section for teachers
//   aisa:signed-out -> hide everything and reset
//
// Include order matters: load this AFTER menu.js so the teacher topbar has
// already been rendered before we prepend the burger.

(function () {
  // Primary navigation. `match` is the filename used to highlight the
  // current page; '' covers the site root (index.html served as "/").
  const LEARNING = [
    { href: 'index.html',    match: ['index.html', ''], icon: '🏠', label: 'Home',        desc: "Your hub & today's work" },
    { href: 'progress.html', match: ['progress.html'],  icon: '📊', label: 'My Progress', desc: 'Streak, badges & feedback' },
  ];
  const TEACHING = [
    { href: 'teacher.html',   match: ['teacher.html'],   icon: '✍️', label: 'Teacher Studio', desc: 'Create prompts & review work' },
    { href: 'dashboard.html', match: ['dashboard.html'], icon: '📋', label: 'Dashboard',      desc: 'Class data & CSV exports' },
    { href: 'student.html',   match: ['student.html'],   icon: '🎒', label: 'Student Profiles', desc: 'Open from the Dashboard', disabled: true },
  ];

  let lastFocused = null;

  function currentFile() {
    const path = location.pathname.split('/').pop() || '';
    return path;
  }

  function isCurrent(item) {
    const file = currentFile();
    return item.match.indexOf(file) !== -1;
  }

  function initials(name, email) {
    const src = (name || email || '').trim();
    if (!src) return '··';
    return src.split(/[\s@.]+/).filter(Boolean).slice(0, 2)
      .map(p => p[0].toUpperCase()).join('') || '··';
  }

  function navItemHtml(item) {
    const current = isCurrent(item);
    if (item.disabled) {
      // Non-navigable hint row (e.g. Student Profiles, which is opened from a
      // dashboard row, not a static link).
      return `
        <span class="nav-drawer-link is-disabled">
          <span class="nav-drawer-link-icon" aria-hidden="true">${item.icon}</span>
          <span class="nav-drawer-link-text">
            <span class="nav-drawer-link-label">${item.label}</span>
            <span class="nav-drawer-link-desc">${item.desc}</span>
          </span>
        </span>`;
    }
    return `
      <a href="${item.href}" class="nav-drawer-link${current ? ' is-current' : ''}"${current ? ' aria-current="page"' : ''}>
        <span class="nav-drawer-link-icon" aria-hidden="true">${item.icon}</span>
        <span class="nav-drawer-link-text">
          <span class="nav-drawer-link-label">${item.label}</span>
          <span class="nav-drawer-link-desc">${item.desc}</span>
        </span>
        ${current ? '<span class="nav-drawer-link-dot" aria-hidden="true"></span>' : ''}
      </a>`;
  }

  function buildBurger() {
    const topbar = document.querySelector('nav.topbar');
    if (!topbar || document.getElementById('nav-burger')) return;
    const burger = document.createElement('button');
    burger.id = 'nav-burger';
    burger.className = 'nav-burger';
    burger.type = 'button';
    burger.hidden = true;
    burger.setAttribute('aria-label', 'Open menu');
    burger.setAttribute('aria-controls', 'nav-drawer');
    burger.setAttribute('aria-expanded', 'false');
    burger.innerHTML = '<span class="nav-burger-box"><span class="nav-burger-inner"></span></span>';
    burger.addEventListener('click', open);
    topbar.insertBefore(burger, topbar.firstChild);
  }

  function buildDrawer() {
    if (document.getElementById('nav-drawer')) return;
    const frag = document.createElement('div');
    frag.innerHTML = `
      <div class="nav-drawer-backdrop" id="nav-drawer-backdrop"></div>
      <aside class="nav-drawer" id="nav-drawer" aria-hidden="true" aria-label="Main menu" role="dialog" aria-modal="true">
        <header class="nav-drawer-head">
          <span class="nav-drawer-brand">
            <span class="brand-mark" aria-hidden="true">🦁</span>
            <span class="nav-drawer-brand-text">
              <span class="nav-drawer-brand-name">AISA</span>
              <span class="nav-drawer-brand-sub">Student Hub</span>
            </span>
          </span>
          <button class="nav-drawer-close" id="nav-drawer-close" type="button" aria-label="Close menu">×</button>
        </header>

        <div class="nav-drawer-identity" id="nav-drawer-identity" hidden>
          <span class="nav-drawer-avatar" id="nav-drawer-avatar" aria-hidden="true">··</span>
          <span class="nav-drawer-identity-text">
            <span class="nav-drawer-name" id="nav-drawer-name"></span>
            <span class="nav-drawer-email" id="nav-drawer-email"></span>
          </span>
        </div>

        <nav class="nav-drawer-nav" aria-label="Pages">
          <p class="nav-drawer-section-label">Learning</p>
          <div class="nav-drawer-group">${LEARNING.map(navItemHtml).join('')}</div>

          <div class="nav-drawer-teaching" id="nav-drawer-teaching" hidden>
            <p class="nav-drawer-section-label">
              Teaching
              <span class="nav-drawer-teacher-badge">Staff</span>
            </p>
            <div class="nav-drawer-group">${TEACHING.map(navItemHtml).join('')}</div>
          </div>
        </nav>

        <div class="nav-drawer-foot">
          <button class="nav-drawer-signout" id="nav-drawer-signout" type="button">
            <span class="nav-drawer-signout-icon" aria-hidden="true">↪</span>
            <span>Sign out</span>
          </button>
          <p class="nav-drawer-footnote">American International School of Abu Dhabi</p>
        </div>
      </aside>
    `;
    while (frag.firstChild) document.body.appendChild(frag.firstChild);

    document.getElementById('nav-drawer-close').addEventListener('click', close);
    document.getElementById('nav-drawer-backdrop').addEventListener('click', close);
    document.getElementById('nav-drawer-signout').addEventListener('click', () => {
      close();
      if (typeof signOut === 'function') signOut();
    });
    document.addEventListener('keydown', onKeydown);
  }

  function onKeydown(e) {
    const drawer = document.getElementById('nav-drawer');
    if (!drawer || !drawer.classList.contains('open')) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') trapFocus(e, drawer);
  }

  // Keep keyboard focus inside the drawer while it's open.
  function trapFocus(e, drawer) {
    const focusable = drawer.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function open() {
    const drawer = document.getElementById('nav-drawer');
    const backdrop = document.getElementById('nav-drawer-backdrop');
    const burger = document.getElementById('nav-burger');
    if (!drawer || !backdrop) return;
    lastFocused = document.activeElement;
    backdrop.classList.add('open');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (burger) burger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('nav-drawer-locked');
    // Focus the first actionable element for keyboard + screen-reader users.
    const firstLink = drawer.querySelector('.nav-drawer-link, .nav-drawer-close');
    if (firstLink) setTimeout(() => firstLink.focus(), 60);
  }

  function close() {
    const drawer = document.getElementById('nav-drawer');
    const backdrop = document.getElementById('nav-drawer-backdrop');
    const burger = document.getElementById('nav-burger');
    if (!drawer || !backdrop) return;
    backdrop.classList.remove('open');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (burger) burger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-drawer-locked');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  function revealForUser(user) {
    const burger = document.getElementById('nav-burger');
    if (burger) burger.hidden = false;
    const identity = document.getElementById('nav-drawer-identity');
    const avatar = document.getElementById('nav-drawer-avatar');
    const name = document.getElementById('nav-drawer-name');
    const email = document.getElementById('nav-drawer-email');
    if (identity) identity.hidden = false;
    if (avatar) avatar.textContent = initials(user && user.name, user && user.email);
    if (name) name.textContent = (user && user.name) || '(no name)';
    if (email) email.textContent = (user && user.email) || '';
  }

  function applyRole(role) {
    const teaching = document.getElementById('nav-drawer-teaching');
    if (teaching) teaching.hidden = !(role && role.is_teacher);
  }

  function reset() {
    close();
    const burger = document.getElementById('nav-burger');
    if (burger) burger.hidden = true;
    const identity = document.getElementById('nav-drawer-identity');
    if (identity) identity.hidden = true;
    const teaching = document.getElementById('nav-drawer-teaching');
    if (teaching) teaching.hidden = true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildBurger();
    buildDrawer();
    // If the user signed in (cached token) before this module finished wiring
    // up, catch up using the globals auth.js exposes.
    if (typeof currentUser !== 'undefined' && currentUser) revealForUser(currentUser);
    if (typeof lastRole !== 'undefined' && lastRole) applyRole(lastRole);
  });

  document.addEventListener('aisa:signed-in', (e) => revealForUser(e.detail));
  document.addEventListener('aisa:role', (e) => applyRole(e.detail));
  document.addEventListener('aisa:signed-out', reset);
})();
