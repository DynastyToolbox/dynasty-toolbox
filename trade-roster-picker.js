(function(root){
  'use strict';
  const scoring=typeof module!=='undefined'&&module.exports?require('./scoring_formats.js'):root.DynastyScoring;
  const picks=typeof module!=='undefined'&&module.exports?require('./pick_preferences.js'):root.DynastyPickPreferences;
  function value(asset,mode,format,weight='neutral'){
    const row=asset.scores[mode];
    return scoring.score(row.value,row.position,format)*(asset.position==='PICK'?picks.multiplier(weight):1);
  }
  function render({team,assets,format,disabled,onSelect}){
    const doc=document,details=doc.createElement('details'),summary=doc.createElement('summary');
    details.className='trade-roster-picker';summary.textContent='Choose a player or pick';summary.id=`team${team.id}Picker`;
    summary.setAttribute('aria-label',`Team ${team.id}: choose a player or pick`);
    details.append(summary);
    if(disabled){summary.setAttribute('aria-disabled','true');summary.onclick=e=>e.preventDefault();summary.onkeydown=e=>{if(['Enter',' '].includes(e.key))e.preventDefault();};return details;}
    const panel=doc.createElement('div');panel.className='trade-picker-options';details.append(panel);
    for(const position of [...new Set(['QB','RB','WR','TE','PICK',...assets.map(a=>a.position)])]){
      const groupAssets=assets.filter(a=>a.position===position).sort((a,b)=>value(b,team.status,format,team.pickWeight)-value(a,team.status,format,team.pickWeight));
      if(!groupAssets.length)continue;
      const group=doc.createElement('section');group.className='trade-picker-position';group.dataset.position=position;
      const heading=doc.createElement('h4');heading.textContent=position==='PICK'?'Draft picks':position;group.append(heading);
      for(const asset of groupAssets){
        const button=doc.createElement('button'),name=doc.createElement('span'),score=doc.createElement('span');
        button.type='button';button.className='trade-picker-asset';name.textContent=asset.label;score.className='trade-picker-score';
        score.textContent=asset.scores[team.status].ranked?value(asset,team.status,format,team.pickWeight).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'Unranked';
        button.append(name,score);button.onclick=()=>{onSelect(asset.id);doc.getElementById(summary.id)?.focus();};group.append(button);
      }
      panel.append(group);
    }
    if(!assets.length){const empty=doc.createElement('p');empty.textContent='No remaining players or picks.';panel.append(empty);}
    details.onkeydown=e=>{if(e.key==='Escape'){details.open=false;summary.focus();}};
    return details;
  }
  const api={value,render};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.DynastyTradeRosterPicker=api;
})(globalThis);
