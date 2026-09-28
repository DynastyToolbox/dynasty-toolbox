'use strict';
(()=>{
  const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  let data=null,busy=false,version=0,identity;
  const record=t=>`${t.record.wins}–${t.record.losses}${t.record.ties?'–'+t.record.ties:''}`;
  const status=(message,error=false)=>{$('outlook-status').textContent=message;$('outlook-status').dataset.error=String(error);};
  const comparisonFor=(id,week)=>data.comparisons?.find(c=>c.week===week&&c.teams.includes(id)&&c.scenario==='play');
  const chanceFor=(c,id)=>c?.available?(c.teams[0]===id?c.probability.win:c.probability.loss):null;
  const unavailable=c=>({live_week:'Live-game win chances are not available for this week yet.',incomplete_lineup:'There is not enough player data to estimate this matchup yet.',uncertain_starter:'Some player estimates need more history before this matchup can be projected.',calibration_unavailable:'Win chances and scoring ranges are not ready for this league’s settings yet.',missing_lineup:'Both teams need sufficient player data for a matchup estimate.'}[c?.reason]||'An opponent or matchup estimate could not be confirmed for this week.');
  function clear(){data=null;version++;$('outlook-content').hidden=true;for(const id of ['league-name','league-context','outlook-summary','outlook-matchup','outlook-coverage','outlook-schedule','outlook-team','outlook-week'])$(id).replaceChildren();}
  function warning(text){return el('p',text,'outlook-warning');}
  function render(){
    if(!data)return;const team=data.league.teams.find(t=>t.id===$('outlook-team').value),week=Number($('outlook-week').value);if(!team)return;
    const summary=$('outlook-summary');summary.replaceChildren();
    for(const [value,label]of [[record(team),'Current record'],[team.pointsFor.toFixed(1),'Points scored'],[data.schedule.length,'Regular-season weeks left']]){const card=el('div',null,'outlook-stat');card.append(el('strong',value),el('span',label));summary.append(card);}
    const comparison=comparisonFor(team.id,week),matchup=$('outlook-matchup');matchup.replaceChildren();$('matchup-title').textContent=`Week ${week||'—'} matchup`;
    if(comparison?.available){
      const side=comparison.teams.indexOf(team.id),ids=side?[...comparison.teams].reverse():comparison.teams,ranges=side?[comparison.b,comparison.a]:[comparison.a,comparison.b];
      matchup.append(el('p','EXPERIMENTAL ESTIMATE','outlook-kicker'));
      const grid=el('div',null,'outlook-matchup-teams');
      ids.forEach((id,index)=>{const card=el('div',null,'outlook-matchup-team');card.append(el('h3',data.league.teams.find(t=>t.id===id)?.name||'Team'),el('strong',Math.round(chanceFor(comparison,id)*100)+'%','outlook-chance'),el('span','Estimated win chance'),el('p',`${Math.round(ranges[index].low)}–${Math.round(ranges[index].high)} points`),el('small','Projected scoring range'));grid.append(card);});
      matchup.append(grid,el('p','Early estimates based on past production. Scoring ranges are not minimums or maximums; actual results can fall outside them.','outlook-muted'));
      if(comparison.probability.tie>0)matchup.append(el('p','A tie is also possible; win chances may not add to 100%.','outlook-muted'));
    }else matchup.append(el('p',unavailable(comparison),'outlook-muted'));
    const schedule=$('outlook-schedule');schedule.replaceChildren();
    for(const row of data.schedule){
      const pair=row.pairs.find(p=>p.includes(team.id)),opponent=data.league.teams.find(t=>t.id===pair?.find(id=>id!==team.id)),tr=el('tr',null,row.week===week?'selected':'');
      const cell=el('td'),button=el('button',`Week ${row.week}`,'week-button');button.type='button';button.setAttribute('aria-pressed',String(row.week===week));button.setAttribute('aria-controls','matchup-details');
      button.onclick=()=>{$('outlook-week').value=String(row.week);render();$('matchup-title').focus({preventScroll:true});if(matchMedia('(max-width:850px)').matches)$('matchup-details').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});};cell.append(button);
      const c=comparisonFor(team.id,row.week),chance=chanceFor(c,team.id),chanceCell=el('td',chance===null?'—':Math.round(chance*100)+'%','outlook-schedule-chance');if(chance===null)chanceCell.title=unavailable(c);
      tr.append(cell,el('td',row.issues.length?'Matchup needs review':opponent?.name||'Opponent unavailable'),el('td',opponent?record(opponent):'—'),chanceCell);schedule.append(tr);
    }
  }
  async function load(){
    if(busy)return;clear();const current=version;busy=true;$('loadLeagueBtn').disabled=true;$('outlook-gate').hidden=true;status('Loading your league’s schedule and matchup estimates…');
    try{
      const result=await DynastyAccount.request('outlook-league',{league_id:$('leagueId').value.trim()});if(version!==current)return;data=result;
      $('league-name').textContent=data.league.name;$('league-context').textContent=`${data.league.season} · ${data.league.teams.length} teams`;
      $('outlook-team').replaceChildren(...data.league.teams.map(t=>new Option(t.name,t.id)));
      const own=String(window.DynastyLeagues?.teamFor(data.league.id)||'');if(data.league.teams.some(t=>t.id===own))$('outlook-team').value=own;
      $('outlook-week').replaceChildren(...data.schedule.map(s=>new Option(String(s.week),String(s.week))));
      const next=data.schedule.find(s=>s.week>data.currentWeek);if(next)$('outlook-week').value=String(next.week);
      const coverage=$('outlook-coverage');coverage.replaceChildren();
      if(data.coverage.scoring.length)coverage.append(warning('This league uses scoring rules that the projection model does not yet support. You can still review its schedule.'));
      if(data.coverage.slots.length)coverage.append(warning('Some starting positions are not modeled yet: '+data.coverage.slots.join(', ')+'. Matchup estimates may be unavailable.'));
      if(data.coverage.nflSchedule.length)coverage.append(warning('The NFL schedule needs review. Bye-week eligibility cannot currently be confirmed.'));
      if(data.coverage.bestBall)coverage.append(warning('Best-ball scoring is not modeled yet. You can still review this league’s schedule.'));
      if(data.coverage.medianGame)coverage.append(warning('This league also plays against the league median. The win chances here cover head-to-head matchups only.'));
      if(!data.schedule.length)coverage.append(warning('No regular-season weeks remain to preview.'));
      $('outlook-content').hidden=false;render();status('League loaded. Choose a team and week to explore.');
    }catch(error){if(version===current){status(error.message,true);$('outlook-gate').hidden=!/sign in|premium/i.test(error.message);}}
    finally{busy=false;$('loadLeagueBtn').disabled=false;}
  }
  $('loadLeagueBtn').onclick=load;$('leagueId').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load();}};$('outlook-team').onchange=render;$('outlook-week').onchange=render;
  window.addEventListener('dynasty-account-change',()=>{const next=DynastyAccount.user?.email||null;if(identity!==next){identity=next;clear();status(next?'Choose a league to load your outlook.':'Sign in to use League Outlook.');}});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  window.DynastyLeagues?.ready.then(()=>{const chosen=new URLSearchParams(location.search).get('league');if(chosen&&!data&&!busy){$('leagueId').value=chosen;load();}});
  fetch('/nav.html').then(r=>{if(!r.ok)throw new Error();return r.text();}).then(html=>$('nav-placeholder').innerHTML=html).catch(()=>{});
})();
