'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {value}=require('../trade-roster-picker.js'),{preferenceValue}=require('../lib/trade-calculator.cjs');
test('roster picker values agree with authoritative trade values across scoring and team preferences',()=>{
  for(const position of ['QB','RB','WR','TE','PICK']){
    const asset={position,scores:Object.fromEntries(['overall','competing','tanking'].map((mode,i)=>[mode,{value:5000+i*731.3,position,ranked:true}]))};
    for(const mode of ['overall','competing','tanking'])for(const ppr of ['std','hppr','ppr'])for(const superflex of [true,false])for(const tePremium of [true,false])for(const weight of ['low','neutral','high',-5,7]){
      const format={ppr,superflex,tePremium};assert.equal(value(asset,mode,format,weight),preferenceValue(asset,mode,format,weight));
    }
  }
});
