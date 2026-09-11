// Run with node scripts/test_sleeper_data.cjs. No network or live league needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../sleeper_data.js'), 'utf8');
let tests = 0;
function runtime(extra = {}) {
  const context = vm.createContext({ Response, AbortSignal, Date, ...extra });
  vm.runInContext(source, context);
  return context.DynastySleeper;
}
const api = runtime();
const base = () => ({ meta: { season: '2026', status: 'in_season', settings: { type: 2, draft_rounds: 2 } },
  rosters: [1,2,3].map(id => ({ roster_id: id, owner_id: 'user' + id, players: [] })),
  drafts: [{ season: '2026', status: 'complete' }], traded: [] });
const pick = (origin, owner, previous = origin) => ({ season: '2027', round: 1, roster_id: origin, owner_id: owner, previous_owner_id: previous });
function check(name, fn) { fn(); tests++; console.log('PASS', name); }
(async () => {
check('multi-hop trade preserves origin, own picks, and total inventory', () => {
  const data = base(); data.traded = [pick(1,3,2), pick(2,3)];
  const out = api.withPicks(data);
  assert.equal(out.flatMap(r=>r.picks).length, 18);
  assert.equal(out[2].picks.filter(p=>p.season==='2027' && p.round===1).length, 3);
  assert.equal(out[0].picks.some(p=>p.season==='2027' && p.round===1), false);
  assert.equal(api.originName(pick(1,3,2), data.rosters, [{user_id:'user1',display_name:'Original'}]), 'Original');
  assert.equal(data.rosters[0].picks, undefined);
});
check('return to original owner, duplicate record, and mixed ID types', () => {
  const data = base(); data.traded = [pick('1','1','3'), pick('1','1','3')];
  const out = api.withPicks(data);
  assert.equal(out.flatMap(r=>r.picks).length, 18);
  assert.equal(out[0].picks.filter(p=>p.season==='2027' && p.round===1).length, 1);
});
check('invalid ownership fails instead of inventing scores', () => {
  const data = base(); data.traded=[pick(1,99)]; assert.throws(()=>api.withPicks(data), /do not match/);
  data.traded=[pick(1,2),pick(1,3)]; assert.throws(()=>api.withPicks(data), /conflicting/);
});
check('completed and out-of-window trades cannot add extra assets', () => {
  const data=base(); data.traded=[{...pick(1,2),season:'2026'}, {...pick(1,2),season:'2030'}];
  assert.equal(api.withPicks(data).flatMap(r=>r.picks).length,18);
});
check('pre-draft league without completed drafts uses actual season', () => {
  const data=base(); data.meta.status='pre_draft';data.drafts=[];
  const picks=api.withPicks(data).flatMap(r=>r.picks);
  assert.equal(picks[0].season,'2026');assert.equal(picks.at(-1).season,'2028');
});
check('draft in progress is explicit; redraft has no future rookie assets', () => {
  const data=base();data.drafts[0].status='drafting';assert.throws(()=>api.withPicks(data),/in progress/);
  data.meta.settings.type=0;assert.equal(api.withPicks(data).flatMap(r=>r.picks).length,0);
});
check('pick scoring uses published round labels, preserves zero, identifies missing', () => {
  const p=pick(1,2);assert.equal(api.pickLabel(p),'2027 1st Round');
  assert.equal(api.pickScore(p,{'20271stround':1234}),1234);
  assert.equal(api.pickScore(p,{'20271stround':0}),0);
  assert.equal(api.pickScore(p,{}),null);
});
// Exercise the real Analyzer averaging function, including its existing caps.
check('Analyzer counts a valued pick in its top-15 average', () => {
  const script=fs.readFileSync(path.join(__dirname,'../team_analyzer.js'),'utf8');
  const fn=script.slice(script.indexOf('  function getTop15Avg('),script.indexOf('  function getStarters('));
  const context=vm.createContext({DynastySleeper:api, allPlayers:{p:{full_name:'Player',position:'QB'}},normalize:s=>s.toLowerCase().replace(/[^a-z0-9]/g,'')});
  vm.runInContext(fn,context);
  assert.equal(context.getTop15Avg({players:['p'],picks:[pick(1,1)]},{player:100,'20271stround':300}),200);
});
let calls=0;
const cacheData=new Map();
const caches={open:async()=>({match:async k=>cacheData.get(k)?.clone(),put:async(k,v)=>cacheData.set(k,v.clone())})};
const fetch=async()=>{calls++;return new Response(JSON.stringify({p:{full_name:'Player'}}));};
let client=runtime({fetch,caches});
await Promise.all([client.players(),client.players()]);assert.equal(calls,1);tests++;console.log('PASS concurrent player requests share one download');
client=runtime({fetch,caches});await client.players();assert.equal(calls,1);tests++;console.log('PASS player cache reused by another page');
client=runtime({fetch,caches,Date:{now:()=>Date.now()+86400001}});await client.players();assert.equal(calls,2);tests++;console.log('PASS expired cache refreshes');
let attempts=0;
client=runtime({fetch:async()=>{if(++attempts===1) return new Response('',{status:503});return new Response('{"p":{}}');}});
await assert.rejects(client.players());await client.players();assert.equal(attempts,2);tests++;console.log('PASS failure permits retry without storage');
client=runtime({fetch:async url=>new Response(JSON.stringify(url.endsWith('/traded_picks')?null:url.endsWith('/rosters')?[{}]:url.endsWith('/users')||url.endsWith('/drafts')?[]:{league_id:'1',sport:'nfl'}))});
await assert.rejects(client.league('1'),/no data/);tests++;console.log('PASS unavailable traded picks never become an empty successful import');
await assert.rejects(client.league('bad'),/numeric/);tests++;console.log('PASS invalid IDs rejected');

check('completed startup does not erase an upcoming rookie draft', () => {
  const data=base(); data.meta.status='pre_draft';
  data.drafts.push({season:'2026',status:'pre_draft',settings:{player_type:1}});
  assert.equal(api.withPicks(data)[0].picks[0].season,'2026');
});
let leagueCalls=0;
client=runtime({fetch:async url=>{
  leagueCalls++;
  return new Response(JSON.stringify(url.endsWith('/rosters')?[{roster_id:1}]:/\/(users|drafts|traded_picks)$/.test(url)?[]:{league_id:'1',sport:'nfl'}));
}});
await Promise.all([client.league('1'),client.league('1')]);assert.equal(leagueCalls,5);
await client.league('1');assert.equal(leagueCalls,10);tests++;console.log('PASS concurrent league imports deduplicate; next load requests fresh ownership');
check('Best Available index separates positions and normalizes suffixes', () => {
  const script=fs.readFileSync(path.join(__dirname,'../best_available.js'),'utf8');
  const fn=script.slice(script.indexOf('function buildPlayerIndex('),script.indexOf('async function loadLeague('));
  const context=vm.createContext({indexedPlayers:null,playerIndex:null,normalizeName:s=>s.toLowerCase().replace(/[.']/g,'').trim()});
  vm.runInContext(fn,context);
  const index=context.buildPlayerIndex({a:{full_name:'John Smith Jr.',position:'WR'},b:{full_name:'John Smith',position:'LB'}});
  assert.equal(index.exact.get('john smith jr')[0].player_id,'a');
  assert.equal(index.base.get('john smith').length,2);
});
console.log(`${tests} checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
