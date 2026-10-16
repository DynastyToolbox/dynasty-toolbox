'use strict';
const {sandboxConfig}=require('./billing-sandbox.cjs');
const {createBillingService,API_VERSION}=require('./billing-service.cjs');
function billingRuntime(env){
  // Validate isolation before constructing either privileged client.
  sandboxConfig(env);
  if(!/^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_TEST_SECRET_KEY||'') ||
    !env.SUPABASE_BILLING_SECRET_KEY?.startsWith('sb_secret_'))throw new Error('Test billing credentials missing');
  const Stripe=require('stripe');
  const {createClient}=require('@supabase/supabase-js');
  const stripe=new Stripe(env.STRIPE_TEST_SECRET_KEY,{apiVersion:API_VERSION,maxNetworkRetries:1,timeout:10000});
  const db=createClient(env.SUPABASE_URL,env.SUPABASE_BILLING_SECRET_KEY,
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return {stripe,service:createBillingService({env,stripe,db})};
}
module.exports={billingRuntime};
