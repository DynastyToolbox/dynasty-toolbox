'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Sleeper=require('../sleeper_data.js');
const {catalog,buildLeague,evaluate}=require('../lib/trade-calculator.cjs');
const {requirements,profile,rosterSafe}=require('../lib/finder-roster.cjs');
const {findPartners}=require('../lib/trade-finder.cjs');
const {resolveAccess}=require('../lib/subscription-access.cjs');
const {bestLineup}=require('../median_data.js');
const format={ppr:'hppr',superflex:true,tePremium:false};
const uid='11111111-1111-4111-8111-111111111111';
const premium=resolveAccess(uid,null,[{user_id:uid,plan:'premium',starts_at:'2020-01-01',expires_at:null,revoked_at:null}]);
const rows=[{Player:'Starting QB',Position:'QB',Score:'7000'},{Player:'Starting RB',Position:'RB',Score:'5000'}];
const book=catalog(Object.fromEntries(['overall','competing','tanking'].map(mode=>[mode,rows])));
const players={q:{full_name:'Starting QB',position:'QB'},r:{first_name:'Starting',last_name:'RB',position:'RB'},k:{full_name:'Kicker',position:'K'},DET:{team:'DET',position:'DEF'},d:{full_name:'Linebacker',position:'LB'}};
function bundle(size,extras=false){return {id:'1318402338695708672',meta:{sport:'nfl',season:'2026',status:'in_season',settings:{type:2,draft_rounds:0},roster_positions:['QB','RB','FLEX','K','DEF','BN']},drafts:[],traded:[],users:[],rosters:Array.from({length:size},(_,i)=>({roster_id:i+1,owner_id:null,players:['q','r',...(extras?['k','DET','d','missing']:[])]}))};}
test('8–16 team leagues load K, DEF, IDP and unknown assets without changing dynasty ranks',()=>{
  for(const size of [8,10,12,14,16]){
    const plain=buildLeague(bundle(size),players,book),extended=buildLeague(bundle(size,true),players,book);
    const body={format,teams:[{id:1,roster_id:'1',status:'overall'},{id:2,roster_id:String(size),status:'overall'}],transfers:[]};
    assert.deepEqual(evaluate(body,premium,book,extended),evaluate(body,premium,book,plain));
    assert.equal(extended.teams.length,size);
    assert.equal(extended.teams[0].assets.find(a=>a.id==='player:DET').label,'DET Defense');
    assert.equal(extended.teams[0].assets.find(a=>a.id==='player:missing').scores.overall.ranked,false);
    const finder=findPartners(extended,{roster_id:'1',format},resolveAccess(null));
    assert.deepEqual(finder.team.counts,{QB:1,RB:1,WR:0,TE:0});
  }
});
test('empty rosters, taxi and reserve players are safe and deduplicated',()=>{
  assert.deepEqual(Sleeper.rosterPlayerIds({players:['q',null,'0','r'],reserve:['q','k'],taxi:['r','d']}),['q','r','k','d']);
  const input=bundle(8);input.rosters[0]={roster_id:1,players:null,reserve:['q'],taxi:['r']};input.rosters[1]={roster_id:2,players:null};
  const league=buildLeague(input,players,book);assert.equal(league.teams[0].assets.length,2);assert.equal(league.teams[1].assets.length,0);
  assert.equal(evaluate({format,teams:[{id:1,roster_id:'1',status:'overall'},{id:2,roster_id:'2',status:'overall'}],transfers:[]},premium,book,league).teams.length,2);
});
test('unranked K and DEF never fill a median lineup',()=>{
  const lineup=bestLineup([{id:'q',pos:'QB',median:20},{id:'k',pos:'K',median:99},{id:'d',pos:'DEF',median:99}],{QB:1,FLX:1,SFLX:1});
  assert.deepEqual(lineup.map(s=>s.player?.id||null),['q',null,null]);
});
test('one QB, two QB, two TE, receiving flex and all-flex use actual supported slots',()=>{
  assert.deepEqual(requirements({roster_positions:['QB','TE','TE','K','DEF','BN']},format).demand,{QB:1,RB:0,WR:0,TE:2});
  assert.equal(requirements({roster_positions:['QB','QB']},{...format,superflex:false}).demand.QB,2);
  const flex=requirements({roster_positions:['WRRB_FLEX','REC_FLEX','BN']},format);
  assert.equal(flex.fallback,false);assert.deepEqual(flex.demand,{QB:0,RB:.5,WR:1,TE:.5});
  const asset=(id,position)=>({id,position,scores:{overall:{value:6000,position,ranked:true}}});
  const wr=asset('w','WR'),te=asset('t','TE');
  const p=profile({roster_positions:['WR','TE','REC_FLEX'],teams:[{roster_id:'1',assets:[wr,te,asset('w2','WR')]}]},'1','overall',format);
  assert.equal(rosterSafe(p,[wr],[asset('rb','RB')],'overall',format),false);
});
test('analyzer handles restricted flex and two kicker slots without reusing the same kicker',()=>{
  const source=fs.readFileSync(require.resolve('../team_analyzer.js'),'utf8');
  const fn=source.slice(source.indexOf('  function getStarters('),source.indexOf('  // ─── Load teams & picks'));
  const registry={r:{full_name:'RB',position:'RB'},t:{full_name:'TE',position:'TE'},k1:{full_name:'Kicker One',position:'K'},k2:{full_name:'Kicker Two',position:'K'}};
  const starters=vm.runInNewContext(fn+';getStarters({players:["r","t","k1","k2","missing"]},{rb:5000,te:9000})',{lineupConfig:['WRRB_FLEX','REC_FLEX','K','K'],allPlayers:registry,normalize:s=>String(s||'').toLowerCase()});
  assert.equal(starters.FLEX1.name,'RB');assert.equal(starters.FLEX2.name,'TE');assert.equal(starters.K.name,'Kicker One (unranked)');assert.equal(starters.K2.name,'Kicker Two (unranked)');
});
test('analyzer strategy tiers scale with league size',()=>{
  assert.deepEqual(Sleeper.leagueRankBands(8),{top:2,middle:5});assert.deepEqual(Sleeper.leagueRankBands(12),{top:3,middle:7});assert.deepEqual(Sleeper.leagueRankBands(16),{top:4,middle:10});
});
