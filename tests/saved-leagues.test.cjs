'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {leagueAction, lookupLeague} = require('../lib/saved-leagues.cjs');
const id='1318402338695708672', rowId='00000000-0000-4000-8000-000000000001', user={id:'account-a'};
const lookup=async()=>({league_id:id,name:'Real league',season:'2026',teams:[{roster_id:7,name:'Real team'}]});
function database(error=null) {
 const calls=[]; const result={data:{id:rowId},error};
 const q={then:(resolve,reject)=>Promise.resolve(result).then(resolve,reject)};
 for(const name of ['select','eq','order','update','insert','delete','single']) q[name]=(...args)=>{calls.push([name,...args]);return q;};
 return {calls,from:table=>{assert.equal(table,'saved_leagues');return q;}};
}
test('saved league identity and names come from verified user and Sleeper, not supplied fields',async()=>{
 const db=database(); const [status]=await leagueAction('league-add',{league_id:id,roster_id:7,user_id:'victim',name:'fake',team_name:'fake'},user,db,lookup);
 assert.equal(status,200); const row=db.calls.find(c=>c[0]==='insert')[1];
 assert.equal(row.user_id,'account-a'); assert.equal(row.name,'Real league'); assert.equal(row.team_name,'Real team');
});
test('league edits and removal include both row ID and verified account ID filters',async()=>{
 for(const action of ['league-update','league-remove']) {const db=database();await leagueAction(action,{id:rowId,league_id:id,roster_id:null},user,db,lookup);assert.ok(db.calls.some(c=>c[0]==='eq'&&c[1]==='user_id'&&c[2]===user.id));assert.ok(db.calls.some(c=>c[0]==='eq'&&c[1]==='id'&&c[2]===rowId));}
});
test('unknown roster is rejected and no write occurs',async()=>{
 const db=database();assert.equal((await leagueAction('league-add',{league_id:id,roster_id:99},user,db,lookup))[0],400);assert.equal(db.calls.length,0);
});
test('renewal replaces the league ID and season on the same saved entry with a newly selected roster',async()=>{
 const db=database();const next='1418402338695708672';
 await leagueAction('league-update',{id:rowId,league_id:next,roster_id:4},user,db,async requested=>{assert.equal(requested,next);return {league_id:next,name:'Renewed league',season:'2027',teams:[{roster_id:4,name:'My renewed team'}]};});
 const row=db.calls.find(c=>c[0]==='update')[1]; assert.equal(row.league_id,next);assert.equal(row.season,'2027');assert.equal(row.roster_id,4);assert.ok(!db.calls.some(c=>c[0]==='insert'));
});
test('duplicate saved leagues have a useful error; database details stay private',async()=>{
 assert.equal((await leagueAction('league-add',{league_id:id,roster_id:null},user,database({code:'23505'}),lookup))[0],409);
 const result=await leagueAction('leagues',{},user,database({message:'private SQL detail'})); assert.equal(result[0],503);assert.ok(!JSON.stringify(result).includes('private SQL'));
});
test('Sleeper lookup validates IDs before network, rejects other sports and unowned roster labels are safe',async()=>{
 let requests=0;await assert.rejects(lookupLeague('https://evil.example',async()=>{requests++;}));assert.equal(requests,0);
 const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/users')?[]:url.endsWith('/rosters')?[{roster_id:1,owner_id:null}]:{league_id:id,sport:'nfl',season:'2026',name:'League'}});
 assert.equal((await lookupLeague(id,fetcher)).teams[0].name,'Team 1');
 await assert.rejects(lookupLeague(id,async url=>({ok:true,json:async()=>url.endsWith('/users')||url.endsWith('/rosters')?[]:{league_id:id,sport:'nba'}})),/football/);
});
