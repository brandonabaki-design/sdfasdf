// Shared Google sign-in + Apps Script API helper. Used by both index.html and teacher.html.

let currentUser = null;

function initGoogleSignIn() {
  const cfg = window.AISA_CONFIG;
  const statusEl = document.getElementById('status');

  if (!cfg.GOOGLE_CLIENT_ID || cfg.GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
    if (statusEl) statusEl.textContent = 'Setup incomplete: edit config.js with your Google OAuth client ID.';
    return;
  }

  google.accounts.id.initialize({
    client_id: cfg.GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
    hd: cfg.ALLOWED_HD,
    ux_mode: 'popup',
    auto_select: false,
  });

  google.accounts.id.renderButton(
    document.getElementById('g-signin-button'),
    { type: 'standard', size: 'large', theme: 'outline', text: 'signin_with', shape: 'rectangular' }
  );
}

function parseJwt(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '==='.slice((base64.length + 3) % 4);
  const json = decodeURIComponent(
    atob(padded).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
  );
  return JSON.parse(json);
}

function handleCredentialResponse(response) {
  const cfg = window.AISA_CONFIG;
  const claims = parseJwt(response.credential);

  if (claims.hd !== cfg.ALLOWED_HD) {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = `Only ${cfg.ALLOWED_HD} accounts can use this site.`;
    return;
  }

  currentUser = {
    idToken: response.credential,
    email: claims.email,
    name: claims.name,
    sub: claims.sub,
  };

  document.dispatchEvent(new CustomEvent('aisa:signed-in', { detail: currentUser }));
}

function signOut() {
  google.accounts.id.disableAutoSelect();
  currentUser = null;
  document.dispatchEvent(new CustomEvent('aisa:signed-out'));
}

async function api(action, payload) {
  const cfg = window.AISA_CONFIG;
  if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID')) {
    throw new Error('APPS_SCRIPT_URL not set in config.js');
  }
  if (!currentUser) throw new Error('not signed in');
  const res = await fetch(cfg.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, idToken: currentUser.idToken, ...(payload || {}) }),
  });
  return res.json();
}
