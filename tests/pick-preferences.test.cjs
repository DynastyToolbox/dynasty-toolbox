'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Pick=require('../pick_preferences.js');
const {preferenceValue}=require('../lib/trade-calculator.cjs');
test('slider boundaries, labels and legacy saved preferences remain consistent',()=>{
 for(const [n,label] of [[-20,'low'],[-6,'low'],[-5,'slightly low'],[-1,'slightly low'],[0,'neutral'],[1,'slightly high'],[5,'slightly high'],[6,'high'],[20,'high']]){assert.equal(Pick.valid(n),true);assert.equal(Pick.label(n),label);}
 for(const n of [-21,21,1.5,NaN,Infinity,'5',null,undefined])assert.equal(Pick.valid(n),false);
 assert.equal(Pick.percent('low'),-20);assert.equal(Pick.percent('neutral'),0);assert.equal(Pick.percent('high'),20);
 const pick={position:'PICK',scores:{overall:{value:4000,position:'PICK'}}},format={ppr:'hppr',superflex:true,tePremium:false};
 assert.ok(Math.abs(preferenceValue(pick,'overall',format,-7)-3720)<1e-8);
 assert.equal(preferenceValue(pick,'overall',format,3),4120);
 assert.equal(preferenceValue({...pick,position:'WR'},'overall',format,-7),4000);
});
