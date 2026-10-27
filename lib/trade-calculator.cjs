'use strict';
const Sleeper = require('../sleeper_data.js');
const {score} = require('../scoring_formats.js');
const {requireFeature} = require('./subscription-access.cjs');
const TYPES = ['overall','competing','tanking'];
const norm = Sleeper.playerNameKey;
const fail = (message,status=400) => {throw Object.assign(new Error(message),{status});};
function catalog(rankings) {
  return Object.fromEntries(TYPES.map(type=>[type,new Map(rankings[type].map(r=>[norm(r.Player),{name:r.Player,position:r.Position,value:parseFloat(r.Score)||0}]))]));
}
function assetScores(name,position,book) {
  return Object.fromEntries(TYPES.map(type=>{const row=Sleeper.isDynastyPosition(position)?book[type].get(norm(name)):null;return [type,{value:row?.value||0,position:row?.position||position,ranked:!!row}];}));
}
function buildLeague(bundle,players,book) {
  if(Number(bundle.meta.settings?.type)!==2)fail('League trades currently support Sleeper dynasty leagues. Other formats are coming later.');
  const matched=Object.fromEntries(TYPES.map(type=>[type,Sleeper.matchRankings([...book[type].values()].map(r=>({Player:r.name,Position:r.position,Score:r.value})),players).byId]));
  const scoresFor=id=>Object.fromEntries(TYPES.map(type=>{const row=matched[type].get(String(id));return [type,{value:Number(row?.Score)||0,position:row?.Position||players[id]?.position,ranked:!!row}];}));
  const rosters=Sleeper.withPicks(bundle);
  const teams=rosters.map(r=>{
    const user=bundle.users.find(u=>u.user_id===r.owner_id);
    const assets=[...new Set(r.players)].map(id=>{
      const p=Sleeper.playerInfo(id,players), name=p.full_name;
      return {id:'player:'+id,name,label:name,position:p?.position||'?',scores:scoresFor(id)};
    });
    for(const p of r.picks){
      const name=Sleeper.pickLabel(p),origin=Sleeper.originName(p,rosters,bundle.users);
      assets.push({id:`pick:${p.season}:${p.round}:${p.roster_id}`,name,label:`${name} (${origin})`,position:'PICK',origin,scores:assetScores(name,'PICK',book)});
    }
    return {roster_id:String(r.roster_id),name:user?.metadata?.team_name||user?.display_name||`Team ${r.roster_id}`,manager:user?.display_name||'',assets};
  });
  return {id:bundle.id,name:bundle.meta.name,season:bundle.meta.season,roster_positions:bundle.meta.roster_positions,scoring_settings:bundle.meta.scoring_settings,teams};
}
function formatOf(value={}) {
  if(!value || !['std','hppr','ppr'].includes(value.ppr) || typeof value.superflex!=='boolean'||typeof value.tePremium!=='boolean')fail('Choose a valid league scoring format.');
  return {ppr:value.ppr,superflex:value.superflex,tePremium:value.tePremium};
}
const valueOf=(asset,type,format)=>score(asset.scores[type].value,asset.scores[type].position,format);
const PickPreferences=require('../pick_preferences.js');
const PICK_WEIGHTS={low:.8,neutral:1,high:1.2};
const preferenceValue=(asset,type,format,pickWeight='neutral')=>valueOf(asset,type,format)*(asset.position==='PICK'?PickPreferences.multiplier(pickWeight):1);
function bonus(sends,receives) {
  if(!sends.length||!receives.length||(sends.length===1&&receives.length===1))return 0;
  return Math.max(0,Math.max(...sends)-Math.max(...receives))*.75;
}
function rankLeague(league,inventories,format) {
  const result={};
  for(const type of ['competing','tanking']){
    const sorted=league.teams.map(team=>{
      const values=inventories.get(team.roster_id).filter(a=>Sleeper.isDynastyPosition(a.position||a.scores[type].position)).map(a=>valueOf(a,type,format)).sort((a,b)=>b-a).slice(0,15);
      return {id:team.roster_id,score:values.reduce((s,n)=>s+n,0)/Math.max(values.length,1)};
    }).sort((a,b)=>b.score-a.score||Number(a.id)-Number(b.id));
    sorted.forEach((team,i)=>{(result[team.id]??={})[type]={rank:i+1,score:team.score};});
  }
  return result;
}
function evaluate(body,access,book,league=null) {
  const teams=body.teams, moves=body.transfers,format=formatOf(body.format);
  if(!Array.isArray(teams)||teams.length<2||teams.length>12||!Array.isArray(moves)||moves.length>120)fail('Use 2–12 teams and at most 120 trade assets.');
  if(teams.length>2)requireFeature(access,'tradeTeams');
  if(league)requireFeature(access,'tradeLeagueImport');
  const byId=new Map(), selected=new Set();
  for(const team of teams){
    if(!Number.isInteger(team.id)||team.id<1||team.id>10000||byId.has(team.id)||!TYPES.includes(team.status))fail('Invalid calculator team.');
    if(!PickPreferences.valid(team.pickWeight??'neutral'))fail('Invalid pick preference.');
    if(PickPreferences.percent(team.pickWeight??'neutral')!==0&&!league)fail('Pick preferences require an imported league.');
    if(team.roster_id){
      if(!league||!league.teams.some(t=>t.roster_id===team.roster_id)||selected.has(team.roster_id))fail('Select each league team only once.');
      selected.add(team.roster_id);
    }
    byId.set(team.id,team);
  }
  const inventories=league?new Map(league.teams.map(t=>[t.roster_id,[...t.assets]])):null;
  const before=league?rankLeague(league,inventories,format):null;
  const outgoing=new Map(teams.map(t=>[t.id,[]])), incoming=new Map(teams.map(t=>[t.id,[]])),seen=new Set();
  for(const move of moves){
    const from=byId.get(move.from),to=byId.get(move.to);
    if(!from||!to||from===to||typeof move.asset!=='string')fail('Choose a different destination team for every asset.');
    let asset;
    if(league){
      if(!from.roster_id||!to.roster_id)fail('Select a league team for both sides of each transfer.');
      asset=league.teams.find(t=>t.roster_id===from.roster_id).assets.find(a=>a.id===move.asset);
      if(!asset)fail('That asset is no longer on the sending roster. Refresh the league.');
    }else{
      const row=book.overall.get(norm(move.asset));
      if(!row)fail('That player or pick is not in the published rankings.');
      asset={id:move.asset,name:row.name,label:row.name,position:row.position,scores:assetScores(row.name,row.position,book)};
    }
    const identity=league?asset.id:from.id+':'+asset.id;
    if(seen.has(identity))fail('An asset can only be sent once.');seen.add(identity);
    outgoing.get(from.id).push(asset);incoming.get(to.id).push(asset);
    if(league){
      inventories.set(from.roster_id,inventories.get(from.roster_id).filter(a=>a.id!==asset.id));
      inventories.get(to.roster_id).push(asset);
    }
  }
  const after=league?rankLeague(league,inventories,format):null;
  return {teams:teams.map(team=>{
    const entries=assets=>assets.map(a=>({asset:a.id,label:a.label,score:preferenceValue(a,team.status,format,team.pickWeight??'neutral'),ranked:a.scores[team.status].ranked}));
    const sends=entries(outgoing.get(team.id)),receives=entries(incoming.get(team.id));
    const studBonus=bonus(sends.map(a=>a.score),receives.map(a=>a.score));
    const sendsTotal=sends.reduce((sum,a)=>sum+a.score,0)+studBonus,receivesTotal=receives.reduce((sum,a)=>sum+a.score,0);
    // Market balance always uses Overall, with league scoring but without stud bonus.
    const marketSends=outgoing.get(team.id).reduce((sum,a)=>sum+valueOf(a,'overall',format),0);
    const marketReceives=incoming.get(team.id).reduce((sum,a)=>sum+valueOf(a,'overall',format),0);
    const market={sendsTotal:marketSends,receivesTotal:marketReceives,net:marketReceives-marketSends,
      unranked:[...outgoing.get(team.id),...incoming.get(team.id)].some(a=>!a.scores.overall.ranked)};
    return {id:team.id,sends,receives,studBonus,sendsTotal,receivesTotal,total:receivesTotal-sendsTotal,
      market,
      ranks:team.roster_id?{before:before[team.roster_id],after:after[team.roster_id],total:league.teams.length}:null};
  })};
}
// Warm-instance cache avoids downloading rosters for every edit. Never cache access decisions.
const cache=new Map();
async function loadLeague(id,book,refresh=false) {
  if(typeof id!=='string'||!/^\d{8,25}$/.test(id))fail('Enter the numeric Sleeper league ID.');
  if(refresh)cache.delete(id);
  if(cache.has(id)&&cache.get(id).until>Date.now())return cache.get(id).promise;
  if(cache.size>=20)cache.delete(cache.keys().next().value);
  const promise=Promise.all([Sleeper.league(id),Sleeper.players()]).then(([b,p])=>buildLeague(b,p,book));
  const entry={promise,until:Date.now()+60000};cache.set(id,entry);
  try{return await promise;}catch(error){if(cache.get(id)===entry)cache.delete(id);if(error.status)throw error;fail(error.message||'Sleeper is unavailable. Try again.',502);}
}
async function tradeAction(action,body,access,deps={}) {
  if(action==='trade-config')return {access};
  if(action==='trade-league'||body.league_id)requireFeature(access,'tradeLeagueImport');
  if(action==='trade-evaluate'&&Array.isArray(body.teams)&&body.teams.length>2)requireFeature(access,'tradeTeams');
  const book=deps.book||catalog(require('../data/nfl_rankings.json').rankings);
  const load=deps.loadLeague||loadLeague;
  if(action==='trade-league')return {league:await load(body.league_id,book,body.refresh===true)};
  const league=body.league_id?await load(body.league_id,book):null;
  return evaluate(body,access,book,league);
}
module.exports={catalog,buildLeague,evaluate,bonus,tradeAction,loadLeague,preferenceValue,PICK_WEIGHTS};
