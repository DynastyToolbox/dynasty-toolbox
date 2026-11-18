'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {premiumRankingsAction}=require('../lib/premium-rankings.cjs');
const {createHandler}=require('../lib/account-server.cjs');
const {resolveAccess}=require('../lib/subscription-access.cjs');
const id='11111111-1111-4111-8111-111111111111';
const grant={user_id:id,plan:'premium',starts_at:'2026-01-01',expires_at:null,revoked_at:null};
const premium=resolveAccess(id,null,[grant]);
const weekly={meta:{season:'2026'},players:{one:{name:'Fixture',pos:'WR',weeks:{}}}};
const body={league_id:'1234567890123456789',ranking_type:'overall'};
const players={a:{full_name:'KC Concepcion Jr.',position:'WR',team:'TEST',age:22},b:{full_name:'Roster Player',position:'RB'},c:{full_name:'Taxi Player',position:'WR'},d:{full_name:'Reserve Player',position:'TE'},e:{full_name:'Starter Player',position:'QB'}};
const rows=Object.values(players).map((p,i)=>({Player:i===0?'KC Concepcion':p.full_name,Position:p.position,Score:String(100-i),Age:'21'}));
const deps={weekly:()=>weekly,rankings:()=>({overall:rows,competing:rows.map(r=>({...r,Score:'150'})),tanking:rows.map(r=>({...r,Score:'200'}))}),players:async()=>players,league:async()=>({id:body.league_id,meta:{name:'Fixture league'},rosters:[{players:['b'],taxi:['c'],reserve:['d'],starters:['e']}]})};
test('protected handlers refuse free, expired and revoked access before reading or loading data',async()=>{
  for(const access of [resolveAccess(null),resolveAccess(id,null,[]),resolveAccess(id,null,[{...grant,expires_at:'2026-01-02'}]),resolveAccess(id,null,[{...grant,revoked_at:'2026-01-02'}])]){
    let reads=0; const blocked=Object.fromEntries(Object.keys(deps).map(k=>[k,()=>{reads++;throw Error('must not read');}]));
    for(const action of ['median-data','available-players'])await assert.rejects(()=>premiumRankingsAction(action,{...body,premium:true},access,blocked),{status:403});
    assert.equal(reads,0);
  }
});
test('Best Available preserves suffix matching and all ranking modes, excluding every owned slot',async()=>{
  for(const [ranking_type,score] of [['overall',100],['competing',150],['tanking',200]]){
    const result=await premiumRankingsAction('available-players',{...body,ranking_type},premium,deps);
    assert.deepEqual(result.players.map(p=>p.id),['a']);assert.equal(result.players[0].score,score);
    assert.equal(result.players[0].name,'KC Concepcion');assert.equal(result.league.name,'Fixture league');
    assert.equal('rosters' in result,false);
  }
});
test('invalid league or ranking requests never reach Sleeper; upstream errors stay generic',async()=>{
  let calls=0; const failDeps={...deps,league:async()=>{calls++;throw Error('private upstream detail');}};
  for(const patch of [{league_id:'https://evil.example'},{league_id:'../../data'},{ranking_type:'__proto__'}])await assert.rejects(()=>premiumRankingsAction('available-players',{...body,...patch},premium,failDeps),{status:400});
  assert.equal(calls,0);
  await assert.rejects(()=>premiumRankingsAction('available-players',body,premium,failDeps),e=>e.status===502&&!e.message.includes('private'));
  assert.deepEqual(await premiumRankingsAction('median-data',{},premium,deps),{data:weekly});
});
test('HTTP endpoints use verified server identity, not forged entitlement fields; expiry and provider failures deny data',async()=>{
  let currentGrant=grant, signedIn=true, dbFailure=false, reads=0;
  const factory=()=>({auth:{getUser:async()=>({data:{user:signedIn?{id,email_confirmed_at:'yes'}:null}})},from(table){return {select(){return {eq(column,owner){assert.equal(owner,id);const result={data:table==='access_grants'?(currentGrant?[currentGrant]:[]):null,error:dbFailure?Error('internal detail'):null};return {...result,maybeSingle:async()=>result};}};}};}});
  const handler=createHandler(factory,{SUBSCRIPTION_ACCESS_ENABLED:'true'},{premiumRankings:{...deps,weekly:()=>{reads++;return weekly;}}});
  async function call(action){let result; const headers={};const res={setHeader(k,v){headers[k]=v;},end(raw){result={status:this.statusCode,body:JSON.parse(raw),headers};}};
    await handler({method:'POST',headers:{origin:'http://localhost:8770','content-type':'application/json',cookie:'dt-dev-access=test'},body:{action,...body,premium:true,user_id:'other',role:'admin',paid_through:'2099-01-01'}},res);return result;}
  let result=await call('median-data');assert.equal(result.status,200);assert.deepEqual(result.body.data,weekly);assert.match(result.headers['Cache-Control'],/private.*no-store/);
  currentGrant=null;
  for(const action of ['median-data','available-players'])assert.equal((await call(action)).status,403);
  currentGrant={...grant,expires_at:new Date(Date.now()-1000).toISOString()};assert.equal((await call('median-data')).status,403);
  currentGrant=grant;dbFailure=true;result=await call('median-data');assert.equal(result.status,503);assert.ok(!JSON.stringify(result.body).includes('internal'));
  dbFailure=false;signedIn=false;assert.equal((await call('median-data')).status,401);assert.equal(reads,1);
});
