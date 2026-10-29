(function () {
  'use strict';

  const T = window.Taskline;
  const { $, esc } = T;

  T.pages.dashboard = async function () {
    const [me, r] = await Promise.all([T.api('/api/me'), T.api('/api/dashboard')]);
    if (!r.ok) return T.toast(r.data.error || 'Could not load the dashboard.', 'error');
    const d = r.data;
    $('#welcome').textContent = `Welcome back, ${me.data.user.name.split(' ')[0]}`;
    $('#t-open').textContent = d.tiles.open;
    $('#t-today').textContent = d.tiles.due_today;
    $('#t-overdue').textContent = d.tiles.overdue;
    $('#t-week').textContent = d.tiles.completed_week;

    const today = me.data.today;
    $('#my-tasks').innerHTML = d.my_tasks.length
      ? d.my_tasks.map((t) => `<li class="row-item">
          <span class="key">${t.key}</span>
          <a href="/tasks?task=${t.key}">${esc(t.title)}</a>
          <span class="spacer"></span>
          ${T.prioBadge(t.priority)}
          <span class="due${T.isOverdue(t, today) ? ' overdue' : ''}">${t.due ? T.fmtDate(t.due) : 'No date'}</span>
        </li>`).join('')
      : '<li class="muted">Nothing assigned to you. Nice.</li>';

    $('#project-progress').innerHTML = d.projects.map((p) => `<li class="progress-item">
        <div class="row-item"><span class="dot" style="background: ${esc(p.color)}"></span>
          <a href="/board?project=${p.key}">${esc(p.name)}</a><span class="spacer"></span>
          <span class="muted small">${p.done} of ${p.total} done</span> <strong>${p.progress}%</strong></div>
        <div class="bar" role="presentation"><span style="width: ${Math.min(100, p.progress)}%; background: ${esc(p.color)}"></span></div>
      </li>`).join('');

    $('#activity').innerHTML = d.activity.map((a) => `<li class="row-item">
        <span><strong>${esc(a.name)}</strong> ${esc(a.text)}</span><span class="spacer"></span>
        <span class="muted small">${T.ago(a.at)}</span></li>`).join('');
  };
})();
