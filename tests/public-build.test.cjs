'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {build,PUBLIC_DATA}=require('../scripts/build-public-site.cjs');
test('static deployment excludes all weekly data and server files while preserving public pages/assets',()=>{
  const root=path.resolve(__dirname,'..'),output=build(root);
  for(const name of fs.readdirSync(path.join(root,'data')).filter(n=>n.startsWith('weekly_points_')))
    assert.equal(fs.existsSync(path.join(output,'data',name)),false,name);
  for(const name of ['lib','api','scripts','supabase','tests','.env.membership-development','.git','AGENTS.md'])assert.equal(fs.existsSync(path.join(output,name)),false,name);
  for(const name of ['best_available.html','median_rankings.html','premium-page.js','median-page.js','median_team.js','account.html','index.html','assets/Logos/favicon.svg',...PUBLIC_DATA.map(n=>'data/'+n)])assert.ok(fs.existsSync(path.join(output,name)),name);
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json')));
  assert.equal(config.outputDirectory,'public-build');assert.match(config.buildCommand,/build-public-site/);
  assert.equal(config.functions['api/account.js'].includeFiles,'data/weekly_points_current.json');
  for(const name of ['best_available.html','median_rankings.html']){
    const html=fs.readFileSync(path.join(output,name),'utf8');
    assert.doesNotMatch(html,/ADMIN_PASSWORD|dt_admin_unlocked|weekly_points_current/);
    assert.match(html,/premium-page.js/);
  }
});
