(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  document.addEventListener('submit', (e) => e.preventDefault(), true);

  async function post(path, body) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let data = {};
      try {
        data = await res.json();
      } catch (e) {
        data = {};
      }
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: { error: 'You appear to be offline. Try again.' } };
    }
  }

  function say(el, text, kind) {
    el.textContent = text;
    el.classList.toggle('error', kind === 'error');
    el.classList.toggle('success', kind === 'success');
  }

  const login = $('#login-form');
  if (login) {
    login.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#l-email').value.trim();
      const password = $('#l-password').value;
      const msg = $('#login-msg');
      if (!EMAIL.test(email)) return say(msg, 'Enter your work email.', 'error');
      if (!password) return say(msg, 'Enter your password.', 'error');
      const r = await post('/api/login', { email, password });
      if (!r.ok) return say(msg, r.data.error || 'Could not log you in.', 'error');
      location.href = '/';
    });
  }

  const forgot = $('#forgot-form');
  if (forgot) {
    forgot.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#f-email').value.trim();
      const msg = $('#forgot-msg');
      if (!EMAIL.test(email)) return say(msg, 'Enter a valid email address.', 'error');
      const r = await post('/api/forgot', { email });
      if (r.ok) return say(msg, r.data.message, 'success');
      if (r.status >= 500) return say(msg, 'Something went wrong. Please try again.', 'error');
      say(msg, r.data.error || 'Could not send the link.', 'error');
    });
  }
})();
