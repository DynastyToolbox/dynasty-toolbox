'use strict';
(() => {
  const $=id=>document.getElementById(id), api=(action,body={})=>DynastyAccount.request(action,body);
  let teams=[{id:1,status:'overall',roster_id:''},{id:2,status:'overall',roster_id:''}],nextId=3,transfers=[],league=null,access=null,players=[],revision=0,running=false,timer,loading=false;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,fn,cls)=>{const n=el('button',text,cls);n.type='button';n.onclick=fn;return n;};
  const teamName=team=>league?.teams.find(t=>t.roster_id===team.roster_id)?.name||'Team '+team.id;
  const roster=team=>league?.teams.find(t=>t.roster_id===team.roster_id);
  const message=(text,error=false)=>{$('trade-message').textContent=text;$('trade-message').dataset.error=String(error);};
  const format=()=>DynastyScoring.read();
  function choices(options,value,label,change){const select=el('select');select.setAttribute('aria-label',label);for(const [v,t,disabled] of options){const o=new Option(t,v);o.disabled=!!disabled;select.add(o);}select.value=value;select.onchange=()=>change(select.value);return select;}
  function updateControls(){
    $('addTeamButton').disabled=loading||!access||teams.length>=access.features.tradeTeams;
    $('trade-league-section').hidden=!access?.features.tradeLeagueImport;
    $('trade-access-note').textContent=access?.premium?'Premium access · Up to 12 team trades and league input.':'Free access · Two teams. Premium: Up to 12 team trades and league input.';
    $('leave-league').hidden=!league;
    $('loadLeagueBtn').disabled=loading||!access?.features.tradeLeagueImport;
    $('refresh-trade-league').hidden=!league;
    $('refresh-trade-league').disabled=loading;
    $('trade-league-name').textContent=league?`${league.name} · ${league.season}`:'';
  }
  function balancePending(text='Updating market values…'){
    $('trade-balance').setAttribute('aria-busy','true');
    $('trade-balance-content').replaceChildren(el('p',text));
  }
  function changed(clearMessage=true){if(clearMessage)message('');revision++;balancePending();renderTeams();schedule();}
  function addAsset(team,asset){
    if(transfers.some(m=>m.from===team.id&&m.asset===asset))return;
    const other=teams.find(t=>t.id!==team.id&&(!league||t.roster_id));
    if(!other){message('Select another league team to receive this asset.',true);return;}
    transfers.push({from:team.id,to:other.id,asset});changed();
  }
  function renderTeams(){
    const container=$('tradeContainer');container.replaceChildren();
    for(const team of teams){
      const box=el('section',undefined,'trade-box');box.id=`team${team.id}Box`;box.setAttribute('aria-label','Trade team '+team.id);
      const header=el('div',undefined,'trade-header');header.append(el('span',teamName(team)));
      header.append(choices([['overall','Overall'],['competing','Contending'],['tanking','Rebuilding']],team.status,`Team ${team.id} value system`,value=>{team.status=value;changed();}));
      if(teams.length>2)header.append(button('Remove Team',()=>{teams=teams.filter(t=>t!==team);transfers=transfers.filter(m=>m.from!==team.id&&m.to!==team.id);changed();},'remove-team-btn'));
      box.append(header);
      if(league){
        const label=el('label','League team','trade-team-label'),select=choices([['','Choose a league team'],...league.teams.map(t=>[t.roster_id,`${t.name}${t.manager&&t.name!==t.manager?' — '+t.manager:''}`,teams.some(other=>other!==team&&other.roster_id===t.roster_id)])],team.roster_id,`Team ${team.id} league roster`,value=>{
          team.roster_id=value;transfers=transfers.filter(m=>m.from!==team.id&&m.to!==team.id);changed();
        });label.append(select);box.append(label);
        const pickLabel=el('label','Pick preference','trade-team-label');
        pickLabel.append(choices([['low','Low (−20%)'],['neutral','Neutral'],['high','High (+20%)']],team.pickWeight||'neutral',`Team ${team.id} pick preference`,value=>{team.pickWeight=value;changed();}));
        box.append(pickLabel);
        const ranks=el('div','Select a team to see its league ranks.','trade-ranks');ranks.id=`team${team.id}Ranks`;box.append(ranks);
      }
      const sends=el('div',undefined,'trade-sends');sends.append(el('h3','Sends:'));
      if(league){
        const assets=[...(roster(team)?.assets||[])].sort((a,b)=>{
          const order={QB:0,RB:1,WR:2,TE:3,PICK:5};
          return (order[a.position]??4)-(order[b.position]??4)||(a.position==='PICK'?0:
            DynastyScoring.score(b.scores[team.status].value,b.scores[team.status].position,format())-DynastyScoring.score(a.scores[team.status].value,a.scores[team.status].position,format()));
        });
        const select=choices([['','Choose a player or pick'],...assets.filter(a=>!transfers.some(m=>m.asset===a.id)).map(a=>[a.id,`${a.label} · ${a.position}${a.scores[team.status].ranked?'':' · Unranked'}`])],'',`Team ${team.id} player or pick`,value=>{if(value)addAsset(team,value);});
        select.className='trade-roster-assets';select.disabled=!team.roster_id||loading;sends.append(select);
      }else{
        const input=el('input');input.type='search';input.placeholder='Search for a player or pick';input.className='player-search';input.setAttribute('aria-label',`Team ${team.id} search players and picks`);
        const suggestions=el('div',undefined,'suggestions-box');
        input.oninput=()=>{suggestions.replaceChildren();const q=input.value.trim().toLowerCase();suggestions.style.display=q?'block':'none';if(q)for(const p of players.filter(p=>p.Player.toLowerCase().includes(q)&&!transfers.some(m=>m.from===team.id&&m.asset===p.Player)).slice(0,5))suggestions.append(button(p.Player,()=>addAsset(team,p.Player),'suggestion-item'));};
        input.onkeydown=event=>{if(event.key==='Escape'){suggestions.style.display='none';}if(event.key==='ArrowDown'){event.preventDefault();suggestions.querySelector('button')?.focus();}};
        sends.append(input,suggestions);
      }
      const sendList=el('ul',undefined,'trade-list');sendList.id=`team${team.id}Sends`;
      for(const move of transfers.filter(m=>m.from===team.id)){
        const label=league?roster(team)?.assets.find(a=>a.id===move.asset)?.label:move.asset;
        const row=el('li',undefined,'trade-item');row.dataset.asset=move.asset;
        row.append(el('span',label||move.asset,'trade-asset-name'));
        const score=el('span','…','player-score');row.append(score);
        const dest=choices(teams.filter(t=>t!==team).map(t=>[String(t.id),teamName(t),!!league&&!t.roster_id]),String(move.to),`Send ${label} to`,value=>{move.to=Number(value);changed();});dest.className='dest-select';row.append(dest);
        const remove=button('✖',()=>{transfers=transfers.filter(m=>m!==move);changed();},'remove-btn');remove.setAttribute('aria-label','Remove '+label);row.append(remove);sendList.append(row);
      }
      sends.append(sendList);box.append(sends,el('h3','Receives:'));
      const receives=el('ul',undefined,'trade-list');receives.id=`team${team.id}Receives`;box.append(receives);
      const totals=el('div','Updating values…','trade-totals');totals.id=`team${team.id}Totals`;box.append(totals);container.append(box);
    }
    container.classList.toggle('grid',teams.length>=3);updateControls();
  }
  function renderResult(result){
    DynastyTradeBalance.render($('trade-balance-content'),result.teams.map(t=>({...t,name:teamName(teams.find(team=>team.id===t.id))})),transfers.length>0);
    $('trade-balance').setAttribute('aria-busy','false');
    for(const team of result.teams){
      const sends=$(`team${team.id}Sends`);if(!sends)continue;
      for(const asset of team.sends){const row=[...sends.children].find(r=>r.dataset.asset===asset.asset);if(row)row.querySelector('.player-score').textContent=asset.ranked?asset.score.toFixed(2):'Unranked · 0.00';}
      sends.querySelectorAll('.bonus-item').forEach(n=>n.remove());
      if(team.studBonus>0){const row=el('li',undefined,'trade-item bonus-item');row.append(el('span','Stud Bonus'),el('span',team.studBonus.toFixed(2),'player-score'));sends.insertBefore(row,sends.children[1]||null);}
      const receives=$(`team${team.id}Receives`);receives.replaceChildren();for(const asset of team.receives){const row=el('li',undefined,'trade-item');row.append(el('span',asset.label,'trade-asset-name'),el('span',asset.ranked?asset.score.toFixed(2):'Unranked · 0.00','player-score'));receives.append(row);}
      const totals=$(`team${team.id}Totals`);totals.replaceChildren();for(const [name,value] of [['Sends Total',team.sendsTotal],['Receives Total',team.receivesTotal],['Trade Total',team.total]]){const p=el('p',name+': '),v=el('span',value.toFixed(2),name==='Trade Total'?'trade-total '+(value>0?'positive':value<0?'negative':''):'');p.append(v);totals.append(p);}
      if(team.ranks){
        const panel=$(`team${team.id}Ranks`);panel.replaceChildren(el('strong','League rank'));
        for(const [type,name] of [['competing','Contending'],['tanking','Rebuilding']]){
          const before=team.ranks.before[type].rank,after=team.ranks.after[type].rank;
          const row=el('p',`${name}: #${after}`);
          if(before!==after){
            const up=after<before,arrow=el('span',up?'↑':'↓','trade-rank-change '+(up?'rank-up':'rank-down'));
            const description=`${up?'Up':'Down'} ${Math.abs(before-after)} ${Math.abs(before-after)===1?'place':'places'} from the original roster rank`;
            arrow.setAttribute('role','img');arrow.setAttribute('aria-label',description);arrow.title=description;row.append(arrow);
          }
          panel.append(row);
        }
      }
    }
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(calculate,150);}
  async function calculate(){
    if(running||!access||loading)return;running=true;const version=revision;balancePending();
    try{
      const result=await api('trade-evaluate',{teams:teams.map(t=>({...t})),transfers:transfers.map(m=>({...m})),format:format(),league_id:league?.id});
      if(version===revision)renderResult(result);
    }catch(e){if(version===revision){message(e.message,true);balancePending('Market values unavailable — use Retry values below.');$('trade-balance').setAttribute('aria-busy','false');document.querySelectorAll('.trade-totals').forEach(n=>n.textContent='Values unavailable — retry below.');document.querySelectorAll('.trade-ranks').forEach(n=>n.textContent='Ranks unavailable.');}}
    finally{running=false;if(version!==revision)schedule();}
  }
  async function loadLeague(refresh=false){
    await ready;if(loading)return;loading=true;revision++;balancePending();updateControls();message('Loading league rosters and draft picks…');
    try{
      const id=refresh?league.id:$('leagueId').value.trim(), result=await api('trade-league',{league_id:id,refresh});
      league=result.league;transfers=[];
      const defaultTeam=String(window.DynastyLeagues?.teamFor(id)||'');
      teams=teams.map((t,i)=>({...t,pickWeight:refresh?t.pickWeight:'neutral',roster_id:refresh&&league.teams.some(r=>r.roster_id===t.roster_id)?t.roster_id:i===0&&league.teams.some(r=>r.roster_id===defaultTeam)?defaultTeam:''}));
      $('leagueId').value=id;message('Choose a league team in each box. Loading or refreshing a league clears the trade.');
    }catch(e){message(e.message,true);}
    finally{loading=false;changed(false);}
  }
  $('loadLeagueBtn').onclick=()=>loadLeague();
  $('leagueId').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();loadLeague();}};
  $('refresh-trade-league').onclick=()=>loadLeague(true);
  $('leave-league').onclick=()=>{league=null;transfers=[];teams.forEach(t=>{t.roster_id='';t.pickWeight='neutral';});changed();};
  $('clear-trade').onclick=()=>{transfers=[];changed();};
  $('retry-trade').onclick=()=>{if(access)calculate();else initialize();};
  $('addTeamButton').onclick=()=>{if(!access||teams.length>=access.features.tradeTeams)return;teams.push({id:nextId++,status:'overall',roster_id:''});changed();};
  DynastyScoring.bind(changed);
  async function initialize(){
    try{
      const [config,rows]=await Promise.all([api('trade-config'),DynastyRankings.getRows('overall')]);access=config.access;players=rows;changed();
    }catch(e){message(e.message,true);balancePending('Market values unavailable — use Retry values below.');$('trade-balance').setAttribute('aria-busy','false');updateControls();}
  }
  const ready=initialize();
  // Saved leagues can finish loading before membership access enables the Load button.
  // Retry the saved-link handoff once both are ready, without importing an unknown URL ID.
  ready.then(async()=>{
    await window.DynastyLeagues?.ready;
    const params=new URLSearchParams(location.search),chosen=params.get('league');
    if(access?.features.tradeLeagueImport&&chosen&&params.has('from')&&params.has('to')){
      if(!league&&!loading){$('leagueId').value=chosen;await loadLeague();}
      if(!league||league.id!==chosen)return;
      const from=league.teams.find(t=>t.roster_id===params.get('from')),to=league.teams.find(t=>t.roster_id===params.get('to'));
      const send=params.getAll('send'),receive=params.getAll('receive'),assets=[...send,...receive];
      if(!from||!to||from===to||!send.length||!receive.length||assets.length>120||new Set(assets).size!==assets.length||send.some(id=>!from.assets.some(a=>a.id===id))||receive.some(id=>!to.assets.some(a=>a.id===id))){message('This trade idea no longer matches the league rosters. Build a new trade.',true);return;}
      const mode=['overall','competing','tanking'].includes(params.get('mode'))?params.get('mode'):'overall';
      const theirMode=['overall','competing','tanking'].includes(params.get('theirMode'))?params.get('theirMode'):'overall';
      const weight=key=>['low','neutral','high'].includes(params.get(key))?params.get(key):'neutral';
      teams=[{id:1,status:mode,roster_id:from.roster_id,pickWeight:weight('pickWeight')},{id:2,status:theirMode,roster_id:to.roster_id,pickWeight:weight('theirPickWeight')}];
      transfers=[...send.map(asset=>({from:1,to:2,asset})),...receive.map(asset=>({from:2,to:1,asset}))];nextId=3;
      const ppr=['std','hppr','ppr'].includes(params.get('ppr'))?params.get('ppr'):'hppr';
      $('nonPpr').checked=ppr==='std';$('halfPpr').checked=ppr==='hppr';$('fullPpr').checked=ppr==='ppr';$('superflex').checked=params.get('sf')!=='false';$('tePremium').checked=params.get('tep')==='true';
      changed();message('Trade idea loaded. Review the values and adjust the proposal.');return;
    }
    if(access?.features.tradeLeagueImport&&chosen&&$('saved-league-select')?.value===chosen&&!league&&!loading)await loadLeague();
  }).catch(e=>message(e.message,true));
  // Returning from account settings must recheck grants instead of trusting old page state.
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  document.addEventListener('visibilitychange',async()=>{
    if(document.hidden||loading)return;
    try{access=(await api('trade-config')).access;if(!access.premium&&(league||teams.length>2)){league=null;teams=teams.slice(0,2);teams.forEach(t=>{t.roster_id='';t.pickWeight='neutral';});transfers=[];}changed();}catch(e){access=null;revision++;balancePending('Sign in again or use Retry values below.');$('trade-balance').setAttribute('aria-busy','false');message(e.message,true);updateControls();}
  });
})();
