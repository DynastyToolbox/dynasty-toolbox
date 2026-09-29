'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {draftInventory}=require('../lib/outlook-draft.cjs');
const {board}=require('../outlook-draft.js');
function fixture(){return {meta:{season:'2026',status:'in_season',settings:{type:2,draft_rounds:3}},rosters:[1,2,3,4].map(roster_id=>({roster_id})),drafts:[{season:'2026',status:'complete'}],traded:[{season:'2027',round:1,roster_id:1,owner_id:3,previous_owner_id:2},{season:'2027',round:2,roster_id:3,owner_id:1,previous_owner_id:4}]};}
test('every original pick appears once, with its current owner after multiple trades',()=>{
  const input=fixture(),copy=JSON.stringify(input),inventory=draftInventory(input),rows=board(['4','1','3','2'],inventory);
  assert.equal(inventory.season,2027);assert.equal(rows.flat().length,12);
  assert.deepEqual(rows[0][1],{round:1,originalId:'1',ownerId:'3',slot:2,overall:2,label:'1.02'});
  assert.equal(rows[1][2].ownerId,'1');assert.equal(rows[1][2].originalId,'3');
  assert.equal(rows[2][3].label,'3.04');assert.equal(rows[2][3].overall,12);
  assert.equal(JSON.stringify(input),copy);
});
test('linear and snake order preserve original-pick ownership across rounds',()=>{
  const inv=draftInventory(fixture()),order=['4','1','3','2'];
  assert.deepEqual(board(order,inv)[1].map(p=>p.originalId),order);
  const snake=board(order,inv,{type:'snake'});
  assert.deepEqual(snake[1].map(p=>p.originalId),[...order].reverse());
  assert.equal(snake[1][1].ownerId,'1');assert.deepEqual(snake[2].map(p=>p.originalId),order);
});
test('conflicting owners, unknown rosters, missing endpoints and invalid orders cannot fabricate picks',()=>{
  const input=fixture();input.traded.push({...input.traded[0],owner_id:4});assert.equal(draftInventory(input).available,false);
  input.traded=[{...input.traded[0],owner_id:99}];assert.equal(draftInventory(input).available,false);
  input.traded=null;assert.equal(draftInventory(input).available,false);
  const inv=draftInventory(fixture());assert.throws(()=>board(['1','1','2','3'],inv));assert.throws(()=>board(['1','2','3','9'],inv));
  assert.throws(()=>board(['1','2','3','4'],{...inv,picks:inv.picks.slice(1)}));
});
