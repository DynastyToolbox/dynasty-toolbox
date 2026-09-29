'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../outlook-bracket.js');
const {simulateSeason,distribution}=require('../lib/outlook-season.cjs');
const {playoffConfig}=require('../lib/outlook-playoffs.cjs');
const field=n=>Array.from({length:n},(_,i)=>({id:String(i+1),seed:i+1}));
const forecasts=(n,sd=10)=>Object.fromEntries([15,16,17,18].flatMap(w=>field(n).map(t=>[w+':'+t.id,{mean:100,sd}])));
test('four six and eight team brackets eliminate once, obey byes and crown one champion',()=>{
 for(const count of [4,6,8]){const rounds=B.roundWeeks(count,15,Array(count===4?2:3).fill(1)),f=forecasts(count,0),path=B.play(field(count),rounds,f);
  assert.equal(path.champion.seed,1);assert.equal(path.rounds.reduce((n,r)=>n+r.games.length,0),count-1);
  assert.equal(path.rounds[0].games.length,count===6?2:count/2);
  assert.deepEqual(B.pairsFor(field(6)).map(p=>p.map(t=>t.seed)),[[4,5],[3,6]]);
 }
});
test('reseeded semifinal sends the lowest surviving seed to number one; fixed paths stay on their side',()=>{
 const f=forecasts(6,0);f['15:6'].mean=200;
 const rounds=B.roundWeeks(6,15,[1,1,1]);
 assert.deepEqual(B.play(field(6),rounds,f,{reseed:false}).rounds[1].games.map(g=>[g.a.seed,g.b.seed]),[[1,4],[2,6]]);
 assert.deepEqual(B.play(field(6),rounds,f,{reseed:true}).rounds[1].games.map(g=>[g.a.seed,g.b.seed]),[[1,6],[2,4]]);
});
test('two week rounds aggregate scores and reject seasons past week eighteen',()=>{
 const rounds=B.roundWeeks(4,15,[1,2]),f=forecasts(4,0);f['16:1'].mean=120;f['17:1'].mean=20;f['16:2'].mean=80;f['17:2'].mean=90;
 assert.equal(B.play(field(4),rounds,f).champion.seed,2);
 assert.deepEqual(rounds,[[15],[16,17]]);assert.throws(()=>B.roundWeeks(6,15,[2,2,2]),/Week 18/);
 f['16:1'].mean=100.1;f['17:1'].mean=100.2;f['16:2'].mean=100.3;f['17:2'].mean=100;
 const tied=B.play(field(4),rounds,f);assert.equal(tied.rounds.at(-1).games[0].aScore,tied.rounds.at(-1).games[0].bScore);assert.equal(tied.champion.seed,1);
 assert.throws(()=>B.scenario([field(4)[0],field(4)[0],...field(4).slice(2)],rounds,f),/different team/);
 delete f['17:1'];assert.throws(()=>B.scenario(field(4),rounds,f),/unavailable/);
});
test('scenario title chances total one, finalists total two, repeat deterministically, and never mutate inputs',()=>{
 const original=field(6),copy=structuredClone(original),f=forecasts(6),rounds=B.roundWeeks(6,15,[1,1,1]);
 const result=B.scenario(original,rounds,f,{reseed:true,iterations:1000});
 assert.deepEqual(result,B.scenario(original,rounds,f,{reseed:true,iterations:1000}));assert.deepEqual(original,copy);
 assert.ok(Math.abs(result.teams.reduce((s,t)=>s+t.titleChance,0)-1)<1e-10);assert.ok(Math.abs(result.teams.reduce((s,t)=>s+t.finalChance,0)-2)<1e-10);
 assert.ok(result.teams[0].titleChance>result.teams[5].titleChance);
 const a=original[0],b=original[1];assert.ok(Math.abs(B.gameChance(a,b,[15],f)+B.gameChance(b,a,[15],f)-1)<1e-6);
});
test('unconditional championship simulation preserves regular-season projections and qualification bounds',()=>{
 const teams=field(8).map(t=>({...t,record:{wins:0,losses:0,ties:0},pointsFor:0,pointsAgainst:0}));
 const f=forecasts(8),config=playoffConfig({settings:{playoff_teams:6,playoff_week_start:15,playoff_seed_type:1,playoff_round_type:0}},teams);
 const all=new Map(Object.entries(f).map(([k,v])=>[k,{...v,available:true}]));for(const t of teams)all.set('14:'+t.id,{mean:100,sd:20,available:true});
 const args={teams,schedule:[{week:14,pairs:[['1','2'],['3','4'],['5','6'],['7','8']],issues:[]}],forecasts:all,playoffConfig:config,iterations:1000};
 const result=simulateSeason(args),baseline=simulateSeason({...args,playoffConfig:{...config,bracket:null}});
 assert.ok(Math.abs(result.teams.reduce((s,t)=>s+t.playoffs.titleChance,0)-1)<1e-10);
 assert.ok(Math.abs(result.teams.reduce((s,t)=>s+t.playoffs.finalChance,0)-2)<1e-10);
 for(const t of result.teams){assert.deepEqual(t.expected,baseline.teams.find(b=>b.id===t.id).expected);assert.ok(t.playoffs.titleChance<=t.playoffs.finalChance&&t.playoffs.finalChance<=t.playoffs.chance);}
 all.delete('17:8');const missing=simulateSeason(args);assert.equal(missing.available,true);assert.equal(missing.playoffs.rounds,null);assert.ok(missing.teams.every(t=>t.playoffs.titleChance===null));
});
test('a known free agent cannot block a genuine vacant starting spot, but an unknown eligible player can',()=>{
 const model={available:true,residuals:[-10,0,10]},lineup={lineup:[{slot:'RB',player:null}],lineupNotes:[],unresolved:[{id:'f',reason:'no_nfl_team'}]};
 assert.equal(distribution(model,lineup,{}, {f:{position:'RB',team:null}}).available,true);
 assert.equal(distribution(model,lineup,{}, {f:{position:'RB',team:'BUF'}}).available,false);
 assert.equal(distribution(model,lineup,{}, {}).available,false);
});
test('moving one team shifts intervening seeds and outside teams replace the last qualifier',()=>{
 const original=field(6),copy=structuredClone(original);
 assert.deepEqual(B.moveTeam(original,'1',3).map(t=>t.id),['2','3','1','4','5','6']);
 assert.deepEqual(B.moveTeam(original,'6',2).map(t=>t.id),['1','6','2','3','4','5']);
 const outside=B.moveTeam(original,'outside',2);assert.deepEqual(outside.map(t=>t.id),['1','outside','2','3','4','5']);assert.equal(outside.filter(t=>t.bye).length,2);
 assert.deepEqual(original,copy);assert.throws(()=>B.moveTeam(original,'1',0),/seed/);
});
test('enumerated seed odds conserve probabilities and agree with sampled brackets',()=>{
 for(const count of [4,6,8])for(const reseed of [true,false]){
  const f=forecasts(count),rounds=B.roundWeeks(count,15,Array(count===4?2:3).fill(1));f['15:1'].mean=115;
  const exact=B.exactScenario(field(count),rounds,f,{reseed}),sample=B.scenario(field(count),rounds,f,{reseed,iterations:5000});
  assert.ok(Math.abs(exact.reduce((s,t)=>s+t.titleChance,0)-1)<1e-9);assert.ok(Math.abs(exact.reduce((s,t)=>s+t.finalChance,0)-2)<1e-9);
  for(const t of exact)assert.ok(Math.abs(t.titleChance-sample.teams.find(s=>s.id===t.id).titleChance)<.035);
 }
});
test('team path includes all rounds even for an underdog without pretending it wins the title',()=>{
 const f=forecasts(6,0),rounds=B.roundWeeks(6,15,[1,1,1]);for(const w of [15,16,17])f[w+':6'].mean=1;
 const scenario=B.teamScenario(field(6),'6',6,rounds,f,{reseed:true});
 assert.equal(scenario.titleChance,0);assert.equal(scenario.path.length,3);assert.ok(scenario.path.every(r=>r.opponent&&r.opponent.id!=='6'));assert.ok(scenario.path.every(r=>r.winChance===0));
 assert.equal(B.teamScenario(field(6),'6',1,rounds,f,{reseed:true}).path[0].bye,true);
 const equal=forecasts(6);const bye=B.teamScenario(field(6),'6',2,rounds,equal,{reseed:true}),noBye=B.teamScenario(field(6),'6',6,rounds,equal,{reseed:true});assert.ok(bye.titleChance>noBye.titleChance+.1);
});
