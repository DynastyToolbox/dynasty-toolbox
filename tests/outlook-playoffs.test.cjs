'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {playoffConfig,seedField,openingRound,roundedRecord,seedRecordSummary}=require('../lib/outlook-playoffs.cjs');
const {simulateSeason}=require('../lib/outlook-season.cjs');
const teams=Array.from({length:10},(_,i)=>({id:String(i+1),division:null,record:{wins:0,losses:0,ties:0},pointsFor:0,pointsAgainst:0}));
const config=(count=6,ts=teams)=>playoffConfig({settings:{playoff_teams:count,playoff_week_start:15}},ts);
test('standard 4/6/8 fields have unique qualifiers, correct byes and opening opponents',()=>{
 for(const count of [4,6,8]){
  const c=config(count),field=seedField(teams,c),games=openingRound(field,c);
  assert.equal(field.length,count);assert.equal(new Set(field.map(t=>t.id)).size,count);
  assert.equal(field.filter(t=>t.bye).length,count===6?2:0);
  const playing=games.flatMap(g=>[g.a.seed,g.b.seed]);assert.equal(new Set(playing).size,playing.length);
  assert.equal(playing.length+field.filter(t=>t.bye).length,count);
 }
 assert.deepEqual(openingRound(seedField(teams,config()),config()).map(g=>[g.a.seed,g.b.seed]),[[3,6],[4,5]]);
});
test('record targets are conditional modal finishes, preserve completed ties and withhold thin samples',()=>{
 const current={wins:2,losses:1,ties:1},counts=new Map([['9:4:1',40],['10:3:1',30],['8:5:1',10]]);
 const r=seedRecordSummary(counts,current);assert.deepEqual(r.final,{wins:9,losses:4,ties:1});assert.deepEqual(r.remaining,{wins:7,losses:3,ties:0});assert.equal(r.samples,80);
 assert.equal(seedRecordSummary(new Map([['9:4:1',29]]),current).available,false);assert.equal(seedRecordSummary(new Map(),current).available,false);
});
test('division winners qualify above a stronger wildcard and incomplete divisions fail visibly',()=>{
 const ts=teams.map((t,i)=>({...t,division:i<8?1:2})),c=config(6,ts),field=seedField(ts,c);
 assert.equal(c.available,true);assert.deepEqual(field.slice(0,2).map(t=>t.id),['1','9']);assert.ok(field.slice(0,2).every(t=>t.bye));
 const four=teams.map((t,i)=>({...t,division:Math.min(4,1+Math.floor(i/3))})),c4=config(8,four);
 assert.deepEqual(seedField(four,c4).slice(0,4).map(t=>t.id),['1','4','7','10']);
 assert.equal(config(6,[{...ts[0],division:null},...ts.slice(1)]).available,false);
 assert.equal(config(4,ts).available,false);assert.equal(config(12).available,false);
});
test('whole-number records keep season totals and already-recorded wins losses and ties',()=>{
 const zero={wins:0,losses:0,ties:0};
 assert.deepEqual(roundedRecord({wins:11.8,losses:2.2,ties:0},zero,14),{wins:12,losses:2,ties:0});
 assert.deepEqual(roundedRecord({wins:6.5,losses:7.5,ties:0},zero,14),{wins:7,losses:7,ties:0});
 assert.deepEqual(roundedRecord({wins:5.4,losses:7.6,ties:1}, {wins:2,losses:1,ties:1},14),{wins:5,losses:8,ties:1});
 for(let total=2;total<=36;total++)for(let w=0;w<=total;w+=.13){const e={wins:w,losses:total-w,ties:0},r=roundedRecord(e,zero,total);assert.equal(r.wins+r.losses+r.ties,total);assert.ok(Object.values(r).every(Number.isInteger));}
});
test('playoff chances sum to exactly the field size, seed chances reconcile and rounding never feeds seeding',()=>{
 const schedule=[{week:1,pairs:[['1','2'],['3','4'],['5','6'],['7','8'],['9','10']],issues:[]}];
 const forecasts=new Map(teams.map((t,i)=>['1:'+t.id,{available:true,mean:100-i,sd:20}]));
 const args={teams,schedule,forecasts,iterations:1000,seed:'playoffs',expectedCompletedGames:0,expectedWeeks:[1],playoffConfig:config()};
 const p=simulateSeason(args),baseline=simulateSeason({...args,playoffConfig:{available:false}});
 assert.ok(Math.abs(p.teams.reduce((s,t)=>s+t.playoffs.chance,0)-6)<1e-10);
 assert.ok(Math.abs(p.teams.reduce((s,t)=>s+t.playoffs.byeChance,0)-2)<1e-10);
 for(let seed=0;seed<6;seed++)assert.ok(Math.abs(p.teams.reduce((s,t)=>s+t.playoffs.seedChances[seed],0)-1)<1e-10);
 for(const t of p.teams){assert.deepEqual(t.expected,baseline.teams.find(x=>x.id===t.id).expected);assert.equal(t.displayRecord.wins+t.displayRecord.losses+t.displayRecord.ties,1);assert.ok(t.playoffs.byeChance<=t.playoffs.chance);for(const [i,target]of t.playoffs.seedRecords.entries()){assert.ok(Math.abs(target.samples-t.playoffs.seedChances[i]*args.iterations)<1e-8);if(target.available){assert.equal(Object.values(target.final).reduce((a,b)=>a+b,0),1);assert.deepEqual(target.remaining,target.final);}}}
 const invalid=simulateSeason({...args,playoffConfig:config(12)});assert.equal(invalid.available,true);assert.equal(invalid.playoffs.available,false);assert.ok(invalid.teams.every(t=>t.playoffs===null));
});
