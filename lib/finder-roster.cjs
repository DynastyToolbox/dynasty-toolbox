'use strict';
const {score}=require('../scoring_formats.js');
const POS=['QB','RB','WR','TE'];
const FLOORS={QB:5000,RB:3000,WR:3000,TE:3000};
function lineup(league){
  const raw=league.roster_positions;
  const supported=['QB','RB','WR','TE','FLEX','SUPER_FLEX','WRRB_FLEX','REC_FLEX'];
  const fallback=!Array.isArray(raw)||!raw.some(p=>supported.includes(p));
  const slots=fallback?['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX']:raw;
  return {slots:slots.filter(p=>['QB','RB','WR','TE','FLEX','SUPER_FLEX','WRRB_FLEX','REC_FLEX'].includes(p)),fallback};
}
function requirements(league,format){
  const spec=lineup(league),demand={QB:0,RB:0,WR:0,TE:0};let flex=0,receivingFlex=0;
  for(const slot of spec.slots){
    if(POS.includes(slot))demand[slot]++;
    else if(slot==='SUPER_FLEX'&&format.superflex)demand.QB++;
    else if(slot==='REC_FLEX'){demand.WR+=.5;demand.TE+=.5;receivingFlex++;}
    else {demand.RB+=.5;demand.WR+=.5;flex++;}
  }
  return {...spec,demand,flex,receivingFlex};
}
function usable(asset,mode,format){
  const row=asset.scores?.[mode],pos=asset.position;
  return POS.includes(pos)&&row?.ranked&&score(row.value,row.position,format)>=score(FLOORS[pos],pos,format);
}
function counts(assets,mode,format){
  const result={QB:0,RB:0,WR:0,TE:0};
  for(const a of assets)if(usable(a,mode,format))result[a.position]++;
  return result;
}
function deficits(count,req){
  const out=Object.fromEntries(POS.map(p=>[p,Math.max(0,Math.floor(req.demand[p])-count[p])]));
  // Shared flex coverage prevents counting the same spare starter twice.
  const direct=p=>req.slots.filter(s=>s===p).length;
  out.flex=Math.max(0,req.flex-Math.max(0,count.RB-direct('RB'))-Math.max(0,count.WR-direct('WR')));
  out.receivingFlex=Math.max(0,req.receivingFlex-Math.max(0,count.WR-direct('WR'))-Math.max(0,count.TE-direct('TE')));
  out.totalFlex=Math.max(0,req.flex+req.receivingFlex-Math.max(0,count.RB-direct('RB'))-Math.max(0,count.WR-direct('WR'))-Math.max(0,count.TE-direct('TE')));
  return out;
}
function profile(league,id,mode,format){
  const team=league.teams.find(t=>t.roster_id===id),req=requirements(league,format),count=counts(team.assets,mode,format);
  return {id,name:team.name,counts:count,requirements:req,baseline:req.demand,
    needs:POS.filter(p=>count[p]<Math.floor(req.demand[p])),
    surplus:POS.filter(p=>req.demand[p]>0&&count[p]>=Math.ceil(req.demand[p])+1)};
}
function rosterSafe(before,outgoing,incoming,mode,format){
  if(!before.requirements)return true; // Unit callers without a league context.
  const removed=counts(outgoing,mode,format),added=counts(incoming,mode,format);
  const after=Object.fromEntries(POS.map(p=>[p,before.counts[p]-removed[p]+added[p]]));
  const a=deficits(before.counts,before.requirements),b=deficits(after,before.requirements);
  return Object.keys(a).every(p=>b[p]<=a[p]);
}
function equivalentSwap(send,receive){
  // Cancel picks only when year, round AND current ranking tier match; origin stays on the stored assets.
  const key=a=>a.position==='PICK'?a.id.split(':').slice(0,3).join(':')+'|'+JSON.stringify(['overall','competing','tanking'].map(m=>a.scores[m].value)):null;
  const remaining=receive.slice();let cancelled=0;
  const left=send.filter(a=>{const k=key(a),i=k?remaining.findIndex(b=>key(b)===k):-1;if(i<0)return true;remaining.splice(i,1);cancelled++;return false;});
  return cancelled>0&&(!left.length||!remaining.length);
}
module.exports={lineup,requirements,profile,rosterSafe,equivalentSwap,FLOORS,usable};
