'use strict';
const {requireFeature}=require('./subscription-access.cjs');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const normalize=name=>String(name).toLowerCase().replace(/[^a-z0-9]/g,'');
const hits={RB:{1:.85,2:.475,3:.375,4:.175,5:.16,6:.12,7:.04},WR:{1:.575,2:.40,3:.24,4:.09,5:.075,6:.05,7:.04},QB:{1:.645,2:.425,3:.125,4:.105,5:0,6:.10,7:0},TE:{1:.80,2:.375,3:.27,4:.26,5:.04,6:.075,7:0}};
// CSV parser supports quoted commas, escaped quotes, and embedded newlines.
function parseCSV(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field.trim());field='';}else if(c==='\n'&&!quoted){row.push(field.trim());if(row.some(Boolean))rows.push(row);row=[];field='';}else if(c!=='\r'||quoted)field+=c;}
  row.push(field.trim());if(row.some(Boolean))rows.push(row);
  const headers=rows.shift()||[];return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
}
function dataset(sheets=require('../data/site_sheets.json').sheets){
  const rows=id=>parseCSV(sheets[id].csv);
  return {picks:rows('devy_mock_simulator_1').filter(p=>/^[1-7]$/.test(p.Round||p.ROUND||'')).map((p,i)=>({...p,id:String(i)})),players:rows('devy_mock_simulator_2').filter(p=>['QB','RB','WR','TE'].includes((p.Position||p.Pos||'').toUpperCase())).map((p,i)=>({...p,id:String(i)})),opportunity:rows('devy_mock_simulator_3'),rankings:rows('devy_mock_simulator_4')};
}
function simulate(action,body,access,data=dataset()){
  const rounds=access.premium&&access.features.devyRounds===7?7:2;
  if(action==='devy-config')return {rounds,picks:data.picks.filter(p=>Number(p.Round||p.ROUND)<=rounds),players:data.players};
  if(!Array.isArray(body.assignments)||body.assignments.length>300||typeof body.superflex!=='boolean'||typeof body.includeDevy!=='boolean')fail('Invalid draft settings.');
  const seenPicks=new Set(),seenPlayers=new Set();
  const results=body.assignments.map(a=>{
    const pick=data.picks.find(p=>p.id===a.pick),player=data.players.find(p=>p.id===a.player);
    if(!pick||!player||seenPicks.has(pick.id)||seenPlayers.has(player.id))fail('Choose each player and pick only once.');
    seenPicks.add(pick.id);seenPlayers.add(player.id);
    const round=Number(pick.Round||pick.ROUND);
    if(round>2)requireFeature(access,'devyRounds');
    const pos=(player.Position||player.Pos).toUpperCase(),name=player.Name||player.name;
    const team=String(pick.TEAM||pick.Team||'').toLowerCase();
    const opp=data.opportunity.find(r=>String(r.TEAM||r.Team||'').toLowerCase()===team);
    const column={QB:'QUARTERBACK',RB:'RUNNINGBACK',WR:'WIDE RECIEVER',TE:'TIGHT END'}[pos];
    let score=(5000*(hits[pos]?.[round]||0)+300*(parseFloat(opp?.[column])||0))*(pos==='QB'?(body.superflex?.9:.7):pos==='TE'?.8:1);
    if(body.includeDevy){const row=data.rankings.find(r=>normalize(r['PLAYER NAME']||r['player name']||r['Player Name']||r.Name||'')===normalize(name));const rating=parseFloat(row?.SCORE||row?.score);score+=300*(Number.isFinite(rating)?rating:1);}
    return {pick:{Round:String(round),Pick:pick.PICK||pick.Pick,Team:pick.TEAM||pick.Team},player:{Name:name,Position:pos},score};
  }).sort((a,b)=>b.score-a.score);
  return {rounds,results};
}
module.exports={simulate,dataset,parseCSV};
