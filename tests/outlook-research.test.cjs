'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {historyPlan,observation,predict,establishedRole,evaluate}=require('../lib/outlook-research.cjs');
test('research cutoff excludes current games and Week 18 across seasons',()=>{
  const slots=historyPlan({season:'2026',week:3,season_type:'regular'});
  assert.equal(slots.length,36);assert.deepEqual(slots[0],{season:2024,week:1});assert.deepEqual(slots.at(-1),{season:2026,week:2});
  assert.ok(slots.every(s=>s.week<=17));assert.throws(()=>historyPlan({season:2026,week:0,season_type:'pre'}));
});
test('active zero and early-exit games count; missing, inactive and unknown records do not become zeroes',()=>{
  assert.equal(observation({gms_active:1,off_snp:1,tm_off_snp:70},'WR',{rec:1}).points,0);
  assert.equal(observation({gms_active:1,rec:2,off_snp:5,tm_off_snp:70},'WR',{rec:1}).points,2);
  assert.equal(observation(null,'WR',{rec:1}).status,'missing');
  assert.equal(observation({gms_active:0},'WR',{rec:1}).points,null);
  assert.equal(observation({rec:2},'WR',{rec:1}).status,'unknown');
  const inconsistent=observation({gms_active:1,rec:2,off_snp:80,tm_off_snp:70},'WR',{rec:1});
  assert.equal(inconsistent.snap,null);assert.equal(inconsistent.invalidSnap,true);assert.equal(inconsistent.points,2);
});
test('history requirements preserve cold starts and role cohort uses only prior workload',()=>{
  const history=Array.from({length:4},(_,index)=>({points:10,index,snap:.7}));
  assert.equal(predict(history.slice(0,3),'mean4'),null);assert.equal(predict(history,'mean4'),10);
  assert.equal(establishedRole(history,4),true);assert.equal(establishedRole(history,8),false);
  assert.equal(establishedRole(history.map(r=>({...r,snap:.05})),4),false);
});
function fixture(){
  const slots=historyPlan({season:2026,week:3,season_type:'regular'});
  const weeks=slots.map(()=>({'1':{gms_active:1,rec:10,off_snp:50,tm_off_snp:60}}));
  return {slots,weeks,players:{'1':{position:'WR'}},scoring:{rec:1}};
}
test('target outcomes cannot leak into their own point forecasts or role eligibility',()=>{
  const base=fixture();
  // Last target has very few snaps. It still belongs to the cohort from prior games.
  base.weeks.at(-1)['1']={gms_active:1,rec:0,off_snp:1,tm_off_snp:60};
  const report=evaluate(base),metric=report.results.holdout.establishedRole.mean4;
  assert.equal(metric.n,11);assert.equal(metric.mae,.909);assert.equal(metric.bias,.909);
  assert.equal(report.results.holdout.allObserved.mean4.n,11);
});
test('holdout changes cannot change baseline selection or calibration residuals',()=>{
  const first=fixture(),second=fixture();
  // Enough calibration observations to test real intervals, not the unavailable branch.
  for(const data of [first,second])for(let id=2;id<=5;id++){
    data.players[id]={position:'WR'};
    for(const week of data.weeks)week[id]={...week['1']};
  }
  for(let i=25;i<second.weeks.length;i++)second.weeks[i]['1'].rec=100;
  const a=evaluate(first),b=evaluate(second);
  assert.equal(a.selected,b.selected);assert.deepEqual(a.results.tuning,b.results.tuning);
  assert.equal(a.intervals.WR.available,true);
  assert.equal(a.intervals.WR.lowerResidual,b.intervals.WR.lowerResidual);assert.equal(a.intervals.WR.upperResidual,b.intervals.WR.upperResidual);
  assert.notEqual(a.intervals.WR.observedCoverage,b.intervals.WR.observedCoverage);
  assert.notDeepEqual(a.results.holdout,b.results.holdout);
});
test('missing target observations are reported separately from point accuracy',()=>{
  const data=fixture();delete data.weeks.at(-1)['1'];
  const report=evaluate(data);
  assert.equal(report.results.holdout.establishedRole.mean4.n,10);
  assert.equal(report.results.holdout.establishedRole.mean4.mae,0);
  assert.equal(report.roleForecastAvailability.missing,1);
  assert.equal(report.roleForecastAvailability.total,11);
});
test('unsupported scoring and unordered history fail visibly',()=>{
  const data=fixture();assert.throws(()=>evaluate({...data,scoring:{bonus_rec_te:1}}),/Unsupported scoring/);
  const reverse={...data,slots:[...data.slots].reverse()};assert.throws(()=>evaluate(reverse),/ordered/);
});
