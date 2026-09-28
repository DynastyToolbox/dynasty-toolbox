(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OutlookBracket=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function roundWeeks(count,start,lengths){
    const n=count===4?2:[6,8].includes(count)?3:0;
    if(!n||!Number.isInteger(start)||start<2||!Array.isArray(lengths)||lengths.length!==n||lengths.some(l=>![1,2].includes(l)))throw new Error('Choose a supported playoff format.');
    let week=start;const rounds=lengths.map(length=>Array.from({length},()=>week++));
    if(week>19)throw new Error('This playoff format goes beyond Week 18.');
    return rounds;
  }
  function pairsFor(field){
    const at=seed=>field.find(t=>t.seed===seed);
    // Bracket order: adjacent winners meet next round. With six teams, the
    // top seed waits for 4/5 and the second seed waits for 3/6.
    const pairs=field.length===4?[[1,4],[2,3]]:field.length===6?[[4,5],[3,6]]:[[1,8],[4,5],[2,7],[3,6]];
    return pairs.map(p=>p.map(at));
  }
  function validate(field,rounds,forecasts){
    if(![4,6,8].includes(field.length)||new Set(field.map(t=>t.id)).size!==field.length||field.some((t,i)=>!field.some(x=>x.seed===i+1)))throw new Error('Each seed needs a different team.');
    if(rounds.length!==(field.length===4?2:3)||rounds.flat().some(w=>!Number.isInteger(w)||w<2||w>18)||new Set(rounds.flat()).size!==rounds.flat().length||rounds.some(r=>r.length<1||r.length>2))throw new Error('Invalid playoff weeks.');
    for(const week of rounds.flat())for(const team of field){const d=forecasts[week+':'+team.id];if(!d||!Number.isFinite(d.mean)||!Number.isFinite(d.sd)||d.sd<0)throw new Error('Some playoff-week player estimates are unavailable.');}
  }
  function play(field,rounds,forecasts,{reseed=false,score}={}){
    let pairs=pairsFor(field);const output=[];
    for(let index=0;index<rounds.length;index++){
      const games=pairs.map(([a,b])=>{
        const total=entry=>rounds[index].reduce((sum,week)=>sum+Math.round((score?score(forecasts[week+':'+entry.id],week,entry):forecasts[week+':'+entry.id].mean)*100),0)/100;
        const aScore=total(a),bScore=total(b),winner=aScore>bScore?a:bScore>aScore?b:a.seed<b.seed?a:b;
        return {a,b,aScore,bScore,winner};
      });
      output.push({weeks:rounds[index],games});
      let winners=games.map(g=>g.winner);
      if(index===0&&field.length===6)winners=[field.find(t=>t.seed===1),winners[0],field.find(t=>t.seed===2),winners[1]];
      if(reseed){winners.sort((a,b)=>a.seed-b.seed);pairs=Array.from({length:Math.floor(winners.length/2)},(_,i)=>[winners[i],winners[winners.length-1-i]]);}
      else pairs=Array.from({length:Math.floor(winners.length/2)},(_,i)=>winners.slice(i*2,i*2+2));
    }
    return {rounds:output,champion:output.at(-1).games[0].winner};
  }
  function random(seed){let x=2166136261;for(const c of String(seed)){x^=c.charCodeAt(0);x=Math.imul(x,16777619);}return ()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
  function sampler(rng){return d=>Math.round((d.mean+d.sd*Math.sqrt(-2*Math.log(Math.max(Number.EPSILON,rng())))*Math.cos(2*Math.PI*rng()))*100)/100;}
  function gameChance(a,b,weeks,forecasts){
    let delta=0,variance=0;for(const week of weeks){const x=forecasts[week+':'+a.id],y=forecasts[week+':'+b.id];delta+=x.mean-y.mean;variance+=x.sd*x.sd+y.sd*y.sd;}
    if(!variance)return delta===0?Number(a.seed<b.seed):Number(delta>0);
    const z=(delta+(a.seed<b.seed?.005:-.005))/Math.sqrt(variance),x=Math.abs(z),t=1/(1+.2316419*x),p=.3989422804014327*Math.exp(-x*x/2)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
    return z>=0?1-p:p;
  }
  function scenario(field,rounds,forecasts,{reseed=false,iterations=3000,seed='bracket-scenario'}={}){
    validate(field,rounds,forecasts);if(!Number.isInteger(iterations)||iterations<100||iterations>20000)throw new Error('Invalid simulation count.');
    const counts=Object.fromEntries(field.map(t=>[t.id,{final:0,title:0}])),score=sampler(random(seed));
    for(let i=0;i<iterations;i++){const result=play(field,rounds,forecasts,{reseed,score});counts[result.champion.id].title++;for(const t of [result.rounds.at(-1).games[0].a,result.rounds.at(-1).games[0].b])counts[t.id].final++;}
    return {path:play(field,rounds,forecasts,{reseed}),teams:field.map(t=>({...t,finalChance:counts[t.id].final/iterations,titleChance:counts[t.id].title/iterations}))};
  }
  return {roundWeeks,pairsFor,validate,play,random,sampler,scenario,gameChance};
});
