'use strict';
const { createClient } = require('@supabase/supabase-js');
const { createHandler } = require('../lib/account-server.cjs');

// This is a publishable key, not an administrative or email-service credential.
const url = process.env.SUPABASE_URL || 'https://hbovzwgpheiuuqdbzcnr.supabase.co';
const key = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_L9mqAdGHR9DzNfnHf4k1uA_d4tUkl3g';
module.exports = createHandler(access => createClient(url, key, {
  ...(access ? {global:{headers:{Authorization:'Bearer ' + access}}} : {}),
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}), process.env);
