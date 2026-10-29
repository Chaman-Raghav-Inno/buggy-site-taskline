(function () {
  'use strict';

  const T = (window.Taskline = window.Taskline || {});
  T.pages = T.pages || {};

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  T.$ = $;
  T.$$ = $$;
  T.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
  T.params = new URLSearchParams(location.search);
  T.EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  T.STATUS = { todo: 'To do', doing: 'In progress', review: 'In review', done: 'Done' };
  T.PRIORITY = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
  T.PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
  T.role = document.body.dataset.role || '';
  T.canEdit = T.role === 'admin' || T.role === 'member';
  T.isAdmin = T.role === 'admin';

  // No form on these pages is meant to submit natively: scripts handle them all.
  document.addEventListener('submit', (e) => e.preventDefault(), true);

  T.api = async function (path, body) {
    const opts = body === undefined
      ? { credentials: 'same-origin' }
      : {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        };
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      return { ok: false, status: 0, data: { error: 'You appear to be offline. Try again.' } };
    }
    if (res.status === 401 && !path.startsWith('/api/login')) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
    }
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      data = {};
    }
    return { ok: res.ok, status: res.status, data };
  };

  let toastTimer;
  T.toast = function (text, kind) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = text;
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  };

  T.say = function (el, text, kind) {
    el.textContent = text || '';
    el.classList.toggle('error', kind === 'error');
    el.classList.toggle('success', kind === 'success');
  };

  T.fmtDate = function (iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    const format = document.body.dataset.dateFormat;
    if (format === 'MDY') return `${m}/${d}/${y}`;
    if (format === 'ISO') return iso;
    return `${d}/${m}/${y}`;
  };

  T.fmtShort = function (iso) {
    const [, m, d] = iso.split('-');
    const format = document.body.dataset.dateFormat;
    if (format === 'MDY') return `${m}/${d}`;
    if (format === 'ISO') return `${m}-${d}`;
    return `${d}/${m}`;
  };

  T.addDays = function (iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  T.ago = function (ts) {
    const minutes = Math.round((ts * 1000 - Date.now()) / 60000);
    const m = Math.abs(minutes);
    if (m < 60) return rtf.format(m, 'minute');
    if (m < 1440) return rtf.format(Math.round(m / 60), 'hour');
    return rtf.format(Math.round(m / 1440), 'day');
  };

  T.initials = (name) => String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  T.avatar = function (member) {
    if (!member) return '<span class="avatar avatar-empty" title="Unassigned">–</span>';
    return `<span class="avatar" style="background: ${T.esc(member.color)}" title="${T.esc(member.name)}">${T.esc(T.initials(member.name))}</span>`;
  };

  T.memberById = (ws, id) => ws.members.find((m) => m.id === id) || null;

  T.prioBadge = (p) => `<span class="prio prio-${p}">${T.PRIORITY[p]}</span>`;

  T.isOverdue = (t, today) => Boolean(t.due && t.due < today && t.status !== 'done');

  let wsPromise = null;
  T.loadWorkspace = function (force) {
    if (!wsPromise || force) {
      wsPromise = T.api('/api/workspace').then((r) => {
        if (!r.ok) throw new Error(r.data.error || 'Could not load the workspace.');
        T.ws = r.data;
        return r.data;
      });
    }
    return wsPromise;
  };

  // A confirmation dialog that resolves true only when the action button is pressed.
  T.confirm = function (title, text, action) {
    let dialog = $('#confirm-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'confirm-dialog';
      dialog.setAttribute('aria-labelledby', 'confirm-title');
      dialog.innerHTML = `<h2 id="confirm-title"></h2><p id="confirm-text"></p>
        <div class="dialog-actions"><button type="button" class="btn btn-ghost" data-value="cancel">Cancel</button>
        <button type="button" class="btn btn-danger" data-value="ok"></button></div>`;
      document.body.appendChild(dialog);
      $$('button', dialog).forEach((b) => b.addEventListener('click', () => dialog.close(b.dataset.value)));
    }
    $('#confirm-title', dialog).textContent = title;
    $('#confirm-text', dialog).textContent = text;
    $('button[data-value="ok"]', dialog).textContent = action;
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    });
  };

  function setupChrome() {
    const page = document.body.dataset.page;
    $$('.nav a').forEach((a) => {
      if (a.dataset.nav === page) a.setAttribute('aria-current', 'page');
    });
    if (!T.canEdit) $$('[data-needs="edit"]').forEach((el) => { el.hidden = true; });
    if (!T.isAdmin) $$('[data-needs="admin"]').forEach((el) => { el.hidden = true; });

    const logout = $('#logout');
    if (logout) {
      logout.addEventListener('click', async () => {
        await T.api('/api/logout', {});
        location.href = '/login';
      });
    }
    setupSearch();
  }

  function setupSearch() {
    const input = $('#global-search');
    const list = $('#search-results');
    if (!input) return;
    let items = [];
    let active = -1;

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }

    function highlight(i) {
      active = i;
      $$('li', list).forEach((li, n) => li.setAttribute('aria-selected', String(n === i)));
      if (i >= 0) input.setAttribute('aria-activedescendant', `sr-${i}`);
    }

    async function update() {
      const q = input.value.trim();
      if (!q) return close();
      const ws = await T.loadWorkspace();
      const needle = q.toLowerCase();
      items = ws.tasks
        .filter((t) => t.title.toLowerCase().includes(needle) || t.key.toLowerCase().includes(needle))
        .slice(0, 6);
      const mark = new RegExp('(' + q + ')', 'ig');
      list.innerHTML = items.length
        ? items.map((t, i) => `<li role="option" id="sr-${i}" aria-selected="false">
            <a href="/tasks?task=${encodeURIComponent(t.key)}"><span class="key">${T.esc(t.key)}</span>
            ${T.esc(t.title).replace(mark, '<mark>$1</mark>')}</a></li>`).join('')
        : '<li class="none">No matching tasks</li>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    }

    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown' && items.length) {
        e.preventDefault();
        highlight((active + 1) % items.length);
      } else if (e.key === 'ArrowUp' && items.length) {
        e.preventDefault();
        highlight((active - 1 + items.length) % items.length);
      } else if (e.key === 'Enter' && items.length) {
        e.preventDefault();
        location.href = `/tasks?task=${encodeURIComponent(items[0].key)}`;
      } else if (e.key === 'Escape') {
        close();
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search')) close();
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    setupChrome();
    const run = T.pages[document.body.dataset.page];
    if (!run) return;
    document.body.classList.add('is-loading');
    try {
      await run();
    } finally {
      document.body.classList.remove('is-loading');
    }
  });
})();
