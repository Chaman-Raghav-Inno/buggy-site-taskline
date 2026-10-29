(function () {
  'use strict';

  const T = window.Taskline;
  const { $, $$, esc } = T;
  const PAGE_SIZE = 10;
  const FILTERS = ['q', 'project', 'assignee', 'status', 'priority', 'due'];

  T.pages.tasks = async function () {
    let ws = await T.loadWorkspace();
    const state = { q: '', project: '', assignee: '', status: '', priority: '', due: '', sort: 'key', dir: 1, page: 1 };
    const controls = {
      q: $('#f-q'),
      project: $('#f-project'),
      assignee: $('#f-assignee'),
      status: $('#f-status'),
      priority: $('#f-priority'),
      due: $('#f-due'),
    };
    const selected = new Set();

    controls.project.insertAdjacentHTML('beforeend', ws.projects.map((p) => `<option value="${p.key}">${esc(p.name)}</option>`).join(''));
    const people = ws.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    controls.assignee.insertAdjacentHTML('beforeend', people);
    $('#bulk-assignee').insertAdjacentHTML('beforeend', people);
    if (!T.canEdit) $('#select-all').closest('th').hidden = true;

    const dueText = (iso) => {
      const [y, m, d] = iso.split('-');
      return `${d}/${m}/${y}`;
    };
    const weekEnd = T.addDays(ws.week_start, 6);
    const keyNumber = (k) => Number(k.split('-')[1]);
    const name = (id) => (T.memberById(ws, id) || {}).name || '';

    function filtered() {
      const q = state.q.trim().toLowerCase();
      const list = ws.tasks.filter((t) => {
        if (q && !t.title.toLowerCase().includes(q)) return false;
        if (state.project && t.project !== state.project) return false;
        if (state.assignee === 'none' && t.assignee) return false;
        if (state.assignee && state.assignee !== 'none' && t.assignee !== Number(state.assignee)) return false;
        if (state.status && t.status !== state.status) return false;
        if (state.priority && t.priority !== state.priority) return false;
        if (state.due === 'overdue' && !T.isOverdue(t, ws.today)) return false;
        if (state.due === 'today' && t.due !== ws.today) return false;
        if (state.due === 'week' && !(t.due && t.due >= ws.today && t.due <= weekEnd)) return false;
        if (state.due === 'none' && t.due) return false;
        return true;
      });
      const by = {
        key: (a, b) => a.project.localeCompare(b.project) || keyNumber(a.key) - keyNumber(b.key),
        title: (a, b) => a.title.localeCompare(b.title),
        status: (a, b) => Object.keys(T.STATUS).indexOf(a.status) - Object.keys(T.STATUS).indexOf(b.status),
        priority: (a, b) => T.PRIORITY[a.priority].localeCompare(T.PRIORITY[b.priority]),
        assignee: (a, b) => (name(a.assignee) || '~').localeCompare(name(b.assignee) || '~'),
        due: (a, b) => (a.due || '9999').localeCompare(b.due || '9999'),
      }[state.sort];
      return list.sort((a, b) => by(a, b) * state.dir);
    }

    function writeUrl() {
      const url = new URL(location.pathname, location.origin);
      FILTERS.forEach((k) => { if (state[k]) url.searchParams.set(k, state[k]); });
      if (state.sort !== 'key' || state.dir !== 1) url.searchParams.set('sort', (state.dir < 0 ? '-' : '') + state.sort);
      if (state.page > 1) url.searchParams.set('page', state.page);
      const task = new URLSearchParams(location.search).get('task');
      if (task) url.searchParams.set('task', task);
      history.replaceState(null, '', url);
    }

    function render() {
      const list = filtered();
      const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      const rows = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
      $('#rows').innerHTML = rows.map((t) => {
        const member = T.memberById(ws, t.assignee);
        const overdue = T.isOverdue(t, ws.today);
        const check = T.canEdit
          ? `<td class="col-check"><input type="checkbox" data-key="${t.key}" aria-label="Select ${t.key}"${selected.has(t.key) ? ' checked' : ''}></td>`
          : '';
        return `<tr data-key="${t.key}">${check}
          <td class="key">${t.key}</td>
          <td><a class="open-task" href="/tasks?task=${t.key}">${esc(t.title)}</a></td>
          <td><span class="status status-${t.status}">${T.STATUS[t.status]}</span></td>
          <td>${T.prioBadge(t.priority)}</td>
          <td class="assignee">${T.avatar(member)} <span>${member ? esc(member.name) : 'Unassigned'}</span></td>
          <td class="${overdue ? 'overdue' : ''}">${t.due ? dueText(t.due) : '—'}</td>
        </tr>`;
      }).join('');
      $('#empty').hidden = rows.length > 0;
      $('#page-info').textContent = `Page ${state.page} of ${pages} · ${list.length} tasks`;
      $('#prev').disabled = state.page <= 1;
      $('#next').disabled = state.page >= pages;
      $$('.sort').forEach((b) => {
        const on = b.dataset.sort === state.sort;
        b.closest('th').setAttribute('aria-sort', on ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
      });
      $('#select-all').checked = rows.length > 0 && rows.every((t) => selected.has(t.key));
      updateBulk();
      writeUrl();
    }

    function updateBulk() {
      $('#bulk').hidden = !T.canEdit || selected.size === 0;
      $('#bulk-count').textContent = `${selected.size} selected`;
    }

    function restoreFromUrl() {
      FILTERS.forEach((k) => {
        if (T.params.has(k)) {
          state[k] = T.params.get(k);
          controls[k].value = state[k];
        }
      });
      const sort = T.params.get('sort');
      if (sort) {
        state.dir = sort.startsWith('-') ? -1 : 1;
        state.sort = sort.replace('-', '');
      }
      if (T.params.get('page')) state.page = Number(T.params.get('page')) || 1;
    }

    Object.entries(controls).forEach(([k, el]) => {
      el.addEventListener(k === 'q' ? 'input' : 'change', () => {
        state[k] = el.value;
        selected.clear();
        render();
      });
    });
    $('#f-clear').addEventListener('click', () => {
      FILTERS.forEach((k) => { state[k] = ''; controls[k].value = ''; });
      state.page = 1;
      selected.clear();
      render();
    });
    $$('.sort').forEach((b) => b.addEventListener('click', () => {
      state.dir = state.sort === b.dataset.sort ? -state.dir : 1;
      state.sort = b.dataset.sort;
      state.page = 1;
      render();
    }));
    $('#prev').addEventListener('click', () => { state.page -= 1; render(); });
    $('#next').addEventListener('click', () => { state.page += 1; render(); });

    $('#rows').addEventListener('change', (e) => {
      const box = e.target.closest('input[data-key]');
      if (!box) return;
      if (box.checked) selected.add(box.dataset.key);
      else selected.delete(box.dataset.key);
      $('#select-all').checked = $$('#rows input[data-key]').every((b) => b.checked);
      updateBulk();
    });
    $('#select-all').addEventListener('change', (e) => {
      $$('#rows input[data-key]').forEach((b) => {
        b.checked = e.target.checked;
        if (b.checked) selected.add(b.dataset.key);
        else selected.delete(b.dataset.key);
      });
      updateBulk();
    });

    async function bulk(action, extra) {
      const keys = action === 'done' ? $$('#rows input[type="checkbox"]').map((b) => b.dataset.key) : [...selected];
      const r = await T.api('/api/tasks/bulk', { keys, action, ...extra });
      if (!r.ok) return T.toast(r.data.error || 'Could not update the tasks.', 'error');
      T.toast(`Updated ${r.data.count} task${r.data.count === 1 ? '' : 's'}.`, 'success');
      selected.clear();
      ws = await T.loadWorkspace(true);
      render();
    }
    $('#bulk-done').addEventListener('click', () => bulk('done'));
    $('#bulk-assignee').addEventListener('change', (e) => {
      if (!e.target.value) return;
      const assignee = e.target.value === 'none' ? null : Number(e.target.value);
      e.target.value = '';
      bulk('assign', { assignee });
    });
    $('#bulk-delete').addEventListener('click', async () => {
      const n = selected.size;
      if (await T.confirm(`Delete ${n} task${n === 1 ? '' : 's'}?`, "This can't be undone.", 'Delete')) bulk('delete');
    });

    $('#export').addEventListener('click', async () => {
      const res = await fetch('/api/export.csv', { credentials: 'same-origin' });
      if (!res.ok) return T.toast('Could not export the tasks.', 'error');
      const text = await res.text();
      const count = text.trim().split('\n').length - 1;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      link.download = 'taskline-tasks.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      T.toast(`Exported ${count} tasks.`, 'success');
    });
    $('#copy-link').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        T.toast('Link copied. Anyone in the workspace sees these filters.', 'success');
      } catch (e) {
        T.toast(`Copy this link: ${location.href}`);
      }
    });

    const handlers = {
      onSaved(t) {
        const mine = ws.tasks.find((x) => x.key === t.key);
        if (mine) Object.assign(mine, { title: t.title, status: t.status, priority: t.priority, due: t.due });
        render();
      },
      async onDeleted() {
        ws = await T.loadWorkspace(true);
        render();
      },
    };
    $('#rows').addEventListener('click', (e) => {
      const link = e.target.closest('.open-task');
      if (!link) return;
      e.preventDefault();
      T.openTask(link.closest('tr').dataset.key, handlers);
    });
    $('#new-task').addEventListener('click', () => T.newTask({}, {
      onCreated(t) {
        ws.tasks.push(t);
        render();
      },
    }));

    render();
    restoreFromUrl();
    if (T.params.get('task')) T.openTask(T.params.get('task'), handlers);
  };
})();
