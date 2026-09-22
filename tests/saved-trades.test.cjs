'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pinnedAction,valuePinned,fingerprint}=require('../lib/saved-trades.cjs');
const {preferencesFor}=require('../lib/trade-finder.cjs');
const premium={premium:true,features:{tradeFinderTargets:true,tradeLeagueImport:true,tradeTeams:12}};
const user={id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:'2026-01-01'};
const rowId='22222222-2222-4222-8222-222222222222';
const asset=(id,position,value)=>({id,name:id,label:id,position,scores:Object.fromEntries(['overall','competing','tanking'].map(m=>[m,{value,position,ranked:true}]))});
const fixture=()=>({id:'1318402338695708672',name:'L',roster_positions:['QB'],teams:[{roster_id:'1',name:'Mine',assets:[asset('pick:2027:1:2','PICK',3000)]},{roster_id:'2',name:'Other',assets:[asset('player:20','WR',3000)]}]});
const body={league_id:'1318402338695708672',roster_id:'1',partner_id:'2',format:{ppr:'hppr',superflex:true,tePremium:false},send:['pick:2027:1:2'],receive:['player:20']};
function database(data,error=null){
  const calls=[],result={data,error};const q={then:(resolve,reject)=>Promise.resolve(result).then(resolve,reject)};
  for(const name of ['select','eq','order','insert','delete','single'])q[name]=(...args)=>{calls.push([name,...args]);return q;};
  return {calls,from:table=>{assert.equal(table,'saved_trades');return q;}};
}
function row(league){return {id:rowId,league_id:league.id,roster_id:'1',partner_id:'2',send:league.teams[0].assets.map(a=>({id:a.id,name:a.name,position:a.position})),receive:league.teams[1].assets.map(a=>({id:a.id,name:a.name,position:a.position}))};}
test('saved pins use verified owner and current asset labels, never supplied identities or scores',async()=>{
  const league=fixture(),db=database(row(league));
  const result=await pinnedAction('finder-pin',{...body,user_id:'victim',myNet:999999},user,db,premium,{book:{},loadLeague:async()=>league});
  const inserted=db.calls.find(c=>c[0]==='insert')[1];assert.equal(inserted.user_id,user.id);assert.equal(inserted.send[0].id,'pick:2027:1:2');
  assert.equal(result.pin.myNet,0);assert.equal(inserted.myNet,undefined);
  assert.equal(fingerprint({...body,send:['a','b']}),fingerprint({...body,send:['b','a']}));
});
test('pins return only for this account, league and selected team; unpin is owner scoped',async()=>{
  const league=fixture(),db=database([row(league)]);
  const r=await pinnedAction('finder-pins',body,user,db,premium,{book:{},loadLeague:async()=>league});
  assert.equal(r.pins.length,1);
  for(const [key,value]of [['user_id',user.id],['league_id',league.id],['roster_id','1']])assert.ok(db.calls.some(c=>c[0]==='eq'&&c[1]===key&&c[2]===value));
  const del=database(null);await pinnedAction('finder-unpin',{id:rowId,user_id:'victim'},user,del,premium);
  assert.ok(del.calls.some(c=>c[0]==='eq'&&c[1]==='user_id'&&c[2]===user.id));
});
test('pins keep assets while scores change; stale ownership and invalidated fairness are clearly flagged',()=>{
  const league=fixture(),saved=row(league);
  const weighted={...body,preferences:[{roster_id:'1',mode:'overall',pickWeight:'low'},{roster_id:'2',mode:'overall',pickWeight:'high'}]};
  let value=valuePinned(league,saved,weighted,premium,preferencesFor(league,weighted,premium));
  assert.equal(value.myNet,600);assert.equal(value.theirNet,600);assert.equal(value.gap,0);
  league.teams[1].assets[0].scores.overall.value=6000;
  value=valuePinned(league,saved,weighted,premium,preferencesFor(league,weighted,premium));
  assert.equal(value.eligible,false);assert.match(value.notice,/Outside/);assert.equal(value.receive[0].id,'player:20');
  league.teams[1].assets=[];
  value=valuePinned(league,saved,weighted,premium,preferencesFor(league,weighted,premium));
  assert.equal(value.unavailable,true);assert.match(value.notice,/Roster changed/);assert.equal('myNet' in value,false);
});
test('missing login, revoked premium, forged ownership, duplicate assets and too-small anchors cannot create pins',async()=>{
  let writes=0;const db={from(){writes++;throw new Error('Unexpected database write');}},league=fixture(),deps={book:{},loadLeague:async()=>league};
  await assert.rejects(()=>pinnedAction('finder-pin',body,null,db,premium,deps),{status:401});
  await assert.rejects(()=>pinnedAction('finder-pin',body,user,db,{premium:false},deps),{status:403});
  for(const altered of [{send:['player:20']},{send:['pick:2027:1:2','pick:2027:1:2']},{partner_id:'1'}])await assert.rejects(()=>pinnedAction('finder-pin',{...body,...altered},user,db,premium,deps),{status:400});
  league.teams[0].assets[0].scores.overall.value=2999;
  await assert.rejects(()=>pinnedAction('finder-pin',body,user,db,premium,deps),{status:400});
  assert.equal(writes,0);
});
test('pin API rejects anonymous requests and disabled rollout before database access',async()=>{
  const {createHandler}=require('../lib/account-server.cjs');
  for(const enabled of [true,false])for(const action of ['finder-pin','finder-pins','finder-unpin']){
    let response;const res={setHeader(){},end(raw){response={status:this.statusCode,body:JSON.parse(raw)};}};
    await createHandler(()=>({auth:{}}),{SUBSCRIPTION_ACCESS_ENABLED:String(enabled)})({method:'POST',headers:{origin:'http://localhost:8770','content-type':'application/json'},body:{action}},res);
    assert.equal(response.status,enabled?401:503);
  }
});
test('storage failures never expose database details or pretend a pin was saved',async()=>{
  const league=fixture(),deps={book:{},loadLeague:async()=>league};
  await assert.rejects(()=>pinnedAction('finder-pin',body,user,database(null,{code:'P0001',message:'private'}),premium,deps),e=>e.status===409&&!e.message.includes('private'));
  await assert.rejects(()=>pinnedAction('finder-pins',body,user,database(null,{message:'private SQL'}),premium,deps),e=>e.status===503&&!e.message.includes('private'));
});
