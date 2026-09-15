'use strict';
const { createClient } = require('@supabase/supabase-js');
const { createHandler } = require('../lib/account-server.cjs');
const { accountConfig } = require('../lib/account-config.cjs');

// This is a publishable key, not an administrative or email-service credential.
try {
const {url,key,development}=accountConfig(process.env);
module.exports = createHandler(access => createClient(url, key, {
  ...(access ? {global:{headers:{Authorization:'Bearer ' + access}}} : {}),
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}), {...process.env,ACCOUNT_DEVELOPMENT:development?'true':'false'});
} catch (_) {
  module.exports=(_req,res)=>{res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json');res.statusCode=503;res.end(JSON.stringify({error:'Development accounts are being configured. Please try again later.'}));};
}
