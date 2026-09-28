'use strict';
// Conditional-on-known-lineup research. Never treat these as availability forecasts.
const {quantile}=require('./outlook-research.cjs');
const {starterSlots}=require('./outlook-foundation.cjs');
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const round=n=>Number.isFinite(n)?Math.round(n*10000)/10000:null;
const key=r=>r.season*100+r.week;
const formatKey=meta=>JSON.stringify({slots:starterSlots(meta).slots,scoring:Object.entries(meta.scoring_settings).filter(([,v])=>Number(v)!==0).sort(([a],[b])=>a.localeCompare(b))});
function validateRows(rows){
  const seen=new Set();
  for(const r of rows){
    if(!Number.isInteger(r.season)||!Number.isInteger(r.week)||r.week<1||r.week>17||r.rosterId==null||!Number.isFinite(r.predicted)||!Number.isFinite(r.actual))throw new Error('Invalid complete-team observation.');
    const id=`${key(r)}:${r.rosterId}`;if(seen.has(id))throw new Error('Duplicate team observation.');seen.add(id);
  }
}
function fit(rows,{before}){
  validateRows(rows);
  if(!Number.isInteger(before))throw new Error('An explicit historical cutoff is required.');
  const training=rows.filter(r=>key(r)<before),groups=new Map();
  for(const r of training){if(r.matchupId==null)continue;const id=`${key(r)}:${r.matchupId}`;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}
  const pairs=[];
  for(const group of groups.values()){
    if(group.length>2)throw new Error('A historical matchup contains more than two teams.');
    if(group.length===2)pairs.push(group.map(r=>r.actual-r.predicted));
  }
  const residuals=training.map(r=>r.actual-r.predicted),weeks=new Set(training.map(key));
  // Minimum data checks are coverage guards, not proof of calibration.
  return {schema:1,before,teamCount:training.length,pairCount:pairs.length,weekCount:weeks.size,
    available:training.length>=40&&pairs.length>=20&&weeks.size>=6,residuals,pairs,
    scope:'Known, complete offensive starting lineups in the same league format; no live-game conditioning or injury probabilities.'};
}
function scoreRange(model,predicted){
  if(!model.available)return null;
  if(!Number.isFinite(predicted))throw new Error('A complete finite team estimate is required.');
  const values=model.residuals.map(e=>predicted+e);
  return {low:quantile(values,.1),high:quantile(values,.9),median:quantile(values,.5),mean:mean(values),nominalCoverage:.8};
}
function matchup(model,a,b,{independent=false}={}){
  if(!model.available)return null;
  if(!Number.isFinite(a)||!Number.isFinite(b))throw new Error('Two complete finite estimates are required.');
  const errors=independent?model.residuals.flatMap(x=>model.residuals.map(y=>x-y)):model.pairs.flatMap(([x,y])=>[x-y,y-x]);
  let wins=0,ties=0;for(const error of errors){const margin=Math.round((a-b+error)*100);if(margin>0)wins++;else if(margin===0)ties++;}
  // A fixed half-observation per decisive outcome avoids certainty from a small
  // empirical sample. This regularization is frozen before evaluating holdout.
  const n=errors.length,win=(wins+.5)/(n+1),tie=ties/(n+1),loss=(n-wins-ties+.5)/(n+1);
  return {win,tie,loss,expectedResult:win+.5*tie,samples:n};
}
function backtest(model,rows){
  validateRows(rows);
  if(rows.some(r=>key(r)<model.before))throw new Error('Evaluation overlaps the fitting period.');
  if(!model.available)return {available:false,reason:'Not enough complete calibration matchups.'};
  const intervals=rows.map(r=>({...r,range:scoreRange(model,r.predicted)}));
  const intervalScore=r=>r.range.high-r.range.low+10*Math.max(0,r.range.low-r.actual)+10*Math.max(0,r.actual-r.range.high);
  const groups=new Map();for(const r of rows){if(r.matchupId==null)continue;const id=`${key(r)}:${r.matchupId}`;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}
  const games=[];let incompletePairs=0;
  for(const group of groups.values()){
    if(group.length>2)throw new Error('An evaluation matchup contains more than two teams.');
    if(group.length!==2){incompletePairs++;continue;}
    const [a,b]=group,actual=a.actual===b.actual ? .5 : a.actual>b.actual ? 1 : 0;
    games.push({season:a.season,week:a.week,matchupId:a.matchupId,actual,paired:matchup(model,a.predicted,b.predicted).expectedResult,independent:matchup(model,a.predicted,b.predicted,{independent:true}).expectedResult});
  }
  const decisive=games.filter(g=>g.actual!==.5),brier=method=>decisive.length?round(mean(decisive.map(g=>(g[method]-g.actual)**2))):null;
  // Both perspectives avoid tying calibration bins to API roster order. They
  // are dependent views of the same games, not twice as many observations.
  const views=decisive.flatMap(g=>[g,{...g,paired:1-g.paired,actual:1-g.actual}]);
  const bins=Array.from({length:5},(_,i)=>{const group=views.filter(g=>Math.min(4,Math.floor(g.paired*5))===i);return {from:i/5,to:(i+1)/5,n:group.length,meanProbability:group.length?round(mean(group.map(g=>g.paired))):null,observedWinRate:group.length?round(mean(group.map(g=>g.actual))):null};});
  const summarize=group=>({n:group.length,coverage:group.length?round(group.filter(r=>r.actual>=r.range.low&&r.actual<=r.range.high).length/group.length):null,meanWidth:group.length?round(mean(group.map(r=>r.range.high-r.range.low))):null,meanIntervalScore:group.length?round(mean(group.map(intervalScore))):null});
  return {available:true,teamRanges:summarize(intervals),bySeason:Object.fromEntries([...new Set(rows.map(r=>r.season))].map(s=>[s,summarize(intervals.filter(r=>r.season===s))])),
    matchups:{n:games.length,decisive:decisive.length,ties:games.length-decisive.length,incompletePairs,brier:{paired:brier('paired'),independent:brier('independent'),coinFlip:decisive.length?.25:null},bins},games};
}
function compareLineups(model,a,b,{week,currentWeek,assumeConditionalActive=false}){
  if(!model?.available)return {available:false,reason:'calibration_unavailable'};
  if(week<=currentWeek)return {available:false,reason:'live_week'};
  if(!a||!b)return {available:false,reason:'missing_lineup'};
  for(const lineup of [a,b]){
    if(!lineup.lineup?.length||lineup.unfilled?.length||lineup.pendingResults||lineup.lockedCount||lineup.lineup.some(r=>!r.player||!Number.isFinite(r.player.points))||!Number.isFinite(lineup.modeledPoints))return {available:false,reason:'incomplete_lineup'};
    if(lineup.lineupNotes?.some(note=>!assumeConditionalActive||note.reason!=='injury_uncertain')||lineup.lineup.some(r=>r.player.limitedHistory||r.player.conditional&&!assumeConditionalActive))return {available:false,reason:'uncertain_starter'};
  }
  return {available:true,assumesUncertainPlayersActive:assumeConditionalActive&&[a,b].some(l=>l.lineup.some(r=>r.player.conditional)),a:scoreRange(model,a.modeledPoints),b:scoreRange(model,b.modeledPoints),probability:matchup(model,a.modeledPoints,b.modeledPoints)};
}
module.exports={fit,scoreRange,matchup,backtest,formatKey,compareLineups};
