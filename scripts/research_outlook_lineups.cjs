'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto');
const {plan,starterSlots}=require('../lib/outlook-foundation.cjs');
const {metrics}=require('../lib/outlook-research.cjs');
const {nflSchedule,playerHistories,projectRoster,evaluateStarterRows}=require('../lib/outlook-lineups.cjs');
async function source(endpoint){
  for(let attempt=0;attempt<3;attempt++)try{
    const r=await fetch('https://api.sleeper.app/'+endpoint,{signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw new Error('Sleeper HTTP '+r.status);
    const data=await r.json();if(!data||typeof data!=='object')throw new Error('Missing Sleeper data.');return data;
  }catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
}
async function main(){
  const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
  if(!args.includes('--league')||!args.includes('--work-dir'))throw new Error('Supply --league NUMERIC_ID --work-dir EXISTING_NON_PUBLIC_RESEARCH_DIRECTORY.');
  const id=value('--league'),root=path.resolve(value('--work-dir')),repo=path.resolve(__dirname,'..'),relative=path.relative(repo,root);
  if(!/^\d{10,22}$/.test(id))throw new Error('Invalid league ID.');
  if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw new Error('Research data must stay outside the website repository.');
  const read=async file=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
  const inputs=await read('inputs.json'),slots=inputs.weeks.map(({season,week})=>({season,week}));
  const weeks=await Promise.all(slots.map(s=>read(`cache/stats-${s.season}-${s.week}.json`)));
  const hash=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
  if(weeks.some((data,i)=>hash(data)!==inputs.weeks[i].sha256))throw new Error('Historical cache changed; rebuild the baseline report first.');
  const replay=args.includes('--snapshot')?await read('lineup-snapshot.json'):null;
  if(replay&&replay.meta.league_id!==id)throw new Error('Saved snapshot belongs to another league.');
  const [state,meta,rosters,players]=replay?[replay.state,replay.meta,replay.rosters,replay.players]:await Promise.all([source('v1/state/nfl'),source('v1/league/'+id),source('v1/league/'+id+'/rosters'),source('v1/players/nfl')]);
  const current=plan(meta,state);
  if(String(inputs.state.season)!==String(state.season)||inputs.state.week!==state.week)throw new Error('Historical cutoff is stale; rebuild the baseline research first.');
  if(!Array.isArray(rosters)||!rosters.length)throw new Error('League rosters unavailable.');
  const rawSchedule=replay?replay.nflSchedule:await source('schedule/nfl/regular/'+meta.season),schedule=nflSchedule(rawSchedule,meta.season);
  const generatedAt=new Date().toISOString();
  if(!replay)await fs.writeFile(path.join(root,'lineup-snapshot.json'),JSON.stringify({generatedAt,state,meta,rosters,players,nflSchedule:rawSchedule}),'utf8');
  const histories=playerHistories({slots,weeks,players,scoring:meta.scoring_settings,season:meta.season,week:state.week});
  const lineups=current.remaining.flatMap(week=>rosters.map(roster=>projectRoster({roster,players,histories,meta,schedule,week,currentWeek:state.week})));
  console.log(`Checked ${lineups.length} future/current team lineups. NFL schedule valid: ${schedule.valid}.`);
  let previous=null;
  if(meta.previous_league_id){
    try{if(!replay)throw new Error('Refresh');previous=await read('previous-league.json');}
    catch{previous=await source('v1/league/'+meta.previous_league_id);await fs.writeFile(path.join(root,'previous-league.json'),JSON.stringify(previous),'utf8');}
    if(previous.league_id!==meta.previous_league_id)throw new Error('Previous-league cache mismatch.');
  }
  const evaluations=[];
  const comparison={blend4and16:[],lastGame:[]};
  for(const league of [previous,meta].filter(Boolean)){
    if(![Number(meta.season)-1,Number(meta.season)].includes(Number(league.season)))continue;
    const end=Number(league.season)===Number(meta.season)?current.completedThrough:Math.min(17,Number(league.settings?.playoff_week_start)-1);
    const start=Number(league.season)===Number(meta.season)?1:9; // Never evaluate the model-selection weeks as holdout.
    const matchWeeks=Array.from({length:Math.max(0,end-start+1)},(_,i)=>i+start);
    for(let offset=0;offset<matchWeeks.length;offset+=3){
      const batch=matchWeeks.slice(offset,offset+3),rows=await Promise.all(batch.map(week=>replay?read(`matchups-${league.season}-${week}.json`):source(`v1/league/${league.league_id}/matchups/${week}`)));
      for(let i=0;i<batch.length;i++){
        const week=batch[i];if(!Array.isArray(rows[i]))throw new Error('Historical league matchups unavailable.');
        const history=playerHistories({slots,weeks,players,scoring:league.scoring_settings,season:Number(league.season),week});
        const results={};
        for(const model of Object.keys(comparison)){
          const result=evaluateStarterRows({matchups:rows[i],histories:history,players,slots:starterSlots(league).slots,model});
          comparison[model].push(...result.teams);results[model]=result;
        }
        evaluations.push({season:Number(league.season),week,results});
        await fs.writeFile(path.join(root,`matchups-${league.season}-${week}.json`),JSON.stringify(rows[i]),'utf8');
      }
    }
  }
  const counts=(rows,key)=>Object.fromEntries([...new Set(rows.map(r=>r[key]))].sort().map(reason=>[reason,rows.filter(r=>r[key]===reason).length]));
  const summary={generatedAt,sourceSnapshotAt:replay?.generatedAt||generatedAt,nflSchedule:{valid:schedule.valid,issues:schedule.issues,canceled:schedule.canceled,games:schedule.games.length},lineups:lineups.length,
    lineupsWithFullModeledSlots:lineups.filter(l=>!l.unfilled.length).length,lineupsWithUnresolvedPlayers:lineups.filter(l=>l.unresolved.length).length,
    uniqueUnresolvedPlayers:counts([...new Map(lineups.flatMap(l=>l.unresolved).map(p=>[p.id+':'+p.reason,p])).values()],'reason'),
    excludedPlayerWeeks:counts(lineups.flatMap(l=>l.excluded),'reason'),
    teamBacktest:{attempted:evaluations.reduce((s,e)=>s+e.results.blend4and16.attempted,0),models:Object.fromEntries(Object.entries(comparison).map(([m,rows])=>[m,metrics(rows)])),excludedReasons:evaluations.reduce((sum,e)=>{for(const [k,n]of Object.entries(e.results.blend4and16.excludedReasons))sum[k]=(sum[k]||0)+n;return sum;},{})},
    limits:['Internal conditional lineup estimates only; no public page or win odds.','Actual historical starters validate points conditional on known lineups, not historical availability or automatic lineup choices.','Teams missing even one starter projection are excluded from complete-team error, never scored using a partial total.','Current-week lineups after games begin require lock handling before use.','Current fantasy IR/taxi placement is held fixed; future activation and return dates are unknown.','Current player positions are used for historical eligibility; role changes and rookie priors remain unresolved.']};
  await fs.writeFile(path.join(root,'lineups-report.json'),JSON.stringify({summary,lineups,evaluations},null,2)+'\n','utf8');
  console.log(JSON.stringify(summary,null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
