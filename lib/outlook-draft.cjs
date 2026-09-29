'use strict';
const {withPicks}=require('../sleeper_data.js');

// Reuse the same original-roster/current-owner mapping as the analyzers.
// A failed pick endpoint must not make the season outlook unavailable.
function draftInventory({meta,rosters,drafts,traded}){
  try{
    if(Number(meta.settings?.type)!==2)return {available:false,applicable:false,reason:'A rookie draft board is available for dynasty leagues.'};
    if(!Array.isArray(drafts)||!Array.isArray(traded))throw new Error('Draft picks could not be loaded. Reload the league to try again.');
    const season=Number(meta.season)+1,rounds=Number(meta.settings?.draft_rounds);
    if(!Number.isInteger(rounds)||rounds<1||rounds>20)throw new Error('Draft round settings need review.');
    const picks=withPicks({meta,rosters,drafts,traded}).flatMap(r=>r.picks).filter(p=>Number(p.season)===season)
      .map(p=>({round:p.round,originalId:String(p.roster_id),ownerId:String(p.owner_id)}));
    if(picks.length!==rounds*rosters.length)throw new Error('The full rookie pick inventory is not available yet.');
    return {available:true,season,rounds,picks};
  }catch(error){return {available:false,reason:error.message};}
}
function projectedDraft(inventory,standings){
  if(!inventory?.available)return inventory||{available:false,reason:'Draft picks are unavailable.'};
  const pending=reason=>({...inventory,order:null,orderReason:reason});
  const playoff=standings?.playoffs;
  if(!standings?.available||!playoff?.available||!playoff.path)return pending('Draft slots need a complete projected playoff finish.');
  const teams=standings.teams,known=new Set(teams.map(t=>t.id)),field=new Set(playoff.field.map(t=>t.id));
  const place=new Map(teams.map(t=>[t.id,t.place]));
  const worseFirst=(a,b)=>place.get(b)-place.get(a);
  const order=teams.filter(t=>!field.has(t.id)).map(t=>t.id).sort(worseFirst);
  // Elimination round determines playoff finish. No consolation matchups.
  // Within each eliminated group, reverse regular-season finish breaks ties.
  for(const round of playoff.path.rounds){
    const losers=round.games.map(g=>g.winner.id===g.a.id?g.b.id:g.winner.id===g.b.id?g.a.id:null);
    order.push(...losers.sort(worseFirst));
  }
  order.push(playoff.path.champion.id);
  if(order.length!==known.size||new Set(order).size!==known.size||order.some(id=>!known.has(id)))return pending('Projected draft slots need review.');
  return {...inventory,order,type:'linear',orderLabel:'Reverse projected finish · Same order each round'};
}
module.exports={draftInventory,projectedDraft};
