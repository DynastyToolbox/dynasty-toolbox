begin;
create table public.saved_leagues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'sleeper' check (platform = 'sleeper'),
  league_id text not null check (league_id ~ '^[0-9]{10,22}$'),
  name text not null check (length(name) between 1 and 150),
  season text not null check (season ~ '^[0-9]{4}$'),
  roster_id integer check (roster_id between 1 and 1000),
  team_name text check (length(team_name) <= 150),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, league_id)
);
alter table public.saved_leagues enable row level security;
revoke all on public.saved_leagues from anon, authenticated;
grant select, insert, update, delete on public.saved_leagues to authenticated;
create policy own_leagues_read on public.saved_leagues for select to authenticated using ((select auth.uid()) = user_id);
create policy own_leagues_add on public.saved_leagues for insert to authenticated with check ((select auth.uid()) = user_id);
create policy own_leagues_update on public.saved_leagues for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_leagues_remove on public.saved_leagues for delete to authenticated using ((select auth.uid()) = user_id);
commit;
