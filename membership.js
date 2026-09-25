'use strict';
(() => {
  const status=document.getElementById('membership-status'),link=document.getElementById('membership-account');
  async function load(){
    try{
      const session=await DynastyAccount.check();
      if(!session.user){status.textContent='Create a free account to save your leagues.';link.textContent='Create account';link.href=DynastyMembershipNavigation.destination(null);return;}
      link.textContent='My account';link.href='account.html';
      const {access}=await DynastyAccount.request('access');
      status.textContent=access.premium?'Your account has premium access.':'Your account currently has free access.';
    }catch(e){status.textContent='We couldn’t check your membership. Refresh to try again, or visit your account.';status.dataset.error='true';}
  }
  fetch('/nav.html').then(r=>{if(!r.ok)throw new Error();return r.text();}).then(html=>{document.getElementById('nav-placeholder').innerHTML=html;}).catch(()=>{document.getElementById('nav-placeholder').textContent='';});
  load();
})();
