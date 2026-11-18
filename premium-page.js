/* Membership controls for premium tools; the server checks every data request too. */
'use strict';
window.DynastyPremiumPage = {
  start({feature, load = async () => {}, clear = () => {}}) {
    let revision = 0, allowed = false;
    const gate = document.getElementById('gate'), content = document.getElementById('protected');
    const message = document.getElementById('gateMessage');
    const status = document.getElementById('gateError');
    const retry = document.getElementById('premiumRetry');
    const controller = {get allowed(){return allowed;}, get revision(){return revision;}, refresh};
    async function refresh() {
      const current = ++revision;
      allowed = false; content.style.display = 'none'; gate.hidden = false; clear();
      retry.disabled = true; message.textContent = 'Checking your membership…'; status.textContent = '';
      try {
        const {access} = await DynastyAccount.request('access');
        if (current !== revision) return;
        if (!access?.premium || access.features?.[feature] !== true) {
          message.textContent = 'This tool is included with a Dynasty Toolbox membership.';
          return;
        }
        await load(() => current === revision);
        if (current !== revision) return;
        allowed = true; gate.hidden = true; content.style.display = 'block';
      } catch (error) {
        if (current !== revision) return;
        message.textContent = 'Sign in with a membership to use this tool.';
        status.textContent = error.message || 'Membership could not be checked. Please try again.';
      } finally { if (current === revision) retry.disabled = false; }
    }
    retry.addEventListener('click', refresh);
    window.addEventListener('dynasty-account-change', refresh);
    window.addEventListener('pageshow', e => {if(e.persisted) refresh();});
    window.addEventListener('focus', refresh);
    refresh();
    return controller;
  }
};
