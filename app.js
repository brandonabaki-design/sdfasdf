// Student page logic. Auth + api() helpers live in auth.js.

let allResponses = [];

function showSignedIn(user) {
  document.getElementById('signin-container').hidden = true;
  document.getElementById('status').hidden = true;
  document.getElementById('signed-in').hidden = false;
  document.getElementById('user-name').textContent = user.name || '';
  document.getElementById('user-email').textContent = user.email || '';
  loadPrompts();
}

function showSignedOut() {
  document.getElementById('signed-in').hidden = true;
  document.getElementById('signin-container').hidden = false;
  document.getElementById('status').hidden = false;
  document.getElementById('status').textContent = 'Signed out. Sign in again to continue.';
  document.getElementById('result').textContent = '';
  document.getElementById('prompts-list').innerHTML = '';
  allResponses = [];
}

async function loadPrompts() {
  const list = document.getElementById('prompts-list');
  list.textContent = 'Loading prompts...';
  try {
    const [promptsData, responsesData] = await Promise.all([
      api('list_prompts'),
      api('list_my_responses'),
    ]);
    if (!promptsData.ok) {
      list.textContent = `Couldn't load prompts: ${promptsData.error}`;
      return;
    }
    allResponses = responsesData.ok ? responsesData.responses : [];

    if (promptsData.prompts.length === 0) {
      list.innerHTML = '<p class="muted">No active prompts yet. Check back later.</p>';
      return;
    }

    list.innerHTML = '';
    for (const p of promptsData.prompts) {
      list.appendChild(renderPromptCard(p));
    }
  } catch (err) {
    list.textContent = `Network error: ${err.message}`;
  }
}

function renderPromptCard(p) {
  const card = document.createElement('article');
  card.className = 'prompt-card';
  card.dataset.promptId = p.id;
  const created = new Date(p.created_at).toLocaleString();

  card.innerHTML = `
    <h3></h3>
    <p class="prompt-body"></p>
    <p class="muted small">from <span class="prompt-teacher"></span> · <span class="prompt-time"></span></p>

    <div class="responses"></div>

    <form class="response-form">
      <label>
        Your response
        <textarea rows="4" required placeholder="Type your response..."></textarea>
      </label>
      <button type="submit" class="primary">Submit response</button>
      <p class="result muted small" aria-live="polite"></p>
    </form>
  `;
  card.querySelector('h3').textContent = p.title || '(untitled)';
  card.querySelector('.prompt-body').textContent = p.body || '';
  card.querySelector('.prompt-teacher').textContent = p.teacher_email;
  card.querySelector('.prompt-time').textContent = created;

  renderResponsesInCard(card, p.id);
  card.querySelector('.response-form').addEventListener('submit', (e) => submitResponse(e, p.id, card));

  return card;
}

function renderResponsesInCard(card, promptId) {
  const container = card.querySelector('.responses');
  container.innerHTML = '';
  const mine = allResponses.filter(r => r.prompt_id === promptId);
  if (mine.length === 0) return;

  const header = document.createElement('p');
  header.className = 'muted small';
  header.textContent = mine.length === 1 ? 'Your response:' : `Your responses (${mine.length}):`;
  container.appendChild(header);

  for (const r of mine) {
    const bubble = document.createElement('div');
    bubble.className = 'response-bubble';
    bubble.innerHTML = `
      <p class="response-body"></p>
      <p class="muted small response-time"></p>
    `;
    bubble.querySelector('.response-body').textContent = r.body;
    bubble.querySelector('.response-time').textContent = new Date(r.created_at).toLocaleString();
    container.appendChild(bubble);

    if (r.ai_feedback) {
      const fb = document.createElement('div');
      fb.className = 'ai-feedback';
      fb.innerHTML = `
        <p class="ai-label small">AI feedback</p>
        <p class="ai-body"></p>
      `;
      fb.querySelector('.ai-body').textContent = r.ai_feedback;
      container.appendChild(fb);
    }
  }
}

async function submitResponse(event, promptId, card) {
  event.preventDefault();
  const form = event.target;
  const textarea = form.querySelector('textarea');
  const result = form.querySelector('.result');
  const button = form.querySelector('button[type="submit"]');

  const body = textarea.value.trim();
  if (!body) return;

  button.disabled = true;
  result.textContent = 'Submitting and getting AI feedback...';

  try {
    const data = await api('submit_response', { prompt_id: promptId, body });
    if (!data.ok) {
      result.textContent = `Error: ${data.error || 'unknown'}`;
      return;
    }
    allResponses.push(data.response);
    result.textContent = data.response.ai_feedback
      ? 'Submitted. AI feedback below.'
      : 'Submitted. (AI feedback unavailable — check GEMINI_API_KEY.)';
    textarea.value = '';
    renderResponsesInCard(card, promptId);
  } catch (err) {
    result.textContent = `Network error: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

async function logImHere() {
  const btn = document.getElementById('im-here');
  const result = document.getElementById('result');
  btn.disabled = true;
  result.textContent = 'Logging...';
  try {
    const data = await api('im_here', { clientTimestamp: new Date().toISOString() });
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('im-here').addEventListener('click', logImHere);
  document.getElementById('sign-out').addEventListener('click', signOut);
});

document.addEventListener('aisa:signed-in', (e) => showSignedIn(e.detail));
document.addEventListener('aisa:signed-out', showSignedOut);
