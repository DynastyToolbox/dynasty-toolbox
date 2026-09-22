'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {preferenceAction,validate}=require('../lib/finder-preferences.cjs');
const prefs=[{roster_id:'1',mode:'competing',pickWeight:'low'}],user={id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:'yes'},access={premium:true,features:{tradeFinderTargets:true}};
test('preference API uses verified identity and returns the saved league settings',async()=>{
 const calls=[],q={then:resolve=>Promise.resolve({data:{preferences:prefs},error:null}).then(resolve)};
 for(const key of ['select','eq','maybeSingle','upsert'])q[key]=(...args)=>{calls.push([key,...args]);return q;};
 const db={from:name=>{assert.equal(name,'finder_preferences');return q;}};
 const body={league_id:'1318402338695708672',preferences:prefs,user_id:'forged'};
 await preferenceAction('finder-save-preferences',body,user,db,access);
 assert.equal(calls.find(c=>c[0]==='upsert')[1].user_id,user.id);
 assert.deepEqual((await preferenceAction('finder-preferences',body,user,db,access)).preferences,prefs);
 assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='user_id'&&c[2]===user.id));
 await assert.rejects(()=>preferenceAction('finder-save-preferences',body,null,db,access),{status:401});
 await assert.rejects(()=>preferenceAction('finder-save-preferences',body,user,db,{premium:false}),{status:403});
 assert.throws(()=>validate([...prefs,...prefs]),{status:400});assert.throws(()=>validate([{...prefs[0],pickWeight:'huge'}]),{status:400});
});
test('saved preferences isolate accounts and leagues, allow updates, deny anonymous access',{skip:!process.env.PGLITE_TEST_MODULE},async()=>{
 const {PGlite}=require(process.env.PGLITE_TEST_MODULE),db=new PGlite(),a=user.id,b='22222222-2222-4222-8222-222222222222';
 try{
 await db.exec("create role anon; create role authenticated; create schema auth; grant usage on schema auth to anon,authenticated; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;");
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/202609220002_finder_preferences.sql'),'utf8'));await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/202609220003_pick_preference_slider.sql'),'utf8'));await db.query('insert into auth.users values($1),($2)',[a,b]);
 async function as(id,fn,role='authenticated'){await db.exec('begin; set local role '+role);await db.query("select set_config('request.jwt.sub',$1,true)",[id||'']);try{const r=await fn();await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 const save=(owner,id,data=prefs)=>db.query('insert into finder_preferences values($1,$2,$3::jsonb) on conflict(user_id,league_id) do update set preferences=excluded.preferences',[owner,id,JSON.stringify(data)]);
 await as(a,()=>save(a,'123456789'));await as(a,()=>save(a,'987654321',[]));
 await as(a,()=>save(a,'123456789',[{...prefs[0],pickWeight:'high'}]));
 assert.equal((await as(a,()=>db.query("select preferences from finder_preferences where league_id='123456789'"))).rows[0].preferences[0].pickWeight,'high');
 await as(a,()=>save(a,'123456789',[{...prefs[0],pickWeight:-7}]));
 assert.equal((await as(a,()=>db.query("select preferences from finder_preferences where league_id='123456789'"))).rows[0].preferences[0].pickWeight,-7);
 for(const bad of [21,-21,1.5,'7',null,undefined])await assert.rejects(()=>as(a,()=>save(a,'123456789',[{...prefs[0],pickWeight:bad}])),/check constraint/);
 assert.equal((await as(b,()=>db.query('select * from finder_preferences'))).rows.length,0);
 assert.equal((await as(b,()=>db.query("update finder_preferences set preferences='[]' returning *"))).rows.length,0);
 await assert.rejects(()=>as(b,()=>save(a,'123456789')),/row-level security/);
 await assert.rejects(()=>as(a,()=>db.query('update finder_preferences set user_id=$1',[b])),/row-level security/);
 await assert.rejects(()=>as(null,()=>db.query('select * from finder_preferences'),'anon'),/permission denied/);
 await assert.rejects(()=>as(a,()=>save(a,'123456789',[...prefs,...prefs])),/check constraint/);
 }finally{await db.close();}
});
