'use strict';

// Request builders only. Handlers must obtain user from auth.getUser(), binding from a server-only
// owner lookup, and price from Stripe's API using the same test-mode client.
const {accountConfig}=require('./account-config.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message,status=400){throw Object.assign(new Error(message),{status});}

function sandboxConfig(env){
  if(env.BILLING_MODE!=='sandbox' || env.VERCEL_ENV==='production')
    fail('Test billing is unavailable.',503);
  let account;
  try{account=accountConfig(env);}catch(_){fail('Test billing is unavailable.',503);}
  if(!account.development)fail('Test billing requires development accounts.',503);
  let url;
  const previewHost=env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  const returnOrigin=env.BILLING_RETURN_ORIGIN || (env.VERCEL_ENV==='preview' && previewHost ? `https://${previewHost}` : undefined);
  try{url=new URL(returnOrigin);}catch(_){fail('Test billing return address is invalid.',503);}
  const local=['http://localhost:8773','http://127.0.0.1:8773'].includes(url.origin);
  const hosted=env.VERCEL_ENV==='preview' && [env.VERCEL_URL,env.VERCEL_BRANCH_URL].some(host=>
    typeof host==='string' && /^[a-z0-9-]+\.vercel\.app$/i.test(host) && url.origin===`https://${host}`);
  if(url.username || url.password || url.pathname!=='/' || url.search || url.hash ||
      !(env.VERCEL ? hosted : local))fail('Test billing return address is invalid.',503);
  const plans={};
  for(const [name,variable,interval] of [
    ['monthly','STRIPE_TEST_MONTHLY_PRICE_ID','month'],
    ['annual','STRIPE_TEST_ANNUAL_PRICE_ID','year'],
  ]){
    const id=env[variable];
    if(id){
      if(!/^price_[A-Za-z0-9]+$/.test(id))fail('Test price configuration is invalid.',503);
      plans[name]={id,interval};
    }
  }
  if(!Object.keys(plans).length || (plans.monthly && plans.monthly.id===plans.annual?.id))
    fail('Test price configuration is invalid.',503);
  return {origin:url.origin,plans,projectRef:env.MEMBERSHIP_DEV_PROJECT_REF};
}

function ownedCustomer(user,binding,projectRef){
  if(!UUID.test(user?.id||'') || !user.email_confirmed_at)fail('Sign in with a verified account.',401);
  if(binding?.user_id!==user.id || binding.project_ref!==projectRef || binding.livemode!==false ||
      !/^cus_[A-Za-z0-9]+$/.test(binding.stripe_customer_id||''))
    fail('A verified test billing account is required.',403);
  return binding.stripe_customer_id;
}

function checkoutParameters({env,user,binding,input,price}){
  const config=sandboxConfig(env);
  const customer=ownedCustomer(user,binding,config.projectRef);
  // Only the plan label crosses the browser boundary. Reject prices, customer IDs,
  // trial periods, quantities, discounts, metadata, and redirect overrides.
  if(!input || Array.isArray(input) || typeof input!=='object' ||
      Object.keys(input).length!==1 || !Object.hasOwn(input,'plan') ||
      !Object.hasOwn(config.plans,input.plan))fail('Choose an available test plan.');
  const plan=config.plans[input.plan];
  if(price?.id!==plan.id || price.object!=='price' || price.livemode!==false ||
      price.active!==true || price.type!=='recurring' || price.currency!=='usd' ||
      !Number.isSafeInteger(price.unit_amount) || price.unit_amount<=0 ||
      price.recurring?.interval!==plan.interval || price.recurring?.interval_count!==1 ||
      price.recurring?.usage_type!=='licensed')fail('The configured test price is unavailable.',503);
  return {
    mode:'subscription',customer,client_reference_id:user.id,
    line_items:[{price:plan.id,quantity:1}],
    success_url:config.origin+'/membership.html?checkout=returned',
    cancel_url:config.origin+'/membership.html?checkout=canceled',
    subscription_data:{metadata:{user_id:user.id,environment:'development',project_ref:config.projectRef}},
  };
}

function portalParameters({env,user,binding}){
  const config=sandboxConfig(env);
  return {customer:ownedCustomer(user,binding,config.projectRef),return_url:config.origin+'/membership.html'};
}
module.exports={sandboxConfig,checkoutParameters,portalParameters};
