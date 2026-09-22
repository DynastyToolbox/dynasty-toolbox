'use strict';
(()=>{
  const $=id=>document.getElementById(id),api=(action,body)=>DynastyAccount.request(action,body);
  const modes={overall:'Overall',competing:'Contending',tanking:'Rebuilding'},weights={low:.8,neutral:1,high:1.2},positions=['QB','RB','WR','TE','PICK'];
  let league=null,rosters=[],excluded=new Set(),preferences=new Map(),busy=false,saving=false,version=0,prefsDirty=false,prefsTask=null,accountEpoch=0,prefsReady=false;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const status=(text,error=false)=>{$('finder-status').textContent=text;$('finder-status').dataset.error=String(error);};
  const format=()=>({ppr:$('finder-ppr').value,superflex:$('finder-sf').checked,tePremium:$('finder-te').checked});
  const signed=n=>(n>=0?'+':'−')+Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:0});
  function lock(value){busy=value;for(const id of ['loadLeagueBtn','find-partners','apply-exclusions','apply-preferences'])$(id).disabled=value||saving||(id!=='loadLeagueBtn'&&!league);}
  const context=()=>({league_id:league.id,roster_id:$('finder-team').value,mode:$('finder-mode').value,format:format(),excluded:[...excluded],preferences:[...preferences].map(([roster_id,p])=>({roster_id,...p}))});
  const tradeKey=p=>JSON.stringify([p.send.map(a=>a.id).sort(),p.receive.map(a=>a.id).sort()]);
  function invalidate(){version++;$('finder-results').replaceChildren();$('finder-summary').replaceChildren();}
  function settingsChanged(){invalidate();exclusions();status('Settings changed. Choose Find partners or Update matches.');}
  async function savePreferences(){
    if(prefsTask)return prefsTask;
    if(!prefsDirty||!league||!prefsReady)return;
    const epoch=accountEpoch,id=league.id;
    prefsTask=(async()=>{
      while(prefsDirty&&epoch===accountEpoch&&league?.id===id){
        prefsDirty=false;
        try{await api('finder-save-preferences',{league_id:id,preferences:[...preferences].map(([roster_id,p])=>({roster_id,...p}))});}
        catch(e){if(epoch===accountEpoch)prefsDirty=true;throw e;}
      }
    })();
    try{await prefsTask;}finally{prefsTask=null;}
  }
  function preferenceChanged(){
    settingsChanged();prefsDirty=true;
    savePreferences().then(()=>{if(!prefsDirty)status('Team preferences saved. Choose Update matches.');}).catch(e=>status(e.message,true));
  }
  function teamPreferences(){
    const box=$('team-preferences');box.replaceChildren();
    for(const t of rosters){
      const pref=preferences.get(t.id),row=el('div',null,'finder-preference'),name=el('strong',t.name);
      const label=el('label','Approach'),select=el('select');select.setAttribute('aria-label',t.name+' approach');
      for(const [v,text] of Object.entries(modes))select.add(new Option(text,v));select.value=pref.mode;
      select.onchange=()=>{pref.mode=select.value;if(t.id===$('finder-team').value)$('finder-mode').value=select.value;preferenceChanged();};label.append(select);
      const field=el('fieldset',null,'finder-pick-weight');field.append(el('legend','Pick preference'));
      for(const [v,text] of [['low','Low −20%'],['neutral','Neutral'],['high','High +20%']]){
        const l=el('label'),input=el('input');input.type='radio';input.name='pick-weight-'+t.id;input.value=v;input.checked=pref.pickWeight===v;input.setAttribute('aria-label',t.name+' picks '+text);
        input.onchange=()=>{pref.pickWeight=v;preferenceChanged();};l.append(input,el('span',text));field.append(l);
      }
      row.append(name,label,field);box.append(row);
    }
  }
  function exclusions(){
    const box=$('exclude-players');box.replaceChildren();
    const roster=rosters.find(t=>t.id===$('exclude-roster').value),q=$('exclude-search').value.toLowerCase(),pref=preferences.get(roster?.id);
    if(!roster||!pref)return;
    const value=p=>DynastyScoring.score(p.scores[pref.mode].value,p.scores[pref.mode].position,format())*(p.position==='PICK'?weights[pref.pickWeight]:1);
    for(const pos of positions){
      const assets=roster.players.filter(p=>p.position===pos&&p.name.toLowerCase().includes(q)).sort((a,b)=>value(b)-value(a)||a.name.localeCompare(b.name));
      if(!assets.length)continue;
      const group=el('section',null,'finder-position position-'+pos);group.append(el('h3',pos==='PICK'?'Draft picks':pos));
      for(const p of assets){
        const label=el('label'),input=el('input');input.type='checkbox';input.checked=excluded.has(p.id);
        input.onchange=()=>{if(input.checked){if(excluded.size>=120){input.checked=false;status('You can exclude up to 120 players and picks.',true);return;}excluded.add(p.id);}else excluded.delete(p.id);invalidate();status('Selections changed. Choose Update matches.');};
        label.append(input,el('span',p.name),el('small',p.scores[pref.mode].ranked?value(p).toLocaleString(undefined,{maximumFractionDigits:0}):'Unranked'));group.append(label);
      }
      box.append(group);
    }
    if(!box.children.length)box.append(el('p','No matching players or picks.'));
  }
  async function load(){
    if(busy||saving)return;try{await savePreferences();}catch(e){status(e.message,true);return;}invalidate();const current=version;lock(true);league=null;rosters=[];excluded.clear();preferences.clear();prefsReady=false;
    $('finder-exclusions').hidden=true;$('finder-preferences').hidden=true;$('finder-team').disabled=true;$('finder-team').replaceChildren(new Option('Loading…',''));status('Finding league rosters…');
    try{
      const result=await api('finder-league',{league_id:$('leagueId').value.trim()});if(current!==version)return;
      league=result.league;
      $('finder-sf').checked=league.lineup.slots.includes('SUPER_FLEX')||league.lineup.slots.filter(p=>p==='QB').length>1;
      const reception=Number(league.scoring.rec??.5);$('finder-ppr').value=reception>=1?'ppr':reception>0?'hppr':'std';$('finder-te').checked=Number(league.scoring.bonus_rec_te||0)>0;
      $('finder-team').replaceChildren(new Option('Choose your team',''),...league.teams.map(t=>new Option(t.name,t.id)));$('finder-team').disabled=false;
      const own=String(window.DynastyLeagues?.teamFor(league.id)||'');if(league.teams.some(t=>t.id===own))$('finder-team').value=own;status(league.name);
      if(result.premium){
        const result=await api('finder-rosters',{league_id:league.id});if(current!==version)return;
        rosters=result.teams;
        const saved=await api('finder-preferences',{league_id:league.id});if(current!==version)return;
        preferences=new Map(rosters.map(t=>[t.id,saved.preferences.find(p=>p.roster_id===t.id)||{mode:'overall',pickWeight:'neutral'}]));
        prefsReady=true;prefsDirty=false;if(preferences.has(own))$('finder-mode').value=preferences.get(own).mode;
        $('exclude-roster').replaceChildren(...rosters.map(t=>new Option(t.name,t.id)));if(rosters.some(t=>t.id===own))$('exclude-roster').value=own;
        teamPreferences();exclusions();$('finder-exclusions').hidden=false;$('finder-preferences').hidden=false;
      }
    }catch(e){league=null;prefsReady=false;status(e.message,true);}finally{lock(false);}
    if(current===version&&league&&$('finder-team').value)await find();
  }
  async function find(){
    if(busy||saving||!league)return;if(!$('finder-team').value){status('Choose your team first.',true);return;}
    invalidate();const current=version;lock(true);status('Comparing players, picks and team preferences…');
    try{
      await savePreferences();if(current!==version)return;
      const body=context(),result=await api('finder-matches',body);
      result.pins=[];
      if(result.premium){try{result.pins=(await api('finder-pins',body)).pins;}catch(e){result.pinsError=e.message;}}
      if(current!==version)return;render(result);status(result.matches.length+' potential trade '+(result.matches.length===1?'partner':'partners')+' · '+league.name);
    }catch(e){if(current===version)status(e.message,true);}finally{lock(false);}
  }
  function proposal(p,result,m){
    const idea=el('div',null,'finder-proposal'+(p.id?' finder-pinned':''));
    idea.append(el('p','You send: '+p.send.map(a=>a.name).join(' + ')),el('p','You receive: '+p.receive.map(a=>a.name).join(' + ')));
    if(!p.unavailable){
    idea.append(el('p','Overall balance: '+(p.gap*100).toFixed(1)+'% apart','finder-market'));
    const values=el('div',null,'finder-values');
    for(const [name,pref,net] of [['You',result.team.preference,p.myNet],[m.name,m.preference,p.theirNet]]){
      const line=el('p',name+' · '+modes[pref.mode]+': ');line.append(el('strong',signed(net),net>=0?'finder-gain':'finder-loss'));values.append(line);
    }
    idea.append(values);
    }
    if(p.notice)idea.append(el('p',p.notice,'finder-pin-notice'));
    const label=el('label',null,'finder-pin-control'),input=el('input');input.type='checkbox';input.checked=!!p.id;input.disabled=!!result.pinsError;
    input.setAttribute('aria-label',(p.id?'Unpin':'Pin')+' trade: '+p.send.map(a=>a.name).join(' + ')+' for '+p.receive.map(a=>a.name).join(' + '));
    label.append(input,el('span',p.id?'Pinned to your account':'Pin this trade'));idea.append(label);
    input.onchange=async()=>{
      if(saving||busy){input.checked=!!p.id;return;}
      const current=version,wantPin=input.checked,body=context();saving=true;lock(busy);input.disabled=true;
      try{
        const response=await api(wantPin?'finder-pin':'finder-unpin',wantPin?{...body,partner_id:m.id,send:p.send.map(a=>a.id),receive:p.receive.map(a=>a.id)}:{id:p.id});
        if(current!==version)return;
        if(wantPin)result.pins.push(response.pin);else result.pins=result.pins.filter(pin=>pin.id!==p.id);
        render(result);status(response.message);
      }catch(e){if(current===version){input.checked=!!p.id;input.disabled=false;status(e.message,true);}}
      finally{saving=false;lock(busy);}
    };
    return idea;
  }
  function render(result){
    const summary=$('finder-summary');summary.replaceChildren(el('h2',result.team.name),el('p','Needs: '+(result.team.needs.join(', ')||'None')),el('p','Depth: '+(result.team.surplus.join(', ')||'None')));
    summary.append(el('p',(result.team.requirements.fallback?'Default lineup (Sleeper slots unavailable): ':'Sleeper lineup: ')+result.team.requirements.slots.join(' \u00b7 '),'finder-note'));
    const box=$('finder-results');box.replaceChildren();
    if(result.pinsError)box.append(el('p',result.pinsError,'finder-pin-error'));
    const matches=[...result.matches];
    for(const pin of result.pins)if(!matches.some(m=>m.id===pin.partner_id))matches.push({id:pin.partner_id,name:pin.partnerName,needs:pin.needs,preference:pin.preference,proposals:[]});
    if(!matches.length)box.append(el('p','No trade ideas met these settings. Try another approach or adjust team preferences.'));
    for(const m of matches){
      const card=el('article',null,'finder-match');
      card.append(el('h3',m.name),el('p','Needs: '+(m.needs.join(', ')||'None')));
      if(!result.premium)card.append(el('p','Premium adds trade ideas, pins and team preferences.'));
      else{
        card.append(el('p',modes[m.preference.mode]+' · '+m.preference.pickWeight+' pick preference','finder-note'));
        const pins=result.pins.filter(p=>p.partner_id===m.id),keys=new Set(pins.map(tradeKey)),ideas=m.proposals.filter(p=>!keys.has(tradeKey(p)));
        if(pins.length){card.append(el('h4','Pinned trades'),el('p','Values use your current settings.','finder-note'));pins.forEach(p=>card.append(proposal(p,result,m)));}
        if(pins.length&&ideas.length)card.append(el('h4','More ideas'));
        ideas.slice(0,2).forEach(p=>card.append(proposal(p,result,m)));
        if(ideas.length>2){const more=el('details',null,'finder-more');more.append(el('summary',(ideas.length-2)+' more trade ideas'));ideas.slice(2).forEach(p=>more.append(proposal(p,result,m)));card.append(more);}
        if(!ideas.length&&!pins.length)card.append(el('p','No packages met the 3,000-point main-asset rule, Overall balance and both teams’ value limits.'));
        if(m.searchLimited)card.append(el('p','Deep-roster search: top 40 ranked players and 24 ranked picks per team.','finder-note'));
      }
      box.append(card);
    }
  }
  $('loadLeagueBtn').onclick=load;$('leagueId').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load();}};
  $('find-partners').onclick=find;$('apply-exclusions').onclick=find;$('apply-preferences').onclick=find;$('exclude-roster').onchange=exclusions;$('exclude-search').oninput=exclusions;
  $('finder-team').onchange=()=>{const pref=preferences.get($('finder-team').value);if(pref)$('finder-mode').value=pref.mode;settingsChanged();};
  $('finder-mode').onchange=()=>{const pref=preferences.get($('finder-team').value);if(pref){pref.mode=$('finder-mode').value;teamPreferences();preferenceChanged();}else settingsChanged();};
  for(const id of ['finder-ppr','finder-sf','finder-te'])$(id).onchange=settingsChanged;
  window.addEventListener('dynasty-account-change',()=>{accountEpoch++;prefsDirty=false;prefsReady=false;invalidate();rosters=[];preferences.clear();excluded.clear();$('finder-exclusions').hidden=true;$('finder-preferences').hidden=true;if(league)status('Account changed. Reload your league to refresh access.');});
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
  fetch('/nav.html').then(r=>r.text()).then(html=>$('nav-placeholder').innerHTML=html).catch(()=>{});
})();
