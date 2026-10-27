'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Read-only keyset union: broken bindings must not hide stored subscriptions.
async function monitorBillingPage({db,checkRecords,after=null,now=Date.now}){
  if(after!==null && (typeof after!=='string'||!UUID.test(after)))throw new Error('Invalid review cursor');
  const batches=await Promise.all(['billing_accounts','membership_subscriptions'].map(async table=>{
    let query=db.from(table).select('user_id').order('user_id',{ascending:true}).limit(2);
    if(after)query=query.gt('user_id',after.toLowerCase());
    const result=await query;
    if(result.error || !Array.isArray(result.data) || result.data.some(row=>typeof row.user_id!=='string'||!UUID.test(row.user_id)))throw new Error('Payment review unavailable');
    return result.data.map(row=>row.user_id.toLowerCase());
  }));
  const ids=[...new Set(batches.flat())].sort(),userId=ids[0];
  if(!userId)return {checkedAt:new Date(now()).toISOString(),record:null,next:null};
  let record;
  try{
    const check=await checkRecords(userId);
    if(!['matched','mismatch','changed'].includes(check?.state))throw new Error();
    const state=check.state==='mismatch'?'mismatch':check.state==='changed'?'retry':
      ['past_due','unpaid','incomplete','paused'].includes(check.stripe?.status)?'payment_attention':'matched';
    record={userId,state,checkedAt:check.checkedAt};
  }catch{
    record={userId,state:'unavailable',checkedAt:new Date(now()).toISOString()};
  }
  return {checkedAt:new Date(now()).toISOString(),record,next:ids.length>1?userId:null};
}
module.exports={monitorBillingPage};
