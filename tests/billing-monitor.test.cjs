'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {monitorBillingPage}=require('../lib/billing-monitor.cjs');
const {runMonitor}=require('../scripts/monitor-billing-development.cjs');
const {createHandler}=require('../lib/account-server.cjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function dbFor(accounts,subscriptions,{failTable}={}){
 return {from(table){assert.ok(['billing_accounts','membership_subscriptions'].includes(table));let after='';
   const q={select(columns){assert.equal(columns,'user_id');return q;},order(column,opts){assert.equal(column,'user_id');assert.equal(opts.ascending,true);return q;},limit(n){assert.equal(n,2);return q;},gt(column,value){assert.equal(column,'user_id');after=value;return q;},then(resolve,reject){return Promise.resolve(table===failTable?{error:{message:'private key'}}:{data:(table==='billing_accounts'?accounts:subscriptions).filter(x=>x>after).sort().slice(0,2).map(user_id=>({user_id}))}).then(resolve,reject);}};return q;}};
}
test('review covers the union once, including orphaned membership rows, without writes',async()=>{
 const db=dbFor([id(1),id(3),id(5)],[id(2),id(3),id(4)]),seen=[];
 const service={monitor:after=>monitorBillingPage({db,after,checkRecords:async user=>{seen.push(user);return {state:'matched',stripe:{status:'active'}};}})};
 const report=await runMonitor(service);assert.equal(report.complete,true);assert.equal(report.checked,5);assert.equal(report.matched,5);assert.deepEqual(seen,[1,2,3,4,5].map(id));
});
test('review separates mismatches, payment problems, changing records and failures; errors are redacted',async()=>{
 const states=[{state:'mismatch'},{state:'matched',stripe:{status:'past_due'}},{state:'changed'},null];let i=0;
 const db=dbFor([1,2,3,4].map(id),[]);
 const report=await runMonitor({monitor:after=>monitorBillingPage({db,after,checkRecords:async()=>{const result=states[i++];if(!result)throw new Error('sk_test_private customer@example.test');return result;}})});
 assert.equal(report.complete,true);assert.equal(report.matched,0);assert.deepEqual(report.issues.map(r=>r.state),['mismatch','payment_attention','retry','unavailable']);assert.doesNotMatch(JSON.stringify(report),/sk_test|example.test/);
});
test('empty lists finish but database errors and bounds never report a complete clean scan',async()=>{
 const empty=await runMonitor({monitor:after=>monitorBillingPage({db:dbFor([],[]),after,checkRecords:()=>assert.fail()})});assert.equal(empty.complete,true);assert.equal(empty.checked,0);
 await assert.rejects(()=>monitorBillingPage({db:dbFor([],[],{failTable:'membership_subscriptions'}),checkRecords:()=>assert.fail()}));
 await assert.rejects(()=>monitorBillingPage({db:dbFor([],[]),after:'bad',checkRecords:()=>assert.fail()}));
 const limited=await runMonitor({monitor:after=>monitorBillingPage({db:dbFor([id(1),id(2)],[]),after,checkRecords:async()=>({state:'matched'})})},{maxAccounts:1});assert.equal(limited.complete,false);assert.equal(limited.checked,1);
 await assert.rejects(()=>runMonitor({monitor:async()=>({record:{userId:id(1),state:'matched'},next:id(1)})}),/advance/);
});
test('HTTP monitoring enforces origin, sign-in, owner MFA and development before privileged client creation',async()=>{
 async function request({env={},headers={},admin=true,mfa=true,user=true,body={action:'admin-billing-monitor',after:null}}={}){
  let calls=0;
  const client={auth:{getUser:async()=>({data:{user:user?{id:id(1),email_confirmed_at:'2026-10-01'}:null}})},rpc:async()=>({data:{admin,mfa}})};
  const handler=createHandler(()=>client,{BILLING_MODE:'sandbox',MEMBERSHIP_ADMIN_ENABLED:'true',ACCOUNT_ALLOWED_ORIGINS:'http://localhost:8773',...env},{billingRuntime:()=>{calls++;return {service:{monitor:async after=>{assert.equal(after,null);return {record:null,next:null};}}};}});
  const res={setHeader(){},end(value){this.body=JSON.parse(value);}};
  await handler({method:'POST',headers:{origin:'http://localhost:8773','content-type':'application/json',cookie:'dt-dev-access=fixture',...headers},body},res);return {calls,status:res.statusCode,body:res.body};
 }
 for(const options of [{admin:false},{mfa:false},{user:false},{headers:{origin:'https://evil.test'}},{env:{MEMBERSHIP_ADMIN_ENABLED:'false'}},{env:{VERCEL_ENV:'production',ACCOUNT_PUBLIC_ENABLED:'true'}},{env:{BILLING_MODE:'live'}},{body:{action:'admin-billing-monitor',after:'bad'}},{body:{action:'admin-billing-monitor',repair:true}}]){const r=await request(options);assert.notEqual(r.status,200);assert.equal(r.calls,0);}
 const r=await request();assert.equal(r.status,200);assert.equal(r.calls,1);assert.equal(r.body.billingMonitor.next,null);
});
