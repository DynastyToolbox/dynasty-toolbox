'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {distribution,compareForecasts,simulateSeason,compareStanding,applyWeek}=require('../lib/outlook-season.cjs');
const model={available:true,residuals:[-20,-10,0,10,20]};
const lineup=(games=8)=>({lineup:[{slot:'QB',player:{id:'q',points:20,historyGames:games,limitedHistory:games<4}}],unfilled:[],lineupNotes:games<4?[{reason:'limited_history'}]:[]});
test('limited history contributes its point estimate with progressively wider uncertainty',()=>{
  const established=distribution(model,lineup()),three=distribution(model,lineup(3)),one=distribution(model,lineup(1));
  assert.equal(one.mean,established.mean);assert.ok(one.sd>three.sd&&three.sd>established.sd);
  const short=compareForecasts(one,established,{week:4,currentWeek:3});assert.equal(short.available,true);assert.equal(short.limitedHistory,true);assert.ok(Math.abs(short.probability.expectedResult-.5)<1e-6);
  assert.equal(distribution(null,lineup()).available,false);
  assert.equal(distribution(model,{...lineup(),lineupNotes:[{reason:'unsupported_slots'}]}).available,false);
});
test('comparisons are symmetric, finite, sum to one, and less certain data reduces favorite certainty',()=>{
  const a=distribution(model,lineup()),b={...a,mean:a.mean-12},wide={...a,sd:a.sd*2};
  const first=compareForecasts(a,b),reverse=compareForecasts(b,a),uncertain=compareForecasts(wide,b);
  assert.ok(Math.abs(first.probability.win-reverse.probability.loss)<1e-8);
  assert.ok(Math.abs(Object.values(first.probability).slice(0,3).reduce((x,y)=>x+y,0)-1)<1e-10);
  assert.ok(first.probability.win>uncertain.probability.win);
});
test('current-week forecasts use full-game history without leaking final or live points',()=>{
  const l=lineup();l.lineup[0].player={id:'q',locked:true,points:900,actualPoints:900};
  const history={q:Array.from({length:4},()=>({points:10}))},a=distribution(model,l,history);
  l.lineup[0].player.points=0;l.lineup[0].player.actualPoints=0;
  assert.deepEqual(distribution(model,l,history),a);assert.equal(a.mean,10);
  assert.equal(compareForecasts(a,a,{week:3,currentWeek:3}).fullGameEstimate,true);
  assert.equal(distribution(model,l,{}).available,false);
});
test('genuine empty slots are explicit, while unknown players and unsupported slots are not silently zeroed',()=>{
  const l={lineup:[{slot:'TE',player:null}],unfilled:[{slot:'TE'}],lineupNotes:[],unresolved:[]};
  const gap=distribution(model,l);assert.equal(gap.available,true);assert.deepEqual(gap.unfilledSlots,['TE']);assert.equal(gap.mean,0);
  assert.equal(distribution(model,{...l,unresolved:[{id:'unknown',reason:'missing_player'}]}).available,false);
  assert.equal(distribution(model,{...l,lineup:[{slot:'K',player:null}]}).available,false);
});
function fixture(medianGame=false){
  const teams=['1','2','3','4'].map(id=>({id,record:{wins:0,losses:0,ties:0},pointsFor:0,pointsAgainst:0}));
  const schedule=[{week:1,pairs:[['1','2'],['3','4']],issues:[]},{week:2,pairs:[['1','3'],['2','4']],issues:[]}];
  const forecasts=new Map(schedule.flatMap(w=>teams.map((t,i)=>[w.week+':'+t.id,{available:true,mean:100-i*10,sd:15}])));
  return {teams,schedule,forecasts,medianGame,seed:'test',iterations:3000,expectedCompletedGames:0,expectedWeeks:[1,2]};
}
test('league simulation conserves results, stays deterministic and is independent of API order',()=>{
  const args=fixture(),result=simulateSeason(args);assert.equal(result.available,true);assert.deepEqual(simulateSeason(args),result);
  assert.deepEqual(simulateSeason({...args,teams:[...args.teams].reverse(),schedule:[...args.schedule].reverse().map(w=>({...w,pairs:w.pairs.map(p=>[...p].reverse()).reverse()}))}),result);
  let wins=0,losses=0;for(const t of result.teams){const e=t.expected;assert.ok(Math.abs(e.wins+e.losses+e.ties-2)<.0002);wins+=e.wins;losses+=e.losses;assert.ok(t.winRange.low>=0&&t.winRange.high<=2);assert.ok(t.rankRange.low>=1&&t.rankRange.high<=4);}
  assert.ok(Math.abs(wins-losses)<.001);assert.equal(result.teams[0].id,'1');
  const p=compareForecasts(args.forecasts.get('1:1'),args.forecasts.get('1:2')).probability.win+compareForecasts(args.forecasts.get('2:1'),args.forecasts.get('2:3')).probability.win;
  assert.ok(Math.abs(result.teams.find(t=>t.id==='1').expected.wins-p)<.06);
});
test('median games use the same weekly scores, count ties, and do not double-count points for',()=>{
  const rows=['1','2','3','4'].map(id=>({id,wins:0,losses:0,ties:0,pf:0,pa:0}));
  applyWeek(rows,{'1':100,'2':90,'3':90,'4':80},[['1','2'],['3','4']],true);
  assert.deepEqual(rows.map(r=>[r.wins,r.losses,r.ties,r.pf,r.pa]),[[2,0,0,100,90],[0,1,1,90,100],[1,0,1,90,80],[0,2,0,80,90]]);
  for(const t of simulateSeason(fixture(true)).teams)assert.ok(Math.abs(t.expected.wins+t.expected.losses+t.expected.ties-4)<.0002);
});
test('standings sort by record then PF then higher PA and preserve existing records',()=>{
  const a={wins:4,losses:3,ties:0,pf:100,pa:100,lottery:.2},b={...a,pf:101};assert.ok(compareStanding(a,b)>0);
  assert.ok(compareStanding(a,{...a,pa:101})>0);assert.ok(compareStanding(a,{...a,wins:3,ties:2,pf:101})>0);
  const f=fixture();f.expectedCompletedGames=2;
  f.teams.forEach((t,i)=>{t.record={wins:i<2?2:0,losses:i<2?0:2,ties:0};});
  const s=simulateSeason(f);assert.equal(s.available,true);for(const t of s.teams)assert.ok(Math.abs(t.expected.wins+t.expected.losses+t.expected.ties-4)<.0002);
});
test('partial schedules, unknown forecasts, changed standings and duplicate matchups cannot yield final records',()=>{
  const f=fixture();
  assert.equal(simulateSeason({...f,schedule:f.schedule.slice(1)}).available,false);
  assert.equal(simulateSeason({...f,schedule:[f.schedule[0],f.schedule[0]]}).available,false);
  assert.equal(simulateSeason({...f,forecasts:new Map()}).available,false);
  assert.equal(simulateSeason({...f,expectedCompletedGames:1}).available,false);
  const bad=structuredClone(f);bad.schedule[0].pairs[1]=['1','4'];assert.equal(simulateSeason(bad).available,false);
  f.teams[0].pointsAgainst=null;assert.equal(simulateSeason(f).available,false);
});

