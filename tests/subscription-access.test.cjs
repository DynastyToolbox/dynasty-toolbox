'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolveAccess,readAccess,requireFeature} = require('../lib/subscription-access.cjs');
const id='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const now=Date.parse('2026-09-11T12:00:00Z');
const paid={user_id:id,plan:'premium',status:'active',paid_through:'2026-10-11T12:00:00Z'};
const comp={user_id:id,plan:'premium',starts_at:'2026-09-01T00:00:00Z',expires_at:null,revoked_at:null};
test('free and unauthenticated users cannot use premium features',()=>{
  const free=resolveAccess(id,null,[],now);
  assert.equal(free.features.tradeTeams,2); assert.equal(free.features.tradeLeagueImport,false);
  assert.equal(free.features.devyRounds,2); assert.equal(free.premium,false);
  assert.throws(()=>requireFeature(free,'medianRankings'),{status:403});
  assert.equal(resolveAccess(null,paid,[comp],now).premium,false);
});
test('paid access lasts through the paid period including scheduled cancellation',()=>{
  const access=resolveAccess(id,{...paid,cancel_at_period_end:true},[],now);
  assert.equal(access.features.tradeTeams,12); assert.equal(access.features.devyRounds,7);
  assert.deepEqual(access.sources,['subscription']); requireFeature(access,'tradeLeagueImport');
  assert.equal(resolveAccess(id,paid,[],Date.parse(paid.paid_through)).premium,false);
});
test('expired, unknown, unpaid, incomplete, canceled and trial states do not grant paid access',()=>{
  for(const status of ['unpaid','incomplete','incomplete_expired','canceled','trialing','paused','unknown'])
    assert.equal(resolveAccess(id,{...paid,status},[],now).premium,false,status);
  assert.equal(resolveAccess(id,{...paid,status:'past_due'},[],now).premium,true);
  assert.equal(resolveAccess(id,{...paid,status:'past_due',paid_through:'2026-09-10T00:00:00Z'},[],now).premium,false);
  for(const paid_through of [null,'bad','',undefined]) assert.equal(resolveAccess(id,{...paid,paid_through},[],now).premium,false);
});
test('complimentary access is independent of billing, can expire or be revoked',()=>{
  assert.deepEqual(resolveAccess(id,null,[comp],now).sources,['complimentary']);
  assert.equal(resolveAccess(id,null,[comp],now).expiresAt,null);
  for(const change of [{expires_at:'2026-09-10T00:00:00Z'},{revoked_at:'2026-09-10T00:00:00Z'},{starts_at:'2026-10-01T00:00:00Z'},{expires_at:'bad'},{revoked_at:undefined}])
    assert.equal(resolveAccess(id,null,[{...comp,...change}],now).premium,false);
  assert.equal(resolveAccess(id,{...paid,status:'canceled'},[comp],now).premium,true);
  assert.equal(resolveAccess(id,paid,[{...comp,revoked_at:'2026-09-10T00:00:00Z'}],now).premium,true);
});
test('cross-account records and unknown plans or feature names never grant access',()=>{
  assert.equal(resolveAccess(other,paid,[comp],now).premium,false);
  assert.equal(resolveAccess(id,{...paid,plan:'owner'},[{...comp,plan:'admin'}],now).premium,false);
  assert.throws(()=>requireFeature(resolveAccess(id,paid,[],now),'administrator'),{status:403});
  assert.throws(()=>requireFeature(resolveAccess(id,paid,[],now),'toString'),{status:403});
});
test('access is read using verified identity and queries only that user',async()=>{
  const queries=[];
  const db={from(table){return {select(fields){queries.push({table,fields});return {eq(column,value){queries.at(-1).owner=value;assert.equal(column,'user_id'); const result={data:table==='membership_subscriptions'?paid:[comp],error:null};return {...result,maybeSingle:async()=>result};}};}};}};
  const access=await readAccess({id,email_confirmed_at:'2026-09-01',user_metadata:{role:'admin'}},db,now);
  assert.equal(access.premium,true); assert.ok(queries.every(q=>q.owner===id));
  assert.ok(queries.every(q=>!q.fields.includes('stripe_subscription_id')&&!q.fields.includes('reason')));
  assert.equal((await readAccess({id},null,now)).premium,false);
  await assert.rejects(()=>readAccess({id,email_confirmed_at:'yes'},{from(){return {select(){return {eq(){return {error:new Error('private provider detail'),maybeSingle:async()=>({error:new Error('private provider detail')})};}};}};}},now),/Access service unavailable/);
});

test('account access endpoint is disabled until configured and requires verified authentication',async()=>{
  const {createHandler}=require('../lib/account-server.cjs');
  async function run(enabled,authenticated,body={action:'access'},providerError=false) {
    let reads=0;
    const handler=createHandler(()=>({
      auth:{getUser:async()=>({data:{user:authenticated?{id,email_confirmed_at:'2026-09-01'}:null},error:null})},
      from(table){reads++;return {select(){return {eq(column,value){assert.equal(value,id);const result={data:table==='membership_subscriptions'?null:[],error:providerError?new Error('private detail'):null};return {...result,maybeSingle:async()=>result};}};}};},
    }),{SUBSCRIPTION_ACCESS_ENABLED:enabled?'true':'false'});
    const result={};
    const res={setHeader(){},end(raw){result.status=this.statusCode;result.body=JSON.parse(raw);}};
    await handler({method:'POST',headers:{origin:'http://127.0.0.1:8770','content-type':'application/json',cookie:'dt-dev-access=test'},body},res);
    return {...result,reads};
  }
  assert.equal((await run(false,true)).status,503);
  const guest=await run(true,false);assert.equal(guest.status,401);assert.equal(guest.reads,0);
  const forged=await run(true,true,{action:'access',user_id:other,premium:true,role:'admin',paid_through:'2099-01-01'});
  assert.equal(forged.status,200);assert.equal(forged.body.access.premium,false);assert.equal(forged.reads,2);
  const failure=await run(true,true,{action:'access'},true);
  assert.equal(failure.status,503);assert.ok(!JSON.stringify(failure.body).includes('private detail'));
});
