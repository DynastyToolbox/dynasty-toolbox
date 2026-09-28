'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fit,scoreRange,matchup,backtest,compareLineups,formatKey}=require('../lib/outlook-uncertainty.cjs');
function rows(){return Array.from({length:8},(_,i)=>Array.from({length:6},(_,r)=>({season:2025,week:i+1,rosterId:r+1,matchupId:Math.floor(r/2),predicted:100,actual:100+(i-4)*5+(r%2?2:-2)}))).flat();}
const model=()=>fit(rows(),{before:202509});
test('fit excludes future outcomes and never confuses repeated teams with independent weeks',()=>{
  const original=model(),changed=fit([...rows(),{season:2025,week:9,rosterId:1,matchupId:1,predicted:100,actual:999}],{before:202509});
  assert.deepEqual(changed,original);assert.equal(original.available,true);assert.equal(original.pairCount,24);assert.equal(original.weekCount,8);
  const short=fit(rows().filter(r=>r.week<6),{before:202509});assert.equal(short.available,false);assert.equal(scoreRange(short,100),null);
  assert.throws(()=>fit([...rows(),rows()[0]],{before:202509}),/Duplicate/);
});
test('paired uncertainty preserves common weekly errors and swaps opponents symmetrically',()=>{
  const m=model(),equal=matchup(m,100,100),a=matchup(m,105,100),b=matchup(m,100,105);
  assert.equal(equal.expectedResult,.5);assert.equal(a.win,b.loss);assert.equal(a.tie,b.tie);assert.ok(Math.abs(a.win+a.tie+a.loss-1)<1e-12);
  assert.ok(a.win<1&&a.win>.5);assert.ok(a.win>matchup(m,105,100,{independent:true}).win);
  assert.ok(matchup(m,110,100).win>=a.win);assert.throws(()=>matchup(m,NaN,100));
});
test('score intervals shift with the point estimate and preserve actual negative outcomes',()=>{
  const m=model(),a=scoreRange(m,0),b=scoreRange(m,100);assert.ok(a.low<0);assert.equal(b.low-a.low,100);assert.equal(b.high-a.high,100);
  assert.ok(a.low<=a.median&&a.median<=a.high);assert.throws(()=>scoreRange(m,null));
});
test('holdout evaluation rejects overlap, reports incomplete pairs and keeps ties separate',()=>{
  const m=model();assert.throws(()=>backtest(m,rows()),/overlaps/);
  const later=[{season:2025,week:9,rosterId:1,matchupId:1,predicted:100,actual:100},{season:2025,week:9,rosterId:2,matchupId:1,predicted:100,actual:100},{season:2025,week:9,rosterId:3,matchupId:2,predicted:100,actual:120}];
  const e=backtest(m,later);assert.equal(e.teamRanges.n,3);assert.equal(e.matchups.n,1);assert.equal(e.matchups.ties,1);assert.equal(e.matchups.incompletePairs,1);assert.equal(e.matchups.brier.paired,null);
  later[1].actual=90;const decisive=backtest(m,later);assert.equal(decisive.matchups.brier.paired,.25);assert.equal(decisive.matchups.bins.reduce((n,b)=>n+b.n,0),2);
});
test('only complete, settled future lineups receive an experimental comparison',()=>{
  const m=model(),lineup={lineup:[{slot:'QB',player:{id:'a',points:20}}],modeledPoints:20,unfilled:[],lineupNotes:[]},opts={week:4,currentWeek:3};
  assert.equal(compareLineups(m,lineup,lineup,opts).available,true);
  assert.equal(compareLineups(m,lineup,lineup,{week:3,currentWeek:3}).reason,'live_week');
  assert.equal(compareLineups(m,lineup,{...lineup,unfilled:[{slot:'K'}]},opts).reason,'incomplete_lineup');
  for(const prop of ['limitedHistory','conditional'])assert.equal(compareLineups(m,lineup,{...lineup,lineup:[{player:{points:20,[prop]:true}}]},opts).reason,'uncertain_starter');
  assert.equal(compareLineups(m,lineup,{...lineup,lineupNotes:[{reason:'unsupported_slots'}]},opts).available,false);
  assert.equal(compareLineups(null,lineup,lineup,opts).available,false);
});
test('format identity is insensitive to scoring key order but detects lineup and scoring changes',()=>{
  const meta={roster_positions:['QB','FLEX','BN'],scoring_settings:{rec:.5,pass_td:4}},same={roster_positions:['QB','FLEX','BN','BN'],scoring_settings:{pass_td:4,rec:.5,unused:0}};
  assert.equal(formatKey(meta),formatKey(same));assert.notEqual(formatKey(meta),formatKey({...meta,scoring_settings:{...meta.scoring_settings,rec:1}}));assert.notEqual(formatKey(meta),formatKey({...meta,roster_positions:['QB','SUPER_FLEX']}));
});
test('availability assumptions must be explicit and never bypass early-history or unsupported-slot guards',()=>{
  const a={lineup:[{player:{id:'a',points:20,conditional:true}}],modeledPoints:20,unfilled:[],lineupNotes:[{reason:'injury_uncertain'}]},opts={week:4,currentWeek:3};
  assert.equal(compareLineups(model(),a,a,opts).available,false);
  const assumed=compareLineups(model(),a,a,{...opts,assumeConditionalActive:true});assert.equal(assumed.available,true);assert.equal(assumed.assumesUncertainPlayersActive,true);
  for(const reason of ['limited_history','unsupported_slots','best_ball_not_modeled'])assert.equal(compareLineups(model(),{...a,lineupNotes:[{reason}]},a,{...opts,assumeConditionalActive:true}).available,false);
});
