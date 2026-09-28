'use strict';
// Experimental season model v1. Normal score errors are an explicit modeling
// assumption, not calibrated confidence intervals. Old empirical audits stay separate.
const {earlyEstimate,quantile}=require('./outlook-research.cjs');
const {SLOTS}=require('./outlook-foundation.cjs');
const {seedField,openingRound,roundedRecord}=require('./outlook-playoffs.cjs');
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const round=n=>Math.round(n*10000)/10000;
function distribution(model,lineup,histories={},registry={}){
  if(!model?.available||!Array.isArray(model.residuals)||model.residuals.length<2||model.residuals.some(e=>!Number.isFinite(e)))return {available:false,reason:'calibration_unavailable'};
  if(!lineup?.lineup?.length)return {available:false,reason:'missing_lineup'};
  if(lineup.lineup.some(r=>!SLOTS[r.slot])||lineup.lineupNotes?.some(n=>!['limited_history','limited_role_history','injury_uncertain'].includes(n.reason)))return {available:false,reason:'incomplete_lineup'};
  const gaps=lineup.lineup.filter(r=>!r.player);
  // A bye-driven roster gap is different from an unknown player's projection.
  // Never silently turn an otherwise-eligible unknown player into zero points.
  const unknownGap=gaps.some(g=>(lineup.unresolved||[]).some(u=>{
    const p=registry[u.id];if(!p)return true;
    const positions=p.fantasy_positions||[p.position];if(!SLOTS[g.slot].some(pos=>positions.includes(pos)))return false;
    return !(p.position==='QB'&&Number(p.depth_chart_order)>1);
  }));
  if(unknownGap)return {available:false,reason:'incomplete_lineup'};
  const players=lineup.lineup.filter(row=>row.player).map(row=>{
    if(!row.player)return null;
    // Current-week recorded starters stay in their slots, but use full-game
    // historical estimates, never mix final/live points into a pregame forecast.
    if(row.player.locked){const e=earlyEstimate(histories[row.player.id]||[]);return {...row.player,points:e.points,historyGames:e.games,limitedHistory:e.limited};}
    return row.player;
  });
  if(players.some(p=>!p||!Number.isFinite(p.points)))return {available:false,reason:'incomplete_lineup'};
  if(!players.length)return {available:true,mean:0,sd:0,low:0,high:0,limitedPlayers:0,unfilledSlots:gaps.map(r=>r.slot),fullGameEstimate:false,experimental:true};
  const bias=mean(model.residuals),variance=model.residuals.reduce((sum,e)=>sum+(e-bias)**2,0)/(model.residuals.length-1);
  if(!(variance>0))return {available:false,reason:'calibration_unavailable'};
  // A one-game estimate carries more added uncertainty than two or three.
  // Equal starter shares provide a transparent conservative first heuristic.
  const extra=(players.reduce((sum,p)=>sum+(p.roleUncertain?3:p.limitedHistory?4/Math.max(1,Math.min(3,p.historyGames||1))-1:0),0)+gaps.length*4)/lineup.lineup.length;
  const sd=Math.sqrt(variance*(1+extra)),center=players.reduce((sum,p)=>sum+p.points,0)+bias;
  return {available:true,mean:center,sd,low:center-1.281551565545*sd,high:center+1.281551565545*sd,
    limitedPlayers:players.filter(p=>p.limitedHistory||p.roleUncertain).length,unfilledSlots:gaps.map(r=>r.slot),fullGameEstimate:players.some(p=>p.locked),experimental:true};
}
function cdf(x){
  // Abramowitz-Stegun normal CDF approximation; enough for whole-percent UI.
  const z=Math.abs(x),t=1/(1+.2316419*z),p=.3989422804014327*Math.exp(-z*z/2)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x>=0?1-p:p;
}
function compareForecasts(a,b,{week,currentWeek}={}){
  if(!a?.available||!b?.available)return {available:false,reason:(!a?.available?a:b)?.reason||'missing_lineup'};
  const sd=Math.sqrt(a.sd*a.sd+b.sd*b.sd),delta=a.mean-b.mean;
  const loss=sd?cdf((-.005-delta)/sd):Number(delta<0),tie=sd?Math.max(0,cdf((.005-delta)/sd)-loss):Number(delta===0),win=1-loss-tie;
  const publicRange=d=>({low:d.low,high:d.high,mean:d.mean,nominalCoverage:.8,limitedPlayers:d.limitedPlayers,unfilledSlots:d.unfilledSlots});
  return {available:true,a:publicRange(a),b:publicRange(b),probability:{win,loss,tie,expectedResult:win+.5*tie},limitedHistory:a.limitedPlayers+b.limitedPlayers>0,fullGameEstimate:week<=currentWeek,model:'normal-season-v1'};
}
function randomSource(seed){
  let state=2166136261;for(const c of String(seed)){state^=c.charCodeAt(0);state=Math.imul(state,16777619);}
  return ()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
}
const compareStanding=(a,b)=>(b.wins+.5*b.ties)-(a.wins+.5*a.ties)||b.pf-a.pf||b.pa-a.pa||a.lottery-b.lottery;
function applyWeek(rows,scores,pairs,medianGame){
  const index=new Map(rows.map(r=>[r.id,r]));
  const award=(r,own,other)=>{if(own>other)r.wins++;else if(own<other)r.losses++;else r.ties++;};
  for(const [a,b]of pairs){const x=index.get(a),y=index.get(b);award(x,scores[a],scores[b]);award(y,scores[b],scores[a]);x.pa+=scores[b];y.pa+=scores[a];}
  const middle=medianGame?quantile(Object.values(scores),.5):null;
  for(const row of rows){row.pf+=scores[row.id];if(medianGame)award(row,scores[row.id],middle);}
}
function simulateSeason({teams,schedule,forecasts,medianGame=false,seed='outlook-v1',iterations=5000,expectedCompletedGames,expectedWeeks,playoffConfig={available:false,reason:'Playoff settings unavailable.'}}){
  const unavailable=reason=>({available:false,reason,teams:[]});
  if(!Number.isInteger(iterations)||iterations<100||iterations>20000)throw new Error('Invalid season simulation count.');
  teams=[...teams].sort((a,b)=>a.id.localeCompare(b.id));
  schedule=schedule.map(w=>({...w,pairs:w.pairs.map(p=>[...p].sort()).sort((a,b)=>a[0].localeCompare(b[0]))})).sort((a,b)=>a.week-b.week);
  if(expectedWeeks&&(schedule.length!==expectedWeeks.length||expectedWeeks.some(w=>!schedule.some(s=>s.week===w))))return unavailable('Some remaining weeks are missing from the schedule.');
  const ids=new Set(teams.map(t=>t.id));
  if(teams.length<2||ids.size!==teams.length)return unavailable('League teams need review.');
  if(teams.some(t=>!['wins','losses','ties'].every(k=>Number.isInteger(t.record[k])&&t.record[k]>=0)||![t.pointsFor,t.pointsAgainst].every(Number.isFinite)))return unavailable('Current standings are incomplete.');
  if(expectedCompletedGames!=null&&teams.some(t=>t.record.wins+t.record.losses+t.record.ties!==expectedCompletedGames))return unavailable('Current records and completed weeks do not match yet. Reload after Sleeper updates the standings.');
  if(teams.reduce((s,t)=>s+t.record.wins-t.record.losses,0)!==0)return unavailable('Current league wins and losses do not reconcile.');
  const weekIds=new Set();
  for(const row of schedule){
    const seen=new Set();
    if(weekIds.has(row.week)||row.issues?.length)return unavailable('The remaining schedule needs review.');weekIds.add(row.week);
    for(const pair of row.pairs){if(pair.length!==2||pair.some(id=>!ids.has(id)||seen.has(id))||pair[0]===pair[1])return unavailable('The remaining schedule needs review.');pair.forEach(id=>seen.add(id));}
    if(seen.size!==ids.size)return unavailable('The remaining schedule needs review.');
    if(teams.some(t=>{const d=forecasts.get(row.week+':'+t.id);return !d?.available||!Number.isFinite(d.mean)||!Number.isFinite(d.sd)||d.sd<0;}))return unavailable('A full-season projection needs a supported estimate for every team and remaining week.');
  }
  const rng=randomSource(seed),normal=()=>Math.sqrt(-2*Math.log(Math.max(Number.EPSILON,rng())))*Math.cos(2*Math.PI*rng());
  const results=new Map(teams.map(t=>[t.id,{wins:[],losses:[],ties:[],ranks:[],pf:[],pa:[],seeds:Array(playoffConfig.count||0).fill(0),qualified:0,byes:0,divisionWins:0}]));
  for(let run=0;run<iterations;run++){
    const rows=teams.map(t=>({id:t.id,division:t.division,...t.record,pf:t.pointsFor,pa:t.pointsAgainst,lottery:rng()}));
    for(const week of schedule){
      const scores={};for(const t of teams){const d=forecasts.get(week.week+':'+t.id);scores[t.id]=Math.round((d.mean+d.sd*normal())*100)/100;}
      applyWeek(rows,scores,week.pairs,medianGame);
    }
    rows.sort(compareStanding);rows.forEach((r,i)=>{const out=results.get(r.id);for(const key of ['wins','losses','ties','pf','pa'])out[key].push(r[key]);out.ranks.push(i+1);});
    for(const entry of seedField(rows,playoffConfig)){const out=results.get(entry.id);out.qualified++;out.seeds[entry.seed-1]++;if(entry.bye)out.byes++;if(entry.divisionWinner)out.divisionWins++;}
  }
  const projected=teams.map(t=>{const r=results.get(t.id);return {id:t.id,expected:{wins:round(mean(r.wins)),losses:round(mean(r.losses)),ties:round(mean(r.ties))},winRange:{low:Math.floor(quantile(r.wins,.1)),high:Math.ceil(quantile(r.wins,.9))},rankRange:{low:Math.floor(quantile(r.ranks,.1)),high:Math.ceil(quantile(r.ranks,.9))},meanRank:round(mean(r.ranks)),pointsFor:round(mean(r.pf)),pointsAgainst:round(mean(r.pa))};});
  projected.sort((a,b)=>(b.expected.wins+.5*b.expected.ties)-(a.expected.wins+.5*a.expected.ties)||b.pointsFor-a.pointsFor||b.pointsAgainst-a.pointsAgainst||a.id.localeCompare(b.id));
  const finalTeams=projected.map((t,i)=>{const original=teams.find(x=>x.id===t.id),total=original.record.wins+original.record.losses+original.record.ties+schedule.length*(medianGame?2:1),r=results.get(t.id);return {...t,place:i+1,displayRecord:roundedRecord(t.expected,original.record,total),playoffs:playoffConfig.available?{chance:r.qualified/iterations,byeChance:r.byes/iterations,divisionChance:r.divisionWins/iterations,seedChances:r.seeds.map(n=>n/iterations)}:null};});
  const field=seedField(finalTeams.map(t=>({...t,division:teams.find(x=>x.id===t.id).division})),playoffConfig);
  return {available:true,experimental:true,model:'normal-season-v1',iterations,medianGame,teams:finalTeams,rangeCoverage:.8,playoffs:{...playoffConfig,field,openingRound:openingRound(field,playoffConfig)}};
}
module.exports={distribution,compareForecasts,simulateSeason,compareStanding,applyWeek};
