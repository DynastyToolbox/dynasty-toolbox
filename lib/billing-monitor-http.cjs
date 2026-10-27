'use strict';
const {createHash,timingSafeEqual,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {sandboxConfig}=require('./billing-sandbox.cjs');
const STATES=['matched','mismatch','payment_attention','retry','unavailable'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=value=>createHash('sha256').update(value).digest();
// A separate development credential permits counts only, never owner actions or writes.
function seal(value,key){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',digest('monitor-cursor:'+key),iv);
 return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}
function unseal(token,key,now){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{40,512}$/.test(token))throw new Error();
 const bytes=Buffer.from(token,'base64url'),decipher=createDecipheriv('aes-256-gcm',digest('monitor-cursor:'+key),bytes.subarray(0,12));
 decipher.setAuthTag(bytes.subarray(-16));
 const value=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString());
 if(!UUID.test(value.after)||!Number.isSafeInteger(value.until)||value.until<=now||value.until>now+600000)throw new Error();
 return value;
}
function createMonitorHandler(runtimeFactory,env,{now=Date.now}={}){
 return async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(405,{error:'POST required.'});}
  const key=env.BILLING_MONITOR_TOKEN;
  try{
   if(env.BILLING_MONITOR_ENABLED!=='true'||env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='feat/subscription-access-foundation'||
     typeof key!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(key))throw new Error();
   sandboxConfig(env);
  }catch{return reply(503,{error:'Development payment review is unavailable.'});}
  const authorization=req.headers?.authorization;
  if(typeof authorization!=='string'||authorization.length>140||!timingSafeEqual(digest(authorization),digest('Bearer '+key)))
   return reply(401,{error:'Payment review authentication required.'});
  if(req.headers.origin||req.headers['content-type']!=='application/json')return reply(400,{error:'Invalid review request.'});
  let continuation;
  try{
   if(Number(req.headers['content-length'])>1024)throw new Error();
   const chunks=[];let size=0;
   for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>1024)throw new Error();chunks.push(bytes);}
   const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!input||Array.isArray(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'cursor'))throw new Error();
   continuation=input.cursor===null?{after:null,until:now()+600000}:unseal(input.cursor,key,now());
  }catch{return reply(400,{error:'Invalid or expired review cursor. Start a new review.'});}
  try{
   const page=await runtimeFactory(env).service.monitor(continuation.after),record=page.record;
   if(page.next!==null&&(!record||page.next!==record.userId))throw new Error();
   if(record&&(!UUID.test(record.userId)||!STATES.includes(record.state)||(continuation.after&&record.userId<=continuation.after)))throw new Error();
   if(now()>=continuation.until)throw new Error();
   return reply(200,{version:1,environment:'development',checked:record?1:0,
    counts:Object.fromEntries(STATES.map(state=>[state,record?.state===state?1:0])),
    cursor:page.next===null?null:seal({after:page.next,until:continuation.until},key)});
  }catch{return reply(503,{error:'Development payment review could not finish.'});}
 };
}
module.exports={createMonitorHandler};
