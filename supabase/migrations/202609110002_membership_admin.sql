begin;
create table public.membership_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.membership_audit (
  request_id uuid primary key,
  actor_id uuid not null,
  user_id uuid not null,
  grant_id uuid not null,
  action text not null check (action in ('grant','revoke')),
  expires_at timestamptz,
  reason text not null,
  created_at timestamptz not null default now()
);
create index membership_audit_user on public.membership_audit(user_id,created_at desc);
alter table public.membership_admins enable row level security;
alter table public.membership_audit enable row level security;
revoke all on public.membership_admins, public.membership_audit from public, anon, authenticated;
grant all on public.membership_admins, public.membership_audit to service_role;

create function public.dt_admin_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('admin',exists(select 1 from public.membership_admins where user_id=auth.uid()),
    'mfa',coalesce(auth.jwt()->>'aal','')='aal2');
$$;
create function public.dt_assert_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.membership_admins where user_id=auth.uid())
    or coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'Administrator verification required' using errcode='42501';
  end if;
  return auth.uid();
end;
$$;

create function public.dt_admin_members(p_query text default '', p_filter text default 'all', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.dt_assert_admin();
  if length(p_query)>254 or p_filter not in ('all','paid','complimentary','free') or p_offset<0 or p_offset>1000000 then
    raise exception 'Invalid member search' using errcode='22023';
  end if;
  with members as (
    select u.id,u.email,u.email_confirmed_at,
      jsonb_build_object('user_id',u.id,'plan',s.plan,'status',s.status,'paid_through',s.paid_through,
        'cancel_at_period_end',s.cancel_at_period_end) as subscription,
      coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'user_id',g.user_id,'plan',g.plan,
        'starts_at',g.starts_at,'expires_at',g.expires_at,'revoked_at',g.revoked_at) order by g.created_at desc)
        from public.access_grants g where g.user_id=u.id and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())), '[]'::jsonb) as grants,
      coalesce(s.plan='premium' and s.status in ('active','past_due') and s.paid_through>now(),false) as paid,
      exists(select 1 from public.access_grants g where g.user_id=u.id and g.plan='premium' and
        g.revoked_at is null and g.starts_at<=now() and (g.expires_at is null or g.expires_at>now())) as complimentary
    from auth.users u left join public.membership_subscriptions s on s.user_id=u.id
    where u.email is not null and position(lower(trim(p_query)) in lower(u.email))>0
  ), selected as (
    select * from members where p_filter='all' or (p_filter='paid' and paid) or
      (p_filter='complimentary' and complimentary) or (p_filter='free' and not paid and not complimentary)
    order by lower(email),id offset p_offset limit 51
  ) select coalesce(jsonb_agg(to_jsonb(selected)),'[]'::jsonb) into result from selected;
  return result;
end;
$$;

create function public.dt_admin_grant(p_user_id uuid,p_expires_at timestamptz,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; previous public.membership_audit%rowtype; grant_key uuid;
begin
  actor:=public.dt_assert_admin();
  if p_request_id is null or p_reason is null or length(trim(p_reason)) not between 1 and 500 then
    raise exception 'A reason and request ID are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into previous from public.membership_audit where request_id=p_request_id;
  if found then
    if previous.actor_id is distinct from actor or previous.action is distinct from 'grant' or previous.user_id is distinct from p_user_id or
      previous.expires_at is distinct from p_expires_at or previous.reason<>trim(p_reason) then
      raise exception 'Request ID already used' using errcode='22023';
    end if;
    return jsonb_build_object('grant_id',previous.grant_id,'replayed',true);
  end if;
  if p_expires_at is not null and p_expires_at<=now() then
    raise exception 'Expiry must be in the future' using errcode='22023';
  end if;
  if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then
    raise exception 'Choose a verified account' using errcode='22023';
  end if;
  insert into public.access_grants(user_id,expires_at,granted_by,reason)
    values(p_user_id,p_expires_at,actor,trim(p_reason)) returning id into grant_key;
  insert into public.membership_audit(request_id,actor_id,user_id,grant_id,action,expires_at,reason)
    values(p_request_id,actor,p_user_id,grant_key,'grant',p_expires_at,trim(p_reason));
  return jsonb_build_object('grant_id',grant_key,'replayed',false);
end;
$$;

create function public.dt_admin_revoke(p_grant_id uuid,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; previous public.membership_audit%rowtype; target public.access_grants%rowtype;
begin
  actor:=public.dt_assert_admin();
  if p_request_id is null or p_reason is null or length(trim(p_reason)) not between 1 and 500 then
    raise exception 'A reason and request ID are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into previous from public.membership_audit where request_id=p_request_id;
  if found then
    if previous.actor_id is distinct from actor or previous.action is distinct from 'revoke' or previous.grant_id is distinct from p_grant_id or previous.reason<>trim(p_reason) then
      raise exception 'Request ID already used' using errcode='22023';
    end if;
    return jsonb_build_object('grant_id',previous.grant_id,'replayed',true);
  end if;
  select * into target from public.access_grants where id=p_grant_id for update;
  if not found then raise exception 'Grant not found' using errcode='22023'; end if;
  update public.access_grants set revoked_at=coalesce(revoked_at,now()) where id=p_grant_id;
  insert into public.membership_audit(request_id,actor_id,user_id,grant_id,action,expires_at,reason)
    values(p_request_id,actor,target.user_id,p_grant_id,'revoke',target.expires_at,trim(p_reason));
  return jsonb_build_object('grant_id',p_grant_id,'replayed',false);
end;
$$;

create function public.dt_admin_audit(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.dt_assert_admin();
  select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into result from
    (select action,reason,expires_at,created_at from public.membership_audit
     where user_id=p_user_id order by created_at desc,request_id limit 50) a;
  return result;
end;
$$;

revoke all on function public.dt_assert_admin() from public,anon,authenticated;
revoke all on function public.dt_admin_status(),public.dt_admin_members(text,text,integer),
  public.dt_admin_grant(uuid,timestamptz,text,uuid),public.dt_admin_revoke(uuid,text,uuid),
  public.dt_admin_audit(uuid) from public,anon,authenticated;
grant execute on function public.dt_admin_status(),public.dt_admin_members(text,text,integer),
  public.dt_admin_grant(uuid,timestamptz,text,uuid),public.dt_admin_revoke(uuid,text,uuid),
  public.dt_admin_audit(uuid) to authenticated;
commit;
