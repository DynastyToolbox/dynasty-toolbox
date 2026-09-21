'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DynastyTradeBalance=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function model(teams){
    if(!Array.isArray(teams)||teams.length<2||teams.length>12||teams.some(t=>!Number.isFinite(t.market?.net)))throw new Error('Market values unavailable.');
    const limit=Math.max(5000,Math.ceil(Math.max(...teams.map(t=>Math.abs(t.market.net)))/5000)*5000);
    return {limit,teams:teams.map((t,i)=>({...t,number:i+1,ratio:t.market.net/limit,
      // The halfway ring is zero. Both gains and losses stay on their own team axis.
      radius:(1+t.market.net/limit)/2,angle:-Math.PI/2+i*2*Math.PI/teams.length}))};
  }
  const number=n=>n.toLocaleString('en-US',{maximumFractionDigits:2});
  const signed=n=>Math.abs(n)<.005?'0':(n>0?'+':'−')+number(Math.abs(n));
  function render(container,teams,hasTransfers){
    const data=model(teams),doc=container.ownerDocument;
    const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
    const svgEl=(tag,attrs,text)=>{const n=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs||{}))n.setAttribute(key,value);if(text!==undefined)n.textContent=text;return n;};
    const layout=el('div',undefined,'balance-layout'+(teams.length===2?' balance-two':''));
    const chart=el('div',undefined,'balance-chart');
    const svg=svgEl('svg',{viewBox:teams.length===2?'0 0 320 100':'0 0 320 290',role:'img','aria-label':teams.length===2?'Market balance: the marker moves toward the team receiving more Overall value. Exact differences are listed below.':'Market balance by team: outside the dashed ring is a gain; inside is a loss. Exact differences are listed alongside.'});
    if(teams.length===2){
      svg.append(svgEl('line',{x1:26,y1:43,x2:294,y2:43,class:'balance-track'}));
      // Left team gains move left, right team gains move right.
      const x=160-data.teams[0].ratio*134;
      if(hasTransfers)svg.append(svgEl('line',{x1:160,y1:43,x2:x,y2:43,class:'balance-bar-fill'}));
      svg.append(svgEl('line',{x1:160,y1:25,x2:160,y2:61,class:'balance-zero'}));
      svg.append(svgEl('circle',{cx:x,cy:43,r:7,class:'balance-dot'}));
      svg.append(svgEl('text',{x:26,y:16,'text-anchor':'middle'},'1'),svgEl('text',{x:294,y:16,'text-anchor':'middle'},'2'));
      svg.append(svgEl('text',{x:160,y:88,'text-anchor':'middle',class:'balance-svg-note'},'Center = even value'));
    }else{
      const point=(t,r)=>[160+Math.cos(t.angle)*100*r,145+Math.sin(t.angle)*100*r];
      const points=r=>data.teams.map(t=>point(t,r).join(',')).join(' ');
      for(const r of [.25,.5,.75,1])svg.append(svgEl('polygon',{points:points(r),class:r===.5?'balance-zero-ring':'balance-grid'}));
      for(const t of data.teams){
        const [x,y]=point(t,1),[lx,ly]=point(t,1.23);
        svg.append(svgEl('line',{x1:160,y1:145,x2:x,y2:y,class:'balance-axis'}));
        svg.append(svgEl('text',{x:lx,y:ly+5,'text-anchor':'middle',class:'balance-team-number'},String(t.number)));
      }
      if(hasTransfers){
        svg.append(svgEl('polygon',{points:data.teams.map(t=>point(t,t.radius).join(',')).join(' '),class:'balance-shape'}));
        for(const t of data.teams){const [cx,cy]=point(t,t.radius);svg.append(svgEl('circle',{cx,cy,r:4,class:'balance-dot '+(t.market.net<0?'balance-loss-dot':'')}));}
      }
    }
    chart.append(svg);
    const scale=el('p',`Range: −${number(data.limit)} to +${number(data.limit)}`,'balance-scale');chart.append(scale);
    const list=el('ul',undefined,'balance-team-list');list.setAttribute('aria-label','Overall value received minus sent');
    for(const t of data.teams){
      const row=el('li'),name=el('span',undefined,'balance-team-name');name.append(el('span',String(t.number),'balance-badge'),doc.createTextNode(t.name||'Team '+t.id));
      row.append(name,el('strong',signed(t.market.net),t.market.net>0?'balance-gain':t.market.net<0?'balance-loss':'balance-even'));list.append(row);
    }
    layout.append(chart,list);
    const note=el('p',!hasTransfers?'Add players or picks to see the balance.':teams.length===2?'The marker leans toward the team gaining value.':'Dashed ring = even value · Outward = gain · Inward = loss','balance-note');
    container.replaceChildren(layout,note);
    if(teams.some(t=>t.market.unranked))container.append(el('p','Some assets have no Overall ranking and count as zero. This balance is incomplete.','balance-warning'));
  }
  return {model,render};
});
