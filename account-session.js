'use strict';
(() => {
  let currentUser, pending;
  function render() {
    document.querySelectorAll('[data-account-link]').forEach(link => {
      link.querySelector('span').textContent = currentUser === undefined ? 'Account' : currentUser ? 'My account' : 'Sign in';
      if (location.pathname.endsWith('/account.html')) link.setAttribute('aria-current', 'page');
    });
  }
  function update(user) {
    currentUser = user;
    render();
    window.dispatchEvent(new Event('dynasty-account-change'));
  }
  async function request(action, fields = {}) {
    const response = await fetch('/api/account', {method:'POST', credentials:'same-origin', cache:'no-store', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action, ...fields})});
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('Account services are unavailable. Please try again shortly.'); }
    if (!response.ok) throw new Error(result.error || 'Unable to complete that request. Please try again.');
    if (['session', 'signin', 'verify'].includes(action)) update(result.user || null);
    if (['signout', 'reset'].includes(action)) update(null);
    return result;
  }
  function check() {
    // Share one in-flight check between navigation and the account page.
    if (!pending) pending = request('session').finally(() => { pending = null; });
    return pending;
  }
  window.DynastyAccount = Object.freeze({request, check, get user() { return currentUser; }, allowsHistory: () => currentUser === null});
  render();
  check().catch(() => { currentUser = undefined; render(); });
  // A restored page must not keep a stale signed-in navigation label.
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      if (document.body.classList.contains('page-account')) location.reload();
      else check().catch(() => { currentUser = undefined; render(); });
    }
  });
})();
