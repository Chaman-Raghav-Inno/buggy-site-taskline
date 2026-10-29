(function () {
  'use strict';

  const T = window.Taskline;
  const { $, esc } = T;
  const ROLE_NAMES = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };

  T.pages.team = async function () {
    let ws = await T.loadWorkspace();
    const ownerId = ws.members[0].id;

    function render() {
      $('#seats').textContent = `Seats: ${ws.seats.used} of ${ws.seats.total} used`;
      $('#members').innerHTML = ws.members.map((m) => {
        const role = T.isAdmin && m.id !== ownerId
          ? `<label class="sr-only" for="role-${m.id}">Role for ${esc(m.name)}</label>
             <select id="role-${m.id}" class="role-select" data-id="${m.id}">${Object.entries(ROLE_NAMES)
               .map(([v, label]) => `<option value="${v}"${v === m.role ? ' selected' : ''}>${label}</option>`).join('')}</select>`
          : `${ROLE_NAMES[m.role]}${m.id === ownerId ? ' · Owner' : ''}`;
        const remove = T.canEdit && m.id !== ownerId && m.id !== ws.user.id
          ? `<button type="button" class="link link-danger remove" data-id="${m.id}">Remove</button>`
          : '';
        return `<tr><td class="person">${T.avatar(m)} <span>${esc(m.name)}${m.id === ws.user.id ? ' (you)' : ''}</span></td>
          <td>${esc(m.email)}</td><td>${role}</td><td>${remove}</td></tr>`;
      }).join('');
      $('#invites').innerHTML = ws.invites.length
        ? ws.invites.map((i) => `<li class="row-item"><span>${esc(i.email)}</span><span class="muted small">${ROLE_NAMES[i.role]} · sent ${T.fmtDate(i.sent)}</span>
            <span class="spacer"></span>
            ${T.isAdmin ? `<button type="button" class="link resend" data-email="${esc(i.email)}">Resend</button>
            <button type="button" class="link link-danger revoke" data-email="${esc(i.email)}">Revoke</button>` : ''}</li>`).join('')
        : '<li class="muted">No pending invites.</li>';
    }

    async function reload() {
      ws = await T.loadWorkspace(true);
      render();
    }

    render();

    $('#members').addEventListener('change', async (e) => {
      const sel = e.target.closest('.role-select');
      if (!sel) return;
      const r = await T.api(`/api/members/${sel.dataset.id}/role`, { role: sel.value });
      if (!r.ok) {
        T.toast(r.data.error || 'Could not change the role.', 'error');
        return reload();
      }
      T.toast(`${r.data.member.name} is now ${ROLE_NAMES[r.data.member.role].toLowerCase()}.`, 'success');
    });

    $('#members').addEventListener('click', async (e) => {
      const btn = e.target.closest('.remove');
      if (!btn) return;
      const m = T.memberById(ws, Number(btn.dataset.id));
      const ok = await T.confirm('Remove member?', `${m.name} will lose access to the workspace.`, 'Remove');
      if (!ok) return;
      const r = await T.api(`/api/members/${m.id}/remove`, {});
      if (!r.ok) return T.toast(r.data.error || 'Could not remove them.', 'error');
      T.toast(`${m.name} was removed.`, 'success');
      reload();
    });

    $('#invite-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#i-email').value.trim();
      const msg = $('#invite-msg');
      if (!T.EMAIL.test(email)) return T.say(msg, 'Enter a valid email address.', 'error');
      const r = await T.api('/api/invites', { email, role: $('#i-role').value });
      if (!r.ok) return T.say(msg, r.data.error || 'Could not send the invite.', 'error');
      T.say(msg, `Invite sent to ${email}.`, 'success');
      $('#i-email').value = '';
      reload();
    });

    $('#invites').addEventListener('click', async (e) => {
      const btn = e.target.closest('.resend, .revoke');
      if (!btn) return;
      const action = btn.classList.contains('resend') ? 'resend' : 'revoke';
      const r = await T.api(`/api/invites/${action}`, { email: btn.dataset.email });
      if (!r.ok) return T.toast(r.data.error || 'Could not update the invite.', 'error');
      T.toast(action === 'resend' ? `Invite resent to ${btn.dataset.email}.` : 'Invite revoked.', 'success');
      reload();
    });
  };
})();
