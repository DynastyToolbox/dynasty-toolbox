'use strict';
(()=>{
  const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const reasons={fantasy_ir:'On fantasy IR',fantasy_taxi:'On taxi squad',bye:'NFL bye week',currently_unavailable:'Currently unavailable',return_date_unknown:'Future return date unknown',injury_uncertain:'Availability uncertain',insufficient_history:'Not enough game history',qb_role_uncertain:'Quarterback role needs review',stale_role_history:'Recent role needs review',no_nfl_team:'No confirmed NFL team',unrecognized_status:'Status needs review',missing_player:'Player details missing',unsupported_position:'Position not modeled yet',game_status:'NFL game status uncertain',schedule_unconfirmed:'NFL schedule not confirmed',unsupported_slots:'Some lineup positions are not modeled',best_ball_not_modeled:'Best-ball lineup selection is not modeled yet',week_started_lineup_locks_not_modeled:'This week has started. Locked starters are not reflected in this candidate lineup.'};
  Object.assign(reasons,{limited_history:'Early estimate from limited game history',locked_lineup_unavailable:'Locked starters could not be confirmed; remaining lineup estimates are withheld',game_already_started:'Game already started; cannot be added to this lineup',commissioner_override:'Commissioner-adjusted team score is not included'});
  let data=null,busy=false,version=0,identity;
  const record=t=>`${t.record.wins}–${t.record.losses}${t.record.ties?'–'+t.record.ties:''}`;
  const status=(message,error=false)=>{$('outlook-status').textContent=message;$('outlook-status').dataset.error=String(error);};
  function clear(){data=null;version++;$('outlook-content').hidden=true;for(const id of ['league-name','league-context','outlook-summary','outlook-coverage','outlook-schedule','outlook-lineup','outlook-subtotal','review-players','other-players','excluded-players','outlook-team','outlook-week'])$(id).replaceChildren();}
  function warning(text){return el('p',text,'outlook-warning');}
  function render(){
    if(!data)return;const team=data.league.teams.find(t=>t.id===$('outlook-team').value),week=Number($('outlook-week').value);if(!team)return;
    const summary=$('outlook-summary');summary.replaceChildren();
    for(const [value,label]of [[record(team),'Current record'],[team.pointsFor.toFixed(1),'Points scored'],[data.schedule.length,'Regular-season weeks left']]){const card=el('div',null,'outlook-stat');card.append(el('strong',value),el('span',label));summary.append(card);}
    const schedule=$('outlook-schedule');schedule.replaceChildren();
    for(const row of data.schedule){
      const pair=row.pairs.find(p=>p.includes(team.id)),opponent=data.league.teams.find(t=>t.id===pair?.find(id=>id!==team.id)),tr=el('tr',null,row.week===week?'selected':'');
      const cell=el('td'),button=el('button',`Week ${row.week}`,'week-button');button.type='button';button.setAttribute('aria-pressed',String(row.week===week));button.onclick=()=>{$('outlook-week').value=String(row.week);render();};cell.append(button);
      tr.append(cell,el('td',row.issues.length?'Matchup needs review':opponent?.name||'Opponent unavailable'),el('td',opponent?record(opponent):'—'));schedule.append(tr);
    }
    const lineup=data.lineups.find(l=>String(l.rosterId)===team.id&&l.week===week),body=$('outlook-lineup');body.replaceChildren();$('outlook-subtotal').replaceChildren();
    $('lineup-title').textContent=`Week ${week||'—'} candidate lineup`;
    $('lineup-note').textContent=lineup?'From your current roster, using your league’s starting slots.':'Lineup estimates are not available for these settings yet.';
    const started=lineup?.warnings.some(w=>w.reason==='locked_lineup_unavailable');
    $('lineup-note').className=started||lineup?.unfilled.length||lineup?.pendingResults?'outlook-warning':'outlook-muted';
    if(started)$('lineup-note').textContent='Locked starters could not be confirmed. Remaining lineup estimates are withheld for this week.';
    else if(lineup?.unfilled.length)$('lineup-note').textContent=`${lineup.unfilled.length} starting spot(s) need more information. The subtotal below is incomplete.`;
    else if(lineup?.pendingResults)$('lineup-note').textContent=`${lineup.pendingResults} locked player(s) still need a final score. Their live points are shown but excluded from the subtotal.`;
    else if(lineup?.lockedCount)$('lineup-note').textContent='Completed starters stay locked in their original slots with actual points. Remaining slots use estimated points.';
    const slotNames={SUPER_FLEX:'SFLX',WRRB_FLEX:'RB/WR',REC_FLEX:'WR/TE'};
    for(const row of lineup?.lineup||[]){
      const tr=el('tr'),slot=el('td'),p=row.player,name=el('td',p?.name||'Not enough information');slot.append(el('span',slotNames[row.slot]||row.slot,'slot '+(p?.positions[0]||row.slot)));
      if(p?.locked)name.append(el('small',p.gameStatus==='complete'?'Locked · final':'Locked · live','outlook-estimate-note'));
      else if(p?.limitedHistory)name.append(el('small',`Early estimate · ${p.historyGames} game${p.historyGames===1?'':'s'}`,'outlook-estimate-note'));
      const value=p?.points??(p?.locked?p.actualPoints:null);tr.append(slot,name,el('td',Number.isFinite(value)?value.toFixed(1):'—'));body.append(tr);
    }
    if(lineup)$('outlook-subtotal').append(el('span',lineup.unfilled.length||lineup.pendingResults?'Partial lineup subtotal':lineup.lockedCount?'Final points + estimates':'Lineup subtotal'),el('strong',lineup.modeledPoints.toFixed(1)));
    const review=$('review-players');review.replaceChildren();const items=[...(lineup?.possibleStarters||[]),...(lineup?.lineupNotes||[])];
    for(const item of items)review.append(el('li',(item.name?item.name+' — ':'')+(reasons[item.reason]||'Needs review')));
    $('review-title').textContent=`Starting-lineup questions (${items.length})`;$('outlook-review').hidden=!items.length;
    const others=$('other-players');others.replaceChildren();for(const item of lineup?.otherNotes||[])others.append(el('li',item.name+' — '+(reasons[item.reason]||'Needs review')));
    $('other-title').textContent=`Other roster notes (${lineup?.otherNotes.length||0})`;$('outlook-other').hidden=!lineup?.otherNotes.length;
    const excluded=$('excluded-players');excluded.replaceChildren();for(const item of lineup?.excluded||[])excluded.append(el('li',item.name+' — '+(reasons[item.reason]||item.reason)));
    $('excluded-title').textContent=`Outside this week’s lineup pool (${lineup?.excluded.length||0})`;$('outlook-excluded').hidden=!lineup?.excluded.length;
  }
  async function load(){
    if(busy)return;clear();const current=version;busy=true;$('loadLeagueBtn').disabled=true;$('outlook-gate').hidden=true;status('Loading your league’s schedule and candidate lineups…');
    try{
      const result=await DynastyAccount.request('outlook-league',{league_id:$('leagueId').value.trim()});if(version!==current)return;data=result;
      $('league-name').textContent=data.league.name;$('league-context').textContent=`${data.league.season} · ${data.league.teams.length} teams · Player history through Week ${data.historyThrough.week}`;
      $('outlook-team').replaceChildren(...data.league.teams.map(t=>new Option(t.name,t.id)));
      const own=String(window.DynastyLeagues?.teamFor(data.league.id)||'');if(data.league.teams.some(t=>t.id===own))$('outlook-team').value=own;
      $('outlook-week').replaceChildren(...data.schedule.map(s=>new Option(String(s.week),String(s.week))));
      const next=data.schedule.find(s=>s.week>data.currentWeek);if(next)$('outlook-week').value=String(next.week);
      const coverage=$('outlook-coverage');coverage.replaceChildren();
      if(data.coverage.scoring.length)coverage.append(warning('This league uses scoring rules that the projection model does not yet support. You can still review its schedule.'));
      if(data.coverage.slots.length)coverage.append(warning('Some starting positions are not modeled yet: '+data.coverage.slots.join(', ')+'. Lineup subtotals are incomplete.'));
      if(data.coverage.nflSchedule.length)coverage.append(warning('The NFL schedule needs review. Bye-week eligibility cannot currently be confirmed.'));
      if(data.coverage.bestBall)coverage.append(warning('This is a best-ball league. These candidate lineups do not model best-ball scoring.'));
      if(data.coverage.medianGame)coverage.append(warning('This league has an extra game against the league median. Future record projections will need to include it.'));
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
