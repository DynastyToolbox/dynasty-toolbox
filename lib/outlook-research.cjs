'use strict';
// Offline research only. These conditional-on-active estimates are not team forecasts.
const {offensivePoints, scoringSupport}=require('./outlook-foundation.cjs');
const POSITIONS=['QB','RB','WR','TE'];
const MODELS=['lastGame','mean4','mean8','mean16','blend4and16'];
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const round=n=>Number.isFinite(n)?Math.round(n*1000)/1000:null;
function historyPlan(state){
  const season=Number(state.season),week=Number(state.week);
  if(state.season_type!=='regular'||!Number.isInteger(season)||season<2022||season>2100||!Number.isInteger(week)||week<1||week>18)throw new Error('Research requires a current regular-season cutoff.');
  const slots=[];
  for(let year=season-2;year<=season;year++)for(let w=1;w<=(year===season?week-1:17);w++)slots.push({season:year,week:w});
  return slots; // Week 18 stays excluded; never include an in-progress week.
}
function observation(stats,position,scoring){
  if(!stats||typeof stats!=='object'||Array.isArray(stats))return {status:'missing',points:null,snap:null};
  const active=stats.gms_active??stats.gp;
  if(active==null)return {status:'unknown',points:null,snap:null};
  if(!Number.isFinite(Number(active))||Number(active)<0)throw new Error('Invalid active-game count.');
  if(Number(active)===0)return {status:'inactive',points:null,snap:null};
  const ratio=stats.off_snp!=null&&Number(stats.tm_off_snp)>0?Number(stats.off_snp)/Number(stats.tm_off_snp):null;
  const invalidSnap=ratio!==null&&(!Number.isFinite(ratio)||ratio<0||ratio>1);
  // Preserve game points when source snap totals disagree. Never invent a 100% workload.
  return {status:'active',points:offensivePoints(stats,position,scoring),snap:invalidSnap?null:ratio,invalidSnap};
}
function predict(history,model){
  if(!MODELS.includes(model))throw new Error('Unknown projection baseline.');
  if(history.length<4)return null; // No invented zero for rookies/missing history.
  const values=history.slice(-16).map(r=>r.points);
  if(values.some(v=>!Number.isFinite(v)))throw new Error('History must contain observed active-game points.');
  if(model==='lastGame')return values.at(-1);
  if(model==='blend4and16')return .5*mean(values.slice(-4))+.5*mean(values);
  return mean(values.slice(-Number(model.slice(4))));
}
function establishedRole(history,index){
  // Cohort membership uses PRIOR games only, never the target game's workload.
  return history.length>=4&&index-history.at(-1).index<=4&&history.slice(-4).filter(row=>row.snap!==null&&row.snap>=.4).length>=2;
}
function metrics(rows){
  if(!rows.length)return {n:0,mae:null,rmse:null,bias:null};
  const errors=rows.map(row=>row.predicted-row.actual);
  return {n:rows.length,mae:round(mean(errors.map(Math.abs))),rmse:round(Math.sqrt(mean(errors.map(e=>e*e)))),bias:round(mean(errors))};
}
function quantile(values,p){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),at=(sorted.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo);
}
function evaluate({slots,weeks,players,scoring}){
  const unsupported=scoringSupport(scoring);
  if(unsupported.length)throw new Error('Unsupported scoring: '+unsupported.join(', '));
  if(!slots.length||weeks.length!==slots.length)throw new Error('Historical weeks are incomplete.');
  for(let i=0;i<slots.length;i++){
    const s=slots[i];
    if(!Number.isInteger(s.season)||!Number.isInteger(s.week)||s.week<1||s.week>17||i>0&&s.season*17+s.week!==slots[i-1].season*17+slots[i-1].week+1)throw new Error('Historical weeks must be ordered, complete and exclude Week 18.');
    if(!weeks[i]||typeof weeks[i]!=='object'||Array.isArray(weeks[i]))throw new Error('Invalid weekly data.');
  }
  const history=new Map(),rows=[],coverage={active:0,inactive:0,unknown:0,missing:0,insufficientHistory:0,unmappedRecords:0,invalidSnap:0};
  const known=Object.entries(players).filter(([,p])=>POSITIONS.includes(p?.position));
  const ids=new Set(known.map(([id])=>id));
  const warmup=slots[0].season,tuningSeason=warmup+1;
  for(let index=0;index<slots.length;index++){
    const slot=slots[index],data=weeks[index];
    coverage.unmappedRecords+=Object.keys(data).filter(id=>/^\d+$/.test(id)&&!players[id]).length;
    for(const [id,player] of known){
      if(!history.has(id))history.set(id,[]);
      const prior=history.get(id),obs=observation(data[id],player.position,scoring);
      coverage[obs.status]++;
      if(obs.invalidSnap)coverage.invalidSnap++;
      // Freeze predictions before exposing this week's outcome to history.
      if(slot.season>warmup){
        if(prior.length<4){if(obs.status==='active')coverage.insufficientHistory++;}
        else {
          const split=slot.season===tuningSeason&&slot.week<=8?'tuning':'holdout';
          const role=establishedRole(prior,index);
          for(const model of MODELS)rows.push({season:slot.season,week:slot.week,position:player.position,split,role,model,predicted:predict(prior,model),actual:obs.points,status:obs.status});
        }
      }
      if(obs.status==='active')prior.push({...obs,index});
    }
  }
  const active=rows.filter(r=>r.status==='active'),results={};
  for(const split of ['tuning','holdout']){
    results[split]={};
    for(const cohort of ['allObserved','establishedRole']){
      results[split][cohort]={};
      for(const model of MODELS){
        const group=active.filter(r=>r.split===split&&r.model===model&&(cohort==='allObserved'||r.role));
        results[split][cohort][model]={...metrics(group),byPosition:Object.fromEntries(POSITIONS.map(pos=>[pos,metrics(group.filter(r=>r.position===pos))]))};
      }
    }
  }
  // Select solely on tuning-period role-cohort MAE. Holdout never chooses a model.
  const eligible=MODELS.filter(m=>results.tuning.establishedRole[m].n>0);
  const selected=eligible.sort((a,b)=>results.tuning.establishedRole[a].mae-results.tuning.establishedRole[b].mae)[0]??null;
  const intervals={};
  if(selected)for(const position of POSITIONS){
    const calibration=active.filter(r=>r.split==='tuning'&&r.role&&r.position===position&&r.model===selected).map(r=>r.actual-r.predicted);
    const test=active.filter(r=>r.split==='holdout'&&r.role&&r.position===position&&r.model===selected);
    if(calibration.length<30){intervals[position]={available:false,calibrationN:calibration.length};continue;}
    const low=quantile(calibration,.1),high=quantile(calibration,.9);
    intervals[position]={available:true,calibrationN:calibration.length,holdoutN:test.length,lowerResidual:round(low),upperResidual:round(high),nominalCoverage:.8,observedCoverage:test.length?round(test.filter(r=>r.actual>=r.predicted+low&&r.actual<=r.predicted+high).length/test.length):null};
  }
  const roleForecasts=selected?rows.filter(r=>r.model===selected&&r.role&&r.split==='holdout'):[];
  return {schema:1,scope:'Conditional-on-active player baseline research; not a team forecast or calibrated win probability.',period:{start:slots[0],end:slots.at(-1),warmupSeason:warmup,tuning:`${tuningSeason} weeks 1–8`,holdout:`${tuningSeason} week 9 onward`},scoring,coverage,selected,results,intervals,
    roleForecastAvailability:{total:roleForecasts.length,...Object.fromEntries(['active','inactive','missing','unknown'].map(s=>[s,roleForecasts.filter(r=>r.status===s).length]))},
    limits:['Current player registry supplies position labels, not historical roster or availability snapshots. Unmapped historical IDs are reported.','All estimates and point errors are conditional on an observed active game. Missing/DNP/bye records are not zero; availability prediction is not validated.','Role cohort uses at least two of four preceding active games with >=40% offensive snaps and last active game within four included NFL weeks. No target-game snap filter.','First season warms up history; first eight weeks of next season choose the baseline and residual interval. Later outcomes only evaluate. No holdout retuning.','Week 18 excluded. No injury, opponent, weather, rookie, role-change, lineup, K/DEF/IDP or team-correlation model yet.']};
}
module.exports={historyPlan,observation,predict,establishedRole,metrics,quantile,evaluate,MODELS};
