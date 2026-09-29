'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {loadInputs,buildPreview}=require('../lib/league-outlook.cjs');
const {formatKey}=require('../lib/outlook-uncertainty.cjs');

async function setup(t,{week=4,last={season:2026,week:2},empty=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'outlook-history-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.mkdir(path.join(directory,'cache'));
  const id='1234567890123456789',meta={league_id:id,sport:'nfl',name:'History fallback',season:'2026',total_rosters:4,roster_positions:['QB','BN'],scoring_settings:{pass_td:4},settings:{playoff_week_start:15,playoff_teams:4,playoff_seed_type:1,playoff_round_type:0,last_scored_leg:week-1}};
  const state={season:'2026',week,season_type:'regular'};
  const nfl='ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');
  const players=Object.fromEntries(Array.from({length:4},(_,i)=>['q'+i,{position:'QB',fantasy_positions:['QB'],team:nfl[i],status:'Active',active:true,depth_chart_order:1,full_name:'Quarterback '+i}]));
  const rosters=Array.from({length:4},(_,i)=>({roster_id:i+1,players:['q'+i],settings:{wins:i<2?week-1:0,losses:i<2?0:week-1,ties:0,fpts:100+i,fpts_against:100-i}}));
  const rawSchedule=Array.from({length:18},(_,i)=>i+1).flatMap(w=>Array.from({length:16},(_,j)=>j).filter(j=>w!==17||j>=8).filter(j=>w!==18||j<8).map(j=>({game_id:w+'-'+j,week:w,home:nfl[j*2],away:nfl[j*2+1],date:'2026-10-01',status:'pre_game'})));
  const slots=empty?[]:[{season:2026,week},last,{season:2025,week:18}];
  await fs.writeFile(path.join(directory,'inputs.json'),JSON.stringify({weeks:slots}));
  for(const slot of slots)await fs.writeFile(path.join(directory,`cache/stats-${slot.season}-${slot.week}.json`),JSON.stringify(Object.fromEntries(Object.keys(players).map(id=>[id,{gms_active:1,pass_td:slot===last?2:1000,off_snp:60,tm_off_snp:60}]))));
  await fs.writeFile(path.join(directory,'uncertainty-report.json'),JSON.stringify({leagueId:id,format:formatKey(meta),historyThrough:last,model:{available:true,before:202601,residuals:[-10,0,10]}}));
  const calls=[],fetcher=async url=>{
    const endpoint=url.replace('https://api.sleeper.app/','');calls.push(endpoint);
    let value;
    if(endpoint==='v1/state/nfl')value=state;
    else if(endpoint==='v1/league/'+id)value=meta;
    else if(endpoint.endsWith('/rosters'))value=rosters;
    else if(endpoint.endsWith('/users'))value=[];
    else if(endpoint==='v1/players/nfl')value=players;
    else if(endpoint==='schedule/nfl/regular/2026')value=rawSchedule;
    else if(endpoint.includes('/matchups/'))value=rosters.map((r,i)=>({roster_id:r.roster_id,matchup_id:Math.floor(i/2)+1,starters:r.players}));
    else throw new Error('Unexpected source '+endpoint);
    return {ok:true,json:async()=>value};
  };
  return {directory,fetcher,id,last,calls,rosters,week};
}

for(const options of [{week:4,last:{season:2026,week:2}},{week:10,last:{season:2026,week:2}},{week:1,last:{season:2025,week:17}}]){
  test(`week ${options.week} retains season and playoff forecasts with history through ${options.last.season}/${options.last.week}`,async t=>{
    const f=await setup(t,options),input=await loadInputs(f.id,f),result=buildPreview(input);
    assert.deepEqual(input.history.slots,[f.last]); // Current-week and Week 18 poison excluded.
    assert.deepEqual(result.historyThrough,f.last);
    assert.equal(result.currentWeek,f.week);
    assert.equal(result.completedThrough,f.week-1);
    assert.equal(result.standings.available,true,result.standings.reason);
    assert.ok(result.standings.playoffs.path);
    assert.ok(result.standings.teams.every(team=>Number.isFinite(team.playoffs.titleChance)));
    assert.ok(result.comparisons.length>0);
    assert.ok(result.comparisons.every(c=>c.available&&Number.isFinite(c.probability.win)));
    assert.ok(result.lineups.flatMap(l=>l.lineup).filter(r=>r.player).every(r=>r.player.points===8));
    result.league.teams.forEach((team,i)=>assert.equal(team.record.wins,f.rosters[i].settings.wins));
    assert.ok(f.calls.includes('v1/league/'+f.id+'/matchups/'+f.week));
    assert.ok(f.calls.includes('schedule/nfl/regular/2026'));
    assert.ok(result.standings.teams.every(team=>Math.abs(team.expected.wins+team.expected.losses+team.expected.ties-14)<.001));
  });
}

test('missing history remains a genuine data error, not a fabricated forecast',async t=>{
  const f=await setup(t,{empty:true});
  await assert.rejects(()=>loadInputs(f.id,f),/Player history is not available/);
});
