'use strict';
const MAX_BODY=262144;
function createWebhookHandler(runtimeFactory,env){
  return async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');
    const reply=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(405,{error:'POST required.'});}
    let runtime;
    try{
      if(!env.STRIPE_TEST_WEBHOOK_SECRET?.startsWith('whsec_'))throw new Error();
      runtime=runtimeFactory(env);
    }catch{return reply(503,{error:'Test payment notifications are not configured.'});}
    let event;
    try{
      if(typeof req.headers['stripe-signature']!=='string' || req.headers['stripe-signature'].length>4096)throw new Error();
      if(Number(req.headers['content-length'])>MAX_BODY)return reply(413,{error:'Event too large.'});
      // Do not access req.body: verify the original bytes, never parsed/re-serialized JSON.
      const chunks=[];let size=0;
      for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>MAX_BODY)return reply(413,{error:'Event too large.'});chunks.push(bytes);}
      event=runtime.stripe.webhooks.constructEvent(Buffer.concat(chunks),req.headers['stripe-signature'],env.STRIPE_TEST_WEBHOOK_SECRET,300);
    }catch{return reply(400,{error:'Invalid payment notification.'});}
    try{return reply(200,await runtime.service.event(event));}
    catch(error){
      // No raw provider errors, event payloads or credentials in logs or responses.
      return reply(error.billingSafe && error.status===400?400:503,{error:'Test payment notification could not be processed. Retry later.'});
    }
  };
}
module.exports={createWebhookHandler};
