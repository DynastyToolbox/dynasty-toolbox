'use strict';
const {createHash}=require('node:crypto');
const {catalog,loadLeague,evaluate}=require('./trade-calculator.cjs');
const {preferencesFor,profile,LIMITS}=require('./trade-finder.cjs');
const {requireFeature}=require('./subscription-access.cjs');
const {score}=require('../scoring_formats.js');
const ACTIONS=new Set(['finder-pins','finder-pin','finder-unpin']);
const FIELDS='id,league_id,roster_id,partner_id,send,receive,created_at';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const brief=a=>({id:a.id,name:String(a.label||a.name).slice(0,180),position:a.position});
const fingerprint=body=>createHash('sha256').update(JSON.stringify([body.league_id,body.roster_id,body.partner_id,[...body.send].sort(),[...body.receive].sort()])).digest('hex');
function validateContext(league,body,access){
  if(!body.format||!['std','hppr','ppr'].includes(body.format.ppr)||typeof body.format.superflex!=='boolean'||typeof body.format.tePremium!=='boolean')fail('Choose a valid scoring format.');
  if(!league.teams.some(t=>t.roster_id===body.roster_id))fail('Choose your team.');
  return preferencesFor(league,body,access);
}
function valuePinned(league,row,body,access,prefs){
  const mine=league.teams.find(t=>t.roster_id===row.roster_id),other=league.teams.find(t=>t.roster_id===row.partner_id);
  const minePref=prefs.get(row.roster_id),theirPref=prefs.get(row.partner_id);
  const result={id:row.id,partner_id:row.partner_id,partnerName:other?.name||'Team '+row.partner_id,
    preference:theirPref||{mode:'overall',pickWeight:'neutral'},needs:other?profile(league,other.roster_id,theirPref.mode,body.format).needs:[],
    send:row.send,receive:row.receive};
  const sends=row.send.map(a=>mine?.assets.find(x=>x.id===a.id)),receives=row.receive.map(a=>other?.assets.find(x=>x.id===a.id));
  if([...sends,...receives].some(a=>!a)||!mine||!other)return {...result,unavailable:true,notice:'Roster changed — one or more assets are no longer on these teams.'};
  result.send=sends.map(brief);result.receive=receives.map(brief);
  if([...sends,...receives].some(a=>!a.scores.overall.ranked||!a.scores[minePref.mode].ranked||!a.scores[theirPref.mode].ranked))return {...result,unavailable:true,notice:'Current rankings are unavailable for one or more assets.'};
  const values=evaluate({format:body.format,teams:[{id:1,roster_id:mine.roster_id,status:minePref.mode,pickWeight:minePref.pickWeight},{id:2,roster_id:other.roster_id,status:theirPref.mode,pickWeight:theirPref.pickWeight}],
    transfers:[...sends.map(a=>({from:1,to:2,asset:a.id})),...receives.map(a=>({from:2,to:1,asset:a.id}))]},access,{},league).teams;
  const market=values[0].market,largest=Math.max(market.sendsTotal,market.receivesTotal);
  const gap=largest?Math.abs(market.net)/largest:1;
  const anchors=[sends,receives].map(assets=>Math.max(...assets.map(a=>score(a.scores.overall.value,a.scores.overall.position,body.format))));
  const eligible=gap<=LIMITS.marketGap+1e-8&&values.every(t=>t.total>=-LIMITS.maxLoss-1e-8)&&anchors.every(v=>v>=LIMITS.minAnchor)&&
    !(sends.length>receives.length&&anchors[0]<anchors[1]*.5)&&!(receives.length>sends.length&&anchors[1]<anchors[0]*.5);
  const excluded=new Set(Array.isArray(body.excluded)?body.excluded:[]);
  const notices=[];
  if(!eligible)notices.push('Outside the current search limits.');
  if([...sends,...receives].some(a=>excluded.has(a.id)))notices.push('Includes an asset you marked untouchable.');
  return {...result,gap,marketNet:market.net,myNet:values[0].total,theirNet:values[1].total,eligible,notice:notices.join(' ')};
}
function ownedPackage(league,body){
  const mine=league.teams.find(t=>t.roster_id===body.roster_id),other=league.teams.find(t=>t.roster_id===body.partner_id);
  if(!mine||!other||mine===other)fail('Choose two different league teams.');
  if(![body.send,body.receive].every(a=>Array.isArray(a)&&a.length>=1&&a.length<=3&&a.every(id=>typeof id==='string'))||body.send.length+body.receive.length>4)fail('Choose a supported trade package.');
  const ids=[...body.send,...body.receive];if(new Set(ids).size!==ids.length)fail('An asset can only appear once.');
  const send=body.send.map(id=>mine.assets.find(a=>a.id===id)),receive=body.receive.map(id=>other.assets.find(a=>a.id===id));
  if([...send,...receive].some(a=>!a||!['QB','RB','WR','TE','PICK'].includes(a.position)))fail('The sending rosters no longer own all these assets. Reload your league.');
  if([send,receive].some(a=>a.filter(x=>x.position==='PICK').length>2)||[...send,...receive].every(a=>a.position==='PICK'))fail('Choose a player trade with at most two picks per side.');
  return {send:send.map(brief),receive:receive.map(brief)};
}
async function pinnedAction(action,body,user,db,access,deps={}){
  if(!user?.id||!user.email_confirmed_at)fail('Sign in to save or view pinned trades.',401);
  requireFeature(access,'tradeFinderTargets');
  if(action==='finder-unpin'){
    if(!UUID.test(body.id||''))fail('Choose a pinned trade.');
    const {error}=await db.from('saved_trades').delete().eq('id',body.id).eq('user_id',user.id);
    if(error)fail('Could not unpin this trade. Try again.',503);
    return {message:'Trade unpinned.'};
  }
  const book=deps.book||catalog(require('../data/nfl_rankings.json').rankings);
  const league=await (deps.loadLeague||loadLeague)(body.league_id,book),prefs=validateContext(league,body,access);
  if(action==='finder-pins'){
    const {data,error}=await db.from('saved_trades').select(FIELDS).eq('user_id',user.id).eq('league_id',league.id).eq('roster_id',body.roster_id).order('created_at');
    if(error)fail('Pinned trades could not load. Try Find partners again.',503);
    return {pins:data.map(row=>valuePinned(league,row,body,access,prefs))};
  }
  const assets=ownedPackage(league,body),row={user_id:user.id,league_id:league.id,roster_id:body.roster_id,partner_id:body.partner_id,...assets,fingerprint:fingerprint(body)};
  const checked=valuePinned(league,row,body,access,prefs);
  if(!checked.eligible)fail('This trade no longer meets the search limits. Find partners again before pinning.');
  const {data,error}=await db.from('saved_trades').insert(row).select(FIELDS).single();
  if(error?.code==='23505'){
    const existing=await db.from('saved_trades').select(FIELDS).eq('user_id',user.id).eq('fingerprint',row.fingerprint).single();
    if(!existing.error)return {pin:valuePinned(league,existing.data,body,access,prefs),message:'Trade already pinned.'};
  }
  if(error?.code==='P0001')fail('You can pin up to 50 trades. Unpin one before saving another.',409);
  if(error)fail('Could not save this trade. Try again.',503);
  return {pin:valuePinned(league,data,body,access,prefs),message:'Trade pinned to your account.'};
}
module.exports={pinnedAction,valuePinned,fingerprint,ACTIONS};
