'use strict';
const {requireFeature}=require('./subscription-access.cjs');
const ACTIONS=new Set(['finder-preferences','finder-save-preferences']);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function validate(preferences){
  if(!Array.isArray(preferences)||preferences.length>100)fail('Invalid team preferences.');
  const seen=new Set();
  return preferences.map(p=>{
    if(!p||!/^\d{1,4}$/.test(p.roster_id)||seen.has(p.roster_id)||!['overall','competing','tanking'].includes(p.mode)||!['low','neutral','high'].includes(p.pickWeight))fail('Invalid team preferences.');
    seen.add(p.roster_id);return {roster_id:p.roster_id,mode:p.mode,pickWeight:p.pickWeight};
  });
}
async function preferenceAction(action,body,user,db,access){
  if(!user?.id||!user.email_confirmed_at)fail('Sign in to save team preferences.',401);
  requireFeature(access,'tradeFinderTargets');
  if(!/^\d{8,25}$/.test(body.league_id||''))fail('Enter a valid league ID.');
  if(action==='finder-preferences'){
    const {data,error}=await db.from('finder_preferences').select('preferences').eq('user_id',user.id).eq('league_id',body.league_id).maybeSingle();
    if(error)fail('Saved team preferences could not load. Reload your league to try again.',503);
    return {preferences:data?validate(data.preferences):[]};
  }
  const preferences=validate(body.preferences);
  const {error}=await db.from('finder_preferences').upsert({user_id:user.id,league_id:body.league_id,preferences},{onConflict:'user_id,league_id'});
  if(error)fail('Team preferences were not saved. Choose Update matches to retry.',503);
  return {message:'Team preferences saved to your account.'};
}
module.exports={ACTIONS,preferenceAction,validate};
