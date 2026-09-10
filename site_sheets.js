/* Published sheet exports and mock-draft catalogue, shared across page interactions. */
window.DynastySheets = (() => {
  let pending;
  function load() {
    if (!pending) {
      pending = fetch('/data/site_sheets.json', { cache: 'no-cache' })
        .then(response => {
          if (!response.ok) throw new Error(`Website data request failed (${response.status})`);
          return response.json();
        })
        .then(data => {
          if (data.schemaVersion !== 1 || !data.sheets || !Array.isArray(data.mockDrafts)) {
            throw new Error('Invalid website data release');
          }
          return data;
        }).catch(error => { pending = undefined; throw error; });
    }
    return pending;
  }
  async function csv(id) {
    const data = await load();
    if (typeof data.sheets[id]?.csv !== 'string') throw new Error(`Missing published sheet: ${id}`);
    return data.sheets[id].csv;
  }
  async function mocks(kind) {
    const data = await load();
    return data.mockDrafts.filter(draft => draft.kind === kind).map(draft => ({ ...draft }));
  }
  function showError(error) {
    console.error(error);
    let message = document.querySelector('[data-sheets-error]');
    if (!message) {
      message = document.createElement('p');
      message.dataset.sheetsError = '';
      message.setAttribute('role', 'alert');
      message.style.textAlign = 'center';
      (document.querySelector('main') || document.body).prepend(message);
    }
    message.textContent = 'Website data could not load. Please refresh to try again.';
  }
  return Object.freeze({ csv, mocks, showError });
})();
