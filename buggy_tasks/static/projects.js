(function () {
  'use strict';

  const T = window.Taskline;
  const { $, esc } = T;

  T.pages.projects = async function () {
    const dialog = $('#project-dialog');
    const create = $('#project-create');

    async function render(force) {
      const ws = await T.loadWorkspace(force);
      $('#projects').innerHTML = ws.projects.map((p) => `<article class="card project-card">
          <div class="row-item"><span class="dot" style="background: ${esc(p.color)}"></span><h2>${esc(p.name)}</h2>
            <span class="spacer"></span><span class="key">${esc(p.key)}</span></div>
          <p class="muted">${p.done} of ${p.total} tasks done</p>
          <div class="bar" role="presentation"><span style="width: ${Math.min(100, p.progress)}%; background: ${esc(p.color)}"></span></div>
          <p class="progress-label">${p.progress}% complete</p>
          <p><a href="/board?project=${encodeURIComponent(p.key)}">Open board</a> · <a href="/tasks?project=${encodeURIComponent(p.key)}">Tasks</a></p>
        </article>`).join('');
    }

    function reset() {
      $('#project-form').reset();
      $('#p-color').value = '#4b5f9e';
      T.say($('#project-msg'), '');
      create.disabled = false;
      create.textContent = 'Create project';
    }

    $('#new-project').addEventListener('click', () => {
      reset();
      dialog.showModal();
      $('#p-name').focus();
    });
    $('#project-cancel').addEventListener('click', () => dialog.close());
    $('#project-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#p-name').value.trim();
      const key = $('#p-key').value.trim().toUpperCase();
      const msg = $('#project-msg');
      if (!name) return T.say(msg, 'Name the project.', 'error');
      if (!/^[A-Z]{2,5}$/.test(key)) return T.say(msg, 'The key is 2 to 5 letters.', 'error');
      create.disabled = true;
      create.textContent = 'Creating…';
      const r = await T.api('/api/projects', { name, key, color: $('#p-color').value });
      if (r.ok) {
        dialog.close();
        T.toast(`${name} created.`, 'success');
        render(true);
      } else if (r.status === 400 || r.status === 403) {
        T.say(msg, r.data.error, 'error');
        create.disabled = false;
        create.textContent = 'Create project';
      }
    });

    render();
  };
})();
