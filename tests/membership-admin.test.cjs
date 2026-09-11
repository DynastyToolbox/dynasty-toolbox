'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {adminAction}=require('../lib/membership-admin.cjs');
const {createHandler}=require('../lib/account-server.cjs');
const id='11111111-1111-4111-8111-111111111111';
const session={access_token:'private-access',refresh_token:'private-refresh'};
function fixture({admin=true,mfa=true,statusError=null,resultError=null,verifyError=null,factors=[]}={}){
  const calls=[],saved=[];
  const db={rpc:async(name,args)=>{calls.push({name,args});return name==='dt_admin_status'?{data:{admin,mfa},error:statusError}:{data:name==='dt_admin_members'?Array.from({length:51},(_,i)=>({id:i})):[],error:resultError};},
    auth:{setSession:async()=>({data:{session}}),mfa:{listFactors:async()=>({data:{totp:factors.filter(f=>f.status==='verified'),all:factors}}),
      enroll:async()=>{calls.push({name:'enroll'});return {data:{id,totp:{qr_code:'data:image/svg+xml;utf-8,<svg/>'}}};},
      unenroll:async args=>{calls.push({name:'unenroll',args});return {};},
      challenge:async args=>{calls.push({name:'challenge',args});return {data:{id:'challenge'}};},
      verify:async args=>{calls.push({name:'verify',args});return {data:session,error:verifyError};}}}};
  return {calls,saved,run:(action,body={})=>adminAction(action,body,db,session,s=>saved.push(s))};
}
test('non-owners and unverified owner sessions cannot read or change memberships',async()=>{
  for(const action of ['admin-status','admin-members','admin-grant','admin-revoke','admin-audit','admin-mfa-enroll']){
    const f=fixture({admin:false});assert.equal((await f.run(action,{role:'admin'}))[0],403);assert.equal(f.calls.length,1);
  }
  for(const action of ['admin-members','admin-grant','admin-revoke','admin-audit'])assert.equal((await fixture({mfa:false}).run(action))[0],403);
});
test('member directory uses validated filters, bounded pagination and no caller-selected actor',async()=>{
  const f=fixture();const [status,result]=await f.run('admin-members',{query:' owner ',filter:'paid',offset:50,actorId:'fake'});
  assert.equal(status,200);assert.equal(result.members.length,50);assert.equal(result.hasMore,true);
  assert.deepEqual(f.calls[1].args,{p_query:'owner',p_filter:'paid',p_offset:50});
  for(const body of [{filter:'admin'},{offset:-1},{offset:1.2},{query:[]}])assert.equal((await f.run('admin-members',body))[0],400);
});
test('grant and revoke validate IDs, expiry and reason and leave billing changes to billing handlers',async()=>{
  const f=fixture();assert.equal((await f.run('admin-grant',{userId:id,expiresAt:null,reason:'Owner comp',requestId:id,paid:true,actorId:'fake'}))[0],200);
  assert.deepEqual(f.calls[1],{name:'dt_admin_grant',args:{p_reason:'Owner comp',p_request_id:id,p_user_id:id,p_expires_at:null}});
  for(const body of [{userId:'bad',expiresAt:null,reason:'a',requestId:id},{userId:id,expiresAt:'bad',reason:'a',requestId:id},{userId:id,expiresAt:null,reason:'',requestId:id}])assert.equal((await f.run('admin-grant',body))[0],400);
  assert.equal((await f.run('admin-revoke',{grantId:id,reason:'End comp',requestId:id}))[0],200);
  assert.equal(f.calls.at(-1).name,'dt_admin_revoke');
});
test('provider and SQL errors stay private and authorization failures stay forbidden',async()=>{
  for(const [code,expected] of [['42501',403],['22023',400],['XX000',503]]){
    const [status,body]=await fixture({resultError:{code,message:'private database detail'}}).run('admin-members');
    assert.equal(status,expected);assert.ok(!JSON.stringify(body).includes('private database detail'));
  }
  assert.equal((await fixture({statusError:{code:'unavailable'}}).run('admin-members'))[0],503);
});
test('authenticator verification accepts only owned TOTP factors and keeps tokens in cookies',async()=>{
  const factors=[{id,factor_type:'totp',status:'verified',friendly_name:'Owner'}];
  const f=fixture({mfa:false,factors});
  assert.equal((await f.run('admin-mfa-verify',{factorId:id,code:'123'}))[0],400);
  assert.equal((await f.run('admin-mfa-verify',{factorId:'22222222-2222-4222-8222-222222222222',code:'123456'}))[0],400);
  const [status,result]=await f.run('admin-mfa-verify',{factorId:id,code:'123456'});
  assert.equal(status,200);assert.ok(!JSON.stringify(result).includes('private-'));assert.equal(f.saved.at(-1).access_token,'private-access');
  assert.equal(f.calls.at(-1).name,'verify');
  assert.equal((await fixture({factors,verifyError:{status:400}}).run('admin-mfa-verify',{factorId:id,code:'123456'}))[0],400);
});
test('enrollment preserves verified and unrelated factors',async()=>{
  const verified=fixture({factors:[{id,factor_type:'totp',status:'verified'}]});assert.equal((await verified.run('admin-mfa-enroll'))[0],409);assert.ok(!verified.calls.some(c=>c.name==='unenroll'));
  const f=fixture({factors:[{id,factor_type:'totp',status:'unverified',friendly_name:'Dynasty Toolbox owner'},{id:'another',factor_type:'totp',status:'unverified',friendly_name:'Other app'}]});
  assert.equal((await f.run('admin-mfa-enroll'))[0],200);assert.deepEqual(f.calls.filter(c=>c.name==='unenroll').map(c=>c.args.factorId),[id]);
});
test('HTTP admin actions require explicit enablement, same-origin JSON and a verified session',async()=>{
  async function run(env,headers={},body={action:'admin-members'}){
    let called=false;const result={};
    const handler=createHandler(()=>{called=true;return {auth:{getUser:async()=>({error:{status:401}})}};},env);
    const res={setHeader(){},end(value){result.status=this.statusCode;result.body=JSON.parse(value);}};
    await handler({method:'POST',headers:{origin:'http://127.0.0.1:8770','content-type':'application/json',...headers},body},res);
    return {...result,called};
  }
  assert.equal((await run({})).status,503);
  const evil=await run({MEMBERSHIP_ADMIN_ENABLED:'true'},{origin:'https://evil.example'});assert.equal(evil.status,403);assert.equal(evil.called,false);
  assert.equal((await run({MEMBERSHIP_ADMIN_ENABLED:'true'})).status,401);
  assert.equal((await run({MEMBERSHIP_ADMIN_ENABLED:'true'},{cookie:'dt-dev-access=forged'})).status,401);
});
