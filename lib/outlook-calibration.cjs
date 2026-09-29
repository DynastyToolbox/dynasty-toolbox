'use strict';
const {playerHistories,evaluateStarterRows}=require('./outlook-lineups.cjs');
const {starterSlots,scoringSupport}=require('./outlook-foundation.cjs');
const {offensiveView,offensiveMatchup}=require('./outlook-offense.cjs');
const {fit,formatKey}=require('./outlook-uncertainty.cjs');
// Fit each new league from its own completed games. Never borrow another
// league's errors, and never use a target week's results as its input history.
async function calibrateLeague({meta,state,players,history,source}){
  if(!starterSlots(offensiveView(meta)).slots.length||scoringSupport(meta.scoring_settings).length||meta.settings?.best_ball)return null;
  const leagues=[meta];
  if(/^\d{10,22}$/.test(String(meta.previous_league_id))){
    const previous=await source('v1/league/'+meta.previous_league_id);
    if(previous&&Number(previous.season)===Number(meta.season)-1&&formatKey(previous)===formatKey(meta)&&!previous.settings?.best_ball)leagues.unshift(previous);
  }
  const rows=[];
  for(const league of leagues){
    const end=Math.min(17,Number(league.settings?.playoff_week_start)-1,Number(league.season)===Number(state.season)?Math.min(Number(state.week)-1,Number(meta.settings?.last_scored_leg??Number(state.week)-1)):17);
    const weeks=Array.from({length:Math.max(0,end-Number(league.settings?.start_week||1)+1)},(_,i)=>Number(league.settings?.start_week||1)+i);
    for(let offset=0;offset<weeks.length;offset+=3){
      const batch=await Promise.all(weeks.slice(offset,offset+3).map(async week=>({week,matchups:await source(`v1/league/${league.league_id}/matchups/${week}`)})));
      for(const {week,matchups}of batch){
        if(!Array.isArray(matchups)||matchups.length!==Number(league.total_rosters)||new Set(matchups.map(m=>String(m.roster_id))).size!==matchups.length)continue;
        const histories=playerHistories({...history,players,scoring:league.scoring_settings,season:league.season,week});
        const result=evaluateStarterRows({matchups:matchups.map(row=>offensiveMatchup(row,league)),histories,players,slots:starterSlots(offensiveView(league)).slots});
        for(const row of result.teams)rows.push({...row,season:Number(league.season),week,matchupId:matchups.find(m=>String(m.roster_id)===String(row.rosterId)).matchup_id});
      }
    }
  }
  return {leagueId:meta.league_id,format:formatKey(meta),historyThrough:history.slots.at(-1),model:fit(rows,{before:Number(state.season)*100+Number(state.week)}),source:'league-history'};
}
module.exports={calibrateLeague};
