/* Customer membership links; owner administration has a separate page. */
(function(root){
  'use strict';
  const destination=user=>user?'membership.html':'account.html?mode=signup&next=membership';
  function accountRoute(search){
    const params=new URLSearchParams(search);
    return {mode:params.get('mode')==='signup'?'signup':'signin',next:params.get('next')==='membership'?'membership.html':null};
  }
  const api={destination,accountRoute};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.DynastyMembershipNavigation=api;
  if(typeof document==='undefined')return;
  const update=()=>document.querySelectorAll('[data-upgrade-link]').forEach(a=>{a.href=destination(root.DynastyAccount?.user);});
  document.addEventListener('DOMContentLoaded',update);
  root.addEventListener('dynasty-account-change',update);
  update();
})(globalThis);
