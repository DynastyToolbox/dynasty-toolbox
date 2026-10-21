'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {checkBillingRecords}=require('../lib/billing-check.cjs');
const {adminAction}=require('../lib/membership-admin.cjs');
const {createHandler}=require('../lib/account-server.cjs');
const userId='11111111-1111-4111-8111-111111111111',projectRef='abcdefghijklmnopqrst',accountId='acct_fixture';
const now=()=>Date.parse('2026-10-21T12:00:00Z');
const expected={id:'sub_fixture',status:'active',paid_through:'2026-11-21T12:00:00Z',cancel_at_period_end:false};
function fixture(changes={}){
 const state={binding:{user_id:userId,stripe_customer_id:'cus_fixture'},stored:{user_id:userId,plan:'premium',stripe_subscription_id:'sub_fixture',...expected},expected,
  environment:{project_ref:projectRef,stripe_account_id:accountId},reads:0,providerReads:0,...changes};
 const db={from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>{
  state.reads++;
  if(state.failTable===table)return {error:{message:'secret provider detail'}};
  const value=table==='billing_environment'?state.environment:table==='billing_accounts'?state.binding:state.stored;
  if(table==='membership_subscriptions' && state.changing && state.reads>3)return {data:{...value,updated_at:'new'}};
  return {data:structuredClone(value)};
 }})})})};
 const readStripe=async()=>{state.providerReads++;if(state.failStripe)throw new Error('secret provider detail');return structuredClone(state.expected);};
 return {state,run:()=>checkBillingRecords({userId,projectRef,accountId,db,readStripe,now})};
}
test('comparison is read-only, normalizes timestamps and omits customer identifiers',async()=>{
 const f=fixture();f.state.stored.paid_through='2026-11-21 12:00:00+00';
 const result=await f.run();assert.equal(result.state,'matched');assert.equal(f.state.providerReads,1);
 assert.deepEqual(result.differences,[]);
 assert.ok(!/cus_|sub_|11111111/.test(JSON.stringify(result)));
});
test('missed cancellation, payment coverage and subscription binding differences are flagged',async()=>{
 for(const [changes,issue] of [[{expected:null},'status'],[{stored:{...fixture().state.stored,paid_through:null}},'paidThrough'],
   [{stored:{...fixture().state.stored,stripe_subscription_id:'sub_other'}},'subscription'],
   [{stored:{...fixture().state.stored,cancel_at_period_end:true}},'cancellation']]){
  const result=await fixture(changes).run();assert.equal(result.state,'mismatch');assert.ok(result.differences.includes(issue));
 }
});
test('canceled and expired coverage are compared without false premium mismatches',async()=>{
 assert.equal((await fixture({expected:null,stored:{...fixture().state.stored,status:'canceled'}}).run()).state,'matched');
 const old={...expected,paid_through:'2026-10-20T12:00:00Z'};
 const result=await fixture({expected:old,stored:{...fixture().state.stored,paid_through:old.paid_through}}).run();
 assert.equal(result.state,'matched');assert.equal(result.website.paidThrough,null);
});
test('a missing customer never creates a Stripe customer or hides stale coverage',async()=>{
 const free=fixture({binding:null,stored:null});assert.equal((await free.run()).state,'matched');assert.equal(free.state.providerReads,0);
 const stale=fixture({binding:null});assert.equal((await stale.run()).state,'mismatch');assert.equal(stale.state.providerReads,0);
});
test('changing records are inconclusive; environment and provider failures cannot report a match',async()=>{
 assert.equal((await fixture({changing:true}).run()).state,'changed');
 for(const changes of [{environment:null},{environment:{project_ref:'other',stripe_account_id:accountId}},
  {environment:{project_ref:projectRef,stripe_account_id:'acct_other'}},{failTable:'membership_subscriptions'},{failStripe:true},
  {binding:{user_id:'other',stripe_customer_id:'cus_fixture'}}])await assert.rejects(()=>fixture(changes).run());
});
test('owner and MFA authorization happen before any privileged comparison',async()=>{
 for(const status of [{admin:false,mfa:true},{admin:true,mfa:false}]){
  let calls=0;const db={rpc:async()=>({data:status})};
  const result=await adminAction('admin-billing-check',{userId},db,{},()=>{}, {checkBilling:async()=>{calls++;}});
  assert.equal(result[0],403);assert.equal(calls,0);
 }
 const db={rpc:async()=>({data:{admin:true,mfa:true}})};let calls=0;
 const checkBilling=async id=>{calls++;assert.equal(id,userId);return {state:'matched'};};
 assert.equal((await adminAction('admin-billing-check',{action:'admin-billing-check',userId},db,{},()=>{},{checkBilling}))[0],200);
 for(const body of [{userId:'bad'},{userId,customer:'cus_other'},{userId,repair:true}])assert.equal((await adminAction('admin-billing-check',body,db,{},()=>{},{checkBilling}))[0],400);
 assert.equal(calls,1);
 const result=await adminAction('admin-billing-check',{userId},db,{},()=>{}, {checkBilling:async()=>{throw new Error('secret provider detail');}});
 assert.equal(result[0],503);assert.ok(!JSON.stringify(result).includes('secret provider detail'));
});
test('HTTP comparison rejects production, disabled administration, foreign origins and non-owners before runtime creation',async()=>{
 async function run({env={},headers={},admin=true,mfa=true,signedIn=true}={}){
  let runtimeCalls=0;
  const client={auth:{getUser:async()=>({data:{user:signedIn?{id:userId,email_confirmed_at:'2026-10-01'}:null}})},rpc:async()=>({data:{admin,mfa}})};
  const handler=createHandler(()=>client,{BILLING_MODE:'sandbox',MEMBERSHIP_ADMIN_ENABLED:'true',ACCOUNT_ALLOWED_ORIGINS:'http://localhost:8773',...env},
   {billingRuntime:()=>{runtimeCalls++;return {service:{checkRecords:async id=>{assert.equal(id,userId);return {state:'matched'};}}};}});
  const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
  await handler({method:'POST',headers:{origin:'http://localhost:8773','content-type':'application/json',cookie:'dt-dev-access=fixture',...headers},body:{action:'admin-billing-check',userId}},res);
  return {status:res.statusCode,runtimeCalls};
 }
 for(const options of [{env:{VERCEL_ENV:'production',ACCOUNT_PUBLIC_ENABLED:'true'}},{env:{MEMBERSHIP_ADMIN_ENABLED:'false'}},
   {env:{BILLING_MODE:'live'}},{headers:{origin:'https://evil.test'}},{admin:false},{mfa:false},{signedIn:false}]){
  const result=await run(options);assert.notEqual(result.status,200);assert.equal(result.runtimeCalls,0);
 }
 assert.deepEqual(await run(),{status:200,runtimeCalls:1});
});
