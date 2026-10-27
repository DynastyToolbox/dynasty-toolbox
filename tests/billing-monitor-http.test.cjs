'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createMonitorHandler}=require('../lib/billing-monitor-http.cjs');
const token='a'.repeat(64),ref='abcdefghijklmnopqrst',id='00000000-0000-4000-8000-000000000001';
const base={BILLING_MODE:'sandbox',BILLING_MONITOR_ENABLED:'true',BILLING_MONITOR_TOKEN:token,VERCEL_ENV:'preview',VERCEL:'1',
 VERCEL_GIT_COMMIT_REF:'feat/subscription-access-foundation',VERCEL_BRANCH_URL:'fixture.vercel.app',
 MEMBERSHIP_DEV_PROJECT_REF:ref,SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',STRIPE_TEST_MONTHLY_PRICE_ID:'price_fixture'};
async function call({env={},headers={},input={cursor:null},body,method='POST',monitor=async()=>({record:null,next:null}),now=()=>1000000}={}){
 let calls=0;
 const handler=createMonitorHandler(()=>{calls++;return {service:{monitor}};},{...base,...env},{now});
 const req=Readable.from([body??JSON.stringify(input)]);req.method=method;req.headers={'content-type':'application/json',authorization:'Bearer '+token,...headers};
 const res={setHeader(){},end(text){this.body=JSON.parse(text);}};await handler(req,res);return {status:res.statusCode,body:res.body,calls};
}
test('disabled/production/other-branch/bad credentials/origin never construct privileged runtime',async()=>{
 for(const options of [{env:{BILLING_MONITOR_ENABLED:'false'}},{env:{VERCEL_ENV:'production'}},{env:{VERCEL_GIT_COMMIT_REF:'main'}},
  {env:{BILLING_MODE:'live'}},{env:{MEMBERSHIP_DEV_PROJECT_REF:'hbovzwgpheiuuqdbzcnr'}},{headers:{authorization:undefined}},
  {headers:{authorization:'Bearer invalid'}},{headers:{origin:'https://fixture.vercel.app'}},{method:'GET'}]){
  const r=await call(options);assert.notEqual(r.status,200);assert.equal(r.calls,0);
 }
});
test('only bounded cursor request accepted; forged, wrong-key and expired cursors fail before provider reads',async()=>{
 for(const options of [{body:'x'.repeat(1025)},{input:{cursor:null,action:'billing-refresh'}},{input:[]},{input:{cursor:'x'.repeat(60)}}]){
  const r=await call(options);assert.equal(r.status,400);assert.equal(r.calls,0);
 }
 const first=await call({monitor:async()=>({record:{userId:id,state:'matched'},next:id})});assert.equal(first.status,200);
 for(const options of [{now:()=>1600000},{env:{BILLING_MONITOR_TOKEN:'b'.repeat(64)},headers:{authorization:'Bearer '+'b'.repeat(64)}}]){
  const r=await call({...options,input:{cursor:first.body.cursor}});assert.equal(r.status,400);assert.equal(r.calls,0);
 }
});
test('encrypted pagination yields only counts; provider failures never leak details or report healthy',async()=>{
 const first=await call({monitor:async after=>{assert.equal(after,null);return {record:{userId:id,state:'mismatch',email:'private@example.test'},next:id};}});
 assert.equal(first.body.counts.mismatch,1);assert.doesNotMatch(JSON.stringify(first.body),/private|00000000/);
 const last=await call({input:{cursor:first.body.cursor},monitor:async after=>{assert.equal(after,id);return {record:null,next:null};}});
 assert.equal(last.status,200);assert.equal(last.body.cursor,null);
 const failed=await call({monitor:async()=>{throw new Error('sk_test_private');}});assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed),/sk_test/);
 const bad=await call({monitor:async()=>({record:{userId:id,state:'unknown'},next:null})});assert.equal(bad.status,503);
});
