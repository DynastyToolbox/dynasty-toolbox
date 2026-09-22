'use strict';
const {catalog,loadLeague,preferenceValue,PICK_WEIGHTS}=require('./trade-calculator.cjs');
const {score}=require('../scoring_formats.js');
const {requireFeature}=require('./subscription-access.cjs');
const POS=['QB','RB','WR','TE'],MODES=['overall','competing','tanking'];
const LIMITS={marketGap:.15,maxLoss:1000,maxAssets:3,maxPicks:2,maxTotalAssets:4,minAnchor:3000};
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const median=values=>{const a=values.slice().sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
function preferencesFor(league,body,access){
  const mode=body.mode||'overall';
  if(!MODES.includes(mode))fail('Choose a valid ranking system.');
  const prefs=new Map(league.teams.map(t=>[t.roster_id,{mode:t.roster_id===body.roster_id?mode:'overall',pickWeight:'neutral'}]));
  const input=body.preferences??[];
  if(!Array.isArray(input)||input.length>league.teams.length)fail('Invalid team preferences.');
  if(input.length)requireFeature(access,'tradeFinderTargets');
  const seen=new Set();
  for(const p of input){
    if(!p||!prefs.has(p.roster_id)||seen.has(p.roster_id)||!MODES.includes(p.mode)||!Object.hasOwn(PICK_WEIGHTS,p.pickWeight))fail('Invalid team preferences.');
    seen.add(p.roster_id);prefs.set(p.roster_id,{mode:p.mode,pickWeight:p.pickWeight});
  }
  return prefs;
}
function profile(league,id,mode,format){
  // Compare each team's perspective against all rosters in that SAME perspective.
  const profiles=league.teams.map(t=>({id:t.roster_id,name:t.name,values:Object.fromEntries(POS.map(pos=>[pos,t.assets.filter(a=>a.position===pos&&a.scores[mode].ranked).map(a=>score(a.scores[mode].value,a.scores[mode].position,format)).sort((a,b)=>b-a).slice(0,3).reduce((s,n)=>s+n,0)]))}));
  const baseline=Object.fromEntries(POS.map(pos=>[pos,median(profiles.map(p=>p.values[pos]))]));
  const p=profiles.find(p=>p.id===id);
  return {...p,baseline,needs:POS.filter(pos=>baseline[pos]>0&&p.values[pos]<baseline[pos]*.8),surplus:POS.filter(pos=>baseline[pos]>0&&p.values[pos]>baseline[pos]*1.2)};
}
function packages(assets){
  const bySize=[[],[],[],[]];
  function add(items){
    if(items.filter(a=>a.asset.position==='PICK').length>LIMITS.maxPicks)return;
    bySize[items.length].push({items,market:items.reduce((s,a)=>s+a.market,0),max:Math.max(...items.map(a=>a.market)),
      mine:items.reduce((s,a)=>s+a.mine,0),theirs:items.reduce((s,a)=>s+a.theirs,0),
      mineMax:Math.max(...items.map(a=>a.mine)),theirMax:Math.max(...items.map(a=>a.theirs)),
      players:items.filter(a=>a.asset.position!=='PICK').length});
  }
  for(let i=0;i<assets.length;i++){
    add([assets[i]]);
    for(let j=i+1;j<assets.length;j++){
      add([assets[i],assets[j]]);
      for(let k=j+1;k<assets.length;k++)add([assets[i],assets[j],assets[k]]);
    }
  }
  for(const group of bySize)group.sort((a,b)=>a.market-b.market);
  return bySize;
}
function lowerBound(items,value){let lo=0,hi=items.length;while(lo<hi){const mid=(lo+hi)>>>1;if(items[mid].market<value)lo=mid+1;else hi=mid;}return lo;}
const brief=a=>({id:a.id,name:a.label||a.name,position:a.position});
function proposalsFor(mine,their,self,other,minePref,theirPref,format,blocked){
  const decorate=team=>{
    const available=team.assets.filter(a=>(POS.includes(a.position)||a.position==='PICK')&&!blocked.has(a.id)&&a.scores.overall.ranked&&a.scores[minePref.mode].ranked&&a.scores[theirPref.mode].ranked)
      .map(asset=>({asset,market:score(asset.scores.overall.value,asset.scores.overall.position,format),mine:preferenceValue(asset,minePref.mode,format,minePref.pickWeight),theirs:preferenceValue(asset,theirPref.mode,format,theirPref.pickWeight)}))
      .filter(a=>a.market>0).sort((a,b)=>b.market-a.market||a.asset.id.localeCompare(b.asset.id));
    // Bound deep-roster searches; preserve separate player and pick candidate pools.
    return {items:[...available.filter(a=>a.asset.position!=='PICK').slice(0,40),...available.filter(a=>a.asset.position==='PICK').slice(0,24)].sort((a,b)=>b.market-a.market||a.asset.id.localeCompare(b.asset.id)),limited:available.filter(a=>a.asset.position!=='PICK').length>40||available.filter(a=>a.asset.position==='PICK').length>24};
  };
  const yours=decorate(mine),theirs=decorate(their),sends=packages(yours.items),receives=packages(theirs.items);
  let best=[];
  const compare=(a,b)=>b.fit-a.fit||b.utility-a.utility||a.gap-b.gap||a.send.length+a.receive.length-b.send.length-b.receive.length||a.key.localeCompare(b.key);
  for(let sn=1;sn<=3;sn++)for(let rn=1;rn<=3;rn++){
    if(sn+rn>LIMITS.maxTotalAssets)continue;
    for(const s of sends[sn]){
      const candidates=receives[rn],low=s.market*(1-LIMITS.marketGap),high=s.market/(1-LIMITS.marketGap);
      for(let i=lowerBound(candidates,low-1e-8);i<candidates.length&&candidates[i].market<=high+1e-8;i++){
        const r=candidates[i];
        if(s.max<LIMITS.minAnchor||r.max<LIMITS.minAnchor)continue;
        if(!s.players&&!r.players)continue;
        // A consolidation needs a real centerpiece, not a stack of small pieces.
        if((sn>rn&&s.max<r.max*.5)||(rn>sn&&r.max<s.max*.5))continue;
        const myBonus=sn===1&&rn===1?0:Math.max(0,s.mineMax-r.mineMax)*.75;
        const theirBonus=sn===1&&rn===1?0:Math.max(0,r.theirMax-s.theirMax)*.75;
        const myNet=r.mine-s.mine-myBonus,theirNet=s.theirs-r.theirs-theirBonus;
        if(myNet < -LIMITS.maxLoss-1e-8 || theirNet < -LIMITS.maxLoss-1e-8)continue;
        const needGain=(incoming,outgoing,needs)=>needs.reduce((sum,pos)=>sum+Math.max(0,incoming.items.filter(a=>a.asset.position===pos).reduce((n,a)=>n+a.market,0)-outgoing.items.filter(a=>a.asset.position===pos).reduce((n,a)=>n+a.market,0)),0);
        const myFit=needGain(r,s,self.needs),theirFit=needGain(s,r,other.needs);
        const fit=Number(myFit>0)+Number(theirFit>0),preferenceGain=Math.min(myNet,theirNet);
        if(!fit&&s.players&&r.players&&preferenceGain<=0)continue;
        const gap=Math.abs(r.market-s.market)/Math.max(r.market,s.market);
        const send=s.items.map(a=>brief(a.asset)),receive=r.items.map(a=>brief(a.asset));
        best.push({send,receive,marketNet:r.market-s.market,gap,myNet,theirNet,myBonus,theirBonus,
          marketSends:s.market,marketReceives:r.market,fit,
          utility:(myFit+theirFit)/Math.max(s.market,r.market)+preferenceGain/Math.max(s.market,r.market)-.04*(sn+rn-2),
          key:send.map(a=>a.id).sort().join(',')+'|'+receive.map(a=>a.id).sort().join(',')});
        if(best.length>=400){best.sort(compare);best=best.slice(0,160);}
      }
    }
  }
  best.sort(compare);
  const chosen=[],anchors=new Map();
  for(const p of best){const anchor=p.send[0].id+'|'+p.receive[0].id;if((anchors.get(anchor)||0)>=2)continue;anchors.set(anchor,(anchors.get(anchor)||0)+1);const {key,utility,fit,...proposal}=p;chosen.push(proposal);if(chosen.length===6)break;}
  return {proposals:chosen,searchLimited:yours.limited||theirs.limited};
}
function findPartners(league,body,access){
  const mine=league.teams.find(t=>t.roster_id===body.roster_id);
  if(!mine)fail('Choose your team.');
  const format=body.format;
  if(!format||!['std','hppr','ppr'].includes(format.ppr)||typeof format.superflex!=='boolean'||typeof format.tePremium!=='boolean')fail('Choose a valid scoring format.');
  const preferences=preferencesFor(league,body,access),minePref=preferences.get(mine.roster_id);
  const excluded=body.excluded||[];
  if(!Array.isArray(excluded)||excluded.length>120||excluded.some(id=>typeof id!=='string'||!league.teams.some(t=>t.assets.some(a=>a.id===id))))fail('Invalid untouchable selections.');
  if(excluded.length)requireFeature(access,'tradeFinderTargets');
  const self=profile(league,mine.roster_id,minePref.mode,format),blocked=new Set(excluded);
  const premium=access.premium===true&&access.features.tradeFinderTargets===true;
  const matches=league.teams.filter(t=>t!==mine).map(their=>{
    const theirPref=preferences.get(their.roster_id),p=profile(league,their.roster_id,theirPref.mode,format);
    const receive=p.surplus.filter(pos=>self.needs.includes(pos)),send=self.surplus.filter(pos=>p.needs.includes(pos));
    const match={id:p.id,name:p.name,needs:p.needs,receive,send,mutual:!!receive.length&&!!send.length};
    if(premium){
      Object.assign(match,proposalsFor(mine,their,self,p,minePref,theirPref,format,blocked),{preference:theirPref});
    }
    return match;
  }).filter(m=>m.receive.length||m.send.length||m.proposals?.length).sort((a,b)=>Number(b.mutual)-Number(a.mutual)||(b.proposals?.length||0)-(a.proposals?.length||0)||a.name.localeCompare(b.name));
  return {league:{id:league.id,name:league.name},team:{...self,preference:minePref},baseline:self.baseline,matches,premium,limits:LIMITS};
}
async function finderAction(action,body,access,deps={}){
  if(action==='finder-rosters')requireFeature(access,'tradeFinderTargets');
  const book=deps.book||catalog(require('../data/nfl_rankings.json').rankings);
  const league=await (deps.loadLeague||loadLeague)(body.league_id,book,body.refresh===true);
  if(action==='finder-league')return {league:{id:league.id,name:league.name,teams:league.teams.map(t=>({id:t.roster_id,name:t.name}))},premium:access.premium&&access.features.tradeFinderTargets===true};
  if(action==='finder-rosters')return {teams:league.teams.map(t=>({id:t.roster_id,name:t.name,players:t.assets.filter(a=>POS.includes(a.position)||a.position==='PICK').map(a=>({...brief(a),scores:a.scores}))}))};
  return findPartners(league,body,access);
}
module.exports={findPartners,finderAction,proposalsFor,LIMITS,preferencesFor,profile};
