(function () {
  'use strict';

  const T = window.Taskline;
  const { $, esc } = T;

  T.pages.reports = async function () {
    async function load() {
      const r = await T.api(`/api/reports?days=${$('#range').value}`);
      if (!r.ok) return T.toast(r.data.error || 'Could not load the report.', 'error');
      const d = r.data;
      $('#r-completed').textContent = d.completed;
      $('#r-created').textContent = d.created;
      $('#r-avg').textContent = d.avg_days;
      const max = Math.max(1, ...d.weeks.map((w) => w.done));
      $('#chart').innerHTML = d.weeks.map((w) => `<div class="chart-col">
          <span class="chart-value">${w.done}</span>
          <span class="chart-bar" style="height: ${Math.round((w.done / max) * 100)}%"></span>
          <span class="chart-label">${T.fmtShort(w.week)}</span></div>`).join('');
      const top = Math.max(1, ...d.workload.map((w) => w.open));
      $('#workload').innerHTML = d.workload.map((w) => `<li class="bar-row">
          <span class="bar-name">${esc(w.name)}</span>
          <span class="bar"><span style="width: ${Math.round((w.open / top) * 100)}%"></span></span>
          <span class="bar-value">${w.open}</span></li>`).join('');
    }
    $('#range').addEventListener('change', load);
    load();
  };
})();
