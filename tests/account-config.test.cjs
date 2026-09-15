'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {accountConfig}=require('../lib/account-config.cjs');
const good={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feat/subscription-access-foundation',MEMBERSHIP_DEV_PROJECT_REF:'phkbpputgegvesmpscrx',SUPABASE_URL:'https://phkbpputgegvesmpscrx.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
test('membership preview refuses missing or production database configuration',()=>{
  assert.equal(accountConfig(good).development,true);
  for(const patch of [{MEMBERSHIP_DEV_PROJECT_REF:undefined},{SUPABASE_URL:undefined},{SUPABASE_PUBLISHABLE_KEY:undefined},{SUPABASE_URL:'https://hbovzwgpheiuuqdbzcnr.supabase.co'},{VERCEL_ENV:'production'},{MEMBERSHIP_DEV_PROJECT_REF:'hbovzwgpheiuuqdbzcnr',SUPABASE_URL:'https://hbovzwgpheiuuqdbzcnr.supabase.co'}])assert.throws(()=>accountConfig({...good,...patch}));
});
test('existing production configuration is preserved outside isolated membership previews',()=>{
  const config=accountConfig({VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main'});
  assert.equal(config.development,false);assert.equal(config.url,'https://hbovzwgpheiuuqdbzcnr.supabase.co');
});
