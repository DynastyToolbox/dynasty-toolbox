'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {proposalsFor,findPartners,finderAction}=require('../lib/trade-finder.cjs');
const {evaluate}=require('../lib/trade-calculator.cjs');
const format={ppr:'hppr',superflex:true,tePremium:false},neutral={mode:'overall',pickWeight:'neutral'};
const premium={premium:true,features:{tradeFinderTargets:true,tradeLeagueImport:true,tradeTeams:12}};
const asset=(id,position,value,competing=value,tanking=value)=>({id,name:id,label:id,position,scores:Object.fromEntries(Object.entries({overall:value,competing,tanking}).map(([type,value])=>[type,{value,position,ranked:true}]))});
const team=(id,assets)=>({roster_id:id,name:id,assets});
function ideas(send,receive,mine=neutral,theirs=neutral,blocked=new Set(),scoring=format){
  return proposalsFor(team('1',send),team('2',receive),{needs:['WR']},{needs:['RB']},mine,theirs,scoring,blocked).proposals;
}
test('independent modes and pick weights create different gains while market balance stays unweighted',()=>{
  const pick=asset('pick:2027:1:1','PICK',3000,1000,5000),player=asset('player:a','WR',3000,4000,1800);
  const low={mode:'overall',pickWeight:'low'},high={mode:'overall',pickWeight:'high'};
  const p=ideas([pick],[player],low,high)[0];
  assert.equal(p.marketNet,0);assert.equal(p.gap,0);assert.equal(p.myNet,600);assert.equal(p.theirNet,600);
  const swapped=ideas([player],[pick],low,high)[0];assert.equal(swapped.myNet,-600);assert.equal(swapped.theirNet,-600);
  const mixed=ideas([pick],[player],{mode:'competing',pickWeight:'low'},{mode:'tanking',pickWeight:'high'})[0];
  assert.equal(mixed.myNet,3200);assert.equal(mixed.theirNet,4200);assert.equal(mixed.marketNet,0);
});
test('15% market tolerance and both teams’ 1000-point loss limits are enforced at their boundaries',()=>{
  assert.ok(ideas([asset('a','RB',1000)],[asset('b','WR',850)]).length);
  assert.equal(ideas([asset('a','RB',1000)],[asset('b','WR',849)]).length,0);
  const a=asset('a','RB',3000,4000),b=asset('b','WR',3000,3000);
  assert.equal(ideas([a],[b],{mode:'competing',pickWeight:'neutral'})[0].myNet,-1000);
  a.scores.competing.value=4001;
  assert.equal(ideas([a],[b],{mode:'competing',pickWeight:'neutral'}).length,0);
  a.scores.competing.value=1000;
  assert.equal(ideas([a],[b],neutral,{mode:'competing',pickWeight:'neutral'}).length,0,'other team is checked too');
});
test('2-for-1 and 3-for-1 packages include picks and preserve current owner / origin identities',()=>{
  const send=[asset('player:main','RB',4000),asset('pick:2027:2:4','PICK',500),asset('pick:2027:2:9','PICK',500)];
  const proposals=ideas(send,[asset('player:target','WR',5000)]);
  const p=proposals.find(p=>p.send.length===3);assert.ok(p);
  assert.deepEqual(p.send.map(a=>a.id).sort(),send.map(a=>a.id).sort());assert.equal(p.theirNet,-750);
  assert.ok(ideas([asset('player:r','RB',3500),asset('pick:2027:1:1','PICK',1000)],[asset('player:w','WR',4500)]).some(p=>p.send.length===2));
  assert.ok(ideas([asset('player:r','RB',4500)],[asset('player:w','WR',3500),asset('pick:2027:1:1','PICK',1000)]).some(p=>p.receive.length===2));
  assert.ok(ideas([asset('player:r','RB',5000)],send.map(a=>({...a,position:a.position==='RB'?'WR':a.position}))).some(p=>p.receive.length===3));
});
test('2-for-2 swaps work, and piles of picks / low-value assets are rejected',()=>{
  const p=ideas([asset('a','RB',3000),asset('pick:a','PICK',1000)],[asset('b','WR',3300),asset('pick:b','PICK',700)]);
  assert.ok(p.some(p=>p.send.length===2&&p.receive.length===2));
  assert.equal(ideas([1,2,3].map(n=>asset('pick:'+n,'PICK',2000)),[asset('b','WR',6000)]).length,0);
  assert.equal(ideas([1,2,3].map(n=>asset('a'+n,'RB',1800)),[asset('b','WR',5000)]).length,0);
  assert.equal(ideas([1,2,3,4,5].map(n=>asset('a'+n,'RB',1000)),[asset('b','WR',5000)]).length,0);
  assert.equal(ideas([asset('pick:a','PICK',3000)],[asset('pick:b','PICK',3000)]).length,0);
});
test('untouchable picks and unranked assets never enter proposals; PPR affects the market check',()=>{
  const a=asset('pick:a','PICK',3000),b=asset('b','WR',3000);
  assert.equal(ideas([a],[b],neutral,neutral,new Set(['pick:a'])).length,0);
  b.scores.tanking.ranked=false;
  assert.equal(ideas([a],[b],neutral,{mode:'tanking',pickWeight:'neutral'}).length,0);
  assert.equal(ideas([a],[b],neutral,neutral,new Set(),{...format,ppr:'ppr'})[0].marketNet,150);
});
test('calculator handoff totals agree for every package, including asymmetric preferences and Stud Bonus',()=>{
  const mine=team('1',[asset('a','RB',4000),asset('pick:2027:2:4','PICK',500),asset('pick:2027:2:9','PICK',500)]);
  const other=team('2',[asset('b','WR',5000)]);
  const myPref={mode:'tanking',pickWeight:'low'},theirPref={mode:'competing',pickWeight:'high'};
  const proposals=ideas(mine.assets,other.assets,myPref,theirPref);assert.ok(proposals.length);
  for(const p of proposals){
    const input={format,teams:[{id:1,status:myPref.mode,pickWeight:myPref.pickWeight,roster_id:'1'},{id:2,status:theirPref.mode,pickWeight:theirPref.pickWeight,roster_id:'2'}],transfers:[...p.send.map(a=>({from:1,to:2,asset:a.id})),...p.receive.map(a=>({from:2,to:1,asset:a.id}))]};
    const result=evaluate(input,premium,{}, {teams:[mine,other]});
    assert.equal(result.teams[0].total,p.myNet);assert.equal(result.teams[1].total,p.theirNet);
    assert.equal(result.teams[0].market.net,p.marketNet);
    const neutralResult=evaluate({...input,teams:input.teams.map(t=>({...t,pickWeight:'neutral'}))},premium,{}, {teams:[mine,other]});
    assert.deepEqual(result.teams.map(t=>t.ranks),neutralResult.teams.map(t=>t.ranks),'preferences do not change league ranking methodology');
  }
});
test('preference input is validated and premium-gated; neutral rosters can match through player-for-pick value',async()=>{
  const league={id:'123456789',name:'L',teams:[team('1',[asset('pick:a','PICK',3000)]),team('2',[asset('b','WR',3000)])]};
  const body={roster_id:'1',format,preferences:[{roster_id:'1',mode:'overall',pickWeight:'low'},{roster_id:'2',mode:'overall',pickWeight:'high'}]};
  const result=findPartners(league,body,premium);assert.equal(result.matches[0].proposals[0].myNet,600);
  for(const preferences of [[{roster_id:'3',mode:'overall',pickWeight:'low'}],[{roster_id:'1',mode:'bad',pickWeight:'low'}],[{roster_id:'1',mode:'overall',pickWeight:100}],[body.preferences[0],body.preferences[0]]]){
    assert.throws(()=>findPartners(league,{...body,preferences},premium),{status:400});
  }
  assert.throws(()=>findPartners(league,body,{premium:false,features:{}}),{status:403});
  const roster=await finderAction('finder-rosters',{},premium,{book:{},loadLeague:async()=>league});
  assert.equal(roster.teams[0].players[0].id,'pick:a');assert.equal(roster.teams[0].players[0].scores.overall.value,3000);
  const bad={format,teams:[{id:1,status:'overall',roster_id:'1',pickWeight:'bad'},{id:2,status:'overall',roster_id:'2'}],transfers:[]};
  assert.throws(()=>evaluate(bad,premium,{},league),{status:400});
});
