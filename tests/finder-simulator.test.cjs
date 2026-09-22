'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {resolveAccess}=require('../lib/subscription-access.cjs');
const {findPartners,finderAction}=require('../lib/trade-finder.cjs');
const {simulate,dataset,parseCSV}=require('../lib/devy-simulator.cjs');
const id='11111111-1111-4111-8111-111111111111';
const premium=resolveAccess(id,null,[{user_id:id,plan:'premium',starts_at:'2026-01-01',expires_at:null,revoked_at:null}]),free=resolveAccess(null);
const format={ppr:'hppr',superflex:true,tePremium:false};
function asset(id,pos,value){value*=50;return {id,name:id,position:pos,scores:Object.fromEntries(['overall','competing','tanking'].map(type=>[type,{value,position:pos,ranked:true}]))};}
const league={id:'123456789',name:'Fixture',roster_positions:['RB','WR'],teams:[{roster_id:'1',name:'Me',assets:[asset('my-r1','RB',100),asset('my-r2','RB',100),asset('my-r3','RB',100),asset('my-w','WR',20)]},{roster_id:'2',name:'Match',assets:[asset('their-w1','WR',100),asset('their-w2','WR',100),asset('their-w3','WR',100),asset('their-r','RB',20)]},{roster_id:'3',name:'Average',assets:[asset('avg-r','RB',150),asset('avg-w','WR',150)]}]};
test('free finder explains complementary depth without leaking premium players or proposals',()=>{
  const result=findPartners(league,{roster_id:'1',format},free);
  assert.deepEqual(result.team.needs,['WR']);assert.deepEqual(result.team.surplus,['RB']);
  assert.equal(result.matches.length,1);assert.equal(result.matches[0].mutual,true);
  assert.equal('targets' in result.matches[0],false);assert.equal('proposals' in result.matches[0],false);
  assert.equal(JSON.stringify(result).includes('their-w1'),false);
});
test('premium proposals use owned assets and Overall value; exclusions cannot appear',()=>{
  const result=findPartners(league,{roster_id:'1',format,mode:'tanking',excluded:['their-w1','my-r1']},premium);
  assert.ok(result.matches[0].proposals.length>0);
  assert.ok(!JSON.stringify(result.matches).includes('their-w1'));assert.ok(!JSON.stringify(result.matches).includes('my-r1'));
  assert.ok(result.matches[0].proposals.every(p=>p.marketNet===0));
  assert.throws(()=>findPartners(league,{roster_id:'1',format,excluded:['their-w1']},free),{status:403});
  assert.throws(()=>findPartners(league,{roster_id:'bad',format},premium),{status:400});
  assert.throws(()=>findPartners(league,{roster_id:'1',format,excluded:['unknown']},premium),{status:400});
});
test('free roster endpoint is denied before loading league; neutral leagues have no false matches',async()=>{
  let called=false;await assert.rejects(()=>finderAction('finder-rosters',{},free,{loadLeague:()=>{called=true;}}),{status:403});assert.equal(called,false);
  const equal={...league,teams:league.teams.map(t=>({...t,assets:[asset(t.roster_id+'r','RB',100),asset(t.roster_id+'w','WR',100)]}))};
  assert.equal(findPartners(equal,{roster_id:'1',format},free).matches.length,0);
});
test('simulator free board is two rounds and forged higher-round submissions are refused',()=>{
  const data=dataset();assert.equal(Math.max(...simulate('devy-config',{},free,data).picks.map(p=>Number(p.Round||p.ROUND))),2);
  assert.equal(Math.max(...simulate('devy-config',{},premium,data).picks.map(p=>Number(p.Round||p.ROUND))),7);
  const third=data.picks.find(p=>Number(p.Round||p.ROUND)===3),player=data.players[0];
  const body={assignments:[{pick:third.id,player:player.id,score:999999}],superflex:true,includeDevy:true,premium:true,rounds:7};
  assert.throws(()=>simulate('devy-evaluate',body,free,data),{status:403});
  assert.equal(simulate('devy-evaluate',body,premium,data).results.length,1);
  assert.notEqual(simulate('devy-evaluate',body,premium,data).results[0].score,999999);
});
test('simulator preserves old formula and rejects duplicate, unknown and invalid selections',()=>{
  const data={picks:[{id:'0',Round:'1',Pick:'1',Team:'TEST'},{id:'1',Round:'2',Pick:'1',Team:'TEST'}],players:[{id:'p',Name:'QB Sample',Position:'QB'}],opportunity:[{TEAM:'TEST',QUARTERBACK:'2'}],rankings:[{'PLAYER NAME':'QB Sample',SCORE:'4'}]};
  const body={assignments:[{pick:'0',player:'p'}],superflex:true,includeDevy:true};
  assert.equal(simulate('devy-evaluate',body,free,data).results[0].score,(5000*.645+600)*.9+1200);
  assert.equal(simulate('devy-evaluate',{...body,superflex:false,includeDevy:false},free,data).results[0].score,(5000*.645+600)*.7);
  for(const assignments of [[{pick:'0',player:'bad'}],[{pick:'bad',player:'p'}],[...body.assignments,{pick:'1',player:'p'}]])assert.throws(()=>simulate('devy-evaluate',{...body,assignments},free,data),{status:400});
  assert.deepEqual(parseCSV('Name,Note\n"A, B","say ""hi"""'),[{Name:'A, B',Note:'say "hi"'}]);
});
test('new endpoints remain disabled before rollout and ignore forged guest access',async()=>{
  const {createHandler}=require('../lib/account-server.cjs');
  async function call(body,enabled){let result;const res={setHeader(){},end(raw){result={status:this.statusCode,body:JSON.parse(raw)};}};await createHandler(()=>({auth:{}}),{SUBSCRIPTION_ACCESS_ENABLED:enabled?'true':'false'})({method:'POST',headers:{origin:'http://127.0.0.1:8770','content-type':'application/json'},body},res);return result;}
  assert.equal((await call({action:'finder-league'},false)).status,503);
  assert.equal((await call({action:'devy-config'},false)).status,503);
  assert.equal((await call({action:'finder-rosters',premium:true},true)).status,403);
  assert.equal((await call({action:'devy-config',premium:true,rounds:7},true)).body.rounds,2);
});
