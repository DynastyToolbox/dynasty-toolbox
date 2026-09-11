'use strict';
(() => {
  const account = window.DynastyAccount;
  const $ = id => document.getElementById(id);
  let identity, leagues = [], loading, lookup = null, editing = null, busy = false;
  const onAccountPage = !!$('my-leagues');
  const pageInput = $('analyzerLeagueId') || $('leagueId') || $('leagueInput');
  const pageButton = $('analyzeBtn') || $('loadLeagueBtn') || $('loadAvailableBtn');
  function el(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
  function status(text, error = false) { if ($('leagues-status')) { $('leagues-status').textContent = text; $('leagues-status').dataset.error = String(error); } }
  function lock(value) { busy = value; if (onAccountPage) $('my-leagues').querySelectorAll('input,select,button').forEach(n => n.disabled = value); }
  function resetEditor() { editing = null; lookup = null; $('league-editor-title').textContent = 'Add a league'; $('saved-league-id').value = ''; $('league-team-fields').hidden = true; $('cancel-league-edit').hidden = true; }
  function renderList() {
    if (!onAccountPage) return;
    const list = $('my-league-list'); list.replaceChildren();
    if (!leagues.length) list.append(el('p', 'No leagues saved yet. Add your first Sleeper league below.', 'account-hint'));
    for (const league of leagues) {
      const card = el('article', '', 'saved-league-card');
      card.append(el('h4', league.name), el('p', `Sleeper · ${league.season} · ${league.league_id}`, 'account-hint'), el('p', league.team_name ? 'My team: ' + league.team_name : 'No default team selected'));
      const links = el('div', '', 'saved-league-links');
      for (const [path, name] of [['team_analyzer.html','Team Analyzer'], ['league_rankings.html','League Rankings'], ['best_available.html','Best Available']]) {
        const link = el('a', name); link.href = path + '?league=' + encodeURIComponent(league.league_id); links.append(link);
      }
      const edit = el('button', 'Edit / update league', 'account-secondary'); edit.type = 'button'; edit.addEventListener('click', () => {
        if (busy) return; editing = league; lookup = null; $('league-editor-title').textContent = 'Update ' + league.name; $('saved-league-id').value = league.league_id; $('league-team-fields').hidden = true; $('cancel-league-edit').hidden = false; status('Enter the renewed league ID, or keep this ID to change your team. Then select Find league.'); $('saved-league-id').focus();
      });
      const remove = el('button', 'Remove league', 'account-secondary'); remove.type = 'button';
      remove.addEventListener('click', () => {
        if (busy) return;
        const prompt = el('div', '', 'league-remove-prompt'); prompt.append(el('p', 'Remove this league from your account? This does not change anything in Sleeper.'));
        const yes = el('button', 'Remove from My Leagues', 'account-secondary'), no = el('button','Keep league','account-secondary'); yes.type = no.type = 'button';
        no.onclick = () => { prompt.remove(); remove.hidden = false; };
        yes.onclick = async () => { if (busy) return; lock(true); try { await account.request('league-remove', {id:league.id}); resetEditor(); await refresh(); status('League removed from your account.'); } catch (e) {status(e.message,true);} finally {lock(false);} };
        prompt.append(yes,no); card.append(prompt); remove.hidden = true; yes.focus();
      });
      card.append(links,edit,remove); list.append(card);
    }
  }
  let picker;
  function renderPicker() {
    if (!pageInput || !pageButton) return;
    if (!picker) {
      picker = el('section','','saved-league-picker'); picker.id = 'saved-league-picker';
      const label = el('label','My Leagues'); label.htmlFor = 'saved-league-select';
      const select = el('select'); select.id = 'saved-league-select';
      select.addEventListener('change', () => { const league = leagues.find(l => l.league_id === select.value); if (pageButton.disabled) {select.value = pageInput.value; return;} if (league) {pageInput.value = league.league_id; pageButton.click();} });
      const manage = el('a','Manage My Leagues'); manage.href = 'account.html#my-leagues';
      picker.append(label,select,el('p','','saved-league-message'),manage);
      const anchor = pageInput.closest('#leagueInputContainer, .flex-row') || pageInput;
      anchor.parentNode.insertBefore(picker, anchor);
    }
    picker.hidden = !account.user;
    const select = $('saved-league-select'), previous = select.value; select.replaceChildren(new Option('Choose a saved league', ''));
    leagues.forEach(l => select.add(new Option(`${l.name} (${l.season})${l.team_name ? ' — ' + l.team_name : ''}`, l.league_id)));
    select.value = leagues.some(l => l.league_id === previous) ? previous : '';
    picker.querySelector('p').textContent = leagues.length ? 'Your leagues are saved to your account.' : 'Add leagues on your account page to use them here.';
  }
  async function refresh() {
    if (identity !== account.user?.email) { identity = account.user?.email; leagues = []; loading = null; renderList(); renderPicker(); }
    if (!account.user) {leagues = []; renderList(); renderPicker(); return [];}
    if (!loading) {
      const owner = identity;
      const task = account.request('leagues').then(result => {if (identity !== owner) return []; leagues = result.leagues; renderList(); renderPicker(); return leagues;}).finally(() => {if (loading === task) loading = null;});
      loading = task;
    }
    return loading;
  }
  const ready = account.check().then(async () => {
    await refresh();
    const chosen = new URLSearchParams(location.search).get('league');
    if (pageInput && leagues.some(l => l.league_id === chosen)) { $('saved-league-select').value = chosen; pageInput.value = chosen; pageButton.click(); }
  }).catch(e => {status(e.message,true); if (pageInput && account.user) {renderPicker(); picker.querySelector('p').textContent = 'Saved leagues could not be loaded. Reload to try again.';} });
  window.DynastyLeagues = Object.freeze({ready, teamFor: id => leagues.find(l => l.league_id === id)?.roster_id || null});
  window.addEventListener('dynasty-account-change', () => { refresh().catch(e => status(e.message,true)); });
  if (!onAccountPage) return;
  $('saved-league-id').addEventListener('input', () => {lookup = null; $('league-team-fields').hidden = true;});
  $('cancel-league-edit').addEventListener('click', () => {if (!busy) {resetEditor(); status('');}});
  $('find-saved-league').addEventListener('click', async () => {
    if (busy || !$('saved-league-id').reportValidity()) return;
    lock(true); status('Finding league and teams…'); lookup = null; $('league-team-fields').hidden = true;
    try {
      const result = await account.request('league-lookup', {league_id:$('saved-league-id').value.trim()}); lookup = result.league;
      $('found-league-name').textContent = lookup.name + ' · ' + lookup.season;
      const select = $('my-roster'); select.replaceChildren(new Option('No default team', ''));
      lookup.teams.forEach(t => select.add(new Option(t.name, String(t.roster_id))));
      // Only keep a roster choice in the same league; renewal needs confirmation.
      if (editing?.league_id === lookup.league_id) select.value = String(editing.roster_id || '');
      $('league-team-fields').hidden = false; status('Choose your team, then save.');
    } catch(e) {status(e.message,true);} finally {lock(false);}
  });
  $('save-my-league').addEventListener('click', async () => {
    if (busy || !lookup) return; lock(true); status('Saving league…');
    try {
      await account.request(editing ? 'league-update' : 'league-add', {id:editing?.id, league_id:lookup.league_id, roster_id:$('my-roster').value ? Number($('my-roster').value) : null});
      resetEditor(); await refresh(); status('League saved to your account.');
    } catch(e) {status(e.message,true);} finally {lock(false);}
  });
})();
