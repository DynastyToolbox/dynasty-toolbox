'use strict';
const {nflSchedule}=require('./outlook-lineups.cjs');
const {formatKey}=require('./outlook-uncertainty.cjs');
const {metrics}=require('./outlook-research.cjs');
const round=n=>Math.round(n*10000)/10000;
function freezePreview({preview,meta,rawSchedule,week,now=new Date()}){
  if(!Number.isInteger(week)||week<1||week>17||week<=preview.currentWeek)throw new Error('Capture a future regular-season week.');
  const nfl=nflSchedule(rawSchedule,meta.season),games=nfl.games.filter(g=>g.week===week),at=new Date(now).getTime();
  // The source supplies dates, not kickoff times. Require capture before UTC
  // midnight on the earliest game date, deliberately stricter than kickoff.
  if(!Number.isFinite(at)||!nfl.valid||!games.length||games.some(g=>g.status!=='pre_game'||!Number.isFinite(Date.parse(g.date))||at>=Date.parse(g.date)))throw new Error('Capture must precede every NFL game date in a confirmed schedule.');
  const scheduled=preview.schedule.find(s=>s.week===week);
  if(!scheduled||scheduled.issues.length||!preview.uncertainty)throw new Error('A confirmed fantasy schedule and matching calibration are required.');
  const scenarios=['play','replace'].map(scenario=>({scenario,
    teams:preview.league.teams.map(team=>{
      const lineup=(scenario==='replace'?preview.replacementLineups.find(l=>l.week===week&&String(l.rosterId)===team.id):null)||preview.lineups.find(l=>l.week===week&&String(l.rosterId)===team.id);
      const complete=!!lineup?.lineup.length&&!lineup.unfilled.length&&!lineup.pendingResults&&lineup.lineup.every(r=>r.player&&Number.isFinite(r.player.points));
      return {id:team.id,complete,predicted:complete?lineup.modeledPoints:null,starters:lineup?.lineup.map(r=>r.player?.id||null)||[],limitedHistory:!!lineup?.lineup.some(r=>r.player?.limitedHistory),uncertainStarters:lineup?.lineup.flatMap(r=>r.player?.conditional?[r.player.id]:[])||[]};
    }),comparisons:preview.comparisons.filter(c=>c.week===week&&c.scenario===scenario).map(c=>structuredClone(c))}));
  if(scenarios.some(s=>s.comparisons.length!==scheduled.pairs.length))throw new Error('Incomplete frozen comparison coverage.');
  return {schema:1,capturedAt:new Date(at).toISOString(),leagueId:meta.league_id,season:Number(meta.season),week,format:formatKey(meta),historyThrough:preview.historyThrough,earliestGameDate:games.map(g=>g.date).sort()[0],scenarios};
}
function evaluateFrozen(frozen,{meta,state,rawSchedule,matchups}){
  if(meta.league_id!==frozen.leagueId||Number(meta.season)!==frozen.season||formatKey(meta)!==frozen.format)throw new Error('League or scoring/lineup format changed since capture.');
  const nfl=nflSchedule(rawSchedule,frozen.season),games=nfl.games.filter(g=>g.week===frozen.week);
  if(Number(state.season)!==frozen.season||Number(state.week)<=frozen.week||!nfl.valid||!games.length||games.some(g=>g.status!=='complete'))throw new Error('Wait until the captured NFL week is fully completed and the season state has advanced.');
  const ids=frozen.scenarios[0].teams.map(t=>t.id);
  if(!Array.isArray(matchups)||matchups.length!==ids.length||new Set(matchups.map(r=>String(r.roster_id))).size!==ids.length||matchups.some(r=>!ids.includes(String(r.roster_id))))throw new Error('Final matchup roster coverage is incomplete.');
  const actual=new Map(),excluded={};
  for(const row of matchups){
    const id=String(row.roster_id),starters=Array.isArray(row.starters)?row.starters.map(String).filter(p=>p!=='0'):null;
    const expected=frozen.scenarios[0].teams.find(t=>t.id===id).starters.length;
    let reason=row.custom_points!=null?'commissioner_override':!starters||row.starters.length!==expected||new Set(starters).size!==starters.length?'invalid_starters':!Number.isFinite(row.points)||starters.some(p=>!Number.isFinite(row.players_points?.[p]))?'missing_final_points':null;
    if(!reason&&Math.abs(starters.reduce((n,p)=>n+row.players_points[p],0)-row.points)>.05)reason='unreconciled_total';
    if(reason){excluded[id]=reason;continue;}
    actual.set(id,{points:row.points,starters,matchupId:row.matchup_id});
  }
  const scenarios=frozen.scenarios.map(s=>{
    const scoreRows=s.teams.filter(t=>t.complete&&actual.has(t.id)).map(t=>({predicted:t.predicted,actual:actual.get(t.id).points,limited:t.limitedHistory,agreement:t.starters.filter(id=>actual.get(t.id).starters.includes(id)).length/t.starters.length}));
    let gamesScored=0,ties=0,brier=0,ranges=0,covered=0;const skipped={};
    for(const c of s.comparisons){
      const [a,b]=c.teams.map(id=>actual.get(id));
      const reason=!c.available?c.reason:!a||!b?'missing_actual':a.matchupId==null||a.matchupId!==b.matchupId?'opponent_changed':null;
      if(reason){skipped[reason]=(skipped[reason]||0)+1;continue;}
      for(const [value,range]of [[a.points,c.a],[b.points,c.b]]){ranges++;if(value>=range.low&&value<=range.high)covered++;}
      if(a.points===b.points){ties++;continue;}
      gamesScored++;brier+=(c.probability.expectedResult-(a.points>b.points?1:0))**2;
    }
    return {scenario:s.scenario,teamScores:metrics(scoreRows),establishedTeamScores:metrics(scoreRows.filter(r=>!r.limited)),earlyHistoryTeams:scoreRows.filter(r=>r.limited).length,meanStarterAgreement:scoreRows.length?round(scoreRows.reduce((n,r)=>n+r.agreement,0)/scoreRows.length):null,winChances:{n:gamesScored,ties,brier:gamesScored?round(brier/gamesScored):null,coinFlipBrier:gamesScored?.25:null,skipped},ranges:{n:ranges,coverage:ranges?round(covered/ranges):null}};
  });
  return {schema:1,evaluatedAt:new Date().toISOString(),leagueId:frozen.leagueId,season:frozen.season,week:frozen.week,capturedAt:frozen.capturedAt,scenarios,excluded,
    scope:'Prospective preweek candidate lineups versus final fantasy team results. Two scenarios share the same outcomes; they are not independent tests.'};
}
module.exports={freezePreview,evaluateFrozen};
