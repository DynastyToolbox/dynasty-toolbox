'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {offensiveView,offensiveMatchup}=require('../lib/outlook-offense.cjs');
const {scoringSupport,offensivePoints}=require('../lib/outlook-foundation.cjs');
const {projectRoster}=require('../lib/outlook-lineups.cjs');
const {draftInventory}=require('../lib/outlook-draft.cjs');
test('all non-offensive slots are removed while restricted flex and their order stay intact',()=>{
  const meta={roster_positions:['K','QB','DL','RB','DB','REC_FLEX','LB','SUPER_FLEX','IDP_FLEX','DEF','WRRB_FLEX','BN','IR','TAXI']};
  const original=JSON.stringify(meta),view=offensiveView(meta);
  assert.deepEqual(view.roster_positions,['QB','RB','REC_FLEX','SUPER_FLEX','WRRB_FLEX','BN','IR','TAXI']);assert.equal(JSON.stringify(meta),original);
});
test('defensive and kicking settings are ignored without masking unsupported offensive bonuses',()=>{
  const scoring={pass_td:4,rec:.5,fgm_yds:.1,fgmiss_50p:-1,xpmiss:-1,def_kr_td:6,idp_tkl:2,tkl_ast:1,bonus_tkl_10p:3,sack_yd:.1,qb_hit:1,yds_allow_0_100:5,pass_def:2};
  assert.deepEqual(scoringSupport(scoring),[]);
  assert.equal(offensivePoints({pass_td:2,rec:4,idp_tkl:100},'QB',scoring),10);
  assert.deepEqual(scoringSupport({...scoring,bonus_rec_te:1}),['bonus_rec_te']);
});
test('mixed starting lineups retain offensive indices and discard non-offensive points',()=>{
  const meta={roster_positions:['K','WR','DEF','QB','LB','BN']},row={starters:['k','w','def','q','lb'],players_points:{k:100,w:12,def:200,q:20,lb:300},points:632};
  const original=JSON.stringify(row),mapped=offensiveMatchup(row,meta);
  assert.deepEqual(mapped.starters,['w','q']);assert.equal(mapped.points,32);assert.equal(JSON.stringify(row),original);
  assert.deepEqual(offensiveMatchup({...row,starters:['q']},meta).starters,[]);
  assert.equal(offensiveMatchup({...row,players_points:{}},meta).points,null);
});
test('live offensive starters stay locked in the right slots after removing K and DEF',()=>{
  const raw={season:2026,roster_positions:['K','WR','DEF','QB'],settings:{}},meta=offensiveView(raw);
  const players={w:{position:'WR',team:'PHI',status:'Active'},q:{position:'QB',team:'DAL',status:'Active',depth_chart_order:1}};
  const result=projectRoster({meta,players,roster:{roster_id:1,players:['w','q']},histories:{q:[{points:20,snap:.9,season:2026,week:2}]},week:3,currentWeek:3,allowThinHistory:true,
    schedule:{valid:true,games:[{week:3,status:'in_progress'}],byWeek:{3:{PHI:{status:'in_progress'},DAL:{status:'pre_game'}}}},
    matchup:offensiveMatchup({starters:['k','w','PHI','q'],players_points:{k:5,w:7,PHI:10,q:0}},raw)});
  assert.equal(result.lockedCount,1);assert.equal(result.lineup[0].player.id,'w');assert.equal(result.lineup[1].player.id,'q');
});
test('redraft and keeper leagues do not show a rookie draft board',()=>{
  for(const type of [0,1])assert.equal(draftInventory({meta:{settings:{type}}}).applicable,false);
});
