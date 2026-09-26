'use strict';
// Run manually against a non-public work directory. Nothing is deployed or written to site data.
const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto');
const {historyPlan,evaluate}=require('../lib/outlook-research.cjs');
async function getJson(endpoint){
  const url='https://api.sleeper.app/v1/'+endpoint;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error('Sleeper returned HTTP '+response.status);
      const data=await response.json();
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Unexpected Sleeper data.');
      return data;
    }catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
  }
}
async function main(){
  const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
  if(!args.includes('--league')||!args.includes('--work-dir'))throw new Error('Supply --league NUMERIC_ID --work-dir NON_PUBLIC_DIRECTORY.');
  const league=value('--league'),root=path.resolve(value('--work-dir')),repo=path.resolve(__dirname,'..'),relative=path.relative(repo,root);
  if(!/^\d{10,22}$/.test(league))throw new Error('Invalid league ID.');
  if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw new Error('Research data must be stored outside the website repository.');
  await fs.mkdir(path.join(root,'cache'),{recursive:true});
  const [state,meta]=await Promise.all([getJson('state/nfl'),getJson('league/'+league)]);
  if(meta.sport!=='nfl'||String(meta.season)!==String(state.season)||!meta.scoring_settings)throw new Error('Current NFL league with scoring settings required.');
  async function cached(name,endpoint){
    const file=path.join(root,'cache',name+'.json');
    if(!args.includes('--refresh')){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}}
    const data=await getJson(endpoint);
    await fs.writeFile(file,JSON.stringify(data),'utf8');
    return data;
  }
  const players=await cached('players-'+state.season,'players/nfl'),slots=historyPlan(state),weeks=[];
  if(Object.values(players).filter(p=>['QB','RB','WR','TE'].includes(p?.position)).length<100)throw new Error('Player registry appears incomplete; no report written.');
  for(let i=0;i<slots.length;i+=3){
    const batch=slots.slice(i,i+3);
    weeks.push(...await Promise.all(batch.map(s=>cached(`stats-${s.season}-${s.week}`,`stats/nfl/regular/${s.season}/${s.week}`))));
    console.log(`Historical weeks ready: ${weeks.length}/${slots.length}`);
  }
  for(let i=0;i<weeks.length;i++)if(Object.values(weeks[i]).filter(s=>Number(s?.gms_active??s?.gp)>0).length<100)throw new Error(`Incomplete stats for ${slots[i].season} week ${slots[i].week}; no report written.`);
  const report=evaluate({slots,weeks,players,scoring:meta.scoring_settings});
  report.generatedAt=new Date().toISOString();
  // Keep the exact data fingerprints and cutoff beside the report, outside the site.
  const hash=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
  await fs.writeFile(path.join(root,'inputs.json'),JSON.stringify({state,scoring:meta.scoring_settings,generatedAt:report.generatedAt,registryHash:hash(players),weeks:slots.map((slot,i)=>({...slot,sha256:hash(weeks[i])}))},null,2)+'\n','utf8');
  await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify({period:report.period,selected:report.selected,holdout:report.results.holdout.establishedRole,intervals:report.intervals,availability:report.roleForecastAvailability,coverage:report.coverage},null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={getJson};
