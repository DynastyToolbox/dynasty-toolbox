'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const Stripe=require('stripe');
const {createBillingService,paidCoverage}=require('../lib/billing-service.cjs');
const {createWebhookHandler}=require('../lib/billing-webhook.cjs');
const {createHandler}=require('../lib/account-server.cjs');
const user={id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:'2026-10-01'};
const now=Date.parse('2026-10-16T12:00:00Z'),start=now/1000-100,end=now/1000+86400;
const ref='abcdefghijklmnopqrst';
const env={BILLING_MODE:'sandbox',BILLING_WEBHOOK_READY:'true',STRIPE_TEST_ACCOUNT_ID:'acct_fixture',
 MEMBERSHIP_DEV_PROJECT_REF:ref,SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
 BILLING_RETURN_ORIGIN:'http://localhost:8773',STRIPE_TEST_MONTHLY_PRICE_ID:'price_month',STRIPE_TEST_PORTAL_CONFIG_ID:'bpc_fixture'};
const price={id:'price_month',object:'price',active:true,livemode:false,type:'recurring',currency:'usd',unit_amount:1000,
 recurring:{interval:'month',interval_count:1,usage_type:'licensed'}};
const sub={id:'sub_fixture',livemode:false,customer:'cus_fixture',status:'active',cancel_at_period_end:false,
 metadata:{user_id:user.id,project_ref:ref,environment:'development'},items:{has_more:false,data:[{quantity:1,price}]}};
const invoice={id:'in_fixture',livemode:false,status:'paid',paid:true,paid_out_of_band:false,currency:'usd',amount_paid:1000,
 amount_remaining:0,customer:'cus_fixture',subscription:sub.id,charge:'ch_fixture',billing_reason:'subscription_cycle',
 lines:{has_more:false,data:[{type:'subscription',subscription:sub.id,price,quantity:1,proration:false,amount:1000,period:{start,end}}]}};
const charge={id:'ch_fixture',customer:'cus_fixture',invoice:invoice.id,livemode:false,paid:true,captured:true,status:'succeeded',
 currency:'usd',amount:1000,amount_refunded:0,disputed:false};
const clone=o=>structuredClone(o);
function fixture(changes={}){
 const state={row:{user_id:user.id,stripe_customer_id:'cus_fixture',customer_request:'request1',customer_started:new Date(now).toISOString()},
  subscriptions:[],invoices:[clone(invoice)],charge:clone(charge),creates:0,commits:[],events:new Set(),session:null,...changes};
 const stripe={accounts:{retrieve:async()=>({id:'acct_fixture'})},customers:{retrieve:async customer=>({id:customer,livemode:false,metadata:sub.metadata}),
  create:async()=>({id:'cus_fixture',livemode:false})},prices:{retrieve:async()=>clone(price)},
  subscriptions:{list:async()=>({data:state.subscriptions,has_more:false})},invoices:{list:async()=>({data:state.invoices,has_more:false})},
  charges:{retrieve:async()=>state.charge},billingPortal:{sessions:{create:async params=>{state.portal=params;return {url:'https://billing.stripe.com/p/session/test'};}}},
  checkout:{sessions:{retrieve:async()=>state.session,create:async(params,opts)=>{
   state.creates++;state.params=params;state.key=opts.idempotencyKey;
   if(state.failCreate)throw new Error('network');
   return state.session={id:'cs_test_fixture',livemode:false,customer:'cus_fixture',status:'open',url:'https://checkout.stripe.com/c/pay/test'};
  }}}};
 const db={rpc:async(name,args)=>{
  if(state.failDB)return {error:{message:'private detail'}};
  if(name==='dt_billing_lock'){
   if(state.row.lease_token)return {data:{busy:true}};
   state.row.lease_token='lease';return {data:clone(state.row)};
  }
  if(name==='dt_billing_unlock'){state.row.lease_token=null;return {data:null};}
  if(name==='dt_billing_save'){
   Object.assign(state.row,{stripe_customer_id:args.p_customer,checkout_request:args.p_checkout_request,
    checkout_started:args.p_checkout_started,checkout_plan:args.p_checkout_plan,checkout_session:args.p_checkout_session});
   return {data:clone(state.row)};
  }
  if(name==='dt_billing_commit'){
   if(args.p_event && state.events.has(args.p_event))return {data:null};
   if(args.p_event)state.events.add(args.p_event);
   state.commits.push(args.p_subscription);return {data:null};
  }
  throw new Error(name);
 },from:()=>({select:()=>({eq:(_column,customer)=>({maybeSingle:async()=>({data:customer==='cus_fixture'?{user_id:user.id}:null})})})})};
 return {state,stripe,db,service:createBillingService({env,stripe,db,now:()=>now})};
}
test('only paid, matching, unrefunded coverage grants access; weak or future evidence does not',()=>{
 assert.equal(paidCoverage(invoice,charge,sub,price,now/1000),new Date(end*1000).toISOString());
 for(const mutation of [{status:'open'},{paid:false},{paid_out_of_band:true},{livemode:true},{customer:'cus_other'},
  {subscription:'sub_other'},{amount_paid:0},{amount_remaining:100},{billing_reason:'manual'},
  {post_payment_credit_notes_amount:10},{lines:{...invoice.lines,has_more:true}}])
  assert.equal(paidCoverage({...invoice,...mutation},charge,sub,price,now/1000),null);
 for(const mutation of [{amount_refunded:1},{disputed:true},{paid:false},{status:'pending'},{livemode:true},{customer:'cus_other'},
  {invoice:'in_other'},{captured:false}])assert.equal(paidCoverage(invoice,{...charge,...mutation},sub,price,now/1000),null);
 for(const mutation of [{quantity:2},{proration:true},{price:{id:'price_other'}},{period:{start:end,end:end+100}}])
  assert.equal(paidCoverage({...invoice,lines:{has_more:false,data:[{...invoice.lines.data[0],...mutation}]}},charge,sub,price,now/1000),null);
});
test('repeated checkout clicks reuse one session; concurrent requests do not create two',async()=>{
 const f=fixture();const input={action:'billing-checkout',plan:'monthly'};
 const results=await Promise.allSettled([f.service.action(input.action,input,user),f.service.action(input.action,input,user)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 const first=results.find(r=>r.status==='fulfilled').value;
 assert.deepEqual(await f.service.action(input.action,input,user),first);assert.equal(f.state.creates,1);
 assert.equal(f.state.params.customer,'cus_fixture');assert.equal(f.state.params.payment_method_types[0],'card');
 assert.equal(f.state.commits.length,0);
});
test('uncertain checkout retries preserve the idempotency key and reject stale retries',async()=>{
 const f=fixture({failCreate:true});const input={action:'billing-checkout',plan:'monthly'};
 await assert.rejects(()=>f.service.action(input.action,input,user));const key=f.state.key;
 f.state.failCreate=false;await f.service.action(input.action,input,user);assert.equal(f.state.key,key);
 f.state.row.checkout_session=null;f.state.row.checkout_started=new Date(now-24*3600000).toISOString();
 await assert.rejects(()=>f.service.action(input.action,input,user),/owner review/);
});
test('an active or incomplete subscription prevents another checkout',async()=>{
 for(const status of ['active','past_due','incomplete','trialing','unpaid','paused']){
  const f=fixture({subscriptions:[{...sub,status}]});
  await assert.rejects(()=>f.service.action('billing-checkout',{action:'billing-checkout',plan:'monthly'},user),{status:409});
  assert.equal(f.state.creates,0);
 }
});
test('a declined payment can resume its existing open checkout without creating another subscription',async()=>{
 const f=fixture();const input={action:'billing-checkout',plan:'monthly'};
 const original=await f.service.action(input.action,input,user);
 f.state.subscriptions=[{...clone(sub),status:'incomplete'}];
 assert.deepEqual(await f.service.action(input.action,input,user),original);
 assert.equal(f.state.creates,1);assert.equal(f.state.commits.length,0);
});
test('checkout recovery rejects paid, foreign, multiple or closed incomplete subscriptions',async()=>{
 for(const subscriptions of [[clone(sub)],[{...clone(sub),status:'incomplete',metadata:{}}],
  [{...clone(sub),status:'incomplete'},{...clone(sub),id:'sub_second',status:'incomplete'}]]){
  const f=fixture();const input={action:'billing-checkout',plan:'monthly'};
  await f.service.action(input.action,input,user);f.state.subscriptions=subscriptions;
  await assert.rejects(()=>f.service.action(input.action,input,user),{status:409});assert.equal(f.state.creates,1);
 }
 for(const status of ['complete','expired']){
  const f=fixture();const input={action:'billing-checkout',plan:'monthly'};
  await f.service.action(input.action,input,user);
  f.state.subscriptions=[{...clone(sub),status:'incomplete'}];f.state.session.status=status;
  await assert.rejects(()=>f.service.action(input.action,input,user),{status:409});assert.equal(f.state.creates,1);
 }
});
test('ownership and browser overrides are rejected for checkout and portal',async()=>{
 const f=fixture();
 for(const extra of [{customer:'cus_other'},{price:'price_other'},{user_id:'other'},{success_url:'https://evil.test'}])
  await assert.rejects(()=>f.service.action('billing-checkout',{action:'billing-checkout',plan:'monthly',...extra},user),{status:400});
 await assert.rejects(()=>f.service.action('billing-portal',{action:'billing-portal'},null),{status:401});
 f.stripe.customers.retrieve=async()=>({livemode:false,metadata:{...sub.metadata,user_id:'other'}});
 await assert.rejects(()=>f.service.action('billing-portal',{action:'billing-portal'},user),/ownership/);
});
test('portal belongs to the mapped customer, uses a pinned configuration and return origin',async()=>{
 const f=fixture();await f.service.action('billing-portal',{action:'billing-portal'},user);
 assert.equal(f.state.portal.customer,'cus_fixture');assert.equal(f.state.portal.configuration,'bpc_fixture');
 assert.equal(f.state.portal.return_url,'http://localhost:8773/membership.html');
});
test('webhooks reconcile fresh state, dedupe events, and never map unknown customers',async()=>{
 const f=fixture({subscriptions:[clone(sub)]});
 const event={id:'evt_fixture',type:'invoice.paid',livemode:false,data:{object:{customer:'cus_fixture',paid:true}}};
 await f.service.event(event);await f.service.event(event);assert.equal(f.state.commits.length,1);
 assert.equal(f.state.commits[0].paid_through,new Date(end*1000).toISOString());
 // A stale paid event arrives after cancellation: current provider state wins.
 f.state.subscriptions=[{...sub,status:'canceled'}];await f.service.event({...event,id:'evt_stale'});
 assert.equal(f.state.commits.at(-1),null);
 await f.service.event({...event,id:'evt_other',data:{object:{customer:'cus_unknown',metadata:{user_id:user.id}}}});
 assert.equal(f.state.commits.length,2);
 await assert.rejects(()=>f.service.event({...event,livemode:true}),{status:400});
 await assert.rejects(()=>f.service.event({...event,account:'acct_other'}),{status:400});
});
test('failed renewal retains only existing paid coverage; refund and dispute remove it',async()=>{
 const f=fixture({subscriptions:[{...sub,status:'past_due',cancel_at_period_end:true}]});
 await f.service.action('billing-refresh',{action:'billing-refresh'},user);
 assert.equal(f.state.commits.at(-1).paid_through,new Date(end*1000).toISOString());
 f.state.charge.amount_refunded=1000;await f.service.action('billing-refresh',{action:'billing-refresh'},user);
 assert.equal(f.state.commits.at(-1).paid_through,null);
 f.state.charge.amount_refunded=0;f.state.charge.disputed=true;
 await f.service.action('billing-refresh',{action:'billing-refresh'},user);assert.equal(f.state.commits.at(-1).paid_through,null);
});
test('checkout stays closed until notification readiness, and DB errors do not acknowledge events',async()=>{
 const f=fixture();const service=createBillingService({...f,env:{...env,BILLING_WEBHOOK_READY:'false'},now:()=>now});
 await assert.rejects(()=>service.action('billing-checkout',{action:'billing-checkout',plan:'monthly'},user),/still being connected/);
 assert.equal(f.state.creates,0);
 f.state.failDB=true;await assert.rejects(()=>f.service.event({id:'evt_fail',type:'invoice.paid',livemode:false,data:{object:{customer:'cus_fixture'}}}));
});
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(text){this.body=JSON.parse(text);}};}
test('raw-body handler verifies real Stripe signatures; rejects tampering, old signatures and oversized events',async()=>{
 const stripe=new Stripe('sk_test_fixture');const secret='whsec_fixture';let calls=0;
 const handler=createWebhookHandler(()=>({stripe,service:{event:async()=>{calls++;return {received:true};}}}),{STRIPE_TEST_WEBHOOK_SECRET:secret});
 const payload=JSON.stringify({id:'evt_fixture',livemode:false,type:'invoice.paid'});
 async function request(text,signature,method='POST'){
  const req=Readable.from([Buffer.from(text)]);req.method=method;req.headers={'stripe-signature':signature};const res=response();await handler(req,res);return res;
 }
 const signature=stripe.webhooks.generateTestHeaderString({payload,secret});
 assert.equal((await request(payload,signature)).statusCode,200);
 assert.equal((await request(payload+' ',signature)).statusCode,400);
 assert.equal((await request(payload,stripe.webhooks.generateTestHeaderString({payload,secret,timestamp:1}))).statusCode,400);
 assert.equal((await request('x'.repeat(262145),signature)).statusCode,413);
 assert.equal((await request(payload,signature,'GET')).statusCode,405);assert.equal(calls,1);
});
test('account route applies origin, authentication and production gates before billing',async()=>{
 let calls=0;const client={auth:{getUser:async()=>({data:{user}})}};
 const runtime=()=>({service:{action:async()=>{calls++;return {ok:true};}}});
 const handler=createHandler(()=>client,{...env,ACCOUNT_ALLOWED_ORIGINS:'http://localhost:8773'},{billingRuntime:runtime});
 async function req(headers,body={action:'billing-checkout',plan:'monthly'},target=handler){const res=response();await target({method:'POST',headers,body},res);return res;}
 const headers={origin:'http://localhost:8773','content-type':'application/json',cookie:'dt-dev-access=fixture'};
 assert.equal((await req({...headers,origin:'https://evil.test'})).statusCode,403);
 assert.equal((await req({...headers,cookie:''})).statusCode,401);
 assert.equal((await req(headers)).statusCode,200);
 const prod=createHandler(()=>client,{...env,VERCEL_ENV:'production',ACCOUNT_PUBLIC_ENABLED:'true',ACCOUNT_ALLOWED_ORIGINS:'http://localhost:8773'},{billingRuntime:runtime});
 assert.equal((await req(headers,undefined,prod)).statusCode,503);assert.equal(calls,1);
});
