(function () {
  'use strict';

  const T = window.Taskline;
  const { $, $$, esc } = T;

  const DRAWER = `
  <div id="drawer" class="drawer" hidden>
    <div class="drawer-backdrop" data-close></div>
    <section class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="d-key">
      <header class="drawer-head">
        <span id="d-key" class="key"></span>
        <button type="button" class="icon-btn" data-close aria-label="Close task">×</button>
      </header>
      <form id="d-form" class="form" novalidate>
        <label for="d-title" class="sr-only">Title</label>
        <input id="d-title" class="title-input" maxlength="200">
        <div class="field-grid">
          <div class="field"><label for="d-status">Status</label><select id="d-status"></select></div>
          <div class="field"><label for="d-assignee">Assignee</label><select id="d-assignee"></select></div>
          <div class="field"><label for="d-priority">Priority</label><select id="d-priority"></select></div>
          <div class="field"><label for="d-due">Due date</label><input id="d-due" type="date"></div>
        </div>
        <div class="field"><label for="d-desc">Description</label><textarea id="d-desc" rows="4" maxlength="4000"></textarea></div>
        <div class="drawer-actions">
          <button type="submit" class="btn" id="d-save">Save changes</button>
          <button type="button" class="btn btn-ghost btn-danger-text" id="d-delete" data-needs="edit">Delete task</button>
        </div>
        <p id="d-msg" class="msg" role="status"></p>
      </form>
      <section class="drawer-section">
        <h3>Subtasks <span id="d-sub-progress" class="muted"></span></h3>
        <div class="bar small-bar" role="presentation"><span id="d-sub-bar"></span></div>
        <ul id="d-subtasks" class="checklist"></ul>
        <form id="d-sub-form" class="inline-form" novalidate data-needs="edit">
          <label for="d-sub-text" class="sr-only">New subtask</label>
          <input id="d-sub-text" placeholder="Add a subtask" maxlength="200">
          <button type="submit" class="btn btn-small btn-ghost">Add</button>
        </form>
      </section>
      <section class="drawer-section">
        <h3>Time</h3>
        <p id="d-time-total"></p>
        <form id="d-time-form" class="inline-form" novalidate data-needs="edit">
          <div class="field"><label for="d-time-hours">Hours</label>
            <input id="d-time-hours" type="number" step="0.25" min="0.25" max="24" inputmode="decimal"></div>
          <div class="field"><label for="d-time-date">Date</label><input id="d-time-date" type="date"></div>
          <button type="submit" class="btn btn-small btn-ghost">Log time</button>
        </form>
        <ul id="d-time-list" class="list compact"></ul>
      </section>
      <section class="drawer-section">
        <h3>Comments</h3>
        <ul id="d-comments" class="comments"></ul>
        <form id="d-comment-form" class="form" novalidate>
          <label for="d-comment" class="sr-only">Write a comment</label>
          <textarea id="d-comment" rows="2" placeholder="Write a comment…" maxlength="2000"></textarea>
          <button type="submit" class="btn btn-small">Comment</button>
        </form>
      </section>
      <section class="drawer-section">
        <h3>Activity</h3>
        <ul id="d-activity" class="list compact"></ul>
      </section>
    </section>
  </div>
  <dialog id="confirm-delete" aria-labelledby="cd-title">
    <h2 id="cd-title">Delete this task?</h2>
    <p>The task, its subtasks and its comments will be deleted. This can't be undone.</p>
    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" data-value="cancel">Cancel</button>
      <button type="button" class="btn btn-danger" data-value="delete">Delete task</button>
    </div>
  </dialog>
  <dialog id="new-task-dialog" aria-labelledby="nt-title">
    <form id="nt-form" class="form" novalidate>
      <h2 id="nt-title">New task</h2>
      <div class="field"><label for="nt-name">Title</label><input id="nt-name" maxlength="200"></div>
      <div class="field-grid">
        <div class="field"><label for="nt-project">Project</label><select id="nt-project"></select></div>
        <div class="field"><label for="nt-status">Status</label><select id="nt-status"></select></div>
        <div class="field"><label for="nt-assignee">Assignee</label><select id="nt-assignee"></select></div>
        <div class="field"><label for="nt-priority">Priority</label><select id="nt-priority"></select></div>
        <div class="field"><label for="nt-due">Due date</label><input id="nt-due" type="date"></div>
      </div>
      <div class="field"><label for="nt-desc">Description</label><textarea id="nt-desc" rows="3" maxlength="4000"></textarea></div>
      <p id="nt-msg" class="msg error" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" id="nt-cancel">Cancel</button>
        <button type="submit" class="btn" id="nt-create">Create task</button>
      </div>
    </form>
  </dialog>`;

  let current = null;
  let handlers = {};
  let detail = null;

  function options(map, selected) {
    return Object.entries(map).map(([v, label]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${label}</option>`).join('');
  }

  function memberOptions(ws, selected) {
    return '<option value="">Unassigned</option>' + ws.members
      .map((m) => `<option value="${m.id}"${m.id === selected ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
  }

  function setUrlTask(key) {
    const url = new URL(location.href);
    if (key) url.searchParams.set('task', key);
    else url.searchParams.delete('task');
    history.replaceState(null, '', url);
  }

  function renderDetail() {
    const ws = T.ws;
    const t = detail.task;
    $('#d-key').textContent = t.key;
    $('#d-title').value = t.title;
    $('#d-status').innerHTML = options(T.STATUS, t.status);
    $('#d-assignee').innerHTML = memberOptions(ws, t.assignee);
    $('#d-priority').innerHTML = options(T.PRIORITY, t.priority);
    $('#d-due').value = t.due || '';
    $('#d-desc').value = t.description || '';

    const subs = t.subtasks;
    let done = 0;
    for (let i = 0; i < subs.length - 1; i++) if (subs[i].done) done += 1;
    $('#d-sub-progress').textContent = subs.length ? `${done}/${subs.length}` : '';
    $('#d-sub-bar').style.width = subs.length ? `${Math.round((100 * done) / subs.length)}%` : '0%';
    $('#d-subtasks').innerHTML = subs.length
      ? subs.map((s, i) => `<li><label class="check"><input type="checkbox" data-index="${i}"${s.done ? ' checked' : ''}${T.canEdit ? '' : ' disabled'}>
          <span>${esc(s.text)}</span></label></li>`).join('')
      : '<li class="muted">No subtasks yet.</li>';

    $('#d-time-total').textContent = `Logged: ${detail.time_total} h`;
    $('#d-time-list').innerHTML = detail.time.slice(-5).reverse()
      .map((e) => `<li>${esc(e.name)} · ${e.hours} h · ${T.fmtDate(e.date)}</li>`).join('');
    $('#d-time-date').value = T.ws.today;

    $('#d-comments').innerHTML = t.comments.length
      ? t.comments.map((c) => `<li class="comment" data-id="${c.id}">
          <p class="comment-meta"><strong>${esc(c.name)}</strong> · ${T.ago(c.created)}
          ${c.author === ws.user.id ? '<button type="button" class="link edit-comment">Edit</button>' : ''}</p>
          <p class="comment-text">${esc(c.text)}</p></li>`).join('')
      : '<li class="muted">No comments yet.</li>';

    $('#d-activity').innerHTML = detail.activity.length
      ? detail.activity.map((a) => `<li>${esc(a.name)} ${esc(a.text)} · ${T.ago(a.at)}</li>`).join('')
      : '<li class="muted">Nothing yet.</li>';

    if (!T.canEdit) {
      ['#d-title', '#d-assignee', '#d-priority', '#d-due', '#d-desc'].forEach((s) => { $(s).disabled = true; });
    }
  }

  async function load(key) {
    const r = await T.api(`/api/tasks/${encodeURIComponent(key)}`);
    if (!r.ok) {
      T.toast(r.data.error || 'Could not open that task.', 'error');
      close();
      return false;
    }
    detail = r.data;
    renderDetail();
    return true;
  }

  function close() {
    $('#drawer').hidden = true;
    current = null;
    setUrlTask(null);
  }

  T.openTask = async function (key, on) {
    handlers = on || {};
    await T.loadWorkspace();
    current = key;
    T.say($('#d-msg'), '');
    if (!(await load(key))) return;
    $('#drawer').hidden = false;
    setUrlTask(key);
    $('#d-title').focus();
  };

  T.newTask = async function (defaults, on) {
    const ws = await T.loadWorkspace();
    const d = defaults || {};
    $('#nt-name').value = '';
    $('#nt-desc').value = '';
    $('#nt-due').value = '';
    $('#nt-project').innerHTML = ws.projects.map((p) => `<option value="${p.key}"${p.key === d.project ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    $('#nt-status').innerHTML = options(T.STATUS, d.status || 'todo');
    $('#nt-assignee').innerHTML = memberOptions(ws, null);
    $('#nt-priority').innerHTML = options(T.PRIORITY, 'medium');
    T.say($('#nt-msg'), '');
    $('#new-task-dialog').onCreated = (on || {}).onCreated;
    $('#new-task-dialog').showModal();
    $('#nt-name').focus();
  };

  function setup() {
    document.body.insertAdjacentHTML('beforeend', DRAWER);
    if (!T.canEdit) $$('#drawer [data-needs="edit"]').forEach((el) => { el.hidden = true; });

    $$('#drawer [data-close]').forEach((el) => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#drawer').hidden && !document.querySelector('dialog[open]')) close();
    });

    $('#d-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = T.canEdit
        ? {
            title: $('#d-title').value.trim(),
            status: $('#d-status').value,
            assignee: $('#d-assignee').value ? Number($('#d-assignee').value) : null,
            priority: $('#d-priority').value,
            due: $('#d-due').value || null,
            description: $('#d-desc').value.trim(),
          }
        : { status: $('#d-status').value };
      const r = await T.api(`/api/tasks/${encodeURIComponent(current)}`, body);
      if (!r.ok) return T.say($('#d-msg'), r.data.error || 'Could not save the task.', 'error');
      T.say($('#d-msg'), 'Saved.', 'success');
      if (handlers.onSaved) handlers.onSaved(r.data);
      await load(current);
    });

    const confirmDelete = $('#confirm-delete');
    $$('button', confirmDelete).forEach((b) => b.addEventListener('click', () => confirmDelete.close(b.dataset.value)));
    confirmDelete.addEventListener('close', async () => {
      const key = current;
      const r = await T.api(`/api/tasks/${encodeURIComponent(key)}/delete`, {});
      if (!r.ok) return T.toast(r.data.error || 'Could not delete the task.', 'error');
      close();
      T.toast(`${key} deleted.`);
      if (handlers.onDeleted) handlers.onDeleted(key);
    });
    $('#d-delete').addEventListener('click', () => confirmDelete.showModal());

    $('#d-subtasks').addEventListener('change', async (e) => {
      const box = e.target.closest('input[data-index]');
      if (!box) return;
      const r = await T.api(`/api/tasks/${encodeURIComponent(current)}/subtasks/${box.dataset.index}`, { done: box.checked });
      if (r.ok) {
        detail = r.data;
        renderDetail();
      }
    });
    $('#d-sub-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = $('#d-sub-text').value.trim();
      if (!text) return;
      const r = await T.api(`/api/tasks/${encodeURIComponent(current)}/subtasks`, { text });
      if (r.ok) {
        $('#d-sub-text').value = '';
        detail = r.data;
        renderDetail();
      }
    });

    $('#d-time-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await T.api('/api/time', {
        task: current,
        date: $('#d-time-date').value,
        hours: parseInt($('#d-time-hours').value, 10),
      });
      if (!r.ok) return T.toast(r.data.error || 'Could not log the time.', 'error');
      $('#d-time-hours').value = '';
      T.toast(`Logged ${r.data.hours} h on ${current}.`, 'success');
      await load(current);
    });

    $('#d-comment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = $('#d-comment').value.trim();
      if (!text) return;
      const r = await T.api(`/api/tasks/${encodeURIComponent(current)}/comments`, { text });
      if (!r.ok) return T.toast(r.data.error || 'Could not post the comment.', 'error');
      $('#d-comment').value = '';
      detail = r.data;
      renderDetail();
    });
    $('#d-comments').addEventListener('click', (e) => {
      const btn = e.target.closest('.edit-comment');
      if (!btn) return;
      const li = btn.closest('.comment');
      const text = $('.comment-text', li).textContent;
      li.insertAdjacentHTML('beforeend', `<form class="edit-form form" novalidate>
        <label class="sr-only" for="edit-${li.dataset.id}">Edit comment</label>
        <textarea id="edit-${li.dataset.id}" rows="2" maxlength="2000">${esc(text)}</textarea>
        <div class="dialog-actions"><button type="button" class="btn btn-small btn-ghost cancel-edit">Cancel</button>
        <button type="submit" class="btn btn-small">Save</button></div></form>`);
      btn.hidden = true;
    });
    $('#d-comments').addEventListener('submit', async (e) => {
      const form = e.target.closest('.edit-form');
      if (!form) return;
      e.preventDefault();
      const text = $('textarea', form).value.trim();
      if (!text) return;
      const r = await T.api(`/api/tasks/${encodeURIComponent(current)}/comments`, { text });
      if (!r.ok) return T.toast(r.data.error || 'Could not save the comment.', 'error');
      detail = r.data;
      renderDetail();
    });
    $('#d-comments').addEventListener('click', (e) => {
      if (!e.target.closest('.cancel-edit')) return;
      renderDetail();
    });

    $('#nt-cancel').addEventListener('click', () => $('#new-task-dialog').close());
    $('#nt-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = $('#nt-name').value.trim();
      if (!title) return T.say($('#nt-msg'), 'Give the task a title.', 'error');
      const r = await T.api('/api/tasks', {
        title,
        project: $('#nt-project').value,
        status: $('#nt-status').value,
        assignee: $('#nt-assignee').value ? Number($('#nt-assignee').value) : null,
        priority: $('#nt-priority').value,
        due: $('#nt-due').value || null,
        description: $('#nt-desc').value.trim(),
      });
      if (!r.ok) return T.say($('#nt-msg'), r.data.error || 'Could not create the task.', 'error');
      const dialog = $('#new-task-dialog');
      dialog.close();
      T.toast(`${r.data.key} created.`, 'success');
      if (dialog.onCreated) dialog.onCreated(r.data);
    });
  }

  setup();
})();
