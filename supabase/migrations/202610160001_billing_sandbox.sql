-- DEVELOPMENT ONLY. Apply to phkbpputgegvesmpscrx, never production.
begin;
create table public.billing_environment (
  singleton boolean primary key default true check(singleton),
  project_ref text not null,
  stripe_account_id text not null
);
insert into public.billing_environment values(true,'phkbpputgegvesmpscrx','acct_1UQuk03u6z47lQ6H');
create table public.billing_accounts (
  user_id uuid primary key references auth.users(id),
  stripe_customer_id text unique check(stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  customer_request uuid not null default gen_random_uuid(),
  customer_started timestamptz not null default now(),
  checkout_request uuid,
  checkout_started timestamptz,
  checkout_plan text check(checkout_plan in ('monthly','annual')),
  checkout_session text check(checkout_session ~ '^cs_test_[A-Za-z0-9]+$'),
  lease_token uuid,
  lease_until timestamptz,
  window_started timestamptz not null default now(),
  requests integer not null default 0
);
create table public.billing_events (
  event_id text primary key check(event_id ~ '^evt_[A-Za-z0-9]+$'),
  user_id uuid not null references public.billing_accounts(user_id),
  processed_at timestamptz not null default now()
);
alter table public.billing_environment enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.billing_environment,public.billing_accounts,public.billing_events from public,anon,authenticated;
grant select on public.billing_environment,public.billing_accounts,public.billing_events to service_role;

create function public.dt_billing_lock(p_user uuid,p_project text,p_account text,p_interactive boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.billing_accounts; token uuid:=gen_random_uuid();
begin
  if not exists(select 1 from public.billing_environment where project_ref=p_project and stripe_account_id=p_account) then
    raise exception 'Billing environment mismatch';
  end if;
  if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then
    raise exception 'Verified billing account required';
  end if;
  insert into public.billing_accounts(user_id) values(p_user) on conflict do nothing;
  select * into r from public.billing_accounts where user_id=p_user for update;
  if r.lease_until>clock_timestamp() then return jsonb_build_object('busy',true); end if;
  if p_interactive then
    if r.window_started<now()-interval '1 minute' then r.window_started:=now();r.requests:=0;end if;
    if r.requests>=12 then return jsonb_build_object('limited',true);end if;
    r.requests:=r.requests+1;
  end if;
  update public.billing_accounts set lease_token=token,lease_until=clock_timestamp()+interval '2 minutes',
    requests=r.requests,window_started=r.window_started where user_id=p_user returning * into r;
  return to_jsonb(r);
end $$;

create function public.dt_billing_save(p_user uuid,p_token uuid,p_customer text,p_checkout_request uuid,
  p_checkout_started timestamptz,p_checkout_plan text,p_checkout_session text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.billing_accounts;
begin
  select * into r from public.billing_accounts where user_id=p_user for update;
  if not found or r.lease_token is distinct from p_token or r.lease_until<=clock_timestamp() then raise exception 'Billing lock expired'; end if;
  if r.stripe_customer_id is not null and r.stripe_customer_id is distinct from p_customer then raise exception 'Customer cannot be reassigned'; end if;
  update public.billing_accounts set stripe_customer_id=p_customer,checkout_request=p_checkout_request,
    checkout_started=p_checkout_started,checkout_plan=p_checkout_plan,checkout_session=p_checkout_session
    where user_id=p_user returning * into r;
  return to_jsonb(r);
end $$;

create function public.dt_billing_commit(p_user uuid,p_token uuid,p_event text,p_subscription jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.billing_accounts;
begin
  select * into r from public.billing_accounts where user_id=p_user for update;
  if not found or r.lease_token is distinct from p_token or r.lease_until<=clock_timestamp() then raise exception 'Billing lock expired'; end if;
  if p_event is not null then
    insert into public.billing_events(event_id,user_id) values(p_event,p_user) on conflict do nothing;
    if not found then return;end if;
  end if;
  if p_subscription is null then
    -- No qualifying subscription. Do not touch complimentary grants.
    update public.membership_subscriptions set status='canceled',paid_through=null,updated_at=now() where user_id=p_user;
  else
    if p_subscription->>'customer' is distinct from r.stripe_customer_id or
      p_subscription->>'id' !~ '^sub_[A-Za-z0-9]+$' or p_subscription->>'id' is null or
      (p_subscription->>'livemode')::boolean is distinct from false then raise exception 'Invalid billing snapshot';end if;
    insert into public.membership_subscriptions(user_id,plan,stripe_subscription_id,status,paid_through,cancel_at_period_end)
      values(p_user,'premium',p_subscription->>'id',p_subscription->>'status',
        (p_subscription->>'paid_through')::timestamptz,coalesce((p_subscription->>'cancel_at_period_end')::boolean,false))
      on conflict(user_id) do update set stripe_subscription_id=excluded.stripe_subscription_id,status=excluded.status,
        paid_through=excluded.paid_through,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=now();
  end if;
end $$;

create function public.dt_billing_unlock(p_user uuid,p_token uuid) returns void
language sql security definer set search_path='' as $$
 update public.billing_accounts set lease_token=null,lease_until=null where user_id=p_user and lease_token=p_token;
$$;
revoke all on function public.dt_billing_lock(uuid,text,text,boolean),
 public.dt_billing_save(uuid,uuid,text,uuid,timestamptz,text,text),public.dt_billing_commit(uuid,uuid,text,jsonb),
 public.dt_billing_unlock(uuid,uuid) from public,anon,authenticated;
grant execute on function public.dt_billing_lock(uuid,text,text,boolean),
 public.dt_billing_save(uuid,uuid,text,uuid,timestamptz,text,text),public.dt_billing_commit(uuid,uuid,text,jsonb),
 public.dt_billing_unlock(uuid,uuid) to service_role;
commit;
