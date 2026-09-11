'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHandler, validPassword} = require('../lib/account-server.cjs');
const user = {email:'owner@example.com',email_confirmed_at:'2026-09-10T00:00:00Z',id:'private-id'};
const session = {access_token:'private-access',refresh_token:'private-refresh',expires_at:Math.floor(Date.now()/1000)+3600};
function fixture(overrides={}) {
  const calls=[];
  const method=(name,result)=>async args=>{calls.push({name,args});return result;};
  const auth={
    signUp:method('signup',{data:{user},error:null}),
    signInWithPassword:method('signin',{data:{session,user},error:null}),
    verifyOtp:method('verify',{data:{session,user},error:null}),
    resetPasswordForEmail:method('forgot',{error:null}),
    resend:method('resend',{error:null}),
    updateUser:method('update',{data:{user},error:null}),
    signOut:method('revoke',{error:null}),
    getUser:method('user',{data:{user},error:null}),
    refreshSession:method('refresh',{data:{session,user},error:null}),
    admin:{signOut:method('signout',{error:null})}, ...overrides,
  };
  const handler=createHandler(()=>({auth}),{VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'preview.example.com'});
  return {calls, run:async (body, headers={},method='POST')=>{
    const out={headers:{}};
    const res={setHeader:(k,v)=>out.headers[k]=v,end:value=>{out.status=res.statusCode;out.body=JSON.parse(value);}};
    await handler({method,body,headers:{origin:'https://preview.example.com','content-type':'application/json',...headers}},res);
    return out;
  }};
}
test('rejects cross-site, missing origin, incorrect type, and GET requests before auth calls',async()=>{
  const f=fixture();
  assert.equal((await f.run({action:'session'},{origin:'https://evil.example.com'})).status,403);
  assert.equal((await f.run({action:'session'},{origin:undefined})).status,403);
  assert.equal((await f.run({action:'session'},{'content-type':'text/plain'})).status,415);
  assert.equal((await f.run({action:'session'},{},'GET')).status,405);
  assert.equal(f.calls.length,0);
});
test('production accounts stay disabled until deliberately enabled',async()=>{
  const handler=createHandler(()=>{throw new Error('must not run');},{VERCEL_ENV:'production'});
  let status;
  const res={setHeader(){},end(){status=this.statusCode;}};
  await handler({headers:{},method:'POST'},res);assert.equal(status,503);
});
test('rejects malformed bodies, oversized requests, unknown actions, bad email, short codes and weak passwords',async()=>{
  const f=fixture();
  for(const body of ['{',null,[],{action:'admin'}, {action:'signup',email:'bad',password:'long-enough-password'}, {action:'signup',email:user.email,password:'short'}, {action:'verify',email:user.email,code:'123456'}]) assert.equal((await f.run(body)).status,400);
  assert.equal((await f.run({action:'session'},{'content-length':'9000'})).status,413);
  assert.equal(f.calls.length,0);
});
test('password validation uses UTF-8 bytes and code points',()=>{
  assert.ok(validPassword('a'.repeat(12)));
  assert.ok(!validPassword('a'.repeat(11)));
  assert.ok(validPassword('😀'.repeat(12)));
  assert.ok(!validPassword('😀'.repeat(11)));
  assert.ok(validPassword('this is a long passphrase'));
  assert.ok(!validPassword('a'.repeat(73)));
  assert.ok(!validPassword('😀'.repeat(19)));
  assert.ok(!validPassword('😀'.repeat(8)));
});
test('sign-in returns only email and stores tokens in secure HttpOnly host cookies',async()=>{
  const r=await fixture().run({action:'signin',email:' OWNER@example.com ',password:'long-enough-password'});
  assert.equal(r.status,200); assert.deepEqual(r.body,{user:{email:user.email}});
  assert.ok(r.headers['Set-Cookie'].every(c=>c.startsWith('__Host-dt-')&&c.includes('HttpOnly')&&c.includes('Secure')&&c.includes('SameSite=Strict')&&c.includes('Path=/')));
  assert.match(r.headers['Cache-Control'],/no-store/);
  assert.ok(!JSON.stringify(r.body).includes('private-'));
});
test('verification checks email OTP with provider and returns no code or token',async()=>{
  const f=fixture();const r=await f.run({action:'verify',email:user.email,code:'12345678',role:'admin'});
  assert.equal(r.status,200);assert.deepEqual(f.calls[0].args,{email:user.email,token:'12345678',type:'email'});
  assert.deepEqual(r.body,{user:{email:user.email}});
});
test('reset verifies a recovery code, changes password, revokes sessions and clears browser cookies',async()=>{
  const f=fixture();const r=await f.run({action:'reset',email:user.email,code:'12345678',password:'different-long-password'});
  assert.deepEqual(f.calls.map(c=>c.name),['verify','update','revoke']);
  assert.equal(f.calls[0].args.type,'recovery');assert.deepEqual(f.calls[2].args,{scope:'global'});
  assert.equal(r.status,200);assert.ok(r.headers['Set-Cookie'].every(c=>c.includes('Max-Age=0')));
  assert.ok(!JSON.stringify(r.body).includes('private-'));
});
test('invalid recovery code cannot update a password or set cookies',async()=>{
  const f=fixture({verifyOtp:async()=>({error:{status:400},data:{}})});const r=await f.run({action:'reset',email:user.email,code:'12345678',password:'different-long-password'});
  assert.equal(r.status,400);assert.equal(f.calls.length,0);assert.equal(r.headers['Set-Cookie'],undefined);
});
test('expired access refreshes with the provider and replaces both cookies',async()=>{
  const f=fixture({getUser:async()=>({error:{status:401}})});
  const r=await f.run({action:'session'},{cookie:'__Host-dt-access=old; __Host-dt-refresh=refresh-value'});
  assert.equal(r.body.user.email,user.email);assert.equal(f.calls[0].name,'refresh');assert.equal(f.calls[0].args.refresh_token,'refresh-value');
  assert.equal(r.headers['Set-Cookie'].length,2);
});
test('unauthenticated and forged/revoked sessions cannot return private account information',async()=>{
  const f=fixture({getUser:async()=>({error:{status:401}}),refreshSession:async()=>({error:{status:401}})});
  for(const cookie of ['', '__Host-dt-access=forged; __Host-dt-refresh=revoked']) {
    const r=await f.run({action:'session'},{cookie});assert.deepEqual(r.body,{user:null});assert.ok(r.headers['Set-Cookie'].every(c=>c.includes('Max-Age=0')));
  }
});
test('forgot-password and duplicate signup do not identify existing accounts',async()=>{
  const f=fixture({signUp:async()=>({error:{code:'user_already_exists'}})});
  assert.equal((await f.run({action:'signup',email:user.email,password:'long-enough-password'})).status,200);
  assert.match((await f.run({action:'forgot',email:user.email})).body.message,/If an account exists/);
});
test('upstream details, passwords and stack traces are never exposed',async()=>{
  const f=fixture({signInWithPassword:async()=>{throw new Error('private-token database SQL secrets');}});
  const r=await f.run({action:'signin',email:user.email,password:'long-enough-password'});
  assert.equal(r.status,503);assert.ok(!JSON.stringify(r.body).includes('private-token'));
});
test('rate-limited authentication reports retry guidance',async()=>{
  const f=fixture({signUp:async()=>({error:{status:429}})});
  assert.equal((await f.run({action:'signup',email:user.email,password:'long-enough-password'})).status,429);
});
test('signout clears browser cookies even with no active session',async()=>{
  const r=await fixture().run({action:'signout'});assert.equal(r.status,200);assert.ok(r.headers['Set-Cookie'].every(c=>c.includes('Max-Age=0')));
});
test('verification transport failures are not misreported as expired codes',async()=>{
  for(const error of [{status:0,name:'AuthRetryableFetchError'}, {status:503,code:'unexpected_failure'}]) {
    const f=fixture({verifyOtp:async()=>({error,data:{}})});
    const r=await f.run({action:'reset',email:user.email,code:'12345678',password:'different-long-password'});
    assert.equal(r.status,503);assert.match(r.body.error,/could not reach account verification/);
    assert.equal(f.calls.length,0);
  }
});
test('same-password failure is distinguished from an invalid code and revokes only recovery session',async()=>{
  const f=fixture({updateUser:async()=>({error:{status:422,code:'same_password'}})});
  const r=await f.run({action:'reset',email:user.email,code:'12345678',password:'different-long-password'});
  assert.match(r.body.error,/different from the current/);
  assert.deepEqual(f.calls.find(c=>c.name==='revoke').args,{scope:'local'});
});
test('resend requests signup verification and keeps account existence private',async()=>{
  const f=fixture();const r=await f.run({action:'resend',email:user.email});
  assert.deepEqual(f.calls[0].args,{type:'signup',email:user.email});assert.equal(r.status,200);
  const missing=fixture({resend:async()=>({error:{status:400,code:'user_not_found'}})});
  assert.deepEqual((await missing.run({action:'resend',email:user.email})).body,r.body);
});
test('every saved-league endpoint requires a verified session before accessing data',async()=>{
  for (const action of ['leagues','league-lookup','league-add','league-update','league-remove']) {
    const f=fixture(); const result=await f.run({action,league_id:'1318402338695708672',roster_id:null});
    assert.equal(result.status,401); assert.equal(f.calls.length,0);
  }
});
