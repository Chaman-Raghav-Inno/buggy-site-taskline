(function () {
  'use strict';

  const T = window.Taskline;
  const { $, esc } = T;
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const fmt = (n) => String(Math.round(n * 100) / 100);

  T.pages.timesheet = async function () {
    const ws = await T.loadWorkspace();
    let weekStart = ws.week_start;

    $('#log-task').innerHTML = ws.tasks
      .filter((t) => t.status !== 'done')
      .map((t) => `<option value="${t.key}">${t.key} · ${esc(t.title)}</option>`).join('');

    async function load() {
      const r = await T.api(`/api/time?week=${weekStart}`);
      if (!r.ok) return T.toast(r.data.error || 'Could not load the timesheet.', 'error');
      const { days, entries, target } = r.data;
      $('#week-label').textContent = `Week of ${T.fmtDate(days[0])} – ${T.fmtDate(days[6])}`;
      $('#ts-head').innerHTML = '<th scope="col">Task</th>' +
        days.map((d, i) => `<th scope="col"${d === ws.today ? ' class="today"' : ''}>${DAY_NAMES[i]} ${T.fmtShort(d)}</th>`).join('') +
        '<th scope="col">Total</th>';

      const byTask = {};
      entries.forEach((e) => {
        byTask[e.task] = byTask[e.task] || { title: e.title, hours: [0, 0, 0, 0, 0, 0, 0] };
        byTask[e.task].hours[days.indexOf(e.date)] += e.hours;
      });
      const keys = Object.keys(byTask).sort();
      $('#ts-rows').innerHTML = keys.length
        ? keys.map((k) => {
            const row = byTask[k];
            const total = row.hours.reduce((a, b) => a + b, 0);
            return `<tr><th scope="row"><span class="key">${k}</span> ${esc(row.title)}</th>` +
              row.hours.map((h) => `<td>${h ? fmt(h) : ''}</td>`).join('') + `<td><strong>${fmt(total)}</strong></td></tr>`;
          }).join('')
        : '<tr><td colspan="9" class="muted">No time logged this week.</td></tr>';

      const dayTotals = days.map((d) => entries.filter((e) => e.date === d).reduce((a, e) => a + e.hours, 0));
      const weekTotal = dayTotals.slice(0, 6).reduce((a, b) => a + b, 0);
      $('#ts-foot').innerHTML = '<th scope="row">Total</th>' + dayTotals.map((h) => `<td>${fmt(h)}</td>`).join('') +
        `<td id="ts-total"><strong>${fmt(weekTotal)}</strong></td>`;

      const pct = weekTotal ? Math.round((target / weekTotal) * 100) : 0;
      $('#target-text').textContent = `${fmt(weekTotal)} h of ${target} h (${pct}%)`;
      $('#target-bar').style.width = `${Math.min(100, (weekTotal / target) * 100)}%`;

      $('#entries').innerHTML = entries.length
        ? entries.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => `<li class="row-item">
            <span>${T.fmtDate(e.date)}</span><span class="key">${e.task}</span><span>${esc(e.title)}</span>
            <span class="spacer"></span><strong>${fmt(e.hours)} h</strong>
            ${T.canEdit ? `<button type="button" class="link delete-entry" data-id="${e.id}">Delete</button>` : ''}</li>`).join('')
        : '<li class="muted">No entries.</li>';
      $('#log-date').value = days.includes(ws.today) ? ws.today : days[0];
    }

    $('#prev-week').addEventListener('click', () => { weekStart = T.addDays(weekStart, -14); load(); });
    $('#next-week').addEventListener('click', () => { weekStart = T.addDays(weekStart, 7); load(); });
    $('#this-week').addEventListener('click', () => { weekStart = ws.week_start; load(); });

    $('#log-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const hours = parseFloat($('#log-hours').value);
      const msg = $('#log-msg');
      if (!$('#log-task').value) return T.say(msg, 'Choose a task.', 'error');
      if (!(hours >= 0.25 && hours <= 24)) return T.say(msg, 'Log between 0.25 and 24 hours.', 'error');
      const r = await T.api('/api/time', {
        task: $('#log-task').value,
        date: $('#log-date').value,
        hours,
        note: $('#log-note').value.trim(),
      });
      if (!r.ok) return T.say(msg, r.data.error || 'Could not log the time.', 'error');
      T.say(msg, `Logged ${fmt(r.data.hours)} h on ${T.fmtDate(r.data.date)}.`, 'success');
      $('#log-hours').value = '';
      $('#log-note').value = '';
      load();
    });

    $('#entries').addEventListener('click', async (e) => {
      const btn = e.target.closest('.delete-entry');
      if (!btn) return;
      const r = await T.api(`/api/time/${btn.dataset.id}/delete`, {});
      if (!r.ok) return T.toast(r.data.error || 'Could not delete the entry.', 'error');
      T.toast('Entry deleted.');
      load();
    });

    load();
  };
})();
