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
      if(session.environment==='development')await testBilling();
    }catch(e){status.textContent='We couldn’t check your membership. Refresh to try again, or visit your account.';status.dataset.error='true';}
  }
  async function testBilling(){
    const area=document.getElementById('test-billing'),message=document.getElementById('test-billing-message');
    let billing;try{({billing}=await DynastyAccount.request('billing-status'));}catch{return;}
    if(billing?.sandbox!==true || !billing.ready)return;
    area.hidden=false;
    document.getElementById('test-checkout').hidden=!billing.plans.includes('monthly');
    if(new URLSearchParams(location.search).get('checkout')==='returned')
      message.textContent='Checkout returned. Refresh payment status to check your membership.';
    const run=async(action,fields={},host)=>{
      const buttons=area.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
      message.textContent='Checking test billing…';
      try{
        const result=await DynastyAccount.request(action,fields);
        if(host){
          const url=new URL(result.url);
          if(url.protocol!=='https:' || url.hostname!==host || url.username || url.password || url.port)throw new Error('Invalid checkout address.');
          location.assign(url.href);
        }else{
          const {access}=await DynastyAccount.request('access');
          status.textContent=access.premium?'Your account has premium access.':'Your account currently has free access.';
          message.textContent='Payment status refreshed.';
        }
      }catch(error){message.textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}
    };
    document.getElementById('test-checkout').onclick=()=>run('billing-checkout',{plan:'monthly'},'checkout.stripe.com');
    document.getElementById('test-portal').onclick=()=>run('billing-portal',{},'billing.stripe.com');
    document.getElementById('test-refresh').onclick=()=>run('billing-refresh');
  }
  fetch('/nav.html').then(r=>{if(!r.ok)throw new Error();return r.text();}).then(html=>{document.getElementById('nav-placeholder').innerHTML=html;}).catch(()=>{document.getElementById('nav-placeholder').textContent='';});
  load();
})();
