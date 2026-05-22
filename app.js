let currentUser = null;

function initGoogleSignIn() {
  const cfg = window.AISA_CONFIG;
  const statusEl = document.getElementById('status');

  if (!cfg.GOOGLE_CLIENT_ID || cfg.GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
    statusEl.textContent =
      'Setup incomplete: edit config.js with your Google OAuth client ID.';
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
    atob(padded)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(json);
}

function handleCredentialResponse(response) {
  const cfg = window.AISA_CONFIG;
  const claims = parseJwt(response.credential);

  if (claims.hd !== cfg.ALLOWED_HD) {
    document.getElementById('status').textContent =
      `Only ${cfg.ALLOWED_HD} accounts can use this site.`;
    return;
  }

  currentUser = {
    idToken: response.credential,
    email: claims.email,
    name: claims.name,
    sub: claims.sub,
  };

  document.getElementById('signin-container').hidden = true;
  document.getElementById('status').hidden = true;
  document.getElementById('signed-in').hidden = false;
  document.getElementById('user-name').textContent = claims.name || '';
  document.getElementById('user-email').textContent = claims.email || '';
}

async function logImHere() {
  const cfg = window.AISA_CONFIG;
  const btn = document.getElementById('im-here');
  const result = document.getElementById('result');

  if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID')) {
    result.textContent = 'Setup incomplete: set APPS_SCRIPT_URL in config.js.';
    return;
  }

  btn.disabled = true;
  result.textContent = 'Logging...';

  try {
    const res = await fetch(cfg.APPS_SCRIPT_URL, {
      method: 'POST',
      // text/plain keeps this a "simple" CORS request — no preflight needed.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'im_here',
        idToken: currentUser.idToken,
        clientTimestamp: new Date().toISOString(),
      }),
    });
    const data = await res.json();
    if (data.ok) {
      result.textContent = `Logged at ${new Date(data.timestamp).toLocaleTimeString()}.`;
    } else {
      result.textContent = `Error: ${data.error || 'unknown'}`;
    }
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function signOut() {
  google.accounts.id.disableAutoSelect();
  currentUser = null;
  document.getElementById('signed-in').hidden = true;
  document.getElementById('signin-container').hidden = false;
  document.getElementById('status').hidden = false;
  document.getElementById('status').textContent = 'Signed out. Sign in again to continue.';
  document.getElementById('result').textContent = '';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('im-here').addEventListener('click', logImHere);
  document.getElementById('sign-out').addEventListener('click', signOut);
});
