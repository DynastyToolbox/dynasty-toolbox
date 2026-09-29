'use strict';
const {withPicks}=require('../sleeper_data.js');

// Reuse the same original-roster/current-owner mapping as the analyzers.
// A failed pick endpoint must not make the season outlook unavailable.
function draftInventory({meta,rosters,drafts,traded}){
  try{
    if(Number(meta.settings?.type)!==2)return {available:false,reason:'A rookie draft board is available for dynasty leagues.'};
    if(!Array.isArray(drafts)||!Array.isArray(traded))throw new Error('Draft picks could not be loaded. Reload the league to try again.');
    const season=Number(meta.season)+1,rounds=Number(meta.settings?.draft_rounds);
    if(!Number.isInteger(rounds)||rounds<1||rounds>20)throw new Error('Draft round settings need review.');
    const picks=withPicks({meta,rosters,drafts,traded}).flatMap(r=>r.picks).filter(p=>Number(p.season)===season)
      .map(p=>({round:p.round,originalId:String(p.roster_id),ownerId:String(p.owner_id)}));
    if(picks.length!==rounds*rosters.length)throw new Error('The full rookie pick inventory is not available yet.');
    return {available:true,season,rounds,picks};
  }catch(error){return {available:false,reason:error.message};}
}
module.exports={draftInventory};
