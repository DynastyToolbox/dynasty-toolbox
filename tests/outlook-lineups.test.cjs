'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {SLOTS}=require('../lib/outlook-foundation.cjs');
const {nflSchedule,availability,bestLineup,playerHistories,projectRoster,evaluateStarterRows}=require('../lib/outlook-lineups.cjs');
const p=(id,pos,points)=>({id,positions:[pos],points});
test('Sleeper in_game status uses the same live starter locks as in_progress',()=>{
  const parsed=nflSchedule([{home:'PHI',away:'CHI',week:3,date:'2026-09-28',game_id:'live',status:'in_game'}],2026);
  assert.equal(parsed.byWeek[3].PHI.status,'in_progress');
  const args=lockFixture(parsed.byWeek[3].PHI.status),result=projectRoster(args);
  assert.equal(result.lockedCount,1);assert.equal(result.lineup[1].player.id,'done');
});
test('optimizer resolves overlapping FLEX and restricted slots without sacrificing a starter',()=>{
  const result=bestLineup(['FLEX','WRRB_FLEX','TE'],[p('rb','RB',15),p('te1','TE',20),p('te2','TE',18)]);
  assert.equal(result.modeledPoints,53);assert.equal(result.unfilled.length,0);
  assert.equal(result.lineup[1].player.id,'rb');assert.equal(new Set(result.lineup.map(s=>s.player.id)).size,3);
  assert.equal(bestLineup(['QB','SUPER_FLEX'],[p('q','QB',10),p('r','RB',20)]).modeledPoints,30);
  assert.equal(bestLineup(['REC_FLEX'],[p('r','RB',40),p('w','WR',10)]).modeledPoints,10);
});
test('unknown positions, negative scores, empty and multi-position rosters are explicit',()=>{
  const result=bestLineup(['QB','K','DEF'],[p('q','QB',-2)]);
  assert.equal(result.modeledPoints,-2);assert.equal(result.unfilled.length,2);
  assert.equal(bestLineup(['QB'],[]).unfilled.length,1);
  assert.equal(bestLineup(['TE','QB'],[{id:'dual',positions:['TE','QB'],points:20},p('te','TE',10)]).modeledPoints,30);
  assert.throws(()=>bestLineup(['QB'],[p('q','QB',10),p('q','QB',20)]),/duplicate/);
});
test('exact optimizer agrees with exhaustive legal lineups across deterministic mixed formats',()=>{
  let seed=17;const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
  function brute(slots,players,i=0,used=new Set()){
    if(i===slots.length)return {count:0,points:0};
    let best=brute(slots,players,i+1,used);
    for(const pl of players)if(!used.has(pl.id)&&SLOTS[slots[i]].some(pos=>pl.positions.includes(pos))){
      used.add(pl.id);const next=brute(slots,players,i+1,used);used.delete(pl.id);
      const option={count:next.count+1,points:next.points+pl.points};
      if(option.count>best.count||option.count===best.count&&option.points>best.points)best=option;
    }return best;
  }
  for(let trial=0;trial<60;trial++){
    const keys=Object.keys(SLOTS),slots=Array.from({length:4},()=>keys[rand(keys.length)]),pos=['QB','RB','WR','TE'];
    const players=Array.from({length:6},(_,i)=>p(String(i),pos[rand(4)],rand(40)-5));
    const expected=brute(slots,players),actual=bestLineup(slots,players);
    assert.equal(actual.modeledPoints,expected.points);assert.equal(slots.length-actual.unfilled.length,expected.count);
  }
});
const healthy={position:'QB',team:'PHI',status:'Active',active:true,injury_status:null};
const sched={valid:true,games:[{week:3,status:'pre_game'}],byWeek:{3:{PHI:{status:'pre_game'}},4:{PHI:{status:'pre_game'}}}};
const state=extra=>availability({id:'q',player:healthy,roster:{},week:3,currentWeek:3,schedule:sched,...extra});
test('fantasy IR/taxi, confirmed byes and incomplete NFL schedules affect eligibility',()=>{
  assert.equal(state({roster:{reserve:['q']}}).reason,'fantasy_ir');
  assert.equal(state({roster:{taxi:['q']}}).reason,'fantasy_taxi');
  assert.equal(state({week:5}).reason,'bye');
  assert.equal(state({schedule:{valid:false}}).reason,'schedule_unconfirmed');
  assert.equal(state({week:19}).reason,'invalid_week');
  assert.equal(state({player:{...healthy,team:null}}).reason,'no_nfl_team');
});
test('weekly Out is not carried indefinitely; questionable is conditional without invented odds',()=>{
  const out={...healthy,injury_status:'Out'};
  assert.equal(state({player:out}).status,'excluded');assert.equal(state({player:out,week:4}).reason,'future_out_assumed_available');assert.equal(state({player:out,week:4}).eligible,true);
  const questionable=state({player:{...healthy,injury_status:'Questionable'}});
  assert.equal(questionable.eligible,true);assert.equal(questionable.status,'conditional');assert.equal('probability' in questionable,false);
  assert.equal(state({player:{...healthy,status:'Practice Squad'}}).eligible,false);
});
test('IR, suspended and DNR stay excluded in future weeks while Out cannot override reserve or byes',()=>{
  for(const label of ['IR','Suspended','SUS','DNR','Did Not Report'])for(const field of ['injury_status','status']){
    assert.equal(state({player:{...healthy,[field]:label},week:4}).reason,'long_term_unavailable');
  }
  const out={...healthy,injury_status:'Out'};
  assert.equal(state({player:out,week:4,roster:{reserve:['q']}}).reason,'fantasy_ir');
  assert.equal(state({player:out,week:4,roster:{taxi:['q']}}).reason,'fantasy_taxi');
  assert.equal(state({player:out,week:5}).reason,'bye');
  assert.equal(state({player:{...out,status:'Injured Reserve'},week:4}).reason,'long_term_unavailable');
  assert.equal(state({player:{...out,status:'Inactive',active:false},week:4}).eligible,true);
});
test('partial/canceled/duplicated NFL schedules cannot silently create bye weeks',()=>{
  const game={home:'PHI',away:'DAL',game_id:'one',week:3,date:'2026-09-25',status:'pre_game'};
  const result=nflSchedule([game,{...game,status:'canceled',game_id:'old'}],2026);
  assert.equal(result.canceled,1);assert.equal(result.games.length,1);assert.equal(result.valid,false);
  assert.ok(nflSchedule([game,game],2026).issues.some(s=>s.includes('Repeated')));
});
const histories={q:Array.from({length:4},()=>({season:2026,week:2,points:15,snap:.9}))};
test('season preview can estimate a listed starting QB with thin role history but never promotes a backup',()=>{
  const args={roster:{roster_id:1,players:['q']},players:{q:{...healthy,depth_chart_order:1}},histories:{q:[{season:2026,week:2,points:3,snap:.1}]},meta:{season:2026,roster_positions:['QB'],settings:{}},schedule:sched,week:4,currentWeek:3};
  assert.equal(projectRoster(args).unfilled.length,1);
  const preview=projectRoster({...args,allowThinHistory:true});assert.equal(preview.lineup[0].player.points,3);assert.equal(preview.lineup[0].player.roleUncertain,true);
  assert.equal(projectRoster({...args,allowThinHistory:true,players:{q:{...args.players.q,depth_chart_order:2}}}).unfilled.length,1);
});
test('replacement scenarios reoptimize FLEX and exclude every uncertain candidate without promoting IR or taxi',()=>{
  const players=Object.fromEntries([['a','WR','Questionable'],['b','WR','Doubtful'],['c','TE',null],['d','RB',null],['e','WR',null],['ir','RB',null],['taxi','WR',null],['out','WR','Out']].map(([id,position,injury_status])=>[id,{...healthy,position,injury_status,full_name:id}]));
  const scores={a:30,b:25,c:20,d:15,e:10,ir:100,taxi:100,out:5};
  const args={players,roster:{roster_id:1,players:Object.keys(players),reserve:['ir'],taxi:['taxi']},histories:Object.fromEntries(Object.entries(scores).map(([id,points])=>[id,Array.from({length:4},()=>({season:2026,week:2,points,snap:.9}))])),meta:{season:2026,roster_positions:['WR','TE','FLEX'],settings:{}},week:4,currentWeek:3,schedule:sched};
  const before=JSON.stringify(args),base=projectRoster(args),alternative=projectRoster({...args,excludeConditional:true});
  assert.equal(base.modeledPoints,75);assert.equal(alternative.modeledPoints,45);
  assert.deepEqual(new Set(alternative.lineup.map(r=>r.player.id)),new Set(['c','d','e']));
  assert.equal(alternative.excluded.filter(p=>p.reason==='scenario_unavailable').length,2);
  assert.equal(alternative.unresolved.some(p=>p.id==='out'),false);
  assert.equal(JSON.stringify(args),before);assert.throws(()=>projectRoster({...args,week:3,excludeConditional:true}),/future/);
  const partial=projectRoster({...args,roster:{...args.roster,players:args.roster.players.filter(id=>!['e','out'].includes(id))},excludeConditional:true});assert.ok(partial.unfilled.length);
});
test('lineup report cannot silently fill unknown rookies, unsupported slots or live-week locks',()=>{
  const args={roster:{roster_id:1,players:['q','rookie'],taxi:[]},players:{q:healthy,rookie:{...healthy}},histories,meta:{season:2026,roster_positions:['QB','SUPER_FLEX'],settings:{}},schedule:sched,week:3,currentWeek:3};
  const result=projectRoster(args);
  assert.equal(result.unresolved[0].reason,'insufficient_history');assert.equal(result.unfilled.length,1);assert.equal(result.projectedTeamPoints,null);
  const live=projectRoster({...args,schedule:{...sched,games:[{week:3,status:'complete'}]}});
  assert.ok(live.warnings.some(w=>w.reason==='locked_lineup_unavailable'));
  const ir=projectRoster({...args,roster:{players:['q'],reserve:['q']}});assert.equal(ir.lineup.every(s=>!s.player),true);
  const backup=projectRoster({...args,players:{...args.players,q:{...healthy,depth_chart_order:2}}});
  assert.ok(backup.unresolved.some(p=>p.id==='q'&&p.reason==='qb_role_uncertain'));assert.equal(backup.lineup.some(s=>s.player?.id==='q'),false);
});
test('short-history estimates are marked, and zero-history players never receive invented points',()=>{
  const {earlyEstimate}=require('../lib/outlook-research.cjs');
  assert.deepEqual(earlyEstimate([]),{points:null,games:0,limited:true});
  assert.deepEqual(earlyEstimate([{points:0},{points:20}]),{points:10,games:2,limited:true});
  assert.equal(earlyEstimate(histories.q).limited,false);
  assert.throws(()=>earlyEstimate([{points:NaN}]),/Invalid/);
});
function lockFixture(status='complete'){
  return {roster:{roster_id:1,players:['done','benchDone','next'],starters:['next','done']},players:{done:{...healthy,position:'WR',full_name:'Locked player'},benchDone:{...healthy,position:'WR'},next:{...healthy,position:'WR',team:'DAL'}},histories:Object.fromEntries(['done','benchDone','next'].map((id,i)=>[id,[{points:(i+1)*20,snap:.8,season:2026,week:2}]])),meta:{season:2026,roster_positions:['WR','FLEX'],settings:{}},schedule:{valid:true,games:[{week:3,status}],byWeek:{3:{PHI:{status},DAL:{status:'pre_game'}},4:{PHI:{status:'pre_game'},DAL:{status:'pre_game'}}}},week:3,currentWeek:3,matchup:{starters:['next','done'],players_points:{done:0,benchDone:99}}};
}
test('completed starters retain their original slot and real zero; played bench players cannot be added',()=>{
  const result=projectRoster(lockFixture());
  assert.equal(result.lineup[1].player.id,'done');assert.equal(result.lineup[1].player.locked,true);assert.equal(result.lineup[1].player.points,0);
  assert.equal(result.lineup[0].player.id,'next');assert.equal(result.modeledPoints,60);
  assert.equal(result.excluded.find(p=>p.id==='benchDone').reason,'game_already_started');
  assert.equal(result.lineup[0].player.limitedHistory,true);
});
test('live and missing final points remain unknown in the subtotal; future weeks do not inherit locks',()=>{
  const args=lockFixture('in_progress');args.matchup.players_points.done=12;
  const result=projectRoster(args);assert.equal(result.lineup[1].player.points,null);assert.equal(result.lineup[1].player.actualPoints,12);assert.equal(result.pendingResults,1);assert.equal(result.modeledPoints,60);
  args.schedule.byWeek[3].PHI.status='complete';delete args.matchup.players_points.done;
  assert.equal(projectRoster(args).pendingResults,1);
  const future=projectRoster({...args,week:4});assert.equal(future.lockedCount,0);assert.equal(future.modeledPoints,100);
});
test('missing or malformed locked lineups cannot be silently rebuilt using hindsight',()=>{
  const missing=projectRoster({...lockFixture(),matchup:undefined});assert.equal(missing.lineup.every(s=>!s.player),true);
  const malformed=lockFixture();malformed.matchup.starters=['done','done'];assert.equal(projectRoster(malformed).lineup.every(s=>!s.player),true);
});
test('review notes separate selected and reported starters from other roster questions',()=>{
  const args=lockFixture();args.roster.players.push('unknown');args.players.unknown={...healthy,position:'WR',team:'DAL'};
  const result=projectRoster(args);assert.ok(result.lineupNotes.some(p=>p.id==='next'&&p.reason==='limited_history'));
  assert.ok(result.otherNotes.some(p=>p.id==='unknown'));assert.equal(result.possibleStarters.length,0);
  args.roster.starters[0]='unknown';assert.ok(projectRoster(args).possibleStarters.some(p=>p.id==='unknown'));
});
test('a complete season establishes byes, while a missing or duplicate game invalidates them',()=>{
  const teams='ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '),games=[];
  for(let round=1;round<=17;round++)for(let pair=0;pair<16;pair++)games.push({home:teams[pair*2],away:teams[pair*2+1],game_id:round+'-'+pair,week:round===17&&pair>=8?18:round,date:'2026-10-01',status:'pre_game'});
  const result=nflSchedule(games,2026);assert.equal(result.valid,true);assert.equal(result.games.length,272);
  assert.equal(result.byWeek[18].ARI,undefined);assert.ok(result.byWeek[17].ARI);
  assert.equal(nflSchedule(games.slice(1),2026).valid,false);
  assert.equal(nflSchedule([...games,{...games[0],game_id:'duplicate'}],2026).valid,false);
});
test('historical forecasts ignore target/future stats and do not apply current injuries retroactively',()=>{
  const args={slots:[{season:2025,week:1},{season:2025,week:2}],weeks:[{q:{gms_active:1,pass_td:1}},{q:{gms_active:1,pass_td:99}}],players:{q:{...healthy,injury_status:'IR'}},scoring:{pass_td:4},season:2025,week:2};
  const result=playerHistories(args);assert.equal(result.q.length,1);assert.equal(result.q[0].points,4);
});
test('team error requires a full lineup and reconciled actual points; recorded zero points count',()=>{
  const players={q:healthy},slots=['QB'];
  const result=evaluateStarterRows({players,slots,histories,matchups:[{roster_id:1,starters:['q'],points:0,players_points:{q:0}},{roster_id:2,starters:['rookie'],points:10,players_points:{rookie:10}},{roster_id:3,starters:['q'],points:99,players_points:{q:0}},{roster_id:4,starters:['q'],points:0,players_points:{q:0},custom_points:10}]});
  assert.equal(result.complete,1);assert.equal(result.metrics.mae,15);assert.equal(result.excludedReasons.team_total_disagreement,1);assert.equal(result.excludedReasons.commissioner_override,1);
});
