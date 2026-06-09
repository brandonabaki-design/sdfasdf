// flagged-panel.js — the "Flagged" pill + slide-in panel with Open/Resolved
// tabs and the inline resolution-report form.
//
// Same pattern as checkouts-panel: injects its own DOM on load, fetches on
// sign-in, reveals the pill on first success. Non-teachers get a silent
// "not a teacher" and the pill stays hidden, so the module is safe on every
// page.

(function () {
  // Flags older than this (in hours) get an "awaiting follow-up" treatment.
  const FLAG_FOLLOWUP_HOURS = 12;

  let allItems = [];
  let currentView = 'open';
  let resolutionOptionsCache = null;

  function injectPanel() {
    if (document.getElementById('flagged-panel')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="flagged-backdrop" class="flagged-backdrop"></div>
      <aside id="flagged-panel" class="flagged-panel" aria-hidden="true">
        <header class="flagged-panel-header">
          <div>
            <h2 class="font-heading">
              <span class="panel-icon" aria-hidden="true">🚩</span>
              Flagged Responses
            </h2>
            <p class="panel-sub" id="flagged-panel-sub">No items currently flagged.</p>
          </div>
          <button class="flagged-close" id="flagged-close" aria-label="Close flagged panel">×</button>
        </header>
        <div class="flagged-tabs" role="tablist" aria-label="Flagged view">
          <button type="button" class="flagged-tab is-active" data-flagged-view="open"
                  role="tab" aria-selected="true" id="flagged-tab-open">
            <span>Open</span>
            <span class="flagged-tab-count" id="flagged-tab-count-open">0</span>
          </button>
          <button type="button" class="flagged-tab" data-flagged-view="resolved"
                  role="tab" aria-selected="false" id="flagged-tab-resolved">
            <span>Resolved</span>
            <span class="flagged-tab-count" id="flagged-tab-count-resolved">0</span>
          </button>
        </div>
        <div class="flagged-list" id="flagged-list">
          <div class="flagged-empty">
            <span class="empty-icon" aria-hidden="true">✅</span>
            <h3 class="font-heading">All clear</h3>
            <p>No student responses have been flagged for review.</p>
          </div>
        </div>
      </aside>
    `;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  function isFlagOverdue(item) {
    if (!item || !item.created_at) return false;
    const ageMs = Date.now() - new Date(item.created_at).getTime();
    return ageMs > FLAG_FOLLOWUP_HOURS * 60 * 60 * 1000;
  }

  function updateButton(open) {
    const btn = document.getElementById('flagged-btn');
    const count = document.getElementById('flagged-count');
    if (!btn || !count) return;
    btn.hidden = false;
    count.textContent = String(open.length);
    btn.classList.toggle('empty', open.length === 0);
    const overdueCount = open.filter(isFlagOverdue).length;
    btn.classList.toggle('has-overdue', overdueCount > 0);
    btn.setAttribute('aria-label',
      open.length === 0 ? 'No flagged items' :
      overdueCount > 0 ? `${open.length} flagged, ${overdueCount} awaiting follow-up` :
      `${open.length} flagged items`);
  }

  function updateTabCounts(openCount, resolvedCount) {
    const o = document.getElementById('flagged-tab-count-open');
    const r = document.getElementById('flagged-tab-count-resolved');
    if (o) o.textContent = String(openCount);
    if (r) r.textContent = String(resolvedCount);
  }

  function switchView(view) {
    if (view !== 'open' && view !== 'resolved') return;
    currentView = view;
    document.querySelectorAll('.flagged-tab').forEach(tab => {
      const active = tab.dataset.flaggedView === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const filtered = allItems.filter(r => view === 'resolved' ? r.resolved : !r.resolved);
    populatePanel(filtered);
  }

  function populatePanel(responses) {
    const list = document.getElementById('flagged-list');
    const sub = document.getElementById('flagged-panel-sub');
    if (!list || !sub) return;
    const view = currentView;
    if (responses.length === 0) {
      if (view === 'resolved') {
        sub.textContent = 'No flags resolved yet.';
        list.innerHTML = `
          <div class="flagged-empty">
            <span class="empty-icon" aria-hidden="true">🗂️</span>
            <h3 class="font-heading">Nothing here yet</h3>
            <p>Once you resolve a flag, the report shows up here.</p>
          </div>
        `;
      } else {
        sub.textContent = 'No items currently flagged.';
        list.innerHTML = `
          <div class="flagged-empty">
            <span class="empty-icon" aria-hidden="true">✅</span>
            <h3 class="font-heading">All clear</h3>
            <p>No student responses have been flagged for review.</p>
          </div>
        `;
      }
      return;
    }
    if (view === 'resolved') {
      const sorted = responses.slice().sort((a, b) => {
        const ar = a.resolution && a.resolution.resolved_at ? a.resolution.resolved_at : a.created_at;
        const br = b.resolution && b.resolution.resolved_at ? b.resolution.resolved_at : b.created_at;
        return ar < br ? 1 : -1;
      });
      sub.textContent = `${sorted.length} resolved flag${sorted.length === 1 ? '' : 's'} · most recent first.`;
      list.innerHTML = '';
      for (const r of sorted) list.appendChild(renderResolvedItem(r));
      return;
    }
    const overdueCount = responses.filter(isFlagOverdue).length;
    sub.textContent = overdueCount > 0
      ? `${overdueCount} of ${responses.length} awaiting follow-up · oldest first.`
      : `${responses.length} item${responses.length === 1 ? '' : 's'} need${responses.length === 1 ? 's' : ''} your attention.`;
    list.innerHTML = '';
    for (const r of responses) list.appendChild(renderOpenItem(r));
  }

  function sourceMeta(source) {
    const map = {
      response: { label: 'Prompt response', emoji: '📝', tone: 'tone-rose' },
      note: { label: 'Private note', emoji: '📓', tone: 'tone-amber' },
      study_chat: { label: 'AI Study Buddy', emoji: '🤖', tone: 'tone-violet' },
    };
    return map[String(source || '').toLowerCase()] || { label: 'Interaction', emoji: '⚠️', tone: 'tone-rose' };
  }

  function contextHtmlFor(source, r) {
    if (source === 'response' && r.prompt_title) {
      return `<p class="prompt-context">On prompt: <strong></strong></p>`;
    }
    if (source === 'note') {
      return `<p class="prompt-context">A passage from this student's private notebook.</p>`;
    }
    if (source === 'study_chat') {
      return `<p class="prompt-context">From their chat with the AI Study Buddy.</p>`;
    }
    return '';
  }

  function initials(r) {
    return (r.student_name || r.student_email || '?')
      .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
  }

  function renderOpenItem(r) {
    const item = document.createElement('article');
    const overdue = isFlagOverdue(r);
    item.className = 'flagged-item' + (overdue ? ' is-overdue' : '');
    item.dataset.id = r.id;
    const source = String(r.source || 'response').toLowerCase();
    const meta = sourceMeta(source);
    item.innerHTML = `
      ${overdue ? '<p class="flagged-overdue-banner">⏰ Awaiting follow-up — flagged ' + friendlyTime(r.created_at) + '</p>' : ''}
      <div class="flagged-item-head">
        <span class="flagged-avatar"></span>
        <div class="student-line">
          <p class="student-name"></p>
          <p class="student-email"></p>
        </div>
        <span class="flagged-source-pill ${meta.tone}">
          <span aria-hidden="true">${meta.emoji}</span>
          <span>${meta.label}</span>
        </span>
      </div>
      ${contextHtmlFor(source, r)}
      <p class="response-body"></p>
      ${r.context ? '<p class="prompt-context"><strong>Nearby context:</strong> <span class="nearby-context"></span></p>' : ''}
      <div class="flag-reason">
        <span class="reason-label">Why:</span>
        <span class="reason-text"></span>
      </div>
      <div class="flagged-item-footer">
        <span class="submission-time"></span>
        <button type="button" class="btn-success resolve-btn">Resolve…</button>
      </div>
      <div class="resolve-form" hidden>
        <p class="resolve-form-title">Resolution report</p>
        <label class="resolve-field">
          <span class="resolve-field-label">Action taken<span class="required">*</span></span>
          <select class="resolve-action" required>
            <option value="">— pick one —</option>
          </select>
        </label>
        <label class="resolve-field">
          <span class="resolve-field-label">Severity<span class="required">*</span></span>
          <select class="resolve-severity" required>
            <option value="">— pick one —</option>
          </select>
        </label>
        <label class="resolve-field">
          <span class="resolve-field-label">Follow-up<span class="required">*</span></span>
          <select class="resolve-followup" required>
            <option value="">— pick one —</option>
          </select>
        </label>
        <label class="resolve-field">
          <span class="resolve-field-label">Notes <span class="resolve-field-hint">(optional · 500 chars max)</span></span>
          <textarea class="resolve-notes" rows="3" maxlength="500" placeholder="What happened, who you spoke to, anything important the next teacher should know."></textarea>
        </label>
        <p class="resolve-error muted small" aria-live="polite"></p>
        <div class="resolve-actions">
          <button type="button" class="btn btn-ghost cancel-resolve">Cancel</button>
          <button type="button" class="btn-success submit-resolve">Mark resolved</button>
        </div>
      </div>
    `;
    item.querySelector('.flagged-avatar').textContent = initials(r);
    item.querySelector('.student-name').textContent = r.student_name || '(no name)';
    item.querySelector('.student-email').textContent = r.student_email || '';
    const promptStrong = item.querySelector('.prompt-context strong');
    if (promptStrong && source === 'response') promptStrong.textContent = r.prompt_title || '(untitled)';
    item.querySelector('.response-body').textContent = r.body || '';
    const ctxEl = item.querySelector('.nearby-context');
    if (ctxEl) ctxEl.textContent = String(r.context || '').slice(0, 400);
    item.querySelector('.reason-text').textContent = r.flag_reason || 'No reason recorded.';
    item.querySelector('.submission-time').textContent = friendlyTime(r.created_at);

    const resolveBtn = item.querySelector('.resolve-btn');
    const resolveForm = item.querySelector('.resolve-form');
    const cancelBtn = item.querySelector('.cancel-resolve');
    const submitBtn = item.querySelector('.submit-resolve');
    const errorEl = item.querySelector('.resolve-error');
    populateResolutionDropdowns(item);

    resolveBtn.addEventListener('click', () => {
      resolveForm.hidden = false;
      resolveBtn.hidden = true;
      setTimeout(() => item.querySelector('.resolve-action').focus(), 50);
    });
    cancelBtn.addEventListener('click', () => {
      resolveForm.hidden = true;
      resolveBtn.hidden = false;
      errorEl.textContent = '';
    });
    submitBtn.addEventListener('click', async () => {
      const action = item.querySelector('.resolve-action').value;
      const severity = item.querySelector('.resolve-severity').value;
      const followup = item.querySelector('.resolve-followup').value;
      const notes = item.querySelector('.resolve-notes').value.trim();
      if (!action || !severity || !followup) {
        errorEl.textContent = 'Please pick an option for every required field.';
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      errorEl.textContent = '';
      try {
        const data = await api('resolve_flagged_response', {
          response_id: r.id,
          action_taken: action,
          severity: severity,
          followup: followup,
          notes: notes,
        });
        if (data.ok) {
          item.style.opacity = '0.4';
          setTimeout(() => item.remove(), 250);
          setTimeout(refresh, 350);
          if (typeof announce === 'function') announce('Resolution saved.');
        } else {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Mark resolved';
          errorEl.textContent = friendlyError(data.error);
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Mark resolved';
        errorEl.textContent = 'Network error: ' + err.message;
      }
    });
    return item;
  }

  function renderResolvedItem(r) {
    const item = document.createElement('article');
    item.className = 'flagged-item is-resolved';
    item.dataset.id = r.id;
    const source = String(r.source || 'response').toLowerCase();
    const meta = sourceMeta(source);
    const res = r.resolution || null;
    const severityClass = res ? 'sev-' + String(res.severity || '').toLowerCase().replace(/[^a-z0-9]+/g, '-') : '';

    item.innerHTML = `
      <p class="flagged-resolved-banner">✅ Resolved${res && res.resolved_at ? ' · ' + friendlyTime(res.resolved_at) : ''}</p>
      <div class="flagged-item-head">
        <span class="flagged-avatar"></span>
        <div class="student-line">
          <p class="student-name"></p>
          <p class="student-email"></p>
        </div>
        <span class="flagged-source-pill ${meta.tone}">
          <span aria-hidden="true">${meta.emoji}</span>
          <span>${meta.label}</span>
        </span>
      </div>
      ${contextHtmlFor(source, r)}
      <p class="response-body"></p>
      <div class="flag-reason">
        <span class="reason-label">Why:</span>
        <span class="reason-text"></span>
      </div>
      ${res ? `
        <div class="resolution-report ${severityClass}">
          <p class="resolution-report-title">Resolution report</p>
          <dl class="resolution-grid">
            <div class="resolution-row"><dt>Action taken</dt><dd class="res-action"></dd></div>
            <div class="resolution-row"><dt>Severity</dt><dd><span class="severity-pill"></span></dd></div>
            <div class="resolution-row"><dt>Follow-up</dt><dd class="res-followup"></dd></div>
            <div class="resolution-row resolution-by"><dt>Resolved by</dt><dd class="res-by"></dd></div>
            ${res.notes ? '<div class="resolution-row resolution-notes-row"><dt>Notes</dt><dd class="res-notes"></dd></div>' : ''}
          </dl>
        </div>
      ` : '<p class="muted small">No resolution report on file.</p>'}
      <div class="flagged-item-footer">
        <span class="submission-time"></span>
      </div>
    `;
    item.querySelector('.flagged-avatar').textContent = initials(r);
    item.querySelector('.student-name').textContent = r.student_name || '(no name)';
    item.querySelector('.student-email').textContent = r.student_email || '';
    const promptStrong = item.querySelector('.prompt-context strong');
    if (promptStrong && source === 'response') promptStrong.textContent = r.prompt_title || '(untitled)';
    item.querySelector('.response-body').textContent = r.body || '';
    item.querySelector('.reason-text').textContent = r.flag_reason || 'No reason recorded.';
    item.querySelector('.submission-time').textContent = 'Flagged ' + friendlyTime(r.created_at);

    if (res) {
      item.querySelector('.res-action').textContent = res.action_taken || '—';
      item.querySelector('.severity-pill').textContent = res.severity || '—';
      item.querySelector('.res-followup').textContent = res.followup || '—';
      const by = res.resolved_by_name
        ? `${res.resolved_by_name} (${res.resolved_by_email || ''})`
        : (res.resolved_by_email || '—');
      item.querySelector('.res-by').textContent = by;
      if (res.notes) item.querySelector('.res-notes').textContent = res.notes;
    }
    return item;
  }

  async function getResolutionOptions() {
    if (resolutionOptionsCache) return resolutionOptionsCache;
    try {
      const data = await api('get_resolution_options');
      if (data.ok) resolutionOptionsCache = data.options;
    } catch (_) {}
    return resolutionOptionsCache || { actions: [], severities: [], followups: [] };
  }

  async function populateResolutionDropdowns(item) {
    const opts = await getResolutionOptions();
    fillSelect(item.querySelector('.resolve-action'), opts.actions);
    fillSelect(item.querySelector('.resolve-severity'), opts.severities);
    fillSelect(item.querySelector('.resolve-followup'), opts.followups);
  }

  function fillSelect(select, values) {
    if (!select) return;
    while (select.options.length > 1) select.remove(1);
    for (const v of values || []) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    }
  }

  async function refresh() {
    try {
      const data = await api('list_flagged_responses', { include_resolved: true });
      if (!data.ok) return;
      allItems = data.responses || [];
      const open = allItems.filter(r => !r.resolved);
      const resolved = allItems.filter(r => r.resolved);
      updateButton(open);
      updateTabCounts(open.length, resolved.length);
      populatePanel(currentView === 'resolved' ? resolved : open);
    } catch (_) { /* silent — next refresh will retry */ }
  }

  function openPanel() {
    const panel = document.getElementById('flagged-panel');
    document.getElementById('flagged-backdrop').classList.add('open');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    if (typeof modalOpen === 'function') modalOpen(panel, '#flagged-close');
    refresh();
  }
  function closePanel() {
    document.getElementById('flagged-backdrop').classList.remove('open');
    const panel = document.getElementById('flagged-panel');
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    if (typeof modalClose === 'function') modalClose();
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectPanel();
    const btn = document.getElementById('flagged-btn');
    if (btn) btn.addEventListener('click', openPanel);
    document.getElementById('flagged-close').addEventListener('click', closePanel);
    document.getElementById('flagged-backdrop').addEventListener('click', closePanel);
    document.querySelectorAll('.flagged-tab').forEach(tab => {
      tab.addEventListener('click', () => switchView(tab.dataset.flaggedView));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });
  });

  document.addEventListener('aisa:signed-in', () => refresh());
  document.addEventListener('aisa:signed-out', () => {
    closePanel();
    allItems = [];
    const btn = document.getElementById('flagged-btn');
    if (btn) btn.hidden = true;
  });
})();
