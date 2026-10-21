'use strict';
const {randomUUID}=require('node:crypto');
const {sandboxConfig,checkoutParameters,portalParameters}=require('./billing-sandbox.cjs');
const {checkBillingRecords}=require('./billing-check.cjs');
const API_VERSION='2024-10-28.acacia';
const ACTIONS=new Set(['billing-status','billing-checkout','billing-portal','billing-refresh']);
const EVENTS=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded',
  'invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.voided',
  'customer.subscription.created','customer.subscription.updated','customer.subscription.deleted',
  'charge.refunded','charge.dispute.created','charge.dispute.closed','credit_note.created','credit_note.updated','credit_note.voided']);
const fail=(message,status=503)=>{throw Object.assign(new Error(message),{status,billingSafe:true});};
const id=value=>typeof value==='string'?value:value?.id;
function checkedURL(value,host){
  let url;try{url=new URL(value);}catch{fail('Test billing returned an invalid address.');}
  if(url.protocol!=='https:' || url.hostname!==host || url.username || url.password || url.port)
    fail('Test billing returned an invalid address.');
  return url.href;
}
async function listAll(resource,params){
  const result=[];let after;
  for(let page=0;page<10;page++){
    const batch=await resource.list({...params,limit:100,...(after?{starting_after:after}:{})});
    if(!Array.isArray(batch.data))fail('Test billing could not be checked.');
    result.push(...batch.data);
    if(!batch.has_more)return result;
    if(!batch.data.length)break;
    after=batch.data.at(-1).id;
  }
  fail('This test billing account needs a manual review.');
}

// Pin the API version: invoice.subscription, invoice.charge and line.price belong
// to this version. Webhook payloads are routing hints only; always read fresh state.
function paidCoverage(invoice,charge,subscription,price,now){
  if(invoice.livemode!==false || invoice.status!=='paid' || invoice.paid!==true ||
    invoice.paid_out_of_band!==false || invoice.currency!=='usd' || invoice.amount_remaining!==0 ||
    id(invoice.customer)!==id(subscription.customer) || id(invoice.subscription)!==subscription.id ||
    invoice.amount_paid<price.unit_amount || invoice.post_payment_credit_notes_amount>0 ||
    invoice.pre_payment_credit_notes_amount>0 || !['subscription_create','subscription_cycle'].includes(invoice.billing_reason) ||
    invoice.lines?.has_more!==false || invoice.lines?.data?.length!==1)return null;
  const line=invoice.lines.data[0];
  if(id(line.price)!==price.id || id(line.subscription)!==subscription.id || line.type!=='subscription' ||
    line.quantity!==1 || line.proration!==false || line.amount!==price.unit_amount ||
    !Number.isSafeInteger(line.period?.start) || !Number.isSafeInteger(line.period?.end) ||
    line.period.start>now || line.period.end<=now || line.period.end<=line.period.start)return null;
  if(!charge || charge.id!==id(invoice.charge) || charge.livemode!==false || charge.paid!==true ||
    charge.status!=='succeeded' || charge.captured!==true || charge.currency!=='usd' ||
    id(charge.customer)!==id(subscription.customer) || id(charge.invoice)!==invoice.id ||
    charge.amount<invoice.amount_paid || charge.amount_refunded!==0 || charge.disputed!==false)return null;
  return new Date(line.period.end*1000).toISOString();
}

function createBillingService({env,stripe,db,now=()=>Date.now()}){
  const config=sandboxConfig(env);
  const account=env.STRIPE_TEST_ACCOUNT_ID;
  if(!/^acct_[A-Za-z0-9]+$/.test(account||''))fail('Test billing account configuration is incomplete.');
  const rpc=async(name,args)=>{const r=await db.rpc(name,args);if(r.error)fail('Test billing storage is unavailable. Please try again.');return r.data;};
  const bind=row=>({...row,project_ref:config.projectRef,livemode:false});
  const metadata={environment:'development',project_ref:config.projectRef};
  async function verifyAccount(){if((await stripe.accounts.retrieve()).id!==account)fail('Test billing account configuration does not match.');}
  async function lock(userId,interactive,fn){
    const row=await rpc('dt_billing_lock',{p_user:userId,p_project:config.projectRef,p_account:account,p_interactive:interactive});
    if(row?.limited)fail('Please wait a minute before trying billing again.',429);
    if(row?.busy)fail('Billing is updating. Please try again shortly.',409);
    if(!row?.lease_token || row.user_id!==userId)fail('Test billing storage is unavailable.');
    try{return await fn(row);}finally{await rpc('dt_billing_unlock',{p_user:userId,p_token:row.lease_token});}
  }
  async function save(row){
    return rpc('dt_billing_save',{p_user:row.user_id,p_token:row.lease_token,p_customer:row.stripe_customer_id,
      p_checkout_request:row.checkout_request||null,p_checkout_started:row.checkout_started||null,
      p_checkout_plan:row.checkout_plan||null,p_checkout_session:row.checkout_session||null});
  }
  async function customer(row){
    if(!row.stripe_customer_id){
      // Stripe may prune idempotency keys after 24 hours. Never retry an uncertain
      // old customer creation blindly; the owner must reconcile it first.
      if(now()-Date.parse(row.customer_started)>23*3600000)fail('This test billing setup needs an owner review.');
      const created=await stripe.customers.create({metadata:{...metadata,user_id:row.user_id}},
        {idempotencyKey:`dt-customer-${config.projectRef}-${row.customer_request}`});
      if(created.livemode!==false || !/^cus_[A-Za-z0-9]+$/.test(created.id))fail('Test customer creation failed.');
      row.stripe_customer_id=created.id;await save(row);
    }
    const found=await stripe.customers.retrieve(row.stripe_customer_id);
    if(found.deleted || found.livemode!==false || found.metadata?.user_id!==row.user_id ||
      found.metadata?.project_ref!==config.projectRef || found.metadata?.environment!=='development')fail('Test customer ownership could not be verified.');
  }
  function ownsSubscription(sub,row){
    return sub.livemode===false && id(sub.customer)===row.stripe_customer_id &&
      sub.metadata?.user_id===row.user_id && sub.metadata?.project_ref===config.projectRef &&
      sub.metadata?.environment==='development';
  }
  async function subscriptions(row){
    return listAll(stripe.subscriptions,{customer:row.stripe_customer_id,status:'all'});
  }
  async function snapshot(row){
    const all=await subscriptions(row);
    const current=all.filter(sub=>!['canceled','incomplete_expired'].includes(sub.status));
    // Unexpected or multiple subscriptions must not silently select a winner.
    if(current.length>1 || current.some(sub=>!ownsSubscription(sub,row)))fail('This test subscription needs an owner review.');
    if(!current.length)return null;
    const sub=current[0];
    if(sub.items?.has_more || sub.items?.data?.length!==1)fail('This test subscription needs an owner review.');
    const item=sub.items.data[0], plan=Object.keys(config.plans).find(key=>config.plans[key].id===id(item.price));
    if(!plan || item.quantity!==1)fail('This test subscription needs an owner review.');
    const price=await stripe.prices.retrieve(config.plans[plan].id);
    checkoutParameters({env,user:{id:row.user_id,email_confirmed_at:true},binding:bind(row),input:{plan},price});
    let paidThrough=null;
    if(['active','past_due'].includes(sub.status)){
      const invoices=await listAll(stripe.invoices,{customer:row.stripe_customer_id,subscription:sub.id,status:'paid',
        created:{gte:Math.floor(now()/1000)-370*86400}});
      for(const invoice of invoices){
        if(!id(invoice.charge) || !invoice.lines?.data?.some(line=>line.period?.end>now()/1000))continue;
        const charge=await stripe.charges.retrieve(id(invoice.charge));
        const end=paidCoverage(invoice,charge,sub,price,Math.floor(now()/1000));
        if(end && (!paidThrough || end>paidThrough))paidThrough=end;
      }
    }
    return {id:sub.id,customer:row.stripe_customer_id,livemode:false,status:sub.status,
      paid_through:paidThrough,cancel_at_period_end:sub.cancel_at_period_end===true};
  }
  async function reconcile(row,event=null){
    const sub=await snapshot(row);
    await rpc('dt_billing_commit',{p_user:row.user_id,p_token:row.lease_token,p_event:event,p_subscription:sub});
    return sub;
  }
  async function action(action,input,user){
    if(!user?.email_confirmed_at || !/^[0-9a-f-]{36}$/i.test(user.id||''))fail('Sign in with a verified account.',401);
    const allowed=action==='billing-checkout'?['action','plan']:['action'];
    if(Object.keys(input).some(key=>!allowed.includes(key)))fail('Invalid billing request.',400);
    await verifyAccount();
    // Status never creates a customer or checkout. The development UI remains
    // unavailable until the owner has configured and verified the webhook.
    if(action==='billing-status')return {billing:{sandbox:true,ready:env.BILLING_WEBHOOK_READY==='true',plans:Object.keys(config.plans)}};
    if(env.BILLING_WEBHOOK_READY!=='true')fail('Test checkout is still being connected.');
    if(action==='billing-checkout' && !Object.hasOwn(config.plans,input.plan))fail('Choose an available test plan.',400);
    return lock(user.id,true,async row=>{
      await customer(row);
      if(action==='billing-portal'){
        if(!env.STRIPE_TEST_PORTAL_CONFIG_ID?.startsWith('bpc_'))fail('Test account management is still being configured.');
        const session=await stripe.billingPortal.sessions.create({...portalParameters({env,user,binding:bind(row)}),configuration:env.STRIPE_TEST_PORTAL_CONFIG_ID});
        return {url:checkedURL(session.url,'billing.stripe.com')};
      }
      if(action==='billing-refresh'){await reconcile(row);return {updated:true};}
      const all=await subscriptions(row);
      const current=all.filter(s=>!['canceled','incomplete_expired'].includes(s.status));
      // A declined first payment can leave an incomplete subscription while its
      // original Checkout remains open. Resume that saved session only; never
      // create a second subscription or allow another customer's session.
      const recoverIncomplete=current.length===1 && current[0].status==='incomplete' && ownsSubscription(current[0],row);
      if(current.length && !recoverIncomplete)fail('You already have a test subscription. Use Manage test subscription.',409);
      const price=await stripe.prices.retrieve(config.plans[input.plan].id);
      const params=checkoutParameters({env,user,binding:bind(row),input:{plan:input.plan},price});
      if(row.checkout_session){
        const session=await stripe.checkout.sessions.retrieve(row.checkout_session);
        if(session.livemode!==false || id(session.customer)!==row.stripe_customer_id)fail('Test checkout ownership could not be verified.');
        if(session.status==='open'){
          if(row.checkout_plan!==input.plan)fail('Finish or wait for your existing test checkout to expire before changing plans.',409);
          return {url:checkedURL(session.url,'checkout.stripe.com')};
        }
        if(current.length)fail('You already have a test subscription. Use Manage test subscription.',409);
        if(session.status==='complete'){
          // Recheck after observing completion to close the list/create race.
          if((await subscriptions(row)).some(s=>!['canceled','incomplete_expired'].includes(s.status)))fail('You already have a test subscription.',409);
        }else if(session.status!=='expired')fail('Test checkout is still updating.',409);
        row.checkout_request=null;row.checkout_session=null;
      }
      if(current.length)fail('You already have a test subscription. Use Manage test subscription.',409);
      if(!row.checkout_request){
        row.checkout_request=randomUUID();row.checkout_started=new Date(now()).toISOString();row.checkout_plan=input.plan;
        await save(row);
      }
      if(row.checkout_plan!==input.plan || now()-Date.parse(row.checkout_started)>23*3600000)
        fail('This test checkout needs an owner review before another is created.');
      const session=await stripe.checkout.sessions.create({...params,payment_method_types:['card'],
        allow_promotion_codes:false,automatic_tax:{enabled:false}},
        {idempotencyKey:`dt-checkout-${config.projectRef}-${row.checkout_request}`});
      if(session.livemode!==false || id(session.customer)!==row.stripe_customer_id || !/^cs_test_[A-Za-z0-9]+$/.test(session.id))fail('Test checkout could not be verified.');
      row.checkout_session=session.id;await save(row);
      return {url:checkedURL(session.url,'checkout.stripe.com')};
    });
  }
  async function event(event){
    if(event.livemode!==false || event.account || !/^evt_[A-Za-z0-9]+$/.test(event.id||''))fail('Invalid test event.',400);
    if(!EVENTS.has(event.type))return {ignored:true};
    await verifyAccount();
    const object=event.data?.object;
    let customerId=id(object?.customer);
    if(event.type.startsWith('charge.dispute.')){
      if(!/^ch_[A-Za-z0-9]+$/.test(id(object?.charge)||''))fail('Invalid dispute event.',400);
      customerId=id((await stripe.charges.retrieve(id(object.charge))).customer);
    }
    if(event.type.startsWith('credit_note.')){
      if(!/^in_[A-Za-z0-9]+$/.test(id(object?.invoice)||''))fail('Invalid credit event.',400);
      customerId=id((await stripe.invoices.retrieve(id(object.invoice))).customer);
    }
    if(!/^cus_[A-Za-z0-9]+$/.test(customerId||''))return {ignored:true};
    const result=await db.from('billing_accounts').select('user_id').eq('stripe_customer_id',customerId).maybeSingle();
    if(result.error)fail('Test billing storage is unavailable.');
    if(!result.data)return {ignored:true}; // Unrelated Stripe customers never map by email or metadata alone.
    await lock(result.data.user_id,false,async row=>{
      await customer(row);await reconcile(row,event.id);
    });
    return {received:true};
  }
  async function checkRecords(userId){
    await verifyAccount();
    return checkBillingRecords({userId,db,projectRef:config.projectRef,accountId:account,now,
      readStripe:async row=>{await customer(row);return snapshot(row);}});
  }
  return {action,event,checkRecords};
}
module.exports={API_VERSION,ACTIONS,EVENTS,createBillingService,paidCoverage,checkedURL};
