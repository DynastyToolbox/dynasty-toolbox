'use strict';
// Safe for a protected scheduler: read-only checks, no customer email/payment URLs.
async function runMonitor(service,{maxAccounts=1000,deadlineMs=300000,now=Date.now}={}){
  const started=now(),report={startedAt:new Date(started).toISOString(),complete:false,checked:0,matched:0,issues:[]};
  let after=null;
  do{
    if(report.checked>=maxAccounts || now()-started>=deadlineMs)break;
    const page=await service.monitor(after);
    if(page.record){report.checked++;if(page.record.state==='matched')report.matched++;else report.issues.push(page.record);}
    if(page.next===null){report.complete=true;break;}
    if(!page.record || page.next!==page.record.userId || (after && page.next<=after))throw new Error('Review cursor did not advance');
    after=page.next;
  }while(true);
  report.finishedAt=new Date(now()).toISOString();
  return report;
}
async function main(){
  try{
    if(process.argv.length!==3 || process.argv[2]!=='--development')throw new Error();
    const {service}=require('../lib/billing-runtime.cjs').billingRuntime(process.env);
    const report=await runMonitor(service);
    console.log(JSON.stringify(report));
    process.exitCode=!report.complete?2:report.issues.length?1:0;
  }catch{console.error('Development payment review could not finish. Check private configuration and provider availability; no payments or access were changed.');process.exitCode=2;}
}
if(require.main===module)main();
module.exports={runMonitor};
