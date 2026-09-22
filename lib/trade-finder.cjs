'use strict';
const {catalog,loadLeague}=require('./trade-calculator.cjs');
const {score}=require('../scoring_formats.js');
const {requireFeature}=require('./subscription-access.cjs');
const POS=['QB','RB','WR','TE'];
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const median=values=>{const a=values.slice().sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
function findPartners(league,body,access){
  const mine=league.teams.find(t=>t.roster_id===body.roster_id);
  if(!mine)fail('Choose your team.');
  const mode=body.mode||'overall',format=body.format;
  if(!['overall','competing','tanking'].includes(mode)||!format||!['std','hppr','ppr'].includes(format.ppr)||typeof format.superflex!=='boolean'||typeof format.tePremium!=='boolean')fail('Choose a valid scoring format and ranking system.');
  const excluded=body.excluded||[];
  if(!Array.isArray(excluded)||excluded.length>120||excluded.some(id=>typeof id!=='string'||!league.teams.some(t=>t.assets.some(a=>a.id===id))))fail('Invalid untouchable selections.');
  if(excluded.length)requireFeature(access,'tradeFinderTargets');
  const value=(a,type=mode)=>score(a.scores[type].value,a.scores[type].position,format);
  const profiles=league.teams.map(t=>({id:t.roster_id,name:t.name,values:Object.fromEntries(POS.map(pos=>[pos,t.assets.filter(a=>a.position===pos&&a.scores[mode].ranked).map(a=>value(a)).sort((a,b)=>b-a).slice(0,3).reduce((s,n)=>s+n,0)]))}));
  const baseline=Object.fromEntries(POS.map(pos=>[pos,median(profiles.map(p=>p.values[pos]))]));
  for(const p of profiles){p.needs=POS.filter(pos=>baseline[pos]>0&&p.values[pos]<baseline[pos]*.8);p.surplus=POS.filter(pos=>baseline[pos]>0&&p.values[pos]>baseline[pos]*1.2);}
  const self=profiles.find(p=>p.id===mine.roster_id),blocked=new Set(excluded);
  const premium=access.premium===true&&access.features.tradeFinderTargets===true;
  const matches=profiles.filter(p=>p.id!==self.id).map(p=>{
    const receive=p.surplus.filter(pos=>self.needs.includes(pos)),send=self.surplus.filter(pos=>p.needs.includes(pos));
    const match={id:p.id,name:p.name,receive,send,mutual:!!receive.length&&!!send.length};
    if(premium){
      const their=league.teams.find(t=>t.roster_id===p.id);
      const allowed=(a,positions)=>positions.includes(a.position)&&a.scores.overall.ranked&&a.scores[mode].ranked&&!blocked.has(a.id)&&value(a,'overall')>0;
      const targets=their.assets.filter(a=>allowed(a,receive)).sort((a,b)=>value(b)-value(a));
      const offers=mine.assets.filter(a=>allowed(a,send));
      match.targets=targets.slice(0,6).map(a=>({id:a.id,name:a.name,position:a.position,market:value(a,'overall')}));
      const proposals=[];
      for(const target of targets)for(const offer of offers){
        const receiveValue=value(target,'overall'),sendValue=value(offer,'overall'),gap=Math.abs(receiveValue-sendValue)/Math.max(receiveValue,sendValue);
        if(gap<=.25)proposals.push({receive:{id:target.id,name:target.name,position:target.position},send:{id:offer.id,name:offer.name,position:offer.position},marketNet:receiveValue-sendValue,gap});
      }
      match.proposals=proposals.sort((a,b)=>a.gap-b.gap||a.receive.name.localeCompare(b.receive.name)).slice(0,3);
    }
    return match;
  }).filter(m=>m.receive.length||m.send.length).sort((a,b)=>Number(b.mutual)-Number(a.mutual)||(b.receive.length+b.send.length)-(a.receive.length+a.send.length)||a.name.localeCompare(b.name));
  return {league:{id:league.id,name:league.name},team:self,baseline,matches,premium};
}
async function finderAction(action,body,access,deps={}){
  if(action==='finder-rosters')requireFeature(access,'tradeFinderTargets');
  const book=deps.book||catalog(require('../data/nfl_rankings.json').rankings);
  const league=await (deps.loadLeague||loadLeague)(body.league_id,book,body.refresh===true);
  if(action==='finder-league')return {league:{id:league.id,name:league.name,teams:league.teams.map(t=>({id:t.roster_id,name:t.name}))},premium:access.premium&&access.features.tradeFinderTargets===true};
  if(action==='finder-rosters')return {teams:league.teams.map(t=>({id:t.roster_id,name:t.name,players:t.assets.filter(a=>POS.includes(a.position)).map(a=>({id:a.id,name:a.name,position:a.position}))}))};
  return findPartners(league,body,access);
}
module.exports={findPartners,finderAction};
