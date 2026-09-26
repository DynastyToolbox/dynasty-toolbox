'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {playerHistories,evaluateStarterRows}=require('../lib/outlook-lineups.cjs');
const {starterSlots}=require('../lib/outlook-foundation.cjs');
const {fit,backtest,formatKey}=require('../lib/outlook-uncertainty.cjs');
async function main(){
  const arg=process.argv[2];if(!arg)throw new Error('Supply the existing private research directory. Add --fetch to download missing historical matchups.');
  const root=path.resolve(arg),repo=path.resolve(__dirname,'..'),relative=path.relative(repo,root);
  if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw new Error('Research must remain outside the website repository.');
  const read=async n=>JSON.parse(await fs.readFile(path.join(root,n),'utf8'));
  const [inputs,snapshot,previous]=await Promise.all(['inputs.json','lineup-snapshot.json','previous-league.json'].map(read));
  const current=snapshot.meta,trainingSeason=Number(current.season)-1,before=trainingSeason*100+9;
  if(String(previous.league_id)!==String(current.previous_league_id)||Number(previous.season)!==trainingSeason)throw new Error('Previous league does not match.');
  if(formatKey(previous)!==formatKey(current))throw new Error('Starting slots or scoring changed; do not reuse these residuals across formats.');
  if(starterSlots(current).unsupported.length||current.settings.best_ball||previous.settings.best_ball)throw new Error('Only supported offensive non-best-ball lineups can enter this experiment.');
  const slots=inputs.weeks.map(({season,week})=>({season,week})),weeks=await Promise.all(slots.map(s=>read(`cache/stats-${s.season}-${s.week}.json`)));
  const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
  if(weeks.some((data,i)=>hash(data)!==inputs.weeks[i].sha256))throw new Error('Historical data changed; rebuild the baseline first.');
  const rows=[],coverage=[],fingerprints=[];
  for(const meta of [previous,current]){
    const end=Number(meta.season)===Number(current.season)?Number(snapshot.state.week)-1:Math.min(17,meta.settings.playoff_week_start-1);
    const work=Array.from({length:end},(_,i)=>i+1);
    for(let offset=0;offset<work.length;offset+=3){
      const batch=await Promise.all(work.slice(offset,offset+3).map(async week=>{
        const name=`matchups-${meta.season}-${week}.json`;let matchups;
        try{matchups=await read(name);}catch(error){
          if(error.code!=='ENOENT'||!process.argv.includes('--fetch'))throw error;
          const r=await fetch(`https://api.sleeper.app/v1/league/${meta.league_id}/matchups/${week}`,{signal:AbortSignal.timeout(20000)});
          if(!r.ok)throw new Error('Sleeper historical matchups HTTP '+r.status);matchups=await r.json();
          if(!Array.isArray(matchups)||matchups.length!==meta.total_rosters)throw new Error('Incomplete historical matchup response.');
          await fs.writeFile(path.join(root,name),JSON.stringify(matchups),'utf8');
        }
        if(!Array.isArray(matchups)||matchups.length!==meta.total_rosters||new Set(matchups.map(r=>String(r.roster_id))).size!==matchups.length)throw new Error('Invalid historical roster coverage.');
        return {week,matchups,name};
      }));
      for(const {week,matchups,name}of batch){
        fingerprints.push({name,sha256:hash(matchups)});
        const histories=playerHistories({slots,weeks,players:snapshot.players,scoring:meta.scoring_settings,season:meta.season,week});
        const result=evaluateStarterRows({matchups,histories,players:snapshot.players,slots:starterSlots(meta).slots});
        for(const row of result.teams)rows.push({...row,season:Number(meta.season),week,matchupId:matchups.find(m=>String(m.roster_id)===String(row.rosterId)).matchup_id});
        coverage.push({season:Number(meta.season),week,attempted:result.attempted,complete:result.complete,excluded:result.excludedReasons});
      }
    }
  }
  const model=fit(rows,{before}),holdout=rows.filter(r=>r.season*100+r.week>=before),evaluation=backtest(model,holdout);
  const report={generatedAt:new Date().toISOString(),leagueId:current.league_id,format:formatKey(current),calibrationThrough:{season:trainingSeason,week:8},historyThrough:slots.at(-1),model,evaluation,coverage,
    fingerprints:{history:inputs.weeks,registry:hash(snapshot.players),matchups:fingerprints},
    limitations:['Baseline selection and residual fitting share the first eight weeks; all later outcomes are evaluation only.','Complete historical starters are known after the fact. Missing/early-history starters, DNPs and partial lineups are excluded.','One league and a small number of weeks do not establish general calibration; repeated teams/weeks are not independent samples.','Paired team errors preserve aggregate observed matchup dependence, not each proposed lineup’s individual NFL stacks or correlations.','No injury scenarios, current-week conditioning, roster changes, playoff reseeding or season simulation.','The symmetric residual model treats historical opponents as exchangeable; it does not establish stronger/weaker-team error distributions.']};
  await fs.writeFile(path.join(root,'uncertainty-report.json'),JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify({calibration:{teams:model.teamCount,pairs:model.pairCount,weeks:model.weekCount,available:model.available},evaluation:{...evaluation,games:undefined},coverage},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
