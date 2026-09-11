const {test} = require('node:test');
const assert = require('node:assert/strict');
const score = require('../scoring_formats.js').score;
const {computePlayerRow, bestLineup} = require('../median_data.js');
test('format adjustments match NFL rankings and baseline scores stay unchanged', () => {
  for (const pos of ['QB','RB','WR','TE','PICK']) assert.equal(score(100,pos),100);
  assert.equal(score(100,'WR',{ppr:'std'}),95);
  assert.equal(score(100,'WR',{ppr:'ppr'}),105);
  assert.equal(score(100,'TE',{ppr:'ppr',tePremium:true}),110.25);
  assert.equal(score(100,'QB',{superflex:false}),65);
  assert.equal(score(100,'RB',{ppr:'ppr',tePremium:true,superflex:false}),100);
  assert.equal(score(100,'PICK',{ppr:'ppr',tePremium:true,superflex:false}),100);
});
test('medians share scoring, windows and minimum games; zero-point games count', () => {
  const p={name:'Sample',pos:'WR',weeks:{1:{hppr:0,ppr:1},2:{hppr:10,ppr:20},3:{hppr:30,ppr:40},8:{hppr:100,ppr:110}}};
  assert.equal(computePlayerRow('1',p,'hppr','season',8).median,20);
  assert.equal(computePlayerRow('1',p,'ppr','season',8).median,30);
  assert.equal(computePlayerRow('1',p,'hppr','last5',8),null);
});
test('lineup fills fixed positions before FLEX and Superflex without duplicates', () => {
  const rows=[{id:'q1',pos:'QB',median:30},{id:'q2',pos:'QB',median:29},{id:'r1',pos:'RB',median:20},{id:'r2',pos:'RB',median:19},{id:'w1',pos:'WR',median:28},{id:'w2',pos:'WR',median:27},{id:'t1',pos:'TE',median:14}];
  const result=bestLineup(rows,{SFLX:1,FLX:1,TE:1,QB:1,RB:1,WR:1});
  assert.deepEqual(result.map(s=>s.player.id),['q1','r1','w1','t1','w2','q2']);
  assert.equal(new Set(result.map(s=>s.player.id)).size,6);
});
test('missing medians do not fill slots; valid negative medians remain eligible', () => {
  const result=bestLineup([{id:'a',pos:'QB',median:null},{id:'b',pos:'QB',median:-1}],{QB:2,FLX:1});
  assert.equal(result[0].player.id,'b'); assert.equal(result[1].player,null); assert.equal(result[2].player,null);
});
test('changing counts or scoring reselects eligible best players', () => {
  const rows=[{id:'r',pos:'RB',median:10},{id:'w',pos:'WR',median:12}];
  assert.equal(bestLineup(rows,{FLX:1})[0].player.id,'w');
  assert.deepEqual(bestLineup(rows,{WR:1,FLX:1}).map(s=>s.player.id),['w','r']);
  assert.equal(bestLineup(rows.map(r=>({...r,median:r.id==='r'?20:12})),{FLX:1})[0].player.id,'r');
});
test('lineup greedy result matches exhaustive best total for constrained roster', () => {
  const rows=[{id:'q',pos:'QB',median:10},{id:'r',pos:'RB',median:7},{id:'w',pos:'WR',median:8},{id:'t',pos:'TE',median:6},{id:'r2',pos:'RB',median:9}];
  for (let mask=1;mask<64;mask++) {
    const types=['QB','RB','WR','TE','FLX','SFLX'];
    const slots=types.filter((_,i)=>mask&(1<<i));
    function brute(i,used) {
      if(i===slots.length)return 0;
      const slot=slots[i], allowed=slot==='SFLX'?['QB','RB','WR','TE']:slot==='FLX'?['RB','WR','TE']:[slot];
      let total=brute(i+1,used);
      for(const r of rows)if(!used.has(r.id)&&allowed.includes(r.pos))total=Math.max(total,r.median+brute(i+1,new Set([...used,r.id])));
      return total;
    }
    assert.equal(bestLineup(rows,Object.fromEntries(slots.map(s=>[s,1]))).reduce((n,s)=>n+(s.player?.median||0),0),brute(0,new Set()));
  }
});
test('weekly update excludes in-progress weeks and preserves useful prior season early on', async () => {
  const {buildPlan,validateOutput}=await import('../scripts/build_weekly_points_sleeper.mjs');
  assert.deepEqual(buildPlan({season:'2026',week:1,season_type:'regular',previous_season:'2025'}),{season:'2025',through:18});
  assert.deepEqual(buildPlan({season:'2026',week:4,season_type:'regular'}),{season:'2026',through:3});
  assert.deepEqual(buildPlan({season:'2026',week:1,season_type:'post'}),{season:'2026',through:18});
  assert.throws(()=>buildPlan({season:'bad',week:4,season_type:'regular'}));
  assert.throws(()=>validateOutput({meta:{},players:{}},null));
  const data={meta:{season:'2026',week_built_through:3},players:{a:{weeks:{1:{std:1,hppr:2,ppr:3},2:{std:1,hppr:2,ppr:3},3:{std:1,hppr:2,ppr:3}}}}};
  validateOutput(data,null);
  assert.throws(()=>validateOutput(data,{meta:{season:'2027',week_built_through:1}}));
  assert.throws(()=>validateOutput(data,{meta:{season:'2026',week_built_through:4}}));
});
