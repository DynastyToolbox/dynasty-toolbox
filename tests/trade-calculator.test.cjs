'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {catalog,buildLeague,evaluate,bonus,tradeAction}=require('../lib/trade-calculator.cjs');
const {resolveAccess}=require('../lib/subscription-access.cjs');
const userId='11111111-1111-4111-8111-111111111111';
const premium=resolveAccess(userId,null,[{user_id:userId,plan:'premium',starts_at:'2026-01-01',expires_at:null,revoked_at:null}]);
const free=resolveAccess(null),format={ppr:'hppr',superflex:true,tePremium:false};
const rows=[['QB One','QB',100],['WR Two','WR',80],["TE O'Neil",'TE',50],['2027 1st Round','PICK',30]].map(([Player,Position,n])=>({Player,Position,Score:String(n)}));
const book=catalog({overall:rows,competing:rows,tanking:rows.map(r=>({...r,Score:String(Number(r.Score)*.5)}))});
function fixture(){return buildLeague({id:'1318402338695708672',meta:{name:'Test',season:'2026',status:'in_season',settings:{type:2,draft_rounds:1}},rosters:[{roster_id:1,owner_id:'a',players:['q']},{roster_id:2,owner_id:'b',players:['w']},{roster_id:3,owner_id:'c',players:['t']}],users:[{user_id:'a',display_name:'Original'},{user_id:'b',display_name:'Second'},{user_id:'c',display_name:'Third'}],drafts:[{season:'2026',status:'complete'}],traded:[{season:'2027',round:1,roster_id:1,owner_id:2}]},{q:{full_name:'QB One',position:'QB'},w:{full_name:'WR Two',position:'WR'},t:{full_name:"TE O'Neil",position:'TE'}},book);}
const body=()=>({format,teams:[{id:1,status:'overall',roster_id:'1'},{id:2,status:'competing',roster_id:'2'},{id:3,status:'tanking',roster_id:'3'}],transfers:[]});
test('free server operations refuse league imports and more than two teams before fetching',async()=>{
  let fetched=false;const deps={book,loadLeague:()=>{fetched=true;}};
  await assert.rejects(()=>tradeAction('trade-league',{league_id:'1318402338695708672'},free,deps),{status:403});
  await assert.rejects(()=>tradeAction('trade-evaluate',body(),free,deps),{status:403});assert.equal(fetched,false);
  const revoked=resolveAccess(userId,null,[{user_id:userId,plan:'premium',starts_at:'2026-01-01',expires_at:null,revoked_at:'2026-01-02'}]);
  await assert.rejects(()=>tradeAction('trade-evaluate',{...body(),league_id:'1318402338695708672'},revoked,deps),{status:403});
});
test('manual totals retain asymmetric ranking types, scoring and stud bonus',()=>{
  const input={format,teams:[{id:1,status:'overall'},{id:2,status:'tanking'}],transfers:[{from:1,to:2,asset:'QB One'},{from:2,to:1,asset:'WR Two'},{from:2,to:1,asset:"TE O'Neil"}]};
  const result=evaluate(input,free,book);assert.equal(result.teams[0].sendsTotal,115);assert.equal(result.teams[0].receivesTotal,130);assert.equal(result.teams[1].receivesTotal,50);
  assert.equal(bonus([100],[80]),0);assert.equal(bonus([100],[]),0);
  const scored=evaluate({...input,format:{ppr:'ppr',superflex:false,tePremium:true}},free,book);
  assert.equal(scored.teams[0].sendsTotal,65);assert.equal(scored.teams[0].receivesTotal,139.125);
});
test('traded pick keeps its origin and identical-round picks are distinct',()=>{
  const league=fixture(),owner=league.teams[1];
  assert.equal(owner.assets.filter(a=>a.id.startsWith('pick:2027:1')).length,2);
  assert.match(owner.assets.find(a=>a.id==='pick:2027:1:1').label,/Originally Original/);
  const input=body();input.transfers=[{from:2,to:1,asset:'pick:2027:1:1'},{from:2,to:3,asset:'pick:2027:1:2'}];
  const result=evaluate(input,premium,book,league);assert.equal(result.teams[1].sends.length,2);assert.equal(result.teams[0].receives.length,1);assert.equal(result.teams[2].receives.length,1);
  assert.equal(league.teams[1].assets.filter(a=>a.id.startsWith('pick:2027:1')).length,2,'does not mutate original rosters');
});
test('three-way trades rank every roster after all transfers, without stud bonus in rank scores',()=>{
  const league=fixture(),input=body(),before=evaluate(input,premium,book,league);
  input.transfers=[{from:1,to:2,asset:'player:q'},{from:2,to:3,asset:'player:w'},{from:3,to:1,asset:'player:t'}];
  const result=evaluate(input,premium,book,league);
  assert.equal(before.teams[0].ranks.before.competing.rank,1);
  assert.equal(result.teams[0].ranks.after.competing.score,50/3);
  assert.equal(result.teams[1].ranks.after.competing.score,160/5);
  assert.equal(result.teams[2].ranks.after.competing.rank,2);
  assert.equal(result.teams[0].ranks.after.tanking.score,25/3);
});
test('server rejects spoofed ownership, duplicate players/picks, duplicate rosters and missing destinations',()=>{
  const league=fixture();
  for(const transfers of [[{from:1,to:2,asset:'player:w'}],[{from:2,to:1,asset:'pick:2027:1:1'},{from:2,to:3,asset:'pick:2027:1:1'}],[{from:1,to:1,asset:'player:q'}],[{from:1,to:44,asset:'player:q'}]])assert.throws(()=>evaluate({...body(),transfers},premium,book,league),{status:400});
  const duplicate=body();duplicate.teams[1].roster_id='1';assert.throws(()=>evaluate(duplicate,premium,book,league),{status:400});
  const missing=body();missing.teams[1].roster_id='';missing.transfers=[{from:1,to:2,asset:'player:q'}];assert.throws(()=>evaluate(missing,premium,book,league),{status:400});
});
test('top 15 average excludes bench overflow, includes unranked zeros and uses stable roster-ID ties',()=>{
  const asset=n=>({id:'a'+n,scores:{overall:{value:n,position:'RB'},competing:{value:n,position:'RB'},tanking:{value:n,position:'RB'}}});
  const league={teams:[{roster_id:'2',assets:Array.from({length:20},(_,i)=>asset(i+1))},{roster_id:'1',assets:Array.from({length:20},(_,i)=>asset(i+1))}]};
  const result=evaluate({format,teams:[{id:1,status:'overall',roster_id:'1'},{id:2,status:'overall',roster_id:'2'}],transfers:[]},premium,book,league);
  assert.equal(result.teams[0].ranks.before.competing.score,13);assert.equal(result.teams[0].ranks.before.competing.rank,1);
});
test('unranked imported assets stay visible and contribute zero, not a fabricated value',()=>{
  const league=fixture();league.teams[0].assets.push({id:'player:unknown',label:'Unknown',scores:Object.fromEntries(['overall','competing','tanking'].map(t=>[t,{value:0,position:'RB',ranked:false}]))});
  const result=evaluate({...body(),transfers:[{from:1,to:2,asset:'player:unknown'}]},premium,book,league);
  assert.equal(result.teams[0].sends[0].score,0);assert.equal(result.teams[0].sends[0].ranked,false);
});
