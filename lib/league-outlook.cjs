'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {requireFeature}=require('./subscription-access.cjs');
const {plan,weeklyPairings,scoringSupport,starterSlots}=require('./outlook-foundation.cjs');
const {nflSchedule,playerHistories,projectRoster}=require('./outlook-lineups.cjs');
const {formatKey}=require('./outlook-uncertainty.cjs');
const {distribution,compareForecasts,simulateSeason}=require('./outlook-season.cjs');
const {playoffConfig}=require('./outlook-playoffs.cjs');
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
    const recorded=v=>v!=null&&Number.isFinite(Number(v))?Number(v):null;
    return {id:String(roster.roster_id),division:s.division==null?null:Number(s.division),name:user?.metadata?.team_name||user?.display_name||`Team ${roster.roster_id}`,record:{wins:recorded(s.wins),losses:recorded(s.losses),ties:recorded(s.ties)},pointsFor:s.fpts==null?null:finite(s.fpts)+finite(s.fpts_decimal)/100,pointsAgainst:s.fpts_against==null?null:finite(s.fpts_against)+finite(s.fpts_against_decimal)/100};
  });
  const lineups=unsupported.length?[]:season.remaining.flatMap(week=>rosters.map(roster=>projectRoster({roster,players,histories,meta,allowThinHistory:true,schedule:nfl,week,currentWeek:state.week,matchup:input.currentMatchups?.find(row=>String(row.roster_id)===String(roster.roster_id))})));
  const replacementLineups=lineups.filter(l=>l.week>season.currentWeek&&l.warnings.some(w=>w.reason==='injury_uncertain')).map(base=>{
    const alternate=projectRoster({roster:rosters.find(r=>String(r.roster_id)===String(base.rosterId)),players,histories,meta,allowThinHistory:true,schedule:nfl,week:base.week,currentWeek:state.week,excludeConditional:true});
    const before=base.lineup.flatMap(r=>r.player?[r.player]:[]),after=alternate.lineup.flatMap(r=>r.player?[r.player]:[]);
    alternate.changes={removed:before.filter(p=>!after.some(a=>a.id===p.id)).map(p=>({id:p.id,name:p.name})),added:after.filter(p=>!before.some(b=>b.id===p.id)).map(p=>({id:p.id,name:p.name}))};return alternate;
  });
  const report=input.uncertainty,last=history.slots.at(-1);
  const calibrationReady=report?.leagueId===meta.league_id&&report.format===formatKey(meta)&&report.historyThrough?.season===last?.season&&report.historyThrough?.week===last?.week&&report.model?.available&&report.model.before<Number(meta.season)*100+Number(state.week);
  const selectLineup=(id,week,scenario)=>(scenario==='replace'?replacementLineups.find(l=>String(l.rosterId)===id&&l.week===week):null)||lineups.find(l=>String(l.rosterId)===id&&l.week===week);
  const forecasts=new Map(lineups.map(l=>[l.week+':'+l.rosterId,distribution(calibrationReady?report.model:null,l,histories,players)]));
  const comparisons=schedule.flatMap(row=>row.issues.length?[]:row.pairs.flatMap(([a,b])=>(row.week>season.currentWeek?['play','replace']:['play']).map(scenario=>({week:row.week,teams:[a,b],scenario,...compareForecasts(
    scenario==='play'?forecasts.get(row.week+':'+a):distribution(calibrationReady?report.model:null,selectLineup(a,row.week,scenario),histories,players),
    scenario==='play'?forecasts.get(row.week+':'+b):distribution(calibrationReady?report.model:null,selectLineup(b,row.week,scenario),histories,players),{week:row.week,currentWeek:season.currentWeek})}))));
  const standings=simulateSeason({teams,schedule,forecasts,playoffConfig:playoffConfig(meta,teams),medianGame:season.medianGame,seed:meta.league_id+':'+last?.season+':'+last?.week+':normal-season-v1',expectedWeeks:season.remaining,expectedCompletedGames:Math.max(0,season.completedThrough-Number(meta.settings?.start_week||1)+1)*(season.medianGame?2:1)});
  return {league:{id:meta.league_id,name:meta.name,season:meta.season,teams,slots:slotInfo.slots},currentWeek:season.currentWeek,completedThrough:season.completedThrough,
    historyThrough:history.slots.at(-1),schedule,lineups,replacementLineups,comparisons,standings,uncertainty:calibrationReady?{experimental:true,model:'normal-season-v1',historicalReference:{model:'paired-empirical-v1',testMatchups:report.evaluation.matchups.n,rangeCoverage:report.evaluation.teamRanges.coverage}}:null,coverage:{scoring:unsupported,slots:slotInfo.unsupported,nflSchedule:nfl.issues,bestBall:season.bestBall,medianGame:season.medianGame},
    generatedAt:new Date().toISOString(),stage:'season-preview',note:'Experimental full-game estimates and projected regular-season records. Current-week percentages are not live odds. Default playoff qualification and seeds are projected; championship outcomes and custom brackets are not yet modeled.'};
}
async function outlookAction(body,access,options={}){
  requireFeature(access,'leagueOutlook');
  if(typeof body.league_id!=='string'||!/^\d{10,22}$/.test(body.league_id))fail('Enter a numeric Sleeper league ID.',400);
  const data=await (options.load||loadInputs)(body.league_id,options);
  return buildPreview(data);
}
module.exports={outlookAction,buildPreview,loadInputs};
