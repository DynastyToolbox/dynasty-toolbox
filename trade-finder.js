'use strict';
(()=>{
  const $=id=>document.getElementById(id),api=(action,body)=>DynastyAccount.request(action,body);
  const modes={overall:'Overall',competing:'Contending',tanking:'Rebuilding'},weights={low:.8,neutral:1,high:1.2},positions=['QB','RB','WR','TE','PICK'];
  let league=null,rosters=[],excluded=new Set(),preferences=new Map(),busy=false,version=0;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const status=(text,error=false)=>{$('finder-status').textContent=text;$('finder-status').dataset.error=String(error);};
  const format=()=>({ppr:$('finder-ppr').value,superflex:$('finder-sf').checked,tePremium:$('finder-te').checked});
  const signed=n=>(n>=0?'+':'−')+Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:0});
  function lock(value){busy=value;for(const id of ['loadLeagueBtn','find-partners','apply-exclusions','apply-preferences'])$(id).disabled=value||(id!=='loadLeagueBtn'&&!league);}
  function invalidate(){version++;$('finder-results').replaceChildren();$('finder-summary').replaceChildren();}
  function settingsChanged(){invalidate();exclusions();status('Settings changed. Choose Find partners or Update matches.');}
  function teamPreferences(){
    const box=$('team-preferences');box.replaceChildren();
    for(const t of rosters){
      const pref=preferences.get(t.id),row=el('div',null,'finder-preference'),name=el('strong',t.name);
      const label=el('label','Approach'),select=el('select');select.setAttribute('aria-label',t.name+' approach');
      for(const [v,text] of Object.entries(modes))select.add(new Option(text,v));select.value=pref.mode;
      select.onchange=()=>{pref.mode=select.value;if(t.id===$('finder-team').value)$('finder-mode').value=select.value;settingsChanged();};label.append(select);
      const field=el('fieldset',null,'finder-pick-weight');field.append(el('legend','Pick preference'));
      for(const [v,text] of [['low','Low −20%'],['neutral','Neutral'],['high','High +20%']]){
        const l=el('label'),input=el('input');input.type='radio';input.name='pick-weight-'+t.id;input.value=v;input.checked=pref.pickWeight===v;input.setAttribute('aria-label',t.name+' picks '+text);
        input.onchange=()=>{pref.pickWeight=v;settingsChanged();};l.append(input,el('span',text));field.append(l);
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
    if(busy)return;invalidate();const current=version;lock(true);league=null;rosters=[];excluded.clear();preferences.clear();
    $('finder-exclusions').hidden=true;$('finder-preferences').hidden=true;$('finder-team').disabled=true;$('finder-team').replaceChildren(new Option('Loading…',''));status('Finding league rosters…');
    try{
      const result=await api('finder-league',{league_id:$('leagueId').value.trim()});if(current!==version)return;
      league=result.league;$('finder-team').replaceChildren(new Option('Choose your team',''),...league.teams.map(t=>new Option(t.name,t.id)));$('finder-team').disabled=false;
      const own=String(window.DynastyLeagues?.teamFor(league.id)||'');if(league.teams.some(t=>t.id===own))$('finder-team').value=own;status(league.name);
      if(result.premium){
        const result=await api('finder-rosters',{league_id:league.id});if(current!==version)return;
        rosters=result.teams;preferences=new Map(rosters.map(t=>[t.id,{mode:t.id===own?$('finder-mode').value:'overall',pickWeight:'neutral'}]));
        $('exclude-roster').replaceChildren(...rosters.map(t=>new Option(t.name,t.id)));if(rosters.some(t=>t.id===own))$('exclude-roster').value=own;
        teamPreferences();exclusions();$('finder-exclusions').hidden=false;$('finder-preferences').hidden=false;
      }
    }catch(e){status(e.message,true);}finally{lock(false);}
    if(current===version&&league&&$('finder-team').value)await find();
  }
  async function find(){
    if(busy||!league)return;if(!$('finder-team').value){status('Choose your team first.',true);return;}
    invalidate();const current=version;lock(true);status('Comparing players, picks and team preferences…');
    try{
      const result=await api('finder-matches',{league_id:league.id,roster_id:$('finder-team').value,mode:$('finder-mode').value,format:format(),excluded:[...excluded],preferences:[...preferences].map(([roster_id,p])=>({roster_id,...p}))});
      if(current!==version)return;render(result);status(result.matches.length+' potential trade '+(result.matches.length===1?'partner':'partners')+' · '+league.name);
    }catch(e){if(current===version)status(e.message,true);}finally{lock(false);}
  }
  function proposal(p,result,m){
    const idea=el('div',null,'finder-proposal');
    idea.append(el('p','You send: '+p.send.map(a=>a.name).join(' + ')),el('p','You receive: '+p.receive.map(a=>a.name).join(' + ')));
    idea.append(el('p','Overall balance: '+(p.gap*100).toFixed(1)+'% apart','finder-market'));
    const values=el('div',null,'finder-values');
    for(const [name,pref,net] of [['You',result.team.preference,p.myNet],[m.name,m.preference,p.theirNet]]){
      const line=el('p',name+' · '+modes[pref.mode]+': ');line.append(el('strong',signed(net),net>=0?'finder-gain':'finder-loss'));values.append(line);
    }
    idea.append(values);
    const a=el('a','Review in calculator →','finder-open');
    const params=new URLSearchParams({league:league.id,from:result.team.id,to:m.id,ppr:format().ppr,sf:String(format().superflex),tep:String(format().tePremium),mode:result.team.preference.mode,theirMode:m.preference.mode,pickWeight:result.team.preference.pickWeight,theirPickWeight:m.preference.pickWeight});
    for(const asset of p.send)params.append('send',asset.id);for(const asset of p.receive)params.append('receive',asset.id);
    a.href='trade_calculator.html?'+params;a.target='_blank';a.rel='noopener';idea.append(a);return idea;
  }
  function render(result){
    const summary=$('finder-summary');summary.replaceChildren(el('h2',result.team.name),el('p','Needs: '+(result.team.needs.join(', ')||'No clear positional shortage')),el('p','Depth: '+(result.team.surplus.join(', ')||'No clear positional surplus')));
    const box=$('finder-results');box.replaceChildren();
    if(!result.matches.length)box.append(el('p','No trade ideas met these settings. Try another approach or adjust team preferences.'));
    for(const m of result.matches){
      const card=el('article',null,'finder-match');
      card.append(el('h3',m.name),el('span',m.mutual?'Needs match in both directions':m.receive.length||m.send.length?'One-way depth match':'Player / pick value match','finder-tag'));
      if(m.receive.length)card.append(el('p','Their depth matches your needs: '+m.receive.join(', ')));if(m.send.length)card.append(el('p','Your depth matches their needs: '+m.send.join(', ')));
      if(!result.premium)card.append(el('p','Premium adds player targets, trade ideas and team preferences.'));
      else{
        card.append(el('p',modes[m.preference.mode]+' · '+m.preference.pickWeight+' pick preference','finder-note'));
        if(m.targets.length)card.append(el('p','Players to explore: '+m.targets.map(p=>p.name+' ('+p.position+')').join(', ')));
        m.proposals.slice(0,2).forEach(p=>card.append(proposal(p,result,m)));
        if(m.proposals.length>2){const more=el('details',null,'finder-more');more.append(el('summary',(m.proposals.length-2)+' more trade ideas'));m.proposals.slice(2).forEach(p=>more.append(proposal(p,result,m)));card.append(more);}
        if(!m.proposals.length)card.append(el('p','No packages met the 15% Overall balance and both teams’ value limits.'));
        if(m.searchLimited)card.append(el('p','Deep-roster search: top 40 ranked players and 24 ranked picks per team.','finder-note'));
      }
      box.append(card);
    }
  }
  $('loadLeagueBtn').onclick=load;$('leagueId').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load();}};
  $('find-partners').onclick=find;$('apply-exclusions').onclick=find;$('apply-preferences').onclick=find;$('exclude-roster').onchange=exclusions;$('exclude-search').oninput=exclusions;
  $('finder-team').onchange=()=>{const pref=preferences.get($('finder-team').value);if(pref)$('finder-mode').value=pref.mode;settingsChanged();};
  $('finder-mode').onchange=()=>{const pref=preferences.get($('finder-team').value);if(pref){pref.mode=$('finder-mode').value;teamPreferences();}settingsChanged();};
  for(const id of ['finder-ppr','finder-sf','finder-te'])$(id).onchange=settingsChanged;
  window.addEventListener('dynasty-account-change',()=>{invalidate();rosters=[];preferences.clear();excluded.clear();$('finder-exclusions').hidden=true;$('finder-preferences').hidden=true;if(league)status('Account changed. Reload your league to refresh access.');});
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
  fetch('/nav.html').then(r=>r.text()).then(html=>$('nav-placeholder').innerHTML=html).catch(()=>{});
})();
