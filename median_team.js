'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const model = DynastyMedian;
  const counts = Object.fromEntries(model.POSITIONS.map(pos => [pos, 0]));
  let loaded = null, players = {}, request = 0, owner = window.DynastyAccount?.user?.email;
  const create = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function message(text, error = false) {
    $('median-league-status').textContent = text;
    $('median-league-status').dataset.error = String(error);
  }
  function teamName(roster, league = loaded) {
    const user = league.users.find(u => String(u.user_id) === String(roster.owner_id));
    return user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`;
  }
  function rosterRows(roster, data) {
    const maxWeek = model.getMaxWeek(data.meta, data.players);
    const scoring = $('scoringFilter').value, windowKey = $('windowFilter').value;
    const ids = new Set([...(roster.players || []), ...(roster.reserve || []), ...(roster.taxi || [])].map(String));
    return [...ids].map(id => {
      const weekly = data.players[id], player = players[id];
      const computed = weekly && model.computePlayerRow(id, weekly, scoring, windowKey, maxWeek);
      return {...(computed || {id, median:null}),
        name: player?.full_name || weekly?.name || `Player ${id}`,
        pos: player?.position || weekly?.pos || 'Other',
        team: player?.team || weekly?.team || ''};
    }).sort((a,b) => (b.median ?? -Infinity) - (a.median ?? -Infinity) || a.name.localeCompare(b.name));
  }
  function render() {
    const roster = loaded?.rosters.find(r => String(r.roster_id) === $('medianTeamSelect').value);
    $('median-roster-content').hidden = !roster;
    if (!roster) return;
    const data = window.DynastyMedianPage?.data;
    if (!data) { message('Weekly median data is unavailable. Reload the page to try again.', true); return; }
    message(loaded.meta.name);
    const rows = rosterRows(roster, data);
    $('median-roster-title').textContent = teamName(roster) + ' · Roster';
    const scoringName = $('scoringFilter').selectedOptions[0].textContent;
    const windowName = $('windowFilter').selectedOptions[0].textContent;
    $('median-roster-context').textContent = `${data.meta.season} season · ${scoringName} · ${windowName}. Medians require 3 qualifying games. Search and position filters only affect the rankings list.`;
    const list = $('median-lineup'); list.replaceChildren();
    const lineup = model.bestLineup(rows, counts);
    if (!lineup.length) list.append(create('li', 'Use the + buttons to build your starting lineup.', 'median-hint'));
    for (const {slot, number, player} of lineup) {
      const item = create('li', undefined, 'median-player-row');
      item.append(create('strong', `${slot}${number}`), create('span', player?.name || 'No eligible player with a median'), create('strong', player ? player.median.toFixed(2) : '—'));
      list.append(item);
    }
    const filled = lineup.filter(s => s.player);
    $('median-lineup-total').textContent = lineup.length ? `Sum of player medians: ${filled.reduce((sum,s) => sum+s.player.median,0).toFixed(2)} · ${filled.length}/${lineup.length} spots filled` : '';
    const rosterContainer = $('median-roster'); rosterContainer.replaceChildren();
    for (const pos of ['QB','RB','WR','TE','Other']) {
      const group = rows.filter(r => pos === 'Other' ? !['QB','RB','WR','TE'].includes(r.pos) : r.pos === pos);
      if (!group.length) continue;
      rosterContainer.append(create('h4',pos));
      const ul = create('ul');
      for (const row of group) {
        const li = create('li',undefined,'median-player-row');
        const label = create('span',row.name);
        if (row.team) label.append(create('small',` ${row.team}`));
        li.append(label, create('strong', row.median === null ? (pos === 'Other' ? 'No median' : 'Not enough games') : row.median.toFixed(2)));
        ul.append(li);
      }
      rosterContainer.append(ul);
    }
    if (!rows.length) rosterContainer.append(create('p','This team has no players yet.'));
    for (const pos of model.POSITIONS) {
      $(`median-count-${pos}`).textContent = `${pos} · ${counts[pos]}`;
      $(`median-minus-${pos}`).disabled = counts[pos] === 0;
      $(`median-plus-${pos}`).disabled = Object.values(counts).reduce((a,b)=>a+b,0) >= 30;
    }
  }
  for (const pos of model.POSITIONS) {
    const group = create('div',undefined,'median-slot-control');
    const minus = create('button','−'), label = create('span',`${pos} · 0`), plus = create('button','+');
    label.id = `median-count-${pos}`;
    for (const [button,change,verb] of [[minus,-1,'Remove'],[plus,1,'Add']]) {
      button.type = 'button'; button.id = `median-${change<0?'minus':'plus'}-${pos}`;
      button.setAttribute('aria-label',`${verb} ${pos} position`);
      button.addEventListener('click',() => {counts[pos] = Math.max(0, counts[pos]+change); render();});
    }
    minus.disabled = true; group.append(minus,label,plus); $('median-slot-controls').append(group);
  }
  $('loadLeagueBtn').addEventListener('click', async () => {
    const id = $('leagueId').value.trim();
    if (!/^\d{10,22}$/.test(id)) {message('Enter a valid numeric Sleeper league ID.',true); return;}
    const version = ++request;
    $('loadLeagueBtn').disabled = true;
    $('median-team-choice').hidden = $('median-roster-content').hidden = true;
    message('Loading league and teams…');
    try {
      const [league, allPlayers] = await Promise.all([DynastySleeper.league(id,{picks:false}), DynastySleeper.players()]);
      if (version !== request) return;
      if (loaded?.id !== id) model.POSITIONS.forEach(pos => {counts[pos]=0;});
      loaded = league; players = allPlayers;
      const select = $('medianTeamSelect'); select.replaceChildren(new Option('Choose your team',''));
      league.rosters.forEach(r => select.add(new Option(teamName(r,league),String(r.roster_id))));
      const preferred = window.DynastyLeagues?.teamFor(id);
      if (preferred && league.rosters.some(r => String(r.roster_id)===String(preferred))) select.value=String(preferred);
      if (!select.value && league.rosters.length===1) select.value=String(league.rosters[0].roster_id);
      $('median-team-choice').hidden=false;
      message(league.meta.name + (select.value ? '' : ' · Choose your team.'));
      render();
    } catch (error) {if (version===request) {loaded=null; message(error.message || 'League could not load. Try again.',true);}}
    finally {if (version===request) $('loadLeagueBtn').disabled=false;}
  });
  $('leagueId').addEventListener('keydown', e => {if (e.key==='Enter' && !$('loadLeagueBtn').disabled) $('loadLeagueBtn').click();});
  $('medianTeamSelect').addEventListener('change',render);
  window.addEventListener('dynasty-median-change',render);
  window.addEventListener('dynasty-account-change',() => {
    const next = window.DynastyAccount?.user?.email;
    if (next===owner) return;
    owner=next; request++; loaded=null; $('loadLeagueBtn').disabled=false;
    $('median-team-choice').hidden=$('median-roster-content').hidden=true;
    message('');
  });
})();
