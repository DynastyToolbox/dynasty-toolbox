(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OutlookDraft=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function board(order,inventory,{type='linear'}={}){
    if(!inventory?.available)throw new Error(inventory?.reason||'Draft picks are unavailable.');
    if(!['linear','snake'].includes(type))throw new Error('Choose a supported draft format.');
    const ids=order.map(String),known=new Set(ids);
    if(ids.length<2||known.size!==ids.length)throw new Error('Each draft slot needs a different original team.');
    const picks=new Map();
    for(const p of inventory.picks){
      const key=p.round+':'+p.originalId;
      if(!known.has(p.originalId)||!known.has(p.ownerId)||picks.has(key)||!Number.isInteger(p.round)||p.round<1||p.round>inventory.rounds)throw new Error('Draft picks do not match this order.');
      picks.set(key,p);
    }
    if(picks.size!==ids.length*inventory.rounds)throw new Error('The draft pick inventory is incomplete.');
    return Array.from({length:inventory.rounds},(_,i)=>{
      const round=i+1,sequence=type==='snake'&&round%2===0?[...ids].reverse():ids;
      return sequence.map((id,index)=>({...picks.get(round+':'+id),slot:index+1,overall:i*ids.length+index+1,label:round+'.'+String(index+1).padStart(2,'0')}));
    });
  }
  return {board};
});
