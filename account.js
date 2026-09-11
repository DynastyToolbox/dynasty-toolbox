'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const modes = {
    signin: ['Welcome back', 'Sign in to your Dynasty Toolbox account.', 'Sign in'],
    signup: ['Create your account', 'Start with your email and a unique password.', 'Create account'],
    verify: ['Verify your email', 'Enter the code we sent when you created your account.', 'Verify email'],
    forgot: ['Reset your password', 'We’ll email you a code to set a new password.', 'Send reset code'],
    reset: ['Choose a new password', 'Enter your reset code and choose a new, unique password.', 'Update password'],
  };
  let mode = 'signin', user = null, busy = false;
  function status(message = '', error = false) { $('account-status').textContent = message; $('account-status').dataset.error = String(error); }
  function changeMode(next, message = '') {
    if (busy || !modes[next]) return;
    mode = next;
    const [heading, intro, submit] = modes[next];
    $('account-heading').textContent = heading;
    $('account-intro').textContent = intro;
    $('account-submit').textContent = submit;
    const needsCode = next === 'verify' || next === 'reset';
    const needsPassword = ['signin', 'signup', 'reset'].includes(next);
    $('code-field').hidden = !needsCode; $('account-code').required = needsCode; $('account-code').value = '';
    $('code-label').textContent = next === 'reset' ? 'Password-reset code' : 'Email verification code';
    $('code-help').textContent = next === 'reset' ? 'Use the 8-digit code from the newest email titled “Your Dynasty Toolbox password-reset code”. Your signup code will not work here.' : 'Use the 8-digit code from the newest email titled “Your Dynasty Toolbox verification code”.';
    $('account-resend').hidden = !needsCode;
    $('password-field').hidden = !needsPassword; $('account-password').required = needsPassword;
    $('account-password').value = ''; $('account-password').type = 'password'; $('show-password').checked = false;
    $('account-password').autocomplete = next === 'signin' ? 'current-password' : 'new-password';
    $('account-password').minLength = next === 'signin' ? 1 : 12;
    $('password-help').hidden = !['signup', 'reset'].includes(next);
    $('account-password').setAttribute('aria-describedby', $('password-help').hidden ? '' : 'password-help');
    $('signed-in').hidden = true; $('signed-out').hidden = false;
    $('account-back').hidden = !user;
    document.querySelectorAll('[data-mode]').forEach(button => {
      if (button.dataset.mode === next) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    status(message);
  }
  function showUser(nextUser) {
    user = nextUser;
    if (!user) return changeMode('signin');
    $('signed-in').hidden = false; $('signed-out').hidden = true;
    $('account-heading').textContent = 'Your account'; $('account-intro').textContent = 'Welcome to Dynasty Toolbox.';
    $('account-identity').textContent = user.email; $('account-email').value = user.email;
    $('account-password').value = ''; $('account-code').value = ''; status();
  }
  function lock(value) {
    busy = value;
    document.querySelectorAll('.account-card button, .account-card input').forEach(el => el.disabled = value);
    $('account-form').setAttribute('aria-busy', String(value));
  }
  async function request(action, fields = {}) {
    return window.DynastyAccount.request(action, fields);
  }
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => changeMode(button.dataset.mode)));
  $('show-password').addEventListener('change', () => { $('account-password').type = $('show-password').checked ? 'text' : 'password'; });
  $('account-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const action = mode, email = $('account-email').value.trim(), password = $('account-password').value, code = $('account-code').value.trim();
    if (['signup', 'reset'].includes(action) && new TextEncoder().encode(password).length > 72) return status('That password is too long. Please use a shorter passphrase.', true);
    lock(true); status('Please wait…');
    try {
      const fields = {email};
      if (['signin', 'signup', 'reset'].includes(action)) fields.password = password;
      if (['verify', 'reset'].includes(action)) fields.code = code;
      const result = await request(action, fields);
      lock(false);
      if (action === 'signup') changeMode('verify', result.message);
      else if (action === 'forgot') changeMode('reset', result.message);
      else if (action === 'reset') { user = null; changeMode('signin', result.message); }
      else showUser(result.user);
    } catch (error) { lock(false); status(error.message, true); }
    finally { $('account-password').value = ''; }
  });
  $('account-resend').addEventListener('click', async () => {
    if (busy || !['verify', 'reset'].includes(mode)) return;
    if (!$('account-email').reportValidity()) return;
    const targetMode = mode;
    lock(true); status('Requesting a new code…');
    try {
      const result = await request(targetMode === 'reset' ? 'forgot' : 'resend', { email: $('account-email').value.trim() });
      lock(false); changeMode(targetMode, result.message + ' Any older code may no longer work.');
      $('account-code').focus();
    } catch (error) { lock(false); status(error.message, true); }
  });
  async function signout(everywhere) {
    if (busy) return; lock(true); status('Signing out…');
    try { const result = await request('signout', {everywhere}); lock(false); showUser(null); status(result.message); }
    catch (error) { lock(false); showUser(null); status(error.message, true); }
  }
  $('account-signout').addEventListener('click', () => signout(false));
  $('account-signout-all').addEventListener('click', () => signout(true));
  $('account-reset').addEventListener('click', () => changeMode('forgot'));
  $('account-back').addEventListener('click', () => showUser(user));
  fetch('/nav.html').then(r => { if (!r.ok) throw new Error(); return r.text(); }).then(html => { $('nav-placeholder').innerHTML = html; }).catch(() => {
    const nav = document.createElement('nav'), home = document.createElement('a'); home.href = '/index.html'; home.textContent = 'Home'; nav.append(home); $('nav-placeholder').append(nav);
  });
  lock(true);
  window.DynastyAccount.check().then(result => { lock(false); showUser(result.user); }).catch(error => { lock(false); changeMode('signin'); status(error.message, true); });
})();
