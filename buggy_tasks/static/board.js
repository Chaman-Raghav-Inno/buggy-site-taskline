(function () {
  'use strict';

  const T = window.Taskline;
  const { $, $$, esc } = T;

  T.pages.board = async function () {
    const board = $('#board');
    const select = $('#board-project');
    let ws = await T.loadWorkspace();
    let project = T.params.get('project');
    if (!ws.projects.some((p) => p.key === project)) project = ws.projects[0].key;
    let tasks = ws.tasks.filter((t) => t.project === project);

    select.innerHTML = ws.projects.map((p) => `<option value="${p.key}">${esc(p.name)}</option>`).join('');
    select.value = project;

    function setTitle() {
      const p = ws.projects.find((x) => x.key === project);
      $('#board-title').textContent = `${p.name} board`;
    }

    function card(t) {
      const member = T.memberById(ws, t.assignee);
      const overdue = T.isOverdue(t, ws.today);
      const move = T.canEdit
        ? `<label class="move"><span class="sr-only">Move ${t.key} to</span>
            <select class="move-select" data-key="${t.key}">${Object.entries(T.STATUS)
              .map(([v, label]) => `<option value="${v}"${v === t.status ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`
        : '';
      return `<article class="task-card" data-key="${t.key}" draggable="${T.canEdit}">
        <div class="card-top"><span class="key">${t.key}</span>${T.prioBadge(t.priority)}</div>
        <h3><a class="open-task" href="/board?project=${project}&amp;task=${t.key}">${esc(t.title)}</a></h3>
        <div class="card-meta">
          <span class="due${overdue ? ' overdue' : ''}">${t.due ? 'Due ' + T.fmtDate(t.due) : 'No due date'}</span>
          ${T.avatar(member)}
        </div>
        ${move}
      </article>`;
    }

    function render(list) {
      board.innerHTML = Object.entries(T.STATUS).map(([status, label]) => {
        const cards = list.filter((t) => t.status === status);
        const limit = status === 'doing' ? `<span class="limit"> / ${ws.wip_limit}</span>` : '';
        return `<section class="column" data-status="${status}" aria-label="${label}">
          <header class="column-head"><h2>${label}</h2><span class="count-wrap"><span class="count">${cards.length}</span>${limit}</span></header>
          <div class="cards">${cards.map(card).join('')}</div>
          <form class="quick-add" novalidate>
            <label class="sr-only" for="qa-${status}">Add a task to ${label}</label>
            <input id="qa-${status}" placeholder="+ Add a task" maxlength="200" autocomplete="off">
          </form>
        </section>`;
      }).join('');
    }

    async function reload() {
      ws = await T.loadWorkspace(true);
      tasks = ws.tasks.filter((t) => t.project === project);
      render(tasks);
    }

    function column(status) {
      return board.querySelector(`.column[data-status="${status}"]`);
    }

    function hasRoom(status) {
      const n = column(status).querySelectorAll('.task-card').length;
      if (status === 'doing' && n > ws.wip_limit) {
        T.toast(`In progress is full: finish something first (limit ${ws.wip_limit}).`, 'error');
        return false;
      }
      return true;
    }

    function place(cardEl, status) {
      column(status).querySelector('.cards').appendChild(cardEl);
      const sel = cardEl.querySelector('.move-select');
      if (sel) sel.value = status;
    }

    setTitle();
    render(tasks);

    select.addEventListener('change', () => {
      project = select.value;
      setTitle();
      const url = new URL(location.href);
      url.searchParams.set('project', project);
      history.replaceState(null, '', url);
      render(tasks);
    });

    board.addEventListener('change', async (e) => {
      const sel = e.target.closest('.move-select');
      if (!sel) return;
      const cardEl = sel.closest('.task-card');
      const from = cardEl.closest('.column').dataset.status;
      const to = sel.value;
      if (to === from) return;
      if (!hasRoom(to)) {
        sel.value = from;
        return;
      }
      const r = await T.api(`/api/tasks/${sel.dataset.key}`, { status: to });
      if (!r.ok) {
        sel.value = from;
        return T.toast(r.data.error || 'Could not move the task.', 'error');
      }
      place(cardEl, to);
      T.toast(`${sel.dataset.key} moved to ${T.STATUS[to]}.`);
    });

    let dragged = null;
    board.addEventListener('dragstart', (e) => {
      const cardEl = e.target.closest('.task-card');
      if (!cardEl) return;
      dragged = cardEl;
      cardEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', cardEl.dataset.key);
    });
    board.addEventListener('dragend', () => {
      if (dragged) dragged.classList.remove('dragging');
      $$('.column.drop-target', board).forEach((c) => c.classList.remove('drop-target'));
      dragged = null;
    });
    board.addEventListener('dragover', (e) => {
      const col = e.target.closest('.column');
      if (!col || !dragged) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drop-target');
    });
    board.addEventListener('dragleave', (e) => {
      const col = e.target.closest('.column');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop-target');
    });
    board.addEventListener('drop', async (e) => {
      const col = e.target.closest('.column');
      if (!col || !dragged) return;
      e.preventDefault();
      col.classList.remove('drop-target');
      const cardEl = dragged;
      const to = col.dataset.status;
      if (cardEl.closest('.column') === col || !hasRoom(to)) return;
      const r = await T.api(`/api/tasks/${cardEl.dataset.key}`, { column: to });
      if (!r.ok) return T.toast(r.data.error || 'Could not move the task.', 'error');
      place(cardEl, to);
    });

    board.addEventListener('submit', async (e) => {
      const form = e.target.closest('.quick-add');
      if (!form) return;
      e.preventDefault();
      const input = $('input', form);
      const title = input.value.trim();
      if (!title) return;
      const r = await T.api('/api/tasks', { title, project });
      if (!r.ok) return T.toast(r.data.error || 'Could not add the task.', 'error');
      T.toast(`${r.data.key} added.`, 'success');
      await reload();
    });

    const handlers = {
      onSaved(t) {
        const cardEl = board.querySelector(`.task-card[data-key="${t.key}"]`);
        if (!cardEl) return;
        $('.open-task', cardEl).textContent = t.title;
        $('.prio', cardEl).outerHTML = T.prioBadge(t.priority);
        $('.due', cardEl).textContent = t.due ? 'Due ' + T.fmtDate(t.due) : 'No due date';
        $('.due', cardEl).classList.toggle('overdue', T.isOverdue(t, ws.today));
        place(cardEl, t.status);
      },
      onDeleted: () => reload(),
    };
    board.addEventListener('click', (e) => {
      const link = e.target.closest('.open-task');
      if (!link) return;
      e.preventDefault();
      T.openTask(link.closest('.task-card').dataset.key, handlers);
    });
    $('#new-task').addEventListener('click', () => T.newTask({ project }, { onCreated: () => reload() }));

    if (T.params.get('task')) T.openTask(T.params.get('task'), handlers);
  };
})();
