'use strict';
// Read-only integration checks. Never contacts production or prints credentials.
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const ref=process.env.MEMBERSHIP_DEV_PROJECT_REF,url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
if(!/^[a-z]{20}$/.test(ref||'') || ref==='hbovzwgpheiuuqdbzcnr' || url!==`https://${ref}.supabase.co` || !key?.startsWith('sb_publishable_'))throw new Error('Explicit non-production configuration required.');
async function main(){
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  for(const [name,args] of [['dt_admin_status',{}],['dt_admin_members',{}],['dt_admin_audit',{p_user_id:'00000000-0000-4000-8000-000000000001'}],['dt_admin_grant',{p_user_id:'00000000-0000-4000-8000-000000000001',p_expires_at:null,p_reason:'Anonymous denial check',p_request_id:crypto.randomUUID()}],['dt_admin_revoke',{p_grant_id:crypto.randomUUID(),p_reason:'Anonymous denial check',p_request_id:crypto.randomUUID()}]]){
    const {error}=await db.rpc(name,args);assert.equal(error?.code,'42501',name+' must deny anonymous execution');console.log('PASS anonymous RPC denial:',name);
  }
  for(const table of ['membership_admins','membership_audit','access_grants','membership_subscriptions']){
    const {error}=await db.from(table).select('*').limit(1);assert.equal(error?.code,'42501',table+' must deny anonymous reads');console.log('PASS anonymous table denial:',table);
  }
  const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const forged=part({alg:'none',typ:'JWT'})+'.'+part({sub:'00000000-0000-4000-8000-000000000001',role:'authenticated',aal:'aal2',exp:Math.floor(Date.now()/1000)+600})+'.';
  const fake=await fetch(url+'/rest/v1/rpc/dt_admin_members',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+forged,'Content-Type':'application/json'},body:'{}'});
  assert.equal(fake.status,401);console.log('PASS forged authenticator claim rejected by hosted API');
  const origin='http://localhost:8773';
  for(const source of [origin,'http://localhost:8770','http://127.0.0.1:8770','https://untrusted.example']){
    const r=await fetch(origin+'/api/account',{method:'POST',headers:{Origin:source,'Content-Type':'application/json'},body:'{"action":"admin-members"}'});
    assert.equal(r.status,source===origin?401:403);assert.match(r.headers.get('cache-control'),/no-store/);
  }
  console.log('PASS local origin isolation and unsigned-session denial');
  for(const path of ['/lib/membership-admin.cjs','/.env.membership-development','/supabase/migrations/202609110002_membership_admin.sql'])assert.equal((await fetch(origin+path)).status,404);
  const page=await fetch(origin+'/members.html');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(page.headers.get('cache-control'),/no-store/);
  console.log('PASS private source/config denied and browser security headers present');
}
main().catch(error=>{console.error('FAIL',error.message);process.exitCode=1;});
