'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const S=require('../sleeper_data.js');
const {catalog,buildLeague}=require('../lib/trade-calculator.cjs');
const row=(Player,Position='WR',Score='5115')=>({Player,Position,Score});
const player=(full_name,position='WR')=>({full_name,position});
test('KC suffix change retains all three published scores by Sleeper ID',()=>{
 const registry={kc:player('KC Concepcion Jr.')};
 const rankings=require('../data/nfl_rankings.json').rankings;
 for(const rows of Object.values(rankings)){
  const expected=rows.find(r=>r.Player==='KC CONCEPCION');
  const result=S.matchRankings(rows,registry);
  assert.equal(result.byId.get('kc'),expected);
  assert.equal(S.rankingScoreMap(rows,registry)['player:kc'],Number(expected.Score));
 }
 const book=catalog(rankings);
 const league=buildLeague({meta:{season:'2026',settings:{type:2,draft_rounds:0}},rosters:[{roster_id:1,players:['kc']}],users:[],drafts:[],traded:[]},registry,book);
 assert.equal(league.teams[0].assets[0].id,'player:kc');
 assert.deepEqual(Object.values(league.teams[0].assets[0].scores).map(s=>s.ranked),[true,true,true]);
 assert.equal(league.teams[0].assets[0].scores.overall.value,5115);
});
test('punctuation, accents, spacing and terminal suffix variants match in either direction',()=>{
 for(const [a,b] of [['K.C. Concepcion','KC Concepcion Jr.'],['Jose Smith','José Smith'],["D’Andre Swift","D'Andre Swift"],['John Doe II','John Doe'],['John Doe','John Doe III'],['John Doe','John Doe, Sr.']]){
  assert.equal(S.matchRankings([row(a)],{p:player(b)}).byId.size,1,`${a} / ${b}`);
 }
 assert.equal(S.matchRankings([row('John Doe Sr.')],{p:player('John Doe Jr.')}).byId.size,0);
});
test('exact match wins, positions disambiguate, ambiguous suffixes are reported without guessing',()=>{
 const registry={a:player('John Smith'),b:player('John Smith Jr.'),c:player('John Smith','LB')};
 assert.equal(S.matchRankings([row('John Smith')],registry).byId.has('a'),true);
 const ambiguous=S.matchRankings([row('John Smith')],{a:player('John Smith Jr.'),b:player('John Smith III')});
 assert.equal(ambiguous.byId.size,0);assert.equal(ambiguous.report[0].status,'ambiguous');
 assert.equal(S.matchRankings([row('John Smith')],{a:player('John Smith Jr.'),b:player('John Smith','LB')}).byId.has('a'),true);
 const duplicate=S.matchRankings([row('John Smith'),row('John Smith')],{a:player('John Smith')});
 assert.equal(duplicate.byId.size,0);assert.ok(duplicate.report.every(r=>r.status==='ambiguous'));
 assert.equal(S.matchRankings([row('John Smith'),row('John Smith Jr.')],{a:player('John Smith III')}).byId.size,0);
});
test('no fuzzy guessing, no K/DEF matching, zero scores and pick values remain intact',()=>{
 const rows=[row('John Smith'),row('Zero Player','WR','0'),row('2027 1st Round','PICKS','300')];
 const registry={a:player('Jon Smith'),b:player('John Smith','K'),z:player('Zero Player Jr.')};
 const matched=S.matchRankings(rows,registry);assert.equal(matched.byId.size,1);
 assert.equal(matched.report[0].status,'unmatched');
 const scores=S.rankingScoreMap(rows,registry);assert.equal(scores['player:z'],0);
 assert.equal(S.pickScore({season:'2027',round:1},scores),300);
});
test('actual Team Analyzer averages and depth panel use matched player IDs',()=>{
 const code=fs.readFileSync(require.resolve('../team_analyzer.js'),'utf8');
 const players={kc:player('KC Concepcion Jr.')};
 const scores=S.rankingScoreMap([row('KC CONCEPCION')],players);
 const context=vm.createContext({DynastySleeper:S,allPlayers:players,depthChartTeamCard:{innerHTML:''}});
 vm.runInContext(code.slice(code.indexOf('  function getTop15Avg('),code.indexOf('  function getStarters(')),context);
 assert.equal(context.getTop15Avg({players:['kc'],picks:[]},scores),5115);
 // Exercise the real rendering function, not a mirrored implementation.
 const start=code.indexOf('  function renderDepthPanel('),end=code.indexOf('\n  }',start)+4;
 vm.runInContext(code.slice(start,end),context);
 context.renderDepthPanel('overall',{players:['kc'],picks:[]},scores,scores,scores,'Owner');
 assert.match(context.depthChartTeamCard.innerHTML,/KC Concepcion Jr\./);
});

test('reviewed nickname IDs and dual-position eligibility preserve identity',()=>{
 const registry={'7567':player('Kenny Gainwell','RB'),'12547':player('Kyle Williams'),'638':player('Kyle Williams'),'12530':{full_name:'Travis Hunter',position:'DB',fantasy_positions:['DB','WR']}};
 const matched=S.matchRankings([row('KENNETH GAINWELL','RB'),row('KYLE WILLIAMS'),row('TRAVIS HUNTER')],registry);
 assert.deepEqual([...matched.byId.keys()],['7567','12547','12530']);
 assert.equal(S.playerInfo('12530',registry).position,'WR');
 const moved=S.matchRankings([row('Robbie Ouzts','TE')],{r:player('Robbie Ouzts','RB')});
 assert.equal(moved.report[0].status,'position-mismatch');assert.equal(moved.byId.get('r').Score,'5115');
 // A recycled/wrong ID must not inherit the reviewed alias.
 assert.equal(S.matchRankings([row('KENNETH GAINWELL','RB')],{'7567':player('Somebody Else','RB')}).byId.size,0);
});

test('position-compatible suffix beats an exact name belonging to another position',()=>{
 const registry={old:player('Kenneth Walker','WR'),current:player('Kenneth Walker III','RB')};
 const result=S.matchRankings([row('KENNETH WALKER','RB')],registry);
 assert.equal(result.byId.has('old'),false);assert.equal(result.byId.has('current'),true);
 assert.equal(result.report[0].status,'suffix');
});
