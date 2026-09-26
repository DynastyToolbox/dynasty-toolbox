'use strict';
const {SLOTS,starterSlots}=require('./outlook-foundation.cjs');
const {observation,predict,metrics}=require('./outlook-research.cjs');
const NFL=new Set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '));
const canonical=team=>({LA:'LAR',JAC:'JAX',WSH:'WAS'}[team]||team);
const round=n=>Math.round(n*100)/100;
function nflSchedule(rows,season){
  const issues=[],games=[],byWeek={},counts=Object.fromEntries([...NFL].map(t=>[t,0])),ids=new Set();
  let canceled=0;
  if(!Array.isArray(rows))return {valid:false,issues:['NFL schedule unavailable.'],games:[],byWeek:{},canceled};
  for(const row of rows){
    if(['canceled','cancelled'].includes(row.status)){canceled++;continue;}
    const g={...row,home:canonical(row.home),away:canonical(row.away),week:Number(row.week)};
    const year=Number(String(g.date).slice(0,4));
    if(!Number.isInteger(g.week)||g.week<1||g.week>18||!NFL.has(g.home)||!NFL.has(g.away)||g.home===g.away||![Number(season),Number(season)+1].includes(year)||!g.game_id){issues.push('Invalid NFL game record.');continue;}
    if(ids.has(g.game_id)){issues.push('Repeated NFL game ID.');continue;}ids.add(g.game_id);
    const week=byWeek[g.week]??={};
    if(week[g.home]||week[g.away])issues.push('An NFL team appears twice in a week.');
    week[g.home]=week[g.away]=g;counts[g.home]++;counts[g.away]++;games.push(g);
  }
  // Only infer byes from a structurally complete 32-team, 17-game season.
  if(games.length!==272||Object.values(counts).some(n=>n!==17)||Object.keys(byWeek).length!==18)issues.push('NFL schedule is incomplete; bye weeks cannot be confirmed.');
  return {valid:!issues.length,issues:[...new Set(issues)],games,byWeek,canceled};
}
function availability({id,player,roster,week,currentWeek,schedule}){
  const result=(status,reason,eligible=false)=>({status,reason,eligible});
  if(!Number.isInteger(week)||week<1||week>18||!Number.isInteger(currentWeek)||currentWeek<1||currentWeek>18||week<currentWeek)return result('unknown','invalid_week');
  if((roster.reserve||[]).map(String).includes(id))return result('excluded','fantasy_ir');
  if((roster.taxi||[]).map(String).includes(id))return result('excluded','fantasy_taxi');
  if(!player)return result('unknown','missing_player');
  const team=canonical(player.team);
  if(!NFL.has(team))return result('unknown','no_nfl_team');
  if(!schedule.valid)return result('unknown','schedule_unconfirmed');
  const game=schedule.byWeek[week]?.[team];
  if(!game)return result('excluded','bye');
  if(!['pre_game','in_progress','complete','halftime'].includes(game.status))return result('unknown','game_status');
  const injury=String(player.injury_status||'').toLowerCase(),status=String(player.status||'').toLowerCase();
  const unavailable=['out','ir','pup','sus','suspended','dnr'].includes(injury)||['injured reserve','physically unable to perform','inactive','practice squad'].includes(status)||player.active===false;
  if(unavailable)return week===currentWeek?result('excluded','currently_unavailable'):result('unknown','return_date_unknown');
  if(['questionable','doubtful','probable'].includes(injury))return result('conditional','injury_uncertain',true);
  if(injury||status!=='active')return result('unknown','unrecognized_status');
  return result('eligible','available_as_of_snapshot',true);
}
function bestLineup(slots,candidates){
  if(!Array.isArray(slots)||slots.length>40)throw new Error('Unsupported starting lineup size.');
  const seen=new Set();
  for(const p of candidates){
    if(!p.id||seen.has(p.id)||!Number.isFinite(p.points)||Math.abs(p.points)>1000||!Array.isArray(p.positions))throw new Error('Invalid or duplicate lineup candidate.');
    seen.add(p.id);
  }
  const players=[...candidates].sort((a,b)=>String(a.id).localeCompare(String(b.id))),n=slots.length,m=players.length+n;
  if(!n)return {lineup:[],modeledPoints:0,unfilled:[]};
  // Exact rectangular assignment (Hungarian algorithm). Fill as many legal slots
  // as possible first, then maximize points. Dummy columns represent unfilled slots.
  // This handles overlapping/restricted FLEX and multi-position players without greed.
  const bonus=2*players.reduce((sum,p)=>sum+Math.abs(p.points),0)+1,forbidden=bonus*(n+m+2);
  const cost=slots.map(slot=>Array.from({length:m},(_,j)=>j>=players.length?0:SLOTS[slot]?.some(pos=>players[j].positions.includes(pos))?-bonus-players[j].points:forbidden));
  const u=Array(n+1).fill(0),v=Array(m+1).fill(0),p=Array(m+1).fill(0),way=Array(m+1).fill(0);
  for(let i=1;i<=n;i++){
    p[0]=i;let j0=0;const min=Array(m+1).fill(Infinity),used=Array(m+1).fill(false);
    do{
      used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;
      for(let j=1;j<=m;j++)if(!used[j]){const cur=cost[i0-1][j-1]-u[i0]-v[j];if(cur<min[j]){min[j]=cur;way[j]=j0;}if(min[j]<delta){delta=min[j];j1=j;}}
      for(let j=0;j<=m;j++){if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;}j0=j1;
    }while(p[j0]!==0);
    do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0);
  }
  const lineup=slots.map(slot=>({slot,player:null}));
  for(let j=1;j<=m;j++)if(p[j]&&j<=players.length&&cost[p[j]-1][j-1]<0)lineup[p[j]-1].player=players[j-1];
  return {lineup,modeledPoints:round(lineup.reduce((sum,s)=>sum+(s.player?.points??0),0)),unfilled:lineup.flatMap((s,index)=>s.player?[]:[{index,slot:s.slot}])};
}
function playerHistories({slots,weeks,players,scoring,season,week}){
  const history={};
  for(let i=0;i<slots.length;i++){
    const slot=slots[i];if(slot.season*100+slot.week>=Number(season)*100+Number(week))continue;
    for(const [id,stats]of Object.entries(weeks[i])){
      const position=players[id]?.position;if(!['QB','RB','WR','TE'].includes(position))continue;
      const obs=observation(stats,position,scoring);
      if(obs.status==='active')(history[id]??=[]).push({...obs,season:slot.season,week:slot.week});
    }
  }
  return history;
}
function projectRoster({roster,players,histories,meta,schedule,week,currentWeek}){
  const {slots,unsupported}=starterSlots(meta),candidates=[],excluded=[],unresolved=[],warnings=[];
  const ids=[...new Set(['players','reserve','taxi'].flatMap(k=>Array.isArray(roster[k])?roster[k]:[]).filter(id=>id&&id!=='0').map(String))];
  for(const id of ids){
    const player=players[id],state=availability({id,player,roster,week,currentWeek,schedule});
    const detail={id,name:player?.full_name||[player?.first_name,player?.last_name].filter(Boolean).join(' ')||id,reason:state.reason};
    if(state.status==='excluded'){excluded.push(detail);continue;}
    const positions=player?.fantasy_positions?.length?player.fantasy_positions:[player?.position];
    if(!positions.some(pos=>slots.some(slot=>SLOTS[slot]?.includes(pos)))){if(!player||unsupported.includes(player.position))unresolved.push({...detail,reason:'unsupported_position'});continue;}
    if(!state.eligible){unresolved.push(detail);continue;}
    const history=histories[id]||[],points=predict(history,'blend4and16');
    if(points===null){unresolved.push({...detail,reason:'insufficient_history'});continue;}
    if(positions.includes('QB')&&(Number(player.depth_chart_order)>1||history.slice(-4).filter(h=>h.snap!=null&&h.snap>=.4).length<2)){
      unresolved.push({...detail,reason:'qb_role_uncertain'});continue;
    }
    const last=history.at(-1),age=(Number(meta.season)-last.season)*17+currentWeek-last.week;
    if(age>4){unresolved.push({...detail,reason:'stale_role_history'});continue;}
    if(state.status==='conditional')warnings.push(detail);
    candidates.push({...detail,positions,points,conditional:state.status==='conditional'});
  }
  const result=bestLineup(slots,candidates);
  if(unsupported.length)warnings.push({reason:'unsupported_slots',slots:unsupported});
  if(meta.settings?.best_ball===1)warnings.push({reason:'best_ball_not_modeled'});
  if(week===currentWeek&&schedule.games.some(g=>g.week===week&&g.status!=='pre_game'))warnings.push({reason:'week_started_lineup_locks_not_modeled'});
  const ready=!unsupported.length&&!unresolved.length&&!result.unfilled.length&&!warnings.length;
  return {...result,week,rosterId:roster.roster_id,excluded,unresolved,warnings,coverageComplete:ready,
    // Conditional model sum, never advertised as an unconditional team forecast.
    projectedTeamPoints:null,status:'research_lineup',assumption:'Current fantasy IR/taxi placement stays unchanged. Available players are assumed active; future roster moves and new injuries are not predicted.'};
}
function evaluateStarterRows({matchups,histories,players,slots,model='blend4and16'}){
  const teams=[],reasons={};
  for(const row of matchups){
    const issues=[],forecasts=[];
    if(!Array.isArray(row.starters)||row.starters.length!==slots.length)issues.push('lineup_shape');
    const used=new Set();
    for(const [index,idValue]of (row.starters||[]).entries()){
      const id=String(idValue),player=players[id],positions=player?.fantasy_positions?.length?player.fantasy_positions:[player?.position];
      if(!idValue||id==='0'||used.has(id)){issues.push('empty_or_duplicate_starter');continue;}used.add(id);
      if(!positions.some(pos=>SLOTS[slots[index]]?.includes(pos))){issues.push('unsupported_starter');continue;}
      const predicted=predict(histories[id]||[],model),actual=row.players_points?.[id];
      if(predicted===null){issues.push('insufficient_history');continue;}
      if(typeof actual!=='number'||!Number.isFinite(actual)){issues.push('missing_actual_points');continue;}
      forecasts.push({predicted,actual});
    }
    const actualSum=forecasts.reduce((sum,p)=>sum+p.actual,0);
    if(row.custom_points!=null)issues.push('commissioner_override');
    if(!issues.length&&(!Number.isFinite(row.points)||Math.abs(actualSum-row.points)>.05))issues.push('team_total_disagreement');
    for(const issue of new Set(issues))reasons[issue]=(reasons[issue]||0)+1;
    if(!issues.length)teams.push({rosterId:row.roster_id,predicted:forecasts.reduce((sum,p)=>sum+p.predicted,0),actual:row.points});
  }
  return {attempted:matchups.length,complete:teams.length,excludedReasons:reasons,metrics:metrics(teams),teams};
}
module.exports={nflSchedule,availability,bestLineup,playerHistories,projectRoster,evaluateStarterRows};
