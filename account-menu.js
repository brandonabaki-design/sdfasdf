// account-menu.js — circular avatar button + popover, used by both the
// teacher topbar (rendered by menu.js) and the student pages.
//
// Usage: drop <div id="account-slot"></div> into your topbar. This module
// fills it on DOMContentLoaded and listens for aisa:signed-in/out to
// reveal/hide itself and populate the initials, name, and email.

(function () {
  function initialsFrom(name, email) {
    const src = (name || email || '').trim();
    if (!src) return '··';
    return src.split(/[\s@.]+/).filter(Boolean).slice(0, 2)
      .map(p => p[0].toUpperCase()).join('') || '··';
  }

  function render() {
    const slot = document.getElementById('account-slot');
    if (!slot) return;
    if (slot.querySelector('.account-btn')) return;
    slot.innerHTML = `
      <div class="account-wrap">
        <button id="account-btn" class="account-btn" type="button"
                aria-haspopup="menu" aria-expanded="false" aria-label="Account" hidden>
          <span class="account-avatar" id="account-initials" aria-hidden="true">··</span>
        </button>
        <div id="account-menu" class="account-menu" role="menu" hidden>
          <div class="account-menu-info">
            <p class="account-menu-name" id="account-menu-name"></p>
            <p class="account-menu-email" id="account-menu-email"></p>
          </div>
          <div class="account-menu-divider" role="separator"></div>
          <button class="account-menu-item" id="sign-out" type="button" role="menuitem">
            <span class="account-menu-icon" aria-hidden="true">↪</span>
            <span>Sign out</span>
          </button>
        </div>
      </div>
    `;
    document.getElementById('account-btn').addEventListener('click', toggle);
    document.getElementById('sign-out').addEventListener('click', signOut);
    document.addEventListener('click', (e) => {
      const wrap = slot.querySelector('.account-wrap');
      if (wrap && !wrap.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  function toggle() {
    const menu = document.getElementById('account-menu');
    if (!menu) return;
    if (menu.hidden) open(); else close();
  }
  function open() {
    const menu = document.getElementById('account-menu');
    const btn = document.getElementById('account-btn');
    if (!menu || !btn) return;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }
  function close() {
    const menu = document.getElementById('account-menu');
    const btn = document.getElementById('account-btn');
    if (!menu || !btn) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  function reveal(user) {
    const btn = document.getElementById('account-btn');
    const initialsEl = document.getElementById('account-initials');
    const nameEl = document.getElementById('account-menu-name');
    const emailEl = document.getElementById('account-menu-email');
    if (btn) {
      btn.hidden = false;
      btn.setAttribute('aria-label', `Account — ${user.name || user.email || ''}`);
    }
    if (initialsEl) initialsEl.textContent = initialsFrom(user.name, user.email);
    if (nameEl) nameEl.textContent = user.name || '(no name)';
    if (emailEl) emailEl.textContent = user.email || '';
  }

  function hideAll() {
    close();
    const btn = document.getElementById('account-btn');
    if (btn) btn.hidden = true;
  }

  document.addEventListener('DOMContentLoaded', render);
  document.addEventListener('aisa:signed-in', (e) => reveal(e.detail));
  document.addEventListener('aisa:signed-out', hideAll);
})();
