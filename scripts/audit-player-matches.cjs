'use strict';
// Read-only audit: optional first argument is a previously downloaded Sleeper registry.
const fs=require('node:fs/promises');
const {matchRankings}=require('../sleeper_data.js');
const {parseCSV}=require('../lib/devy-simulator.cjs');
async function main(){
 const args=process.argv.slice(2), markdown=args.includes('--markdown'), snapshot=args.find(a=>!a.startsWith('--'));
 const players=snapshot?JSON.parse(await fs.readFile(snapshot,'utf8')):await fetch('https://api.sleeper.app/v1/players/nfl',{signal:AbortSignal.timeout(60000)}).then(r=>{if(!r.ok)throw new Error(`Sleeper HTTP ${r.status}`);return r.json();});
 if(!players||Array.isArray(players)||Object.keys(players).length<100)throw new Error('Expected the full Sleeper NFL player registry.');
 const rankings=require('../data/nfl_rankings.json').rankings,sheets=require('../data/site_sheets.json').sheets;
 const sources={...rankings,...Object.fromEntries(['league_rankings_1','league_rankings_2','league_rankings_3'].map(k=>[k,parseCSV(sheets[k].csv)]))};
 const results=Object.fromEntries(Object.entries(sources).map(([name,rows])=>{
  const {report}=matchRankings(rows,players);
  return [name,{counts:Object.fromEntries(['exact','suffix','alias','unmatched','ambiguous','position-mismatch'].map(k=>[k,report.filter(r=>r.status===k).length])),review:report.filter(r=>r.status!=='exact')}];
 }));
 const checkedAt=new Date().toISOString();
 if(markdown){
  console.log('# Player matching check\n\nChecked: '+checkedAt+'\n\nMatches use Sleeper IDs after checking the names and positions. Suffixes are automatic; nickname/spelling exceptions are reviewed ID mappings. No player scores are changed.\n');
  console.log('| Rankings list | Exact | Suffix | Reviewed alias | Needs review |\n|---|---:|---:|---:|---:|');
  for(const [name,result] of Object.entries(results)){const c=result.counts;console.log(`| ${name} | ${c.exact} | ${c.suffix} | ${c.alias} | ${c.unmatched+c.ambiguous+c['position-mismatch']} |`);}
  console.log('\n## Needs review\n\nA position mismatch needs a spreadsheet decision; an ambiguous name needs a checked Sleeper ID. Do not change a score just to make a name match.\n');
  const seen=new Set();
  for(const result of Object.values(results))for(const r of result.review.filter(r=>!['suffix','alias'].includes(r.status))){const k=JSON.stringify(r);if(seen.has(k))continue;seen.add(k);console.log(`- ${r.name} (${r.position}): ${r.status}; Sleeper: ${r.candidates.join(', ')||'no matching player found'}.`);}
  if(!seen.size)console.log('None.');
  console.log('\n## Automatically resolved names (Overall)\n');
  for(const r of results.overall.review.filter(r=>['suffix','alias'].includes(r.status)))console.log(`- ${r.name} → ${r.sleeperName}; Sleeper ID ${r.playerId} (${r.status}).`);
 }else console.log(JSON.stringify({checkedAt,registrySource:snapshot?'local snapshot':'live Sleeper API',note:'Review unresolved names before changing rankings. No automatic fuzzy matching or score edits.',results},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
