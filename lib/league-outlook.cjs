'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {requireFeature}=require('./subscription-access.cjs');
const {plan,weeklyPairings,scoringSupport,starterSlots}=require('./outlook-foundation.cjs');
const {nflSchedule,playerHistories,projectRoster}=require('./outlook-lineups.cjs');
const {formatKey,compareLineups}=require('./outlook-uncertainty.cjs');
const cache=new Map();
const fail=(message,status=503)=>{throw Object.assign(new Error(message),{status});};
async function loadInputs(id,{directory,fetcher=fetch}){
  if(!directory)fail('League Outlook history is not configured for this preview.');
  async function source(endpoint){
    const response=await fetcher('https://api.sleeper.app/'+endpoint,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)fail('Sleeper could not load this league. Please try again.',502);
    return response.json();
  }
  const memo=async(key,ttl,fn)=>{
    const old=cache.get(key);if(old&&Date.now()-old.at<ttl)return old.value;
    const value=await fn();if(cache.size>30)cache.clear();cache.set(key,{at:Date.now(),value});return value;
  };
  const [state,meta,rosters,users]=await Promise.all([source('v1/state/nfl'),source('v1/league/'+id),source('v1/league/'+id+'/rosters'),source('v1/league/'+id+'/users')]);
  if(!meta||!state||!Array.isArray(rosters)||!rosters.length||!Array.isArray(users))fail('League details are incomplete.',502);
  const season=plan(meta,state),read=async file=>JSON.parse(await fs.readFile(path.join(directory,file),'utf8'));
  const history=await memo('history:'+directory,60000,async()=>{
    const input=await read('inputs.json');const slots=input.weeks.map(({season,week})=>({season,week}));
    const weeks=await Promise.all(slots.map(s=>read(`cache/stats-${s.season}-${s.week}.json`)));
    return {slots,weeks};
  });
  const last=history.slots.at(-1);
  const expectedSeason=Number(state.season)-(Number(state.week)===1?1:0),expectedWeek=Number(state.week)===1?17:Number(state.week)-1;
  if(!last||Number(last.season)!==expectedSeason||last.week!==expectedWeek)fail('This preview needs its weekly player history refreshed. Please try again after the data update.');
  const [players,rawSchedule]=await Promise.all([
    memo('players:'+state.season,86400000,async()=>{
      // Reuse a fresh private research snapshot instead of downloading the full registry per page visit.
      try{const snapshot=await read('lineup-snapshot.json');const age=Date.now()-Date.parse(snapshot.generatedAt);if(age>=0&&age<86400000&&snapshot.state.season===state.season)return snapshot.players;}catch{}
      return source('v1/players/nfl');
    }),source('schedule/nfl/regular/'+state.season)]);
  const schedule=[];let currentMatchups=[];
  for(let offset=0;offset<season.remaining.length;offset+=3)for(const row of await Promise.all(season.remaining.slice(offset,offset+3).map(async week=>{
    try{const rows=await source(`v1/league/${id}/matchups/${week}`);if(week===Number(state.week)&&Array.isArray(rows))currentMatchups=rows;return {week,...weeklyPairings(rows,rosters.map(r=>r.roster_id))};}
    catch{return {week,pairs:[],issues:['Matchups are unavailable for this week.']};}
  })))schedule.push(row);
  let uncertainty=null;
  try{uncertainty=await memo('uncertainty:'+directory,60000,()=>read('uncertainty-report.json'));}catch{}
  return {meta,state,rosters,users,players,rawSchedule,history,schedule,currentMatchups,uncertainty};
}
function buildPreview(input){
  const {meta,state,rosters,users,players,rawSchedule,history,schedule}=input,season=plan(meta,state),nfl=nflSchedule(rawSchedule,meta.season);
  const unsupported=scoringSupport(meta.scoring_settings),slotInfo=starterSlots(meta);
  const histories=unsupported.length?{}:playerHistories({...history,players,scoring:meta.scoring_settings,season:meta.season,week:state.week});
  const teams=rosters.map(roster=>{
    const user=users.find(u=>u.user_id===roster.owner_id),s=roster.settings||{};
    const finite=v=>Number.isFinite(Number(v))?Number(v):0;
    return {id:String(roster.roster_id),name:user?.metadata?.team_name||user?.display_name||`Team ${roster.roster_id}`,record:{wins:finite(s.wins),losses:finite(s.losses),ties:finite(s.ties)},pointsFor:finite(s.fpts)+finite(s.fpts_decimal)/100};
  });
  const lineups=unsupported.length?[]:season.remaining.flatMap(week=>rosters.map(roster=>projectRoster({roster,players,histories,meta,schedule:nfl,week,currentWeek:state.week,matchup:input.currentMatchups?.find(row=>String(row.roster_id)===String(roster.roster_id))})));
  const report=input.uncertainty,last=history.slots.at(-1);
  const calibrationReady=report?.leagueId===meta.league_id&&report.format===formatKey(meta)&&report.historyThrough?.season===last?.season&&report.historyThrough?.week===last?.week&&report.model?.available&&report.model.before<Number(meta.season)*100+Number(state.week);
  const comparisons=schedule.flatMap(row=>row.issues.length?[]:row.pairs.map(([a,b])=>({week:row.week,teams:[a,b],...compareLineups(calibrationReady?report.model:null,lineups.find(l=>String(l.rosterId)===a&&l.week===row.week),lineups.find(l=>String(l.rosterId)===b&&l.week===row.week),{week:row.week,currentWeek:season.currentWeek})})));
  return {league:{id:meta.league_id,name:meta.name,season:meta.season,teams,slots:slotInfo.slots},currentWeek:season.currentWeek,completedThrough:season.completedThrough,
    historyThrough:history.slots.at(-1),schedule,lineups,comparisons,uncertainty:calibrationReady?{experimental:true,testMatchups:report.evaluation.matchups.n,rangeCoverage:report.evaluation.teamRanges.coverage}:null,coverage:{scoring:unsupported,slots:slotInfo.unsupported,nflSchedule:nfl.issues,bestBall:season.bestBall,medianGame:season.medianGame},
    generatedAt:new Date().toISOString(),stage:'lineup-preview',note:'Experimental matchup estimates assume the selected lineups play. Availability and season/playoff probabilities are not modeled.'};
}
async function outlookAction(body,access,options={}){
  requireFeature(access,'leagueOutlook');
  if(typeof body.league_id!=='string'||!/^\d{10,22}$/.test(body.league_id))fail('Enter a numeric Sleeper league ID.',400);
  const data=await (options.load||loadInputs)(body.league_id,options);
  return buildPreview(data);
}
module.exports={outlookAction,buildPreview};
