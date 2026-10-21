'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=()=>{throw new Error('Billing comparison unavailable');};
const inactive=new Set(['canceled','incomplete_expired']);
function summary(row,time){
  if(!row || inactive.has(row.status))return {status:'none',paidThrough:null,cancelAtPeriodEnd:false};
  const until=Date.parse(row.paid_through);
  return {status:row.status,paidThrough:['active','past_due'].includes(row.status) && until>time ? new Date(until).toISOString():null,
    cancelAtPeriodEnd:row.cancel_at_period_end===true};
}

// Called only after verified owner + MFA authorization. Every operation is a read;
// this deliberately has no repair, payment creation, or complimentary-grant access.
async function checkBillingRecords({userId,db,projectRef,accountId,readStripe,now=Date.now}){
  if(!UUID.test(userId||''))fail();
  const environment=await db.from('billing_environment').select('project_ref,stripe_account_id').eq('singleton',true).maybeSingle();
  if(environment.error || environment.data?.project_ref!==projectRef || environment.data?.stripe_account_id!==accountId)fail();
  const read=async()=>{
    const [binding,stored]=await Promise.all([
      db.from('billing_accounts').select('user_id,stripe_customer_id').eq('user_id',userId).maybeSingle(),
      db.from('membership_subscriptions').select('user_id,plan,stripe_subscription_id,status,paid_through,cancel_at_period_end,updated_at').eq('user_id',userId).maybeSingle(),
    ]);
    if(binding.error || stored.error || (binding.data && binding.data.user_id!==userId) || (stored.data && stored.data.user_id!==userId))fail();
    return {binding:binding.data,stored:stored.data};
  };
  const before=await read();
  let expected=null;
  if(before.binding?.stripe_customer_id){
    if(!/^cus_[A-Za-z0-9]+$/.test(before.binding.stripe_customer_id))fail();
    expected=await readStripe(before.binding);
  }
  const after=await read();
  if(JSON.stringify(before)!==JSON.stringify(after))return {state:'changed',checkedAt:new Date(now()).toISOString()};
  const time=now(),stripe=summary(expected,time),website=summary(before.stored,time);
  const differences=[];
  if(stripe.status!==website.status)differences.push('status');
  if(stripe.paidThrough!==website.paidThrough)differences.push('paidThrough');
  if(stripe.cancelAtPeriodEnd!==website.cancelAtPeriodEnd)differences.push('cancellation');
  if(expected && expected.id!==before.stored?.stripe_subscription_id)differences.push('subscription');
  if(website.paidThrough && before.stored?.plan!=='premium')differences.push('plan');
  return {state:differences.length?'mismatch':'matched',checkedAt:new Date(time).toISOString(),stripe,website,differences};
}
module.exports={checkBillingRecords};
