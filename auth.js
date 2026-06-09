// Shared Google sign-in + Apps Script API helper. Used by every page.
//
// Session model
// -------------
// The server validates every request via Google's tokeninfo endpoint, so the
// security boundary is unchanged. What this file does on the client side is
// reduce how often the user has to interactively re-sign-in:
//
//  1. After a successful Google sign-in, the verified ID token is cached in
//     localStorage (keyed per client). On a fresh page load we read the cache
//     and only fall through to interactive sign-in if the cached token is
//     missing, expired, or for a different Workspace domain.
//  2. With auto_select: true, Google's One Tap can silently re-issue a token
//     when the user is still signed into Google in this browser. A timer
//     fires this ~5 minutes before the current token expires.
//  3. If any API call comes back with "invalid idToken" we clear the cache,
//     drop the user back to the sign-in screen, and let them re-auth.
//
// localStorage trades a small risk (a token stolen via XSS could be replayed
// until expiry) for a much better UX. Our render code uses textContent for
// every user-supplied string so the XSS surface is effectively zero.

let currentUser = null;
let refreshTimer = null;

const TOKEN_STORAGE_KEY = 'aisa.idtoken.v1';

function tokenStorageKey() {
  const cfg = window.AISA_CONFIG || {};
  return TOKEN_STORAGE_KEY + ':' + (cfg.GOOGLE_CLIENT_ID || 'unknown');
}

function loadStoredToken() {
  try {
    const raw = localStorage.getItem(tokenStorageKey());
    if (!raw) return null;
    const claims = parseJwt(raw);
    // Treat tokens within 60s of expiry as already gone — they'd fail the next call.
    const expMs = Number(claims.exp || 0) * 1000;
    if (!expMs || expMs < Date.now() + 60_000) {
      localStorage.removeItem(tokenStorageKey());
      return null;
    }
    return { token: raw, claims };
  } catch (err) {
    try { localStorage.removeItem(tokenStorageKey()); } catch (_) {}
    return null;
  }
}

function storeToken(token) {
  try { localStorage.setItem(tokenStorageKey(), token); } catch (err) { /* private mode */ }
}

function clearStoredToken() {
  try { localStorage.removeItem(tokenStorageKey()); } catch (_) {}
}

function scheduleSilentRefresh(claims) {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  const expMs = Number(claims.exp || 0) * 1000;
  if (!expMs) return;
  // Refresh 5 minutes before expiry, but not in less than 30 seconds.
  const delay = Math.max(30_000, expMs - Date.now() - 5 * 60_000);
  refreshTimer = setTimeout(() => {
    if (window.google && google.accounts && google.accounts.id) {
      try {
        google.accounts.id.prompt(); // silently re-issues if user is in Google
      } catch (err) { /* swallow */ }
    }
  }, delay);
}

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
    auto_select: true,
  });

  // 1. Try the cached token first — covers refreshes, tab restores, return visits.
  const stored = loadStoredToken();
  if (stored && stored.claims.hd === cfg.ALLOWED_HD) {
    currentUser = {
      idToken: stored.token,
      email: stored.claims.email,
      name: stored.claims.name,
      sub: stored.claims.sub,
    };
    document.body.classList.add('is-signed-in');
    document.dispatchEvent(new CustomEvent('aisa:signed-in', { detail: currentUser }));
    scheduleSilentRefresh(stored.claims);
    // Quietly try One Tap so we can refresh in the background if Google is happy to.
    try { google.accounts.id.prompt(); } catch (_) {}
    return;
  }

  // 2. No cached token — render the button and try One Tap.
  google.accounts.id.renderButton(
    document.getElementById('g-signin-button'),
    { type: 'standard', size: 'large', theme: 'filled_black', text: 'signin_with', shape: 'pill', logo_alignment: 'left' }
  );
  try { google.accounts.id.prompt(); } catch (_) {}
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

  storeToken(response.credential);
  scheduleSilentRefresh(claims);

  document.body.classList.add('is-signed-in');
  document.dispatchEvent(new CustomEvent('aisa:signed-in', { detail: currentUser }));
}

function signOut() {
  try { google.accounts.id.disableAutoSelect(); } catch (_) {}
  currentUser = null;
  clearStoredToken();
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  document.body.classList.remove('is-signed-in');
  document.dispatchEvent(new CustomEvent('aisa:signed-out'));
}

// If the backend rejects our token (expired between cache and call, revoked,
// etc.), drop the user back to the sign-in screen so they can re-auth.
function handleAuthFailure() {
  clearStoredToken();
  currentUser = null;
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  document.body.classList.remove('is-signed-in');
  document.dispatchEvent(new CustomEvent('aisa:signed-out'));
}

// Friendly-up backend error strings. Don't show raw "not a teacher" /
// "invalid idToken" etc — translate into something a student or teacher
// can act on.
function friendlyError(raw) {
  const e = String(raw || '').toLowerCase();
  if (!e) return 'Something went wrong. Try again in a moment.';
  if (e.includes('not a teacher')) return "You don't have teacher access on this account.";
  if (e.includes('invalid idtoken') || e.includes('missing idtoken') || e.includes('not signed in')) {
    return 'Your session has ended — please sign in again.';
  }
  if (e.includes('wrong domain')) return 'Only aisa.sch.ae accounts can use this site.';
  if (e.includes('prompt not found')) return "That prompt couldn't be found.";
  if (e.includes('not your prompt') || e.includes('not your draft')) {
    return "You can only edit prompts and drafts that belong to you.";
  }
  if (e.includes('this prompt has closed')) return 'The deadline for this prompt has passed.';
  if (e.includes('prompt is not active')) return "This prompt isn't accepting responses right now.";
  if (e.includes('response is empty')) return 'Please write a response before submitting.';
  if (e.includes('invalid option')) return 'Please pick one of the options.';
  if (e.includes('invalid rating')) return 'Please pick a rating value.';
  if (e.includes('at least 2 options')) return 'Add at least two options.';
  if (e.includes('at most 8 options')) return 'A prompt can have at most 8 options.';
  if (e.includes('recipient_email required')) return "Enter the teacher's email address.";
  if (e.includes('recipient must be')) return 'The recipient must be an aisa.sch.ae teacher.';
  if (e.includes('recipient is not')) return 'That teacher is not on the allow-list.';
  if (e.includes('already checked out')) return "You're already checked out. Please check back in first.";
  if (e.includes('teacher_email required')) return "Pick a teacher to notify.";
  if (e.includes('destination required')) return 'Pick where you are going.';
  if (e.includes('gemini')) return "Our AI helper couldn't reply just now. Your work was saved.";
  if (e.includes('network')) return "We couldn't reach the server. Check your internet and try again.";
  if (e.includes('topic required')) return 'Enter a topic for the AI to draft.';
  // Fallback — keep it short and human.
  return 'Something went wrong. Please try again.';
}

// Live region announcer for transient status changes (saved, submitted, etc).
// Creates a single hidden element shared across the page.
function announce(message) {
  let region = document.getElementById('aria-live-announcer');
  if (!region) {
    region = document.createElement('div');
    region.id = 'aria-live-announcer';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.className = 'sr-only';
    document.body.appendChild(region);
  }
  region.textContent = '';
  // Defer so screen readers register the change.
  setTimeout(() => { region.textContent = message; }, 50);
}

// Focus management for modal/panel dialogs. Saves the element that opened the
// modal, focuses the first interactive element inside, and on close restores
// focus to the opener.
let _lastModalOpener = null;
function modalOpen(panelEl, firstFocusableSelector) {
  _lastModalOpener = document.activeElement;
  if (firstFocusableSelector) {
    setTimeout(() => {
      const target = panelEl.querySelector(firstFocusableSelector);
      if (target) target.focus();
    }, 60);
  }
}
function modalClose() {
  if (_lastModalOpener && typeof _lastModalOpener.focus === 'function') {
    try { _lastModalOpener.focus(); } catch (_) {}
  }
  _lastModalOpener = null;
}

// Natural-language timestamp for student-friendly display. Returns short
// strings like "Just now", "12 min ago", "Today at 2:15 PM", "Yesterday at
// 9:30 AM", "Tuesday at 11 AM", "Mar 14".
function friendlyTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMin = Math.round((now - d) / 60000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return diffMin + ' min ago';

  const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'Today at ' + timeStr;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday at ' + timeStr;

  const diffDays = Math.floor((now - d) / (24 * 60 * 60 * 1000));
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'long' }) + ' at ' + timeStr;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
  const data = await res.json();
  if (!data.ok && (data.error === 'invalid idToken' || data.error === 'missing idToken')) {
    handleAuthFailure();
  }
  return data;
}

/* ============================================================
   Student profile prefetch cache
   ------------------------------------------------------------
   The dashboard fires this on row hover; student.html consumes it on load
   so the click feels instant. sessionStorage survives the full navigation
   from dashboard -> student profile within the same tab.
   ============================================================ */

const PROFILE_CACHE_PREFIX = 'aisa.profile.v1:';
const PROFILE_CACHE_TTL_MS = 90_000;
const _profilePrefetchInFlight = new Map();

function studentProfileCacheKey(sub, email) {
  return PROFILE_CACHE_PREFIX + (sub || '') + ':' + String(email || '').toLowerCase();
}

function getCachedStudentProfile(sub, email) {
  try {
    const raw = sessionStorage.getItem(studentProfileCacheKey(sub, email));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.t || Date.now() - entry.t > PROFILE_CACHE_TTL_MS) {
      sessionStorage.removeItem(studentProfileCacheKey(sub, email));
      return null;
    }
    return entry.p;
  } catch (_) {
    return null;
  }
}

function putCachedStudentProfile(sub, email, profile) {
  try {
    sessionStorage.setItem(
      studentProfileCacheKey(sub, email),
      JSON.stringify({ t: Date.now(), p: profile })
    );
  } catch (_) { /* quota — silent */ }
}

function clearCachedStudentProfile(sub, email) {
  try { sessionStorage.removeItem(studentProfileCacheKey(sub, email)); } catch (_) {}
}

// Fire-and-forget prefetch. Safe to call repeatedly: it dedupes in-flight
// requests and skips when a fresh cache entry already exists.
function prefetchStudentProfile(sub, email) {
  if (!sub && !email) return;
  if (!currentUser) return;
  if (getCachedStudentProfile(sub, email)) return;
  const key = studentProfileCacheKey(sub, email);
  if (_profilePrefetchInFlight.has(key)) return;
  const p = api('get_student_profile', { google_sub: sub || '', student_email: email || '' })
    .then(data => {
      if (data && data.ok && data.profile) putCachedStudentProfile(sub, email, data.profile);
    })
    .catch(() => { /* silent — the real load will surface any error */ })
    .finally(() => { _profilePrefetchInFlight.delete(key); });
  _profilePrefetchInFlight.set(key, p);
}
