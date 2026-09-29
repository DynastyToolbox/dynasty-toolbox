'use strict';
const {SLOTS,starterSlots}=require('./outlook-foundation.cjs');
// Keep starter indices aligned before dropping K/DEF/IDP. Those positions may
// appear anywhere in the lineup, including between offensive slots.
function offensiveView(meta){
  return {...meta,roster_positions:(meta.roster_positions||[]).filter(slot=>SLOTS[slot]||['BN','IR','TAXI'].includes(slot))};
}
function offensiveMatchup(row,meta){
  if(!row)return row;
  const slots=starterSlots(meta).slots;
  if(slots.every(slot=>SLOTS[slot]))return row;
  if(!Array.isArray(row.starters)||row.starters.length!==slots.length)return {...row,starters:[],points:null};
  const starters=row.starters.filter((_,i)=>SLOTS[slots[i]]),values=starters.map(id=>row.players_points?.[id]);
  const complete=values.every(value=>typeof value==='number'&&Number.isFinite(value));
  return {...row,starters,points:complete?values.reduce((sum,n)=>sum+n,0):null};
}
module.exports={offensiveView,offensiveMatchup};
