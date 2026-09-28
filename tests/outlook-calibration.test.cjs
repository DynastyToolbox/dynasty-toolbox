'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {calibrateLeague}=require('../lib/outlook-calibration.cjs');
function fixture(){
 const meta={league_id:'1111111111111111',previous_league_id:'2222222222222222',season:'2026',total_rosters:6,roster_positions:['QB','BN'],scoring_settings:{pass_td:4},settings:{playoff_week_start:15,last_scored_leg:2}};
 const players=Object.fromEntries(Array.from({length:6},(_,i)=>['p'+i,{position:'QB'}]));
 const slots=[2024,2025,2026].flatMap(season=>Array.from({length:season===2026?2:17},(_,i)=>({season,week:i+1})));
 const history={slots,weeks:slots.map(s=>Object.fromEntries(Object.keys(players).map(id=>[id,{gms_active:1,pass_td:2,off_snp:60,tm_off_snp:60}])))};
 const calls=[],source=async endpoint=>{calls.push(endpoint);if(!endpoint.includes('matchups'))return {...meta,league_id:meta.previous_league_id,season:'2025'};const week=Number(endpoint.split('/').at(-1));return Array.from({length:6},(_,i)=>({roster_id:i+1,matchup_id:Math.floor(i/2),starters:['p'+i],players_points:{['p'+i]:8+week+i},points:8+week+i}));};
 return {meta,state:{season:'2026',week:3},players,history,source,calls};
}
test('a newly loaded league fits only its own completed matching-format games',async()=>{
 const input=fixture(),report=await calibrateLeague(input);assert.equal(report.leagueId,input.meta.league_id);assert.equal(report.model.available,true);assert.equal(report.model.before,202603);assert.equal(report.model.teamCount,96);
 assert.equal(input.calls.some(p=>p.endsWith(input.meta.league_id+'/matchups/3')),false);assert.equal(input.calls.some(p=>p.endsWith('/matchups/15')),false);
 // Poison target/future stats: first historical estimates still use only prior games.
 const changed=fixture();changed.history.weeks.at(-1).p0.pass_td=1000;const next=await calibrateLeague(changed);assert.deepEqual(next.model.residuals,report.model.residuals);
});
test('changed formats cannot borrow prior league errors and thin calibration stays unavailable',async()=>{
 const input=fixture(),original=input.source;input.source=async endpoint=>endpoint.includes('matchups')?original(endpoint):{...await original(endpoint),roster_positions:['QB','QB']};
 const report=await calibrateLeague(input);assert.equal(report.model.available,false);assert.equal(report.model.teamCount,12);assert.equal(input.calls.some(p=>p.includes(input.meta.previous_league_id+'/matchups')),false);
 input.meta.roster_positions.push('K');assert.equal(await calibrateLeague(input),null);
});
