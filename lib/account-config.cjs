'use strict';
const PRODUCTION_REF='hbovzwgpheiuuqdbzcnr';
const MEMBERSHIP_BRANCH='feat/subscription-access-foundation';
function accountConfig(env){
  const development=env.VERCEL_GIT_COMMIT_REF===MEMBERSHIP_BRANCH || Boolean(env.MEMBERSHIP_DEV_PROJECT_REF);
  if(development){
    const ref=env.MEMBERSHIP_DEV_PROJECT_REF;
    if(env.VERCEL_ENV==='production' || !/^[a-z]{20}$/.test(ref||'') || ref===PRODUCTION_REF || env.SUPABASE_URL!==`https://${ref}.supabase.co` || !env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_'))throw new Error('Development account configuration is incomplete.');
  }
  return {development,url:env.SUPABASE_URL || `https://${PRODUCTION_REF}.supabase.co`,key:env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_L9mqAdGHR9DzNfnHf4k1uA_d4tUkl3g'};
}
module.exports={accountConfig};
