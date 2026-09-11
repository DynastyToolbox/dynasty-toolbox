'use strict';
(() => {
  const $=id=>document.getElementById(id), api=window.DynastyAccount;
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
  const date=value=>value ? new Date(value).toLocaleString() : 'No expiry';
  let offset=0,hasMore=false,busy=false,pendingChange=null,searchVersion=0,identity=api.user?.email;
  const status=(text,error=false)=>{$('member-status').textContent=text;$('member-status').dataset.error=String(error);};
  function lock(value){busy=value;document.querySelectorAll('button').forEach(b=>b.disabled=value);if(!value){$('members-previous').disabled=offset===0;$('members-next').disabled=!hasMore;}}
  function wipe(){searchVersion++;$('member-results').replaceChildren();$('history-events').replaceChildren();$('history-account').textContent='';$('change-account').textContent='';$('grant-reason').value='';$('owner-code').value='';$('member-directory').hidden=true;$('owner-verification').hidden=true;$('membership-change').close();$('membership-history').close();$('enrollment-qr').removeAttribute('src');$('enrollment').hidden=true;pendingChange=null;}
  async function checkOwner(){
    wipe();lock(true);
    try {
      const session=await api.check();
      if(!session.user){status('Sign in through My account to continue.');return;}
      const owner=await api.request('admin-status');
      if(owner.mfa){$('member-directory').hidden=false;await loadMembers();}
      else {
        $('owner-verification').hidden=false;status('Authenticator verification is required.');
        $('owner-factor').replaceChildren(...owner.factors.map(f=>new Option(f.name,f.id)));
        $('enroll-authenticator').hidden=owner.factors.length>0;$('verify-owner').hidden=!owner.factors.length;
      }
    } catch(e){status(e.message,true);}finally{lock(false);}
  }
  async function loadMembers(){
    const version=++searchVersion;lock(true);status('Loading memberships…');
    try {
      const result=await api.request('admin-members',{query:$('member-query').value,filter:$('member-filter').value,offset});
      if(version!==searchVersion)return;
      hasMore=result.hasMore;$('member-results').replaceChildren();
      for(const member of result.members){
        const card=node('article',undefined,'member-card');card.append(node('h3',member.email));
        const badges=node('div',undefined,'member-badges');
        for(const label of [member.paid?'Paid':null,member.complimentary?'Complimentary':null,!member.paid&&!member.complimentary?'Free':null,!member.email_confirmed_at?'Email unverified':null].filter(Boolean))badges.append(node('span',label,'member-badge'));
        card.append(badges);
        const sub=member.subscription;
        card.append(node('p',sub?.status ? `Billing: ${sub.status}${sub.cancel_at_period_end?' · Cancels at period end':''}` : 'No paid subscription'));
        if(sub?.paid_through)card.append(node('p','Paid access through '+date(sub.paid_through)));
        for(const grant of member.grants){
          const row=node('div',undefined,'member-grant');row.append(node('span','Complimentary · '+(grant.expires_at?'Ends '+date(grant.expires_at):'Permanent')));
          const revoke=node('button','Revoke complimentary access');revoke.type='button';revoke.onclick=()=>openChange('revoke',member,grant);row.append(revoke);card.append(row);
        }
        const actions=node('div',undefined,'member-actions');
        const add=node('button','Grant complimentary access');add.type='button';add.onclick=()=>openChange('grant',member);if(!member.email_confirmed_at){add.hidden=true;}
        const history=node('button','Access history');history.type='button';history.onclick=()=>showHistory(member);
        actions.append(add,history);card.append(actions);$('member-results').append(card);
      }
      if(!result.members.length)$('member-results').append(node('p','No accounts match these filters.'));
      $('members-page').textContent=result.members.length?`Showing ${offset+1}–${offset+result.members.length}`:'No results';status('Memberships are up to date.');
    }catch(e){if(version===searchVersion){$('member-results').replaceChildren();hasMore=false;status(e.message,true);}}
    finally{if(version===searchVersion)lock(false);}
  }
  function openChange(kind,member,grant){
    if(busy)return;
    pendingChange={kind,member,grant,requestId:crypto.randomUUID(),payload:null};
    $('change-title').textContent=kind==='grant'?'Grant complimentary access':'Revoke complimentary access';$('change-account').textContent=member.email;
    $('expiry-fields').hidden=kind!=='grant';$('grant-duration').value='30';$('custom-expiry').hidden=true;$('grant-expiry').required=false;$('grant-expiry').value='';$('grant-reason').value='';$('change-status').textContent='';
    $('confirm-membership-change').textContent=kind==='grant'?'Confirm grant':'Confirm revocation';
    $('change-explanation').textContent=kind==='grant'?'This unlocks premium features without charging this account.':'This removes this complimentary grant. Any paid subscription or other active grant remains.';
    $('membership-change').showModal();
  }
  $('grant-duration').onchange=()=>{$('custom-expiry').hidden=$('grant-duration').value!=='custom';$('grant-expiry').required=$('grant-duration').value==='custom';};
  $('membership-change-form').onsubmit=async e=>{
    e.preventDefault();if(busy||!pendingChange)return;
    const change=pendingChange;
    if(!change.payload){
      let expiresAt=null;
      if(change.kind==='grant'){
        const duration=$('grant-duration').value;
        if(duration!=='permanent'){
          const until=duration==='custom'?new Date($('grant-expiry').value).getTime():Date.now()+Number(duration)*86400000;
          if(!Number.isFinite(until)||until<=Date.now()){$('change-status').textContent='Choose a future end date.';return;}expiresAt=new Date(until).toISOString();
        }
      }
      change.payload={userId:change.member.id,grantId:change.grant?.id,reason:$('grant-reason').value,expiresAt,requestId:change.requestId};
    }
    lock(true);
    try{const result=await api.request('admin-'+change.kind,change.payload);$('membership-change').close();pendingChange=null;await loadMembers();status(result.message);}
    catch(e){$('change-status').textContent=e.message+' Retry repeats the same request. Cancel to change its details.';}
    finally{lock(false);}
  };
  $('cancel-membership-change').onclick=()=>{if(!busy){$('membership-change').close();pendingChange=null;}};
  $('membership-change').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  async function showHistory(member){
    if(busy)return;const version=searchVersion;lock(true);$('history-account').textContent=member.email;$('history-events').replaceChildren(node('p','Loading history…'));$('membership-history').showModal();
    try{const result=await api.request('admin-audit',{userId:member.id});if(version!==searchVersion)return;$('history-events').replaceChildren();for(const event of result.events){const row=node('article');row.append(node('strong',event.action==='grant'?'Access granted':'Access revoked'),node('p',date(event.created_at)),node('p',event.reason));$('history-events').append(row);}if(!result.events.length)$('history-events').append(node('p','No access changes recorded.'));}
    catch(e){$('history-events').replaceChildren(node('p',e.message));}finally{lock(false);}
  }
  $('close-membership-history').onclick=()=>$('membership-history').close();
  $('member-search').onsubmit=e=>{e.preventDefault();if(!busy){offset=0;loadMembers();}};
  $('members-previous').onclick=()=>{offset=Math.max(0,offset-50);loadMembers();};$('members-next').onclick=()=>{offset+=50;loadMembers();};
  $('enroll-authenticator').onclick=async()=>{if(busy)return;lock(true);try{const result=await api.request('admin-mfa-enroll');$('enrollment-qr').src=result.qr;$('enrollment').hidden=false;$('owner-factor').replaceChildren(new Option('New authenticator',result.factorId));$('verify-owner').hidden=false;status('Scan the QR code, then verify the code from your authenticator.');}catch(e){status(e.message,true);}finally{lock(false);}};
  $('verify-owner').onsubmit=async e=>{e.preventDefault();if(busy)return;lock(true);try{await api.request('admin-mfa-verify',{factorId:$('owner-factor').value,code:$('owner-code').value});$('owner-code').value='';await checkOwner();}catch(e){status(e.message,true);}finally{lock(false);}};
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
  window.addEventListener('dynasty-account-change',()=>{const next=api.user?.email;if(next!==identity){identity=next;wipe();}});
  checkOwner();
})();
