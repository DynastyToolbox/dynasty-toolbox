'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {offensivePoints,starterSlots,weeklyPairings,plan,inspectLeague}=require('../lib/outlook-foundation.cjs');
test('outlook uses league stat weights rather than dynasty values or precomputed fantasy totals',()=>{
  const stats={pass_yd:250,pass_td:2,pass_int:2,rush_yd:20,pts_half_ppr:999};
  const scoring={pass_yd:.04,pass_td:4,pass_int:-1,rush_yd:.1};
  assert.equal(offensivePoints(stats,'QB',scoring),18);
  assert.equal(offensivePoints(stats,'QB',{...scoring,pass_int:-2}),16);
  assert.equal(offensivePoints({rec:6,rec_yd:70,rec_td:1},'TE',{rec:.5,rec_yd:.1,rec_td:6}),16);
  assert.equal(offensivePoints({rec:6,rec_yd:70,rec_td:1},'TE',{rec:1,rec_yd:.1,rec_td:6}),19);
  assert.equal(offensivePoints({st_td:1},'WR',{st_td:6}),6);
});
test('missing records, unknown scoring, and unsupported positions are not silently scored as zero',()=>{
  assert.equal(offensivePoints(null,'WR',{rec:1}),null);
  assert.equal(offensivePoints({},'WR',{rec:1}),0);
  assert.throws(()=>offensivePoints({},'TE',{bonus_rec_te:1}),/needs support/);
  assert.throws(()=>offensivePoints({},'K',{}),/currently modeled/);
  assert.throws(()=>offensivePoints({rec:NaN},'WR',{rec:1}),/Invalid/);
  assert.deepEqual(starterSlots({roster_positions:['QB','K','DEF','BN']}),{slots:['QB','K','DEF'],unsupported:['K','DEF']});
});
test('schedule pairs use matchup IDs and fail visibly for missing/duplicate/unpaired teams',()=>{
  assert.deepEqual(weeklyPairings([{roster_id:4,matchup_id:9},{roster_id:2,matchup_id:9}],['2','4']),{pairs:[['4','2']],issues:[]});
  assert.ok(weeklyPairings([{roster_id:2,matchup_id:null}],['2','4']).issues.length);
  assert.ok(weeklyPairings([{roster_id:2,matchup_id:1},{roster_id:2,matchup_id:1}],['2','4']).issues.length);
});
test('in-progress weeks never enter completed history; regular season stops at playoffs',()=>{
  const meta={sport:'nfl',season:'2026',settings:{start_week:1,last_scored_leg:3,playoff_week_start:15,league_average_match:1}};
  const result=plan(meta,{season:'2026',season_type:'regular',week:3});
  assert.equal(result.completedThrough,2);assert.equal(result.remaining[0],3);assert.equal(result.remaining.at(-1),14);assert.equal(result.medianGame,true);
  assert.throws(()=>plan(meta,{season:'2025',season_type:'regular',week:3}),/current regular season/);
});
test('league inspection loads all remaining scheduled weeks without inventing results',async()=>{
  const id='1234567890123456789';
  const result=await inspectLeague(id,async url=>({ok:true,json:async()=>url.endsWith('state/nfl')?{season:'2026',season_type:'regular',week:13}:url.endsWith('/rosters')?[{roster_id:1},{roster_id:2}]:url.includes('/matchups/')?[{roster_id:1,matchup_id:7},{roster_id:2,matchup_id:7}]:{sport:'nfl',name:'Test',season:'2026',roster_positions:['QB','RB'],scoring_settings:{pass_td:6},settings:{last_scored_leg:12,playoff_week_start:15}}}));
  assert.deepEqual(result.schedule.map(w=>w.week),[13,14]);assert.equal(result.schedule.every(w=>w.issues.length===0),true);assert.equal('champion' in result,false);
});
