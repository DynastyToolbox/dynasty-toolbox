'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('billing database denies clients, enforces leases, rate limits, environment binding and atomic deduplication',
 {skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const {PGlite}=require(process.env.PGLITE_TEST_MODULE),db=new PGlite();
 const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
  for(const file of ['202609110001_subscription_access.sql','202610160001_billing_sandbox.sql'])
   await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
  await db.query('insert into auth.users values($1,now()),($2,now())',[user,other]);
  async function as(role,sql,args=[]){await db.exec('begin;set local role '+role);try{const r=await db.query(sql,args);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
  const lock=(id=user,project='phkbpputgegvesmpscrx')=>as('service_role','select public.dt_billing_lock($1,$2,$3,true) as value',[id,project,'acct_1UQuk03u6z47lQ6H']);
  for(const role of ['anon','authenticated']){
   await assert.rejects(()=>as(role,'select * from public.billing_accounts'),/permission denied/);
   await assert.rejects(()=>as(role,'select public.dt_billing_lock($1,$2,$3,true)',[user,'phkbpputgegvesmpscrx','acct_1UQuk03u6z47lQ6H']),/permission denied/);
   await assert.rejects(()=>as(role,'select public.dt_billing_commit($1,$1,null,null)',[user]),/permission denied/);
  }
  await assert.rejects(()=>lock(user,'hbovzwgpheiuuqdbzcnr'),/environment mismatch/);
  const row=(await lock()).rows[0].value;assert.equal((await lock()).rows[0].value.busy,true);
  const save=(id,token,customer)=>as('service_role','select public.dt_billing_save($1,$2,$3,null,null,null,null)',[id,token,customer]);
  await assert.rejects(()=>save(other,row.lease_token,'cus_fixture'),/lock expired/);
  await save(user,row.lease_token,'cus_fixture');
  await assert.rejects(()=>save(user,row.lease_token,'cus_other'),/cannot be reassigned/);
  const sub={id:'sub_fixture',customer:'cus_fixture',livemode:false,status:'active',paid_through:'2026-11-01T00:00:00Z'};
  const commit=(event,snapshot)=>as('service_role','select public.dt_billing_commit($1,$2,$3,$4)',[user,row.lease_token,event,JSON.stringify(snapshot)]);
  await assert.rejects(()=>commit('evt_bad',{...sub,status:'invalid'}));
  assert.equal((await db.query('select * from billing_events')).rows.length,0);
  await commit('evt_valid',sub);await commit('evt_valid',{...sub,paid_through:'2099-01-01T00:00:00Z'});
  assert.equal((await db.query("select paid_through='2026-11-01T00:00:00Z'::timestamptz as unchanged from membership_subscriptions")).rows[0].unchanged,true);
  await assert.rejects(()=>commit('evt_wrong',{...sub,customer:'cus_other'}),/Invalid billing snapshot/);
  await db.exec("update billing_accounts set lease_until=now()-interval '1 second'");
  await assert.rejects(()=>commit('evt_expired',sub),/lock expired/);
  const newer=(await lock()).rows[0].value;
  await as('service_role','select public.dt_billing_unlock($1,$2)',[user,row.lease_token]);
  assert.equal((await lock()).rows[0].value.busy,true); // old worker cannot release new lease
  await as('service_role','select public.dt_billing_unlock($1,$2)',[user,newer.lease_token]);
  await db.exec('update billing_accounts set requests=12');assert.equal((await lock()).rows[0].value.limited,true);
 }finally{await db.close();}
});
