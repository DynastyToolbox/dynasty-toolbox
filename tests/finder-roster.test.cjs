'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {profile,rosterSafe,equivalentSwap,requirements}=require('../lib/finder-roster.cjs');
const fmt={ppr:'hppr',superflex:true,tePremium:false};
const asset=(id,position,value)=>({id,position,scores:Object.fromEntries(['overall','competing','tanking'].map(m=>[m,{value,position,ranked:true}]))});
const slots=['QB','RB','RB','WR','WR','TE','FLEX','FLEX','FLEX','SUPER_FLEX'];
const league=assets=>({roster_positions:slots,teams:[{roster_id:'1',name:'Test',assets}]});
test('Sleeper starter slots define need, neutral and depth, with usable-player cutoffs',()=>{
 const assets=[...Array.from({length:3},(_,i)=>asset('q'+i,'QB',6000)),asset('backup','QB',4999),...Array.from({length:4},(_,i)=>asset('r'+i,'RB',4000)),...Array.from({length:5},(_,i)=>asset('w'+i,'WR',4000)),asset('t','TE',3000)];
 const p=profile(league(assets),'1','overall',fmt);
 assert.deepEqual(p.needs,[]);assert.deepEqual(p.surplus,['QB','WR']);assert.equal(p.counts.QB,3);assert.equal(p.requirements.demand.RB,3.5);
 assert.equal(rosterSafe(p,assets.slice(0,2),[asset('newTE','TE',8000),asset('newWR','WR',8000)],'overall',fmt),false);
 assert.equal(rosterSafe(p,assets.slice(0,1),[asset('newTE','TE',6000)],'overall',fmt),true);
 assert.equal(rosterSafe(p,assets.slice(0,2),[asset('replacement','QB',6000)],'overall',fmt),true);
 const oneQB=profile(league(assets),'1','overall',{...fmt,superflex:false});assert.equal(oneQB.requirements.demand.QB,1);assert.equal(oneQB.requirements.demand.RB,4);
 assert.equal(rosterSafe(oneQB,assets.slice(0,2),[], 'overall',{...fmt,superflex:false}),true);
});
test('existing shortages cannot worsen and flex coverage cannot be double counted',()=>{
 const assets=[...Array.from({length:3},(_,i)=>asset('r'+i,'RB',4000)),...Array.from({length:4},(_,i)=>asset('w'+i,'WR',4000))];
 const p=profile(league(assets),'1','overall',fmt);
 assert.equal(rosterSafe(p,[assets[3]],[asset('t','TE',9000)],'overall',fmt),false,'six RB/WR cannot fill seven slots');
 assert.equal(rosterSafe(p,[assets[0]],[asset('w','WR',9000)],'overall',fmt),false,'RB need introduced');
 const poor=profile(league([assets[0]]),'1','overall',fmt);assert.equal(rosterSafe(poor,[assets[0]],[],'overall',fmt),false);
 assert.equal(profile({...league([]),roster_positions:['QB','TE','TE']},'1','overall',fmt).requirements.demand.TE,2);
 assert.equal(requirements({roster_positions:[]},fmt).fallback,true);
});
test('equivalent pick swaps with a throw-in are removed without removing real packages',()=>{
 const a=asset('pick:2027:1:1','PICK',5000),b=asset('pick:2027:1:2','PICK',5000),p=asset('player:x','RB',100);
 assert.equal(equivalentSwap([a],[b,p]),true);assert.equal(equivalentSwap([a,p],[b]),true);
 assert.equal(equivalentSwap([a,asset('player:y','WR',3000)],[b,asset('player:z','RB',3000)]),false);
 assert.equal(equivalentSwap([a],[{...b,id:'pick:2028:1:2'},p]),false);
});
