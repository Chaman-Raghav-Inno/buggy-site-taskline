(function () {
  'use strict';

  const T = window.Taskline;
  const { $ } = T;

  T.pages.settings = async function () {
    $('#profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#s-name').value.trim();
      const msg = $('#profile-msg');
      if (!name) return T.say(msg, 'Enter your name.', 'error');
      const r = await T.api('/api/settings', { name });
      if (!r.ok) return T.say(msg, r.data.error || 'Could not save your profile.', 'error');
      T.say(msg, 'Profile saved.', 'success');
      $('.user-name').textContent = r.data.user.name;
    });

    $('#prefs-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        date_format: $('#s-date').value,
        theme: $('#s-theme').value,
        notify_assign: $('#s-notify-assign').checked,
        notify_comment: $('#s-notify-comment').checked,
      };
      const r = await T.api('/api/settings', body);
      if (!r.ok) return T.say($('#prefs-msg'), r.data.error || 'Could not save your preferences.', 'error');
      document.documentElement.dataset.theme = body.theme;
      document.body.dataset.dateFormat = body.date_format;
      T.say($('#prefs-msg'), 'Preferences saved.', 'success');
    });

    $('#password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const current = $('#pw-current').value;
      const next = $('#pw-new').value;
      const confirm = $('#pw-confirm').value;
      const msg = $('#password-msg');
      if (!current) return T.say(msg, 'Enter your current password.', 'error');
      if (next.length < 8 || !/\d/.test(next)) return T.say(msg, 'Use at least 8 characters, including a number.', 'error');
      if (next !== confirm) return T.say(msg, "The new passwords don't match.", 'error');
      const r = await T.api('/api/password', { current, new: next, confirm });
      if (!r.ok) return T.say(msg, r.data.error || 'Could not change your password.', 'error');
      $('#password-form').reset();
      T.say(msg, 'Password changed. Use it the next time you log in.', 'success');
    });

    const r = await T.api('/api/me');
    if (!r.ok) return;
    const { user, prefs } = r.data;
    if (!$('#s-name').value) $('#s-name').value = user.name;
    $('#s-email').value = user.email;
    $('#s-date').value = prefs.date_format;
    $('#s-theme').value = prefs.theme;
    $('#s-notify-assign').checked = prefs.notify_assign;
    $('#s-notify-comment').checked = prefs.notify_comment;
  };
})();
