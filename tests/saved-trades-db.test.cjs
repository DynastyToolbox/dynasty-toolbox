'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('saved trade database isolates users, denies anonymous reads, validates assets and caps pins',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
  const {PGlite}=require(process.env.PGLITE_TEST_MODULE),db=new PGlite();
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  try{
    await db.exec("create role anon; create role authenticated; create schema auth; grant usage on schema auth to anon,authenticated; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;");
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/202609220001_saved_trades.sql'),'utf8'));
    await db.query('insert into auth.users values ($1),($2)',[a,b]);
    async function as(id,fn,role='authenticated'){
      await db.exec('begin; set local role '+role);await db.query("select set_config('request.jwt.sub',$1,true)",[id||'']);
      try{const result=await fn();await db.exec('commit');return result;}catch(e){await db.exec('rollback');throw e;}
    }
    const assets=JSON.stringify([{id:'player:1',name:'Player',position:'WR'}]);
    const insert=(owner,n,send=assets)=>db.query("insert into public.saved_trades(user_id,league_id,roster_id,partner_id,send,receive,fingerprint) values($1,'1318402338695708672','1','2',$2::jsonb,$3::jsonb,$4) returning id",[owner,send,assets,n.toString(16).padStart(64,'0')]);
    const first=await as(a,()=>insert(a,1)),id=first.rows[0].id;
    assert.equal((await as(b,()=>db.query('select * from public.saved_trades'))).rows.length,0);
    assert.equal((await as(b,()=>db.query('delete from public.saved_trades where id=$1 returning id',[id]))).rows.length,0);
    assert.equal((await as(a,()=>db.query('select * from public.saved_trades'))).rows.length,1);
    await assert.rejects(()=>as(null,()=>db.query('select * from public.saved_trades'),'anon'),/permission denied/);
    await assert.rejects(()=>as(b,()=>insert(a,2)),/Sign in|row-level security/);
    await assert.rejects(()=>as(a,()=>db.query("update public.saved_trades set user_id=$1",[b])),/permission denied/);
    await assert.rejects(()=>as(a,()=>insert(a,2,'[null]')),/check constraint/);
    await assert.rejects(()=>as(a,()=>insert(a,2,JSON.stringify([{id:'x',position:'WR'}]))),/check constraint/);
    await assert.rejects(()=>as(a,()=>insert(a,1)),/unique constraint/);
    for(let n=2;n<=50;n++)await as(a,()=>insert(a,n));
    await assert.rejects(()=>as(a,()=>insert(a,51)),/Unpin/);
    await as(a,()=>db.query('delete from public.saved_trades where id=$1',[id]));
    await as(a,()=>insert(a,51));
    assert.equal((await as(a,()=>db.query('select * from public.saved_trades'))).rows.length,50);
  }finally{await db.close();}
});
