'use strict';
// Default qualification rules only. Commissioner overrides are not inferred.
function playoffConfig(meta,teams){
  const count=Number(meta.settings?.playoff_teams),start=Number(meta.settings?.playoff_week_start);
  if(![4,6,8].includes(count)||count>teams.length||!Number.isInteger(start)||start<2||start>18)return {available:false,reason:'This playoff format needs review.'};
  const divisions=[...new Set(teams.map(t=>t.division).filter(d=>Number.isInteger(d)&&d>0))];
  const declared=Number(meta.settings?.divisions||0);
  if((declared>0&&declared!==divisions.length)||divisions.length&&teams.some(t=>!divisions.includes(t.division)))return {available:false,reason:'Division assignments are incomplete.'};
  if(divisions.length&&!((divisions.length===2&&count===6)||(divisions.length===4&&count===8)))return {available:false,reason:'This division playoff format needs review.'};
  const bracket=Number(meta.settings?.playoff_seed_type)===1&&Number(meta.settings?.playoff_round_type)===0?{reseed:true,lengths:Array(count===4?2:3).fill(1)}:null;
  return {available:true,count,start,bracket,byes:count===6?2:0,divisions,rule:divisions.length?'division-winners-first':'overall-record'};
}
function seedField(sortedRows,config){
  if(!config.available)return [];
  const leaders=config.divisions.map(d=>sortedRows.find(r=>r.division===d)?.id);
  const first=sortedRows.filter(r=>leaders.includes(r.id)),rest=sortedRows.filter(r=>!leaders.includes(r.id));
  return [...first,...rest].slice(0,config.count).map((r,i)=>({id:r.id,seed:i+1,bye:i<config.byes,divisionWinner:leaders.includes(r.id)}));
}
function openingRound(field,config){
  if(!config.available||field.length!==config.count)return [];
  const pairs=config.count===4?[[1,4],[2,3]]:config.count===6?[[3,6],[4,5]]:[[1,8],[2,7],[3,6],[4,5]];
  return pairs.map(([a,b])=>({a:field.find(t=>t.seed===a),b:field.find(t=>t.seed===b)}));
}
function roundedRecord(expected,current,total){
  // Round the remaining outcomes, preserving every already-recorded result.
  const keys=['wins','losses','ties'],left=total-keys.reduce((s,k)=>s+current[k],0);
  if(!Number.isInteger(left)||left<0||keys.some(k=>!Number.isFinite(expected[k])||!Number.isInteger(current[k])||current[k]<0))throw new Error('Invalid projected record.');
  if(Math.abs(keys.reduce((sum,k)=>sum+expected[k],0)-total)>.001||keys.some(k=>expected[k]<current[k]-.001))throw new Error('Projected outcomes do not match completed results or season length.');
  const parts=keys.map((key,index)=>{const value=Math.max(0,expected[key]-current[key]);return {key,index,value,whole:Math.floor(value)};});
  let remaining=left-parts.reduce((s,p)=>s+p.whole,0);
  if(remaining<0||remaining>3)throw new Error('Projected outcomes do not match the season length.');
  for(const p of [...parts].sort((a,b)=>(b.value-b.whole)-(a.value-a.whole)||a.index-b.index)){if(!remaining)break;p.whole++;remaining--;}
  return Object.fromEntries(parts.map(p=>[p.key,current[p.key]+p.whole]));
}
module.exports={playoffConfig,seedField,openingRound,roundedRecord};
