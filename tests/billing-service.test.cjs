'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const Stripe=require('stripe');
const {createBillingService,paidCoverage}=require('../lib/billing-service.cjs');
const {resolveAccess}=require('../lib/subscription-access.cjs');
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
test('owner comparison uses verified Stripe coverage without creating or changing records',async()=>{
 const f=fixture({subscriptions:[clone(sub)]});
 const stored={user_id:user.id,plan:'premium',stripe_subscription_id:sub.id,status:'active',paid_through:new Date(end*1000).toISOString(),cancel_at_period_end:false};
 f.db.from=table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:clone(table==='billing_environment'?{project_ref:ref,stripe_account_id:'acct_fixture'}:table==='billing_accounts'?{user_id:user.id,stripe_customer_id:'cus_fixture'}:stored)})})})});
 f.db.rpc=async()=>{assert.fail('Comparison must never write or acquire a billing lease');};
 f.stripe.customers.create=async()=>{assert.fail('Comparison must never create a customer');};
 const result=await f.service.checkRecords(user.id);
 assert.equal(result.state,'matched');assert.equal(result.stripe.paidThrough,stored.paid_through);
 f.state.charge.amount_refunded=1000;
 assert.equal((await f.service.checkRecords(user.id)).state,'mismatch');
 f.stripe.customers.retrieve=async()=>({livemode:false,metadata:{...sub.metadata,user_id:'other'}});
 await assert.rejects(()=>f.service.checkRecords(user.id),/ownership/);
 assert.equal(f.state.creates,0);assert.equal(f.state.commits.length,0);
});

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

test('a disputed renewal removes only its coverage and the prior paid period still expires',async()=>{
 const earlier=clone(invoice),later=clone(invoice);
 later.id='in_later';later.charge='ch_later';later.lines.data[0].period.end=end+86400;
 const earlierCharge=clone(charge),laterCharge={...clone(charge),id:'ch_later',invoice:'in_later'};
 const f=fixture({subscriptions:[clone(sub)],invoices:[later,earlier]});
 f.stripe.charges.retrieve=async id=>id==='ch_later'?laterCharge:earlierCharge;
 await f.service.action('billing-refresh',{action:'billing-refresh'},user);
 assert.equal(f.state.commits.at(-1).paid_through,new Date((end+86400)*1000).toISOString());
 laterCharge.disputed=true;
 await f.service.event({id:'evt_disputed',type:'charge.dispute.created',livemode:false,data:{object:{charge:'ch_later'}}});
 assert.equal(f.state.commits.at(-1).paid_through,new Date(end*1000).toISOString());
 const atExpiry=createBillingService({...f,env,now:()=>end*1000});
 await atExpiry.action('billing-refresh',{action:'billing-refresh'},user);
 assert.equal(f.state.commits.at(-1).paid_through,null);
});
test('monthly renewal starts at its period boundary and grants only the paid month',async()=>{
 const renewal=clone(invoice),renewalEnd=end+30*86400;
 renewal.id='in_renewal';renewal.charge='ch_renewal';
 renewal.lines.data[0].period={start:end,end:renewalEnd};
 const f=fixture({subscriptions:[clone(sub)],invoices:[renewal,clone(invoice)]});
 f.stripe.charges.retrieve=async id=>id==='ch_renewal'?{...clone(charge),id,invoice:renewal.id}:clone(charge);
 let time=end*1000-1;
 const service=createBillingService({...f,env,now:()=>time});
 const access=()=>resolveAccess(user.id,{user_id:user.id,plan:'premium',...f.state.commits.at(-1)},[],time);
 await service.action('billing-refresh',{action:'billing-refresh'},user);
 assert.equal(f.state.commits.at(-1).paid_through,new Date(end*1000).toISOString());
 assert.equal(access().premium,true);
 time=end*1000;
 await service.event({id:'evt_renewal',type:'invoice.paid',livemode:false,data:{object:{customer:'cus_fixture'}}});
 assert.equal(f.state.commits.at(-1).paid_through,new Date(renewalEnd*1000).toISOString());
 assert.equal(access().premium,true);
 time=renewalEnd*1000;
 // Access must expire even if no webhook or reconciliation has run since payment.
 assert.equal(access().premium,false);
});

test('declined renewal expires without a webhook and later payment restores the same subscription',async()=>{
 const renewal=clone(invoice),renewalEnd=end+30*86400;
 renewal.id='in_renewal';renewal.charge='ch_renewal';renewal.status='open';renewal.paid=false;renewal.amount_paid=0;renewal.amount_remaining=1000;
 renewal.lines.data[0].period={start:end,end:renewalEnd};
 const renewalCharge={...clone(charge),id:'ch_renewal',invoice:renewal.id,paid:false,captured:false,status:'failed'};
 const f=fixture({subscriptions:[{...clone(sub),status:'past_due'}],invoices:[renewal,clone(invoice)]});
 f.stripe.charges.retrieve=async id=>id==='ch_renewal'?renewalCharge:clone(charge);
 let time=end*1000-1;
 const service=createBillingService({...f,env,now:()=>time});
 const access=()=>resolveAccess(user.id,{user_id:user.id,plan:'premium',...f.state.commits.at(-1)},[],time);
 await service.event({id:'evt_declined',type:'invoice.payment_failed',livemode:false,data:{object:{customer:'cus_fixture'}}});
 assert.equal(access().premium,true);
 time=end*1000;
 assert.equal(access().premium,false);
 await service.action('billing-refresh',{action:'billing-refresh'},user);
 assert.equal(f.state.commits.at(-1).paid_through,null);
 Object.assign(renewal,{status:'paid',paid:true,amount_paid:1000,amount_remaining:0});
 Object.assign(renewalCharge,{paid:true,captured:true,status:'succeeded'});
 f.state.subscriptions[0].status='active';
 time+=3600000;
 await service.event({id:'evt_recovered',type:'invoice.paid',livemode:false,data:{object:{customer:'cus_fixture'}}});
 assert.equal(f.state.commits.at(-1).id,sub.id);
 assert.equal(f.state.commits.at(-1).paid_through,new Date(renewalEnd*1000).toISOString());
 assert.equal(access().premium,true);
 assert.equal(f.state.creates,0);
});

test('closing a lost or won dispute does not trust its payload to restore disputed coverage',async()=>{
 const f=fixture({subscriptions:[clone(sub)]});f.state.charge.disputed=true;
 for(const status of ['lost','won']){
  await f.service.event({id:`evt_${status}`,type:'charge.dispute.closed',livemode:false,data:{object:{charge:charge.id,status}}});
  assert.equal(f.state.commits.at(-1).paid_through,null);
 }
 await f.service.event({id:'evt_delayedPaid',type:'invoice.paid',livemode:false,data:{object:{customer:'cus_fixture',paid:true}}});
 assert.equal(f.state.commits.at(-1).paid_through,null);
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

test('authenticated tools enforce expiration and recovery with the same signed-in session',async t=>{
 const renewal=clone(invoice),renewalEnd=end+30*86400;
 renewal.id='in_http_renewal';renewal.charge='ch_http_renewal';
 Object.assign(renewal,{status:'open',paid:false,amount_paid:0,amount_remaining:1000});
 renewal.lines.data[0].period={start:end,end:renewalEnd};
 const renewalCharge={...clone(charge),id:renewal.charge,invoice:renewal.id,paid:false,captured:false,status:'failed'};
 const f=fixture({subscriptions:[{...clone(sub),status:'past_due'}],invoices:[renewal,clone(invoice)]});
 f.stripe.charges.retrieve=async id=>id===renewal.charge?renewalCharge:clone(charge);
 t.mock.timers.enable({apis:['Date'],now:end*1000-1});
 const service=createBillingService({...f,env,now:()=>Date.now()});
 const client={auth:{getUser:async()=>({data:{user},error:null})},from(table){
  assert.ok(['membership_subscriptions','access_grants'].includes(table));
  return {select(){return {eq(column,value){
   assert.equal(column,'user_id');assert.equal(value,user.id);
   const result={data:table==='access_grants'?[]:{user_id:user.id,plan:'premium',...f.state.commits.at(-1)},error:null};
   return {...result,maybeSingle:async()=>result};
  }};}};
 }};
 const handler=createHandler(()=>client,{ACCOUNT_ALLOWED_ORIGINS:'http://localhost:8773',SUBSCRIPTION_ACCESS_ENABLED:'true'});
 async function request(body){
  const res=response();await handler({method:'POST',headers:{origin:'http://localhost:8773','content-type':'application/json',cookie:'dt-dev-access=fixture'},body},res);return res;
 }
 async function check(premium){
  const access=await request({action:'access',premium:true,paid_through:'2099-01-01'});
  assert.equal(access.statusCode,200);assert.equal(access.body.access.premium,premium);
  assert.match(access.headers['Cache-Control'],/no-store/);
  assert.equal(access.body.access.features.tradeTeams,premium?12:2);
  assert.equal(access.body.access.features.leagueOutlook,premium);
  const trade=await request({action:'trade-evaluate',premium:true,teams:[1,2,3].map(id=>({id,status:'overall'})),transfers:[],format:{ppr:'hppr',superflex:true,tePremium:false}});
  assert.equal(trade.statusCode,premium?200:403);
 }
 const event=(id,type)=>({id,type,livemode:false,data:{object:{customer:'cus_fixture'}}});
 await service.event(event('evt_httpFailure','invoice.payment_failed'));await check(true);
 const before=f.state.commits.length;
 t.mock.timers.setTime(end*1000);await check(false);
 assert.equal(f.state.commits.length,before); // No webhook, refresh, or DB change at expiry.
 await service.event(event('evt_httpFalseSuccess','invoice.paid'));await check(false);
 Object.assign(renewal,{status:'paid',paid:true,amount_paid:1000,amount_remaining:0});
 Object.assign(renewalCharge,{paid:true,captured:true,status:'succeeded'});f.state.subscriptions[0].status='active';
 await service.event(event('evt_httpRecovered','invoice.paid'));await check(true);
 assert.equal(f.state.commits.at(-1).paid_through,new Date(renewalEnd*1000).toISOString());
 await service.event(event('evt_httpLateFailure','invoice.payment_failed'));await check(true);
 f.state.subscriptions[0].cancel_at_period_end=true;
 await service.event(event('evt_httpCancelScheduled','customer.subscription.updated'));
 t.mock.timers.setTime(renewalEnd*1000-1);await check(true);
 t.mock.timers.setTime(renewalEnd*1000);await check(false);
 assert.equal(f.state.creates,0);
});

test('monitor verifies environment before enumeration and never mutates billing',async()=>{
 const f=fixture();let listed=0;
 f.db.from=table=>({select(){return {eq(){return {maybeSingle:async()=>({data:{project_ref:ref,stripe_account_id:'acct_wrong'}})};},order(){listed++;assert.fail('Wrong environment must not enumerate accounts');}};}});
 await assert.rejects(()=>f.service.monitor(),/environment/);assert.equal(listed,0);
 f.db.from=table=>({select(){return table==='billing_environment'?{eq(){return {maybeSingle:async()=>({data:{project_ref:ref,stripe_account_id:'acct_fixture'}})};}}:{order(){return {limit:async()=>({data:[]})};}};}});
 f.db.rpc=async()=>assert.fail('Monitor must never write');
 const result=await f.service.monitor();assert.equal(result.record,null);assert.equal(result.next,null);
});

test('only verified notification-processing failures emit the fixed monitoring signal',async()=>{
 const stripe=new Stripe('sk_test_fixture'),secret='whsec_fixture';let signals=0;
 const handler=createWebhookHandler(()=>({stripe,service:{event:async()=>{throw new Error('private key and customer');}}}),{STRIPE_TEST_WEBHOOK_SECRET:secret},(...args)=>{assert.deepEqual(args,[]);signals++;});
 const payload=JSON.stringify({id:'evt_fixture',livemode:false,type:'invoice.paid'});
 async function request(signature){const req=Readable.from([Buffer.from(payload)]);req.method='POST';req.headers=signature?{'stripe-signature':signature}:{};const res=response();await handler(req,res);return res;}
 assert.equal((await request()).statusCode,400);assert.equal(signals,0);
 assert.equal((await request('bad')).statusCode,400);assert.equal(signals,0);
 const res=await request(stripe.webhooks.generateTestHeaderString({payload,secret}));assert.equal(res.statusCode,503);assert.equal(signals,1);assert.doesNotMatch(JSON.stringify(res.body),/private key|customer/);
});
