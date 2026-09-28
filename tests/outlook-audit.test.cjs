'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {freezePreview,evaluateFrozen}=require('../lib/outlook-audit.cjs');
function fixture(){
  const teams='ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '),rawSchedule=[];
  for(let week=1;week<=17;week++)for(let i=0;i<16;i++)rawSchedule.push({home:teams[i*2],away:teams[i*2+1],game_id:week+'-'+i,week:week===17&&i>=8?18:week,date:'2026-10-01',status:'pre_game'});
  const meta={league_id:'1234567890123456789',season:'2026',roster_positions:['QB'],scoring_settings:{pass_td:4}};
  const lineups=['1','2'].map((id,i)=>({rosterId:id,week:4,lineup:[{player:{id:'p'+id,points:100-i*10}}],unfilled:[],modeledPoints:100-i*10}));
  const comparison={week:4,teams:['1','2'],available:true,a:{low:70,high:130},b:{low:60,high:120},probability:{expectedResult:.75}};
  const preview={league:{teams:[{id:'1'},{id:'2'}]},currentWeek:3,historyThrough:{season:2026,week:2},schedule:[{week:4,issues:[],pairs:[['1','2']]}],uncertainty:{},lineups,replacementLineups:[],comparisons:['play','replace'].map(scenario=>({...comparison,scenario}))};
  return {meta,rawSchedule,preview,week:4,now:'2026-09-28T12:00:00Z'};
}
function finalInput(args){return {meta:args.meta,state:{season:'2026',week:5},rawSchedule:args.rawSchedule.map(g=>({...g,status:'complete'})),matchups:[{roster_id:1,matchup_id:1,starters:['p1'],points:100,players_points:{p1:100}},{roster_id:2,matchup_id:1,starters:['p2'],points:80,players_points:{p2:80}}]};}
test('snapshot is frozen before game dates with explicit scenario coverage and no mutable references',()=>{
  const args=fixture(),frozen=freezePreview(args);assert.equal(frozen.scenarios.length,2);assert.equal(frozen.scenarios[0].teams[0].predicted,100);
  assert.throws(()=>freezePreview({...args,now:'2026-10-01T00:00:00Z'}),/precede/);
  assert.throws(()=>freezePreview({...args,week:3}),/future/);
  assert.throws(()=>freezePreview({...args,rawSchedule:args.rawSchedule.slice(1)}),/confirmed/);
  args.preview.lineups[0].modeledPoints=900;assert.equal(frozen.scenarios[0].teams[0].predicted,100);
  args.preview.comparisons[0].a.low=-999;assert.equal(frozen.scenarios[0].comparisons[0].a.low,70);
});
test('prospective evaluation waits for finished games and detects changed scoring',()=>{
  const args=fixture(),frozen=freezePreview(args),input=finalInput(args);
  assert.throws(()=>evaluateFrozen(frozen,{...input,state:{season:'2026',week:4}}),/completed/);
  assert.throws(()=>evaluateFrozen(frozen,{...input,rawSchedule:args.rawSchedule}),/completed/);
  assert.throws(()=>evaluateFrozen(frozen,{...input,meta:{...input.meta,scoring_settings:{pass_td:6}}}),/changed/);
  const result=evaluateFrozen(frozen,input);assert.equal(result.scenarios[0].winChances.brier,.0625);assert.equal(result.scenarios[0].ranges.coverage,1);assert.equal(result.scenarios[0].teamScores.mae,5);
});
test('final zero counts, missing/overridden totals do not, and changed opponents cannot count as matchup wins',()=>{
  const args=fixture(),frozen=freezePreview(args),input=finalInput(args);
  input.matchups[1].points=0;input.matchups[1].players_points.p2=0;assert.equal(evaluateFrozen(frozen,input).scenarios[0].teamScores.n,2);
  input.matchups[1].custom_points=0;assert.equal(evaluateFrozen(frozen,input).scenarios[0].teamScores.n,1);
  delete input.matchups[1].custom_points;delete input.matchups[1].players_points.p2;assert.equal(evaluateFrozen(frozen,input).excluded['2'],'missing_final_points');
  input.matchups[1].players_points.p2=0;input.matchups[1].matchup_id=2;assert.equal(evaluateFrozen(frozen,input).scenarios[0].winChances.skipped.opponent_changed,1);
  assert.throws(()=>evaluateFrozen(frozen,{...input,matchups:input.matchups.slice(1)}),/coverage/);
});
