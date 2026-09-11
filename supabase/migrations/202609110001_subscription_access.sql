-- Prepared foundation only; apply to an isolated development project and verify RLS first.
-- No client can grant access or update billing. No admin identity is seeded here.
begin;
create table public.membership_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan = 'premium'),
  stripe_subscription_id text not null unique,
  status text not null check (status in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  paid_through timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'premium' check (plan = 'premium'),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid not null references auth.users(id),
  reason text not null check (length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at)
);
create index access_grants_user on public.access_grants(user_id);
alter table public.membership_subscriptions enable row level security;
alter table public.access_grants enable row level security;
revoke all on public.membership_subscriptions, public.access_grants from public, anon, authenticated;
grant select (user_id,plan,status,paid_through,cancel_at_period_end) on public.membership_subscriptions to authenticated;
grant select (user_id,plan,starts_at,expires_at,revoked_at) on public.access_grants to authenticated;
create policy own_subscription_read on public.membership_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy own_access_grants_read on public.access_grants for select to authenticated
  using ((select auth.uid()) = user_id);
-- Service credentials stay in server environment variables. Future write handlers must
-- verify Stripe signatures or an explicitly assigned administrator with step-up MFA.
grant all on public.membership_subscriptions, public.access_grants to service_role;
commit;
