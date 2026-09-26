'use strict';
// Data validation and exact supported offensive scoring, not a calibrated forecast.
const OFFENSE=new Set(['QB','RB','WR','TE']);
const SLOTS={QB:['QB'],RB:['RB'],WR:['WR'],TE:['TE'],FLEX:['RB','WR','TE'],WRRB_FLEX:['RB','WR'],REC_FLEX:['WR','TE'],SUPER_FLEX:['QB','RB','WR','TE']};
const FIELDS=new Set(['pass_yd','pass_td','pass_int','pass_2pt','rush_yd','rush_td','rush_2pt','rec','rec_yd','rec_td','rec_2pt','fum','fum_lost','fum_rec_td','st_td','st_fum_rec','st_ff']);
// These settings do not affect offensive-player scoring. K/DEF starting slots
// are separately flagged as unsupported; their points are never silently zeroed.
const SPECIAL=new Set(['sack','fgm_40_49','pts_allow_0','st_td','fgm_30_39','xpmiss','st_fum_rec','fgmiss','ff','pts_allow_14_20','fgm_0_19','pts_allow_1_6','fgm_20_29','pts_allow_21_27','xpm','int','def_st_fum_rec','fum_rec','fgm_50p','def_td','safe','blk_kick','pts_allow_28_34','pts_allow_35p','def_st_td','def_st_ff','pts_allow_7_13','st_ff']);
function scoringSupport(settings={}){
  return Object.entries(settings).filter(([key,value])=>!Number.isFinite(Number(value))||Number(value)!==0&&!FIELDS.has(key)&&!SPECIAL.has(key)).map(([key])=>key);
}
function offensivePoints(stats,position,settings){
  if(!OFFENSE.has(position))throw new Error('Only QB, RB, WR and TE points are currently modeled.');
  const unsupported=scoringSupport(settings);
  if(unsupported.length)throw new Error('Scoring needs support: '+unsupported.join(', '));
  // No player-week record is missing data, not a zero-point performance.
  if(!stats||typeof stats!=='object')return null;
  let points=0;
  for(const key of FIELDS){const stat=Number(stats[key]??0),weight=Number(settings[key]??0);if(!Number.isFinite(stat)||!Number.isFinite(weight))throw new Error('Invalid weekly stat or scoring weight.');points+=stat*weight;}
  return Math.round((points+Number.EPSILON)*100)/100;
}
function starterSlots(meta){
  const slots=(Array.isArray(meta.roster_positions)?meta.roster_positions:[]).filter(p=>!['BN','IR','TAXI'].includes(p));
  return {slots,unsupported:[...new Set(slots.filter(p=>!SLOTS[p]))]};
}
function weeklyPairings(rows,rosterIds){
  const known=new Set(rosterIds.map(String)),seen=new Set(),groups=new Map(),issues=[];
  if(!Array.isArray(rows))return {pairs:[],issues:['Schedule not available.']};
  for(const row of rows){const id=String(row.roster_id);if(!known.has(id)||seen.has(id)){issues.push('Unknown or repeated roster in schedule.');continue;}seen.add(id);
    if(row.matchup_id===null||row.matchup_id===undefined){issues.push('A team has no scheduled opponent.');continue;}
    const key=String(row.matchup_id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(id);
  }
  const pairs=[];for(const ids of groups.values()){if(ids.length===2)pairs.push(ids);else issues.push('A matchup does not contain exactly two teams.');}
  if(seen.size!==known.size)issues.push('Some league teams are missing from the schedule.');
  return {pairs,issues:[...new Set(issues)]};
}
function plan(meta,state){
  if(meta.sport!=='nfl')throw new Error('A Sleeper NFL league is required.');
  if(String(meta.season)!==String(state.season)||state.season_type!=='regular')throw new Error('The first Outlook prototype supports the current regular season.');
  const week=Number(state.week),start=Number(meta.settings?.start_week||1),playoffs=Number(meta.settings?.playoff_week_start);
  if(!Number.isInteger(week)||week<1||week>18||!Number.isInteger(start)||start<1||!Number.isInteger(playoffs)||playoffs<2||playoffs>19)throw new Error('League season or playoff settings need review.');
  const reported=Number(meta.settings?.last_scored_leg);
  const through=Number.isInteger(reported)&&reported>=0?Math.min(week-1,reported):week-1;
  return {season:String(meta.season),completedThrough:through,currentWeek:week,playoffStart:playoffs,
    remaining:Array.from({length:Math.max(0,playoffs-Math.max(start,through+1))},(_,i)=>Math.max(start,through+1)+i),
    medianGame:meta.settings?.league_average_match===1,bestBall:meta.settings?.best_ball===1};
}
async function inspectLeague(id,fetcher=fetch){
  if(typeof id!=='string'||!/^\d{10,22}$/.test(id))throw new Error('Enter a numeric Sleeper league ID.');
  const get=async path=>{const response=await fetcher('https://api.sleeper.app/v1/'+path,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Sleeper data is unavailable. Try again.');return response.json();};
  const [meta,state,rosters]=await Promise.all([get('league/'+id),get('state/nfl'),get('league/'+id+'/rosters')]);
  if(!meta||!state||!Array.isArray(rosters)||!rosters.length)throw new Error('League data is incomplete.');
  const season=plan(meta,state),starters=starterSlots(meta),ids=rosters.map(r=>String(r.roster_id));
  const schedule=[];
  // Bounded batches, rather than one request per player or unbounded fan-out.
  for(let i=0;i<season.remaining.length;i+=4){
    schedule.push(...await Promise.all(season.remaining.slice(i,i+4).map(async week=>{
      try{return {week,...weeklyPairings(await get(`league/${id}/matchups/${week}`),ids)};}
      catch{return {week,pairs:[],issues:['Schedule could not be loaded. Try again.']};}
    })));
  }
  return {league:{id,name:meta.name,teams:rosters.length},season,starters,unsupportedScoring:scoringSupport(meta.scoring_settings),scoring:meta.scoring_settings,schedule,
    modelStatus:'Research prototype: point estimates and win probabilities are not yet calibrated.'};
}
module.exports={offensivePoints,scoringSupport,starterSlots,weeklyPairings,plan,inspectLeague,SLOTS};
