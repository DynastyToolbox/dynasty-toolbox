'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {draftInventory,projectedDraft}=require('../lib/outlook-draft.cjs');
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

test('reverse finish puts non-playoff teams first, same-round losers in reverse standing order, then runner-up and champion',()=>{
  const entry=id=>({id:String(id)}),game=(a,b,winner)=>({a:entry(a),b:entry(b),winner:entry(winner)});
  const standings={available:true,teams:Array.from({length:10},(_,i)=>({id:String(i+1),place:i+1})),playoffs:{available:true,field:[1,2,3,4,5,6].map(entry),path:{rounds:[{games:[game(4,5,5),game(3,6,6)]},{games:[game(1,6,6),game(2,5,2)]},{games:[game(6,2,6)]}],champion:entry(6)}}};
  const input=fixture();input.rosters=standings.teams.map(t=>({roster_id:Number(t.id)}));input.traded=[{season:'2027',round:1,roster_id:10,owner_id:1,previous_owner_id:2}];
  const before=JSON.stringify(standings),draft=projectedDraft(draftInventory(input),standings);
  assert.deepEqual(draft.order,['10','9','8','7','4','3','5','1','2','6']);
  const rows=board(draft.order,draft);
  assert.equal(rows[0][0].ownerId,'1');assert.equal(rows[0][0].originalId,'10');assert.equal(rows[0].at(-1).originalId,'6');
  assert.deepEqual(rows[1].map(p=>p.originalId),draft.order);assert.equal(JSON.stringify(standings),before);
  const missing=structuredClone(standings);missing.playoffs.path=null;assert.equal(projectedDraft(draft,missing).order,null);
  const duplicate=structuredClone(standings);duplicate.playoffs.path.champion=entry(2);assert.equal(projectedDraft(draft,duplicate).order,null);
});

test('four- and eight-team playoff paths create one slot per original team',()=>{
  const bracket=require('../outlook-bracket.js');
  for(const count of [4,8]){
    const teams=Array.from({length:count+2},(_,i)=>({id:String(i+1),place:i+1})),field=teams.slice(0,count).map(t=>({id:t.id,seed:t.place}));
    const rounds=bracket.roundWeeks(count,15,Array(count===4?2:3).fill(1));
    const forecasts=Object.fromEntries(rounds.flat().flatMap(w=>field.map(t=>[w+':'+t.id,{mean:Number(t.id)*10,sd:0}])));
    const path=bracket.play(field,rounds,forecasts,{reseed:true});
    const result=projectedDraft({available:true},{available:true,teams,playoffs:{available:true,field,path}});
    assert.equal(new Set(result.order).size,count+2);assert.deepEqual(result.order.slice(0,2),[String(count+2),String(count+1)]);
    assert.equal(result.order.at(-1),path.champion.id);
  }
});
