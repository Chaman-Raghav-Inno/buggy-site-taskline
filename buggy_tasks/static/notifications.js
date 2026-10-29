(function () {
  'use strict';

  const T = window.Taskline;
  const { $, esc } = T;

  T.pages.notifications = async function () {
    function render(list) {
      const unread = list.filter((n) => !n.read).length;
      $('#unread-summary').textContent = unread ? `${unread} unread` : 'You are all caught up.';
      $('#notifications').innerHTML = list.length
        ? list.map((n) => `<li class="notification${n.read ? '' : ' unread'}">
            <a href="/tasks?task=${encodeURIComponent(n.task)}" data-id="${n.id}">${esc(n.text)}</a>
            <span class="muted small">${T.ago(n.created)}</span></li>`).join('')
        : '<li class="muted">No notifications.</li>';
    }

    const r = await T.api('/api/notifications');
    if (!r.ok) return T.toast(r.data.error || 'Could not load notifications.', 'error');
    render(r.data.notifications);

    $('#read-all').addEventListener('click', async () => {
      const res = await T.api('/api/notifications/read-all', {});
      if (!res.ok) return T.toast(res.data.error || 'Could not update notifications.', 'error');
      render(res.data.notifications);
      T.toast('All notifications marked as read.', 'success');
    });

    $('#notifications').addEventListener('click', async (e) => {
      const link = e.target.closest('a[data-id]');
      if (!link) return;
      e.preventDefault();
      await T.api(`/api/notifications/${link.dataset.id}/read`, {});
      location.href = link.href;
    });
  };
})();
