'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sandboxConfig,checkoutParameters,portalParameters}=require('../lib/billing-sandbox.cjs');
const {resolveAccess}=require('../lib/subscription-access.cjs');
const ref='abcdefghijklmnopqrst';
const env={BILLING_MODE:'sandbox',MEMBERSHIP_DEV_PROJECT_REF:ref,SUPABASE_URL:`https://${ref}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',BILLING_RETURN_ORIGIN:'http://localhost:8773',
  STRIPE_TEST_MONTHLY_PRICE_ID:'price_fixtureMonth',STRIPE_TEST_ANNUAL_PRICE_ID:'price_fixtureYear'};
const user={id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:'2026-10-01'};
const binding={user_id:user.id,project_ref:ref,livemode:false,stripe_customer_id:'cus_fixtureA'};
const price={id:'price_fixtureMonth',object:'price',active:true,livemode:false,type:'recurring',currency:'usd',
  unit_amount:100,recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}; // Arbitrary fixture, not approved pricing.
const run=(overrides={})=>checkoutParameters({env,user,binding,input:{plan:'monthly'},price,...overrides});

test('sandbox is off by default and cannot run against production accounts or hosting',()=>{
  for(const changes of [{BILLING_MODE:undefined},{BILLING_MODE:'live'},{VERCEL_ENV:'production'},
    {MEMBERSHIP_DEV_PROJECT_REF:undefined},{MEMBERSHIP_DEV_PROJECT_REF:'hbovzwgpheiuuqdbzcnr'},
    {SUPABASE_URL:'https://hbovzwgpheiuuqdbzcnr.supabase.co'}])
    assert.throws(()=>sandboxConfig({...env,...changes}),{status:503});
});
test('return addresses are restricted to this local development site or exact hosted preview',()=>{
  for(const origin of ['https://www.dynasty-toolbox.com','https://evil.example','http://localhost:8770',
    'http://localhost:8773/account.html','http://localhost:8773/?next=evil','http://localhost:8773/#x',
    'http://user:pass@localhost:8773','not a URL'])
    assert.throws(()=>sandboxConfig({...env,BILLING_RETURN_ORIGIN:origin}),{status:503});
  const hosted={...env,VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'fixture.vercel.app',BILLING_RETURN_ORIGIN:'https://fixture.vercel.app'};
  assert.equal(sandboxConfig(hosted).origin,'https://fixture.vercel.app');
  assert.equal(sandboxConfig({...hosted,BILLING_RETURN_ORIGIN:undefined,VERCEL_BRANCH_URL:'branch-fixture.vercel.app'}).origin,'https://branch-fixture.vercel.app');
  assert.throws(()=>sandboxConfig({...hosted,BILLING_RETURN_ORIGIN:'http://localhost:8773'}),{status:503});
  assert.throws(()=>sandboxConfig({...hosted,VERCEL_URL:'evil.example'}),{status:503});
});
test('checkout uses a server-selected recurring price and does not grant access',()=>{
  const params=run();
  assert.equal(params.customer,binding.stripe_customer_id);
  assert.equal(params.client_reference_id,user.id);
  assert.deepEqual(params.line_items,[{price:price.id,quantity:1}]);
  assert.equal(params.subscription_data.metadata.project_ref,ref);
  assert.equal(params.mode,'subscription');
  assert.equal(Object.hasOwn(params,'trial_period_days'),false);
  assert.equal(resolveAccess(user.id,null,[]).premium,false);
});
test('annual fixture works without choosing or publishing a launch price',()=>{
  const result=run({input:{plan:'annual'},price:{...price,id:'price_fixtureYear',recurring:{...price.recurring,interval:'year'}}});
  assert.equal(result.line_items[0].price,'price_fixtureYear');
});
test('anonymous and unverified identities cannot prepare checkout or portal access',()=>{
  for(const identity of [null,{}, {...user,email_confirmed_at:null}]){
    assert.throws(()=>run({user:identity}),{status:401});
    assert.throws(()=>portalParameters({env,user:identity,binding}),{status:401});
  }
});
test('two users cannot cross customer ownership in checkout or billing portal',()=>{
  for(const changed of [{...binding,user_id:'22222222-2222-4222-8222-222222222222'},
    {...binding,project_ref:'anotherproject'}, {...binding,livemode:true}, {...binding,livemode:undefined},
    {...binding,stripe_customer_id:null},null]){
    assert.throws(()=>run({binding:changed}),{status:403});
    assert.throws(()=>portalParameters({env,user,binding:changed}),{status:403});
  }
  assert.deepEqual(portalParameters({env,user,binding}),{customer:'cus_fixtureA',return_url:'http://localhost:8773/membership.html'});
});
test('browser input cannot override ownership, price, quantity, trial, or redirects',()=>{
  for(const extra of [{customer:'cus_fixtureB'},{user_id:'other'},{price:'price_cheaper'}, {quantity:100},
    {unit_amount:1},{trial_period_days:365},{success_url:'https://evil.example'}, {metadata:{premium:true}}])
    assert.throws(()=>run({input:{plan:'monthly',...extra}}),{status:400});
  for(const input of [null,[],{}, {plan:'toString'}, {plan:'__proto__'}, {plan:'unknown'}])
    assert.throws(()=>run({input}),{status:400});
});
test('live, inactive, mismatched, free, metered, and non-recurring prices are rejected',()=>{
  for(const changed of [{id:'price_other'},{livemode:true},{livemode:undefined},{active:false},
    {type:'one_time'},{object:'product'},{currency:'eur'},{unit_amount:0},{unit_amount:1.5},
    {recurring:{interval:'year',interval_count:1,usage_type:'licensed'}},
    {recurring:{interval:'month',interval_count:2,usage_type:'licensed'}},
    {recurring:{interval:'month',interval_count:1,usage_type:'metered'}}])
    assert.throws(()=>run({price:{...price,...changed}}),{status:503});
});
test('missing and conflicting configured plan IDs fail closed',()=>{
  for(const changes of [{STRIPE_TEST_MONTHLY_PRICE_ID:'wrong'},
    {STRIPE_TEST_MONTHLY_PRICE_ID:undefined,STRIPE_TEST_ANNUAL_PRICE_ID:undefined},
    {STRIPE_TEST_ANNUAL_PRICE_ID:env.STRIPE_TEST_MONTHLY_PRICE_ID}])
    assert.throws(()=>sandboxConfig({...env,...changes}),{status:503});
});
test('failed renewals and cancellation follow paid-through rules; browser success flags do not',()=>{
  const now=Date.parse('2026-10-15T12:00:00Z'),end='2026-11-01T00:00:00Z';
  const paid={user_id:user.id,plan:'premium',status:'active',paid_through:end,cancel_at_period_end:true};
  assert.equal(resolveAccess(user.id,paid,[],now).premium,true);
  assert.equal(resolveAccess(user.id,paid,[],Date.parse(end)).premium,false);
  assert.equal(resolveAccess(user.id,{...paid,status:'past_due'},[],Date.parse(end)).premium,false);
  assert.equal(resolveAccess(user.id,{...paid,status:'canceled'},[],now).premium,false);
  assert.equal(resolveAccess(user.id,{user_id:user.id,checkout:'returned',payment_status:'paid',premium:true},[],now).premium,false);
});
