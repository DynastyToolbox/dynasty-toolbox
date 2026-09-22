'use strict';
(async()=>{
  const box=document.getElementById('home-drafts');
  try{
    const lists=await Promise.all([DynastySheets.mocks('nfl'),DynastySheets.mocks('dynasty')]);
    // The published catalogue order is controlled by the owner, not inferred from titles.
    const drafts=[...lists[0].filter(d=>/mock/i.test(d.title)).slice(0,2),...lists[1].slice(0,1)];
    if(!drafts.length)return;
    box.replaceChildren();
    for(const d of drafts){
      const a=document.createElement('a');a.className='home-draft';
      a.href=(d.kind==='nfl'?'nfl_mock_drafts.html':'dynasty_mock_drafts.html')+'?draft='+encodeURIComponent(d.id);
      const text=document.createElement('span'),kind=document.createElement('small'),title=document.createElement('strong'),arrow=document.createElement('span');
      kind.textContent=d.kind==='nfl'?'NFL mock draft':'Dynasty rookie mock';title.textContent=d.title;arrow.textContent='→';arrow.setAttribute('aria-hidden','true');
      text.append(kind,title);a.append(text,arrow);box.append(a);
    }
  }catch{ /* Keep the usable static links when the catalogue is unavailable. */ }
})();
