'use strict';
// Local PostgreSQL test only. PGLITE_TEST_MODULE points to an isolated test dependency.
// This harness never reads Supabase credentials or connects to a hosted database.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const modulePath=process.env.PGLITE_TEST_MODULE;
test('PostgreSQL membership isolation, MFA, grants, revocation, audit and idempotency',{skip:!modulePath},async()=>{
  const {PGlite}=require(modulePath);const db=new PGlite();
  const owner='11111111-1111-4111-8111-111111111111', member='22222222-2222-4222-8222-222222222222', stranger='33333333-3333-4333-8333-333333333333';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema auth to anon,authenticated;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
    for(const file of ['202609110001_subscription_access.sql','202609110002_membership_admin.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
    await db.query('insert into auth.users values ($1,$2,now()),($3,$4,now()),($5,$6,null)',[owner,'owner@example.test',member,'member@example.test',stranger,'unverified@example.test']);
    await db.query('insert into public.membership_admins(user_id) values($1)',[owner]);
    async function as(id,aal,fn,role='authenticated') {
      await db.exec('begin; set local role '+role);
      await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,aal})]);
      try {const result=await fn();await db.exec('commit');return result;}catch(e){await db.exec('rollback');throw e;}
    }
    const q=(sql,args)=>db.query(sql,args);
    const status=await as(owner,'aal1',()=>q('select public.dt_admin_status() as value'));
    assert.deepEqual(status.rows[0].value,{admin:true,mfa:false});
    await assert.rejects(()=>as(owner,'aal1',()=>q('select public.dt_admin_members()')),/Administrator verification required/);
    await assert.rejects(()=>as(member,'aal2',()=>q('select public.dt_admin_members()')),/Administrator verification required/);
    await assert.rejects(()=>as(null,'aal1',()=>q('select public.dt_admin_members()'),'anon'),/permission denied/);
    await assert.rejects(()=>as(member,'aal2',()=>q('insert into public.membership_admins(user_id) values($1)',[member])),/permission denied/);
    await assert.rejects(()=>as(member,'aal2',()=>q("insert into public.access_grants(user_id,granted_by,reason) values($1,$1,'self')",[member])),/permission denied/);
    const request='44444444-4444-4444-8444-444444444444';
    const grant=()=>as(owner,'aal2',()=>q('select public.dt_admin_grant($1,null,$2,$3) as value',[member,'Test complimentary access',request]));
    const first=await grant(), again=await grant();
    assert.equal(again.rows[0].value.replayed,true);assert.equal(first.rows[0].value.grant_id,again.rows[0].value.grant_id);
    assert.equal((await q('select count(*)::int as n from public.access_grants')).rows[0].n,1);
    await assert.rejects(()=>as(owner,'aal2',()=>q('select public.dt_admin_grant(null,null,$1,$2)',['Test complimentary access',request])),/Request ID already used/);
    await assert.rejects(()=>as(owner,'aal2',()=>q('select public.dt_admin_grant($1,null,$2,$3)',[owner,'Test complimentary access',request])),/Request ID already used/);
    assert.equal((await as(member,'aal1',()=>q('select user_id from public.access_grants'))).rows.length,1);
    assert.equal((await as(stranger,'aal2',()=>q('select user_id from public.access_grants'))).rows.length,0);
    await assert.rejects(()=>as(member,'aal2',()=>q('select reason from public.access_grants')),/permission denied/);
    await assert.rejects(()=>as(member,'aal2',()=>q('select * from public.membership_audit')),/permission denied/);
    const compList=await as(owner,'aal2',()=>q("select public.dt_admin_members('','complimentary',0) as value"));
    assert.equal(compList.rows[0].value[0].id,member);
    await q("insert into public.membership_subscriptions values($1,'premium','sub_fixture','active',now()+interval '30 days',true,now())",[member]);
    const revokeRequest='55555555-5555-4555-8555-555555555555';
    const revoke=()=>as(owner,'aal2',()=>q('select public.dt_admin_revoke($1,$2,$3) as value',[first.rows[0].value.grant_id,'End test access',revokeRequest]));
    await revoke();assert.equal((await revoke()).rows[0].value.replayed,true);
    await assert.rejects(()=>as(owner,'aal2',()=>q('select public.dt_admin_revoke(null,$1,$2)',['End test access',revokeRequest])),/Request ID already used/);
    const paid=await as(owner,'aal2',()=>q("select public.dt_admin_members('member@','paid',0) as value"));
    assert.equal(paid.rows[0].value[0].paid,true);assert.equal(paid.rows[0].value[0].complimentary,false);
    const history=await as(owner,'aal2',()=>q('select public.dt_admin_audit($1) as value',[member]));assert.equal(history.rows[0].value.length,2);
    await assert.rejects(()=>as(owner,'aal2',()=>q("select public.dt_admin_grant($1,now()-interval '1 day','bad expiry',gen_random_uuid())",[member])),/Expiry must be in the future/);
    await assert.rejects(()=>as(owner,'aal2',()=>q("select public.dt_admin_grant($1,null,'unverified',gen_random_uuid())",[stranger])),/Choose a verified account/);
    assert.equal((await q('select count(*)::int as n from public.membership_audit')).rows[0].n,2);
    await q('delete from public.membership_admins where user_id=$1',[owner]);
    await assert.rejects(()=>as(owner,'aal2',()=>q('select public.dt_admin_members()')),/Administrator verification required/);
  } finally {await db.close();}
});
