'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('account changes discard a pending paid response and clear already displayed content',async()=>{
 const elements=Object.fromEntries(['gate','protected','gateMessage','gateError','premiumRetry'].map(id=>[id,{style:{},addEventListener(){}}]));
 const events={},requests=[];let clears=0,loads=0;
 const context={document:{getElementById:id=>elements[id]},window:{addEventListener:(name,fn)=>events[name]=fn},DynastyAccount:{request:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../premium-page.js'),'utf8'),context);
 const controller=context.window.DynastyPremiumPage.start({feature:'medianRankings',clear:()=>clears++,load:async()=>loads++});
 const first=requests.shift();const secondRun=events['dynasty-account-change']();
 requests.shift().resolve({access:{premium:false}});await secondRun;
 first.resolve({access:{premium:true,features:{medianRankings:true}}});await new Promise(setImmediate);
 assert.equal(loads,0);assert.equal(controller.allowed,false);assert.equal(elements.protected.style.display,'none');
 const paidRun=controller.refresh();requests.shift().resolve({access:{premium:true,features:{medianRankings:true}}});await paidRun;
 assert.equal(controller.allowed,true);assert.equal(loads,1);
 const failedRun=events.focus();assert.equal(controller.allowed,false);assert.equal(elements.protected.style.display,'none');
 requests.shift().reject(Error('Service unavailable'));await failedRun;
 assert.equal(controller.allowed,false);assert.equal(elements.gate.hidden,false);assert.ok(clears>=4);
});
