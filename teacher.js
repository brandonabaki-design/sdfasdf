// Teacher page logic. Auth + api() helpers live in auth.js.

async function showSignedIn(user) {
  document.getElementById('signin-container').hidden = true;
  document.getElementById('status').hidden = true;
  document.getElementById('signed-in').hidden = false;
  document.getElementById('user-name').textContent = user.name || '';
  document.getElementById('user-email').textContent = user.email || '';

  const roleLoading = document.getElementById('role-loading');
  const notTeacher = document.getElementById('not-teacher');
  const tools = document.getElementById('teacher-tools');

  try {
    const me = await api('whoami');
    roleLoading.hidden = true;
    if (me.ok && me.is_teacher) {
      tools.hidden = false;
      loadPrompts();
    } else {
      notTeacher.hidden = false;
    }
  } catch (err) {
    roleLoading.textContent = `Couldn't check access: ${err.message}`;
  }
}

function showSignedOut() {
  document.getElementById('signed-in').hidden = true;
  document.getElementById('signin-container').hidden = false;
  document.getElementById('status').hidden = false;
  document.getElementById('status').textContent = 'Signed out. Sign in again to continue.';
  document.getElementById('teacher-tools').hidden = true;
  document.getElementById('not-teacher').hidden = true;
  document.getElementById('role-loading').hidden = false;
  document.getElementById('role-loading').textContent = 'Checking access...';
}

async function loadPrompts() {
  const list = document.getElementById('prompts-list');
  list.textContent = 'Loading prompts...';
  try {
    const data = await api('list_prompts');
    if (!data.ok) {
      list.textContent = `Couldn't load prompts: ${data.error}`;
      return;
    }
    if (data.prompts.length === 0) {
      list.innerHTML = '<p class="muted">No active prompts yet.</p>';
      return;
    }
    list.innerHTML = '';
    for (const p of data.prompts) {
      const card = document.createElement('article');
      card.className = 'prompt-card';
      const created = new Date(p.created_at).toLocaleString();
      card.innerHTML = `
        <h3></h3>
        <p class="prompt-body"></p>
        <p class="muted small">from <span class="prompt-teacher"></span> · <span class="prompt-time"></span></p>
      `;
      card.querySelector('h3').textContent = p.title || '(untitled)';
      card.querySelector('.prompt-body').textContent = p.body || '';
      card.querySelector('.prompt-teacher').textContent = p.teacher_email;
      card.querySelector('.prompt-time').textContent = created;
      list.appendChild(card);
    }
  } catch (err) {
    list.textContent = `Network error: ${err.message}`;
  }
}

async function submitPrompt(event) {
  event.preventDefault();
  const titleEl = document.getElementById('prompt-title');
  const bodyEl = document.getElementById('prompt-body');
  const result = document.getElementById('result');
  const submitBtn = event.target.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  result.textContent = 'Publishing...';

  try {
    const data = await api('create_prompt', {
      title: titleEl.value.trim(),
      body: bodyEl.value.trim(),
    });
    if (data.ok) {
      result.textContent = 'Published.';
      titleEl.value = '';
      bodyEl.value = '';
      loadPrompts();
    } else {
      result.textContent = `Error: ${data.error || 'unknown'}`;
    }
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('prompt-form').addEventListener('submit', submitPrompt);
  document.getElementById('sign-out').addEventListener('click', signOut);
});

document.addEventListener('aisa:signed-in', (e) => showSignedIn(e.detail));
document.addEventListener('aisa:signed-out', showSignedOut);
