'use strict';
// Offline, using the private snapshots created by research_outlook_lineups.cjs.
const fs=require('node:fs/promises'),path=require('node:path');
const {playerHistories,evaluateStarterRows}=require('../lib/outlook-lineups.cjs');
const {earlyEstimate,observation,metrics}=require('../lib/outlook-research.cjs');
const {starterSlots}=require('../lib/outlook-foundation.cjs');
async function main(){
  if(!process.argv[2])throw new Error('Supply an existing private Outlook research directory.');
  const root=path.resolve(process.argv[2]),relative=path.relative(path.resolve(__dirname,'..'),root);
  if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw new Error('Use a directory outside the website repository.');
  const read=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
  const [inputs,snapshot,previous,priorReport]=await Promise.all(['inputs.json','lineup-snapshot.json','previous-league.json','lineups-report.json'].map(read));
  const slots=inputs.weeks.map(({season,week})=>({season,week})),weeks=await Promise.all(slots.map(s=>read(`cache/stats-${s.season}-${s.week}.json`)));
  const playerRows=[],playerLast=[],roleRows=[],roleLast=[],priorTeams=[],extendedTeams=[],newTeams=[];
  for(let index=0;index<slots.length;index++){
    const target=slots[index];if(target.season<2025||target.season===2025&&target.week<9)continue;
    const histories=playerHistories({slots,weeks,players:snapshot.players,scoring:snapshot.meta.scoring_settings,season:target.season,week:target.week});
    for(const [id,history]of Object.entries(histories)){
      if(history.length>3)continue;
      const actual=observation(weeks[index][id],snapshot.players[id].position,snapshot.meta.scoring_settings);
      if(actual.status!=='active')continue;
      playerRows.push({actual:actual.points,predicted:earlyEstimate(history).points});playerLast.push({actual:actual.points,predicted:history.at(-1).points});
      if(history.some(h=>h.snap!==null&&h.snap>=.4)){roleRows.push(playerRows.at(-1));roleLast.push(playerLast.at(-1));}
    }
  }
  for(const evaluation of priorReport.evaluations){
    const league=Number(snapshot.meta.season)===evaluation.season?snapshot.meta:previous;
    const matchups=await read(`matchups-${evaluation.season}-${evaluation.week}.json`),histories=playerHistories({slots,weeks,players:snapshot.players,scoring:league.scoring_settings,season:evaluation.season,week:evaluation.week});
    const args={matchups,histories,players:snapshot.players,slots:starterSlots(league).slots};
    const old=evaluateStarterRows(args),extended=evaluateStarterRows({...args,allowLimited:true});
    priorTeams.push(...old.teams);extendedTeams.push(...extended.teams);newTeams.push(...extended.teams.filter(t=>!old.teams.some(o=>o.rosterId===t.rosterId)));
  }
  const report={generatedAt:new Date().toISOString(),playerGames:{earlyAverage:metrics(playerRows),previousGame:metrics(playerLast)},priorSubstantialRole:{earlyAverage:metrics(roleRows),previousGame:metrics(roleLast)},teamWeeks:{establishedOnly:metrics(priorTeams),includingLimited:metrics(extendedTeams),newlyCovered:metrics(newTeams)},limits:['Short-history player accuracy is conditional on an observed active target game, without predicting availability.','The all-player short-history cohort is dominated by low-output fringe players; the prior-substantial-role group is small.','Different team coverage groups are not interchangeable accuracy comparisons.','One-to-three-game estimates remain provisional; no history stays unknown. Historical starters do not validate automatic lineup choices.']};
  await fs.writeFile(path.join(root,'early-history-report.json'),JSON.stringify(report,null,2)+'\n','utf8');console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
