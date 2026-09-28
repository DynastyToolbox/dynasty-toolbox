'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {loadInputs,buildPreview}=require('../lib/league-outlook.cjs');
const {freezePreview,evaluateFrozen}=require('../lib/outlook-audit.cjs');
const hash=x=>createHash('sha256').update(x).digest('hex');
async function main(){
  const [mode,directory,id,weekArg]=process.argv.slice(2),week=Number(weekArg);
  if(!['capture','evaluate'].includes(mode)||!directory||!/^\d{10,22}$/.test(id||'')||!Number.isInteger(week))throw new Error('Usage: audit_outlook.cjs capture|evaluate PRIVATE_DIRECTORY LEAGUE_ID WEEK');
  const root=path.resolve(directory),repo=path.resolve(__dirname,'..'),relative=path.relative(repo,root);
  if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw new Error('Audit files must stay outside the website repository.');
  const audit=path.join(root,'prospective-audit');await fs.mkdir(audit,{recursive:true});
  const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
  const protocolFile=path.join(audit,id+'-protocol.json');
  if(mode==='capture'){
    // Freeze one predeclared protocol; do not overwrite snapshots or silently
    // mix changed algorithms into an existing prospective evaluation.
    const sourceFiles=['outlook-foundation.cjs','outlook-research.cjs','outlook-lineups.cjs','outlook-uncertainty.cjs','outlook-season.cjs','outlook-playoffs.cjs','outlook-calibration.cjs','../outlook-bracket.js','league-outlook.cjs'];
    const sources=await Promise.all(sourceFiles.map(async name=>({name,sha256:hash(await fs.readFile(path.join(repo,'lib',name)))})));
    const uncertainty=await read(path.join(root,'uncertainty-report.json'));
    const protocol={schema:1,leagueId:id,season:2026,weeks:[4,5,6,7,8],sources,modelHash:hash(JSON.stringify(uncertainty.model)),primary:'Brier score against 50% and nominal 80% interval coverage, reported for each scenario separately; no selection of the better scenario after outcomes.',secondary:'Team point error, starter agreement and exclusion counts; early-history cases reported separately.',limits:'Small single-league test; no launch-readiness claim. Dates and predictions must be captured before play. No existing holdout retuning.'};
    let existing=null;try{existing=await read(protocolFile);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(existing&&JSON.stringify(existing)!==JSON.stringify(protocol))throw new Error('Audit protocol or model changed. Start a separately labeled experiment rather than mixing versions.');
    if(!protocol.weeks.includes(week))throw new Error('This predeclared audit covers 2026 Weeks 4–8.');
    const target=path.join(audit,`${id}-${protocol.season}-${week}.json`);
    try{await fs.access(target);throw new Error('This week already has a frozen snapshot; it cannot be overwritten.');}catch(e){if(e.code!=='ENOENT')throw e;}
    const input=await loadInputs(id,{directory:root});
    if(Number(input.meta.season)!==protocol.season)throw new Error('The audit season does not match.');
    const frozen=freezePreview({preview:buildPreview(input),meta:input.meta,rawSchedule:input.rawSchedule,week});
    frozen.protocolHash=hash(JSON.stringify(protocol));
    if(!existing)await fs.writeFile(protocolFile,JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
    await fs.writeFile(target,JSON.stringify(frozen,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({capturedAt:frozen.capturedAt,week,historyThrough:frozen.historyThrough,scenarios:frozen.scenarios.map(s=>({scenario:s.scenario,teams:s.teams.length,availableMatchups:s.comparisons.filter(c=>c.available).length})),file:target},null,2));
  }else{
    const protocol=await read(protocolFile),file=path.join(audit,`${id}-${protocol.season}-${week}.json`),frozen=await read(file);
    if(frozen.protocolHash!==hash(JSON.stringify(protocol)))throw new Error('Frozen protocol fingerprint does not match.');
    const source=async endpoint=>{const r=await fetch('https://api.sleeper.app/'+endpoint,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Sleeper HTTP '+r.status);return r.json();};
    const [meta,state,rawSchedule,matchups]=await Promise.all([source('v1/league/'+id),source('v1/state/nfl'),source('schedule/nfl/regular/'+protocol.season),source(`v1/league/${id}/matchups/${week}`)]);
    const result=evaluateFrozen(frozen,{meta,state,rawSchedule,matchups});
    await fs.writeFile(file.replace('.json','-results.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
