'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(['admin-status','admin-members','admin-grant','admin-revoke','admin-audit','admin-mfa-enroll','admin-mfa-verify']);
const fail=(status,message)=>[status,{error:message}];
const providerFailure=error=>error?.status===429 ? fail(429,'Please wait before trying another code.') : fail(503,'Membership services are unavailable. Please try again.');
async function adminAction(action,body,db,session,save) {
  // Database authorization is repeated in every privileged RPC, including direct API calls.
  const checked=await db.rpc('dt_admin_status');
  if(checked.error)return providerFailure(checked.error);
  if(checked.data?.admin!==true)return fail(403,'This page is only available to the website owner.');
  if(action==='admin-status' || action.startsWith('admin-mfa-')) {
    if(!session.access_token || !session.refresh_token)return fail(401,'Sign in again to verify owner access.');
    const attached=await db.auth.setSession(session);
    if(attached.error || !attached.data?.session)return fail(401,'Sign in again to verify owner access.');
    save(attached.data.session);
    const factors=await db.auth.mfa.listFactors();
    if(factors.error)return providerFailure(factors.error);
    const verified=(factors.data?.totp || []).filter(f=>f.status==='verified');
    if(action==='admin-status')return [200,{admin:true,mfa:checked.data.mfa===true,factors:verified.map(f=>({id:f.id,name:f.friendly_name || 'Authenticator'}))}];
    if(action==='admin-mfa-enroll') {
      if(verified.length)return fail(409,'Use your existing authenticator to verify access.');
      // Restart only incomplete factors created by this enrollment screen.
      for(const factor of factors.data?.all || [])if(factor.factor_type==='totp' && factor.status==='unverified' && factor.friendly_name==='Dynasty Toolbox owner') {
        const removed=await db.auth.mfa.unenroll({factorId:factor.id});
        if(removed.error)return providerFailure(removed.error);
      }
      const enrolled=await db.auth.mfa.enroll({factorType:'totp',friendlyName:'Dynasty Toolbox owner',issuer:'Dynasty Toolbox'});
      if(enrolled.error)return providerFailure(enrolled.error);
      const data=enrolled.data;
      if(!UUID.test(data?.id || '') || !data?.totp?.qr_code?.startsWith('data:image/svg+xml;'))return providerFailure();
      return [200,{factorId:data.id,qr:data.totp.qr_code}];
    }
    if(!UUID.test(body.factorId || '') || !/^\d{6}$/.test(body.code || ''))return fail(400,'Enter the six-digit code from your authenticator.');
    if(!(factors.data?.all || []).some(f=>f.id===body.factorId && f.factor_type==='totp'))return fail(400,'Choose your authenticator and try again.');
    const challenge=await db.auth.mfa.challenge({factorId:body.factorId});
    if(challenge.error)return providerFailure(challenge.error);
    const verifiedCode=await db.auth.mfa.verify({factorId:body.factorId,challengeId:challenge.data.id,code:body.code});
    if(verifiedCode.error)return verifiedCode.error.status===429 ? providerFailure(verifiedCode.error) : fail(400,'That code was not accepted. Try the latest code from your authenticator.');
    if(!verifiedCode.data?.access_token || !verifiedCode.data?.refresh_token)return providerFailure();
    save(verifiedCode.data);
    return [200,{message:'Owner access verified.'}];
  }
  if(checked.data.mfa!==true)return fail(403,'Verify your authenticator before managing memberships.');
  let rpc,args;
  if(action==='admin-members') {
    const query=body.query ?? '', filter=body.filter ?? 'all', offset=body.offset ?? 0;
    if(typeof query!=='string' || query.length>254 || !['all','paid','complimentary','free'].includes(filter) || !Number.isInteger(offset) || offset<0 || offset>1000000)return fail(400,'Check the member search filters.');
    rpc='dt_admin_members';args={p_query:query.trim(),p_filter:filter,p_offset:offset};
  } else if(action==='admin-audit') {
    if(!UUID.test(body.userId || ''))return fail(400,'Select an account.');
    rpc='dt_admin_audit';args={p_user_id:body.userId};
  } else if(action==='admin-grant' || action==='admin-revoke') {
    if(typeof body.reason!=='string' || !body.reason.trim() || body.reason.trim().length>500 || !UUID.test(body.requestId || ''))return fail(400,'Enter a reason and confirm the change.');
    args={p_reason:body.reason.trim(),p_request_id:body.requestId};
    if(action==='admin-grant') {
      if(!UUID.test(body.userId || '') || !(body.expiresAt===null || typeof body.expiresAt==='string' && Number.isFinite(Date.parse(body.expiresAt))))return fail(400,'Choose an account and a valid expiry.');
      rpc='dt_admin_grant';Object.assign(args,{p_user_id:body.userId,p_expires_at:body.expiresAt});
    } else {
      if(!UUID.test(body.grantId || ''))return fail(400,'Select a complimentary grant.');
      rpc='dt_admin_revoke';args.p_grant_id=body.grantId;
    }
  } else return fail(400,'Unknown membership action.');
  const result=await db.rpc(rpc,args);
  if(result.error)return result.error.code==='42501' ? fail(403,'Owner verification is required. Reload and verify again.') : result.error.code==='22023' ? fail(400,'The change was not accepted. Check the account, expiry and reason, then refresh before trying again.') : providerFailure(result.error);
  if(action==='admin-members')return [200,{members:result.data.slice(0,50),hasMore:result.data.length>50}];
  if(action==='admin-audit')return [200,{events:result.data}];
  return [200,{message:action==='admin-grant'?'Complimentary access granted.':'Complimentary access revoked.',...result.data}];
}
module.exports={adminAction,ACTIONS};
