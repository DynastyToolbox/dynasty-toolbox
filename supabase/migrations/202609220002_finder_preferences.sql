begin;
create function public.dt_valid_finder_preferences(value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(value)='array' and jsonb_array_length(value)<=100
 and not exists(select 1 from jsonb_array_elements(value) p where jsonb_typeof(p)<>'object'
 or jsonb_typeof(p->'roster_id') is distinct from 'string' or not (p->>'roster_id' ~ '^\d{1,4}$')
 or coalesce(p->>'mode','') not in ('overall','competing','tanking')
 or coalesce(p->>'pickWeight','') not in ('low','neutral','high'))
 and (select count(*)=count(distinct p->>'roster_id') from jsonb_array_elements(value) p)
$$;
revoke all on function public.dt_valid_finder_preferences(jsonb) from public,anon;
grant execute on function public.dt_valid_finder_preferences(jsonb) to authenticated;
create table public.finder_preferences (
 user_id uuid not null references auth.users(id) on delete cascade,
 league_id text not null check(league_id ~ '^\d{8,25}$'),
 preferences jsonb not null check(octet_length(preferences::text)<=15000 and public.dt_valid_finder_preferences(preferences)),
 primary key(user_id,league_id)
);
alter table public.finder_preferences enable row level security;
revoke all on public.finder_preferences from anon,authenticated;
grant select,insert,update,delete on public.finder_preferences to authenticated;
create policy finder_preferences_select on public.finder_preferences for select to authenticated using ((select auth.uid())=user_id);
create policy finder_preferences_insert on public.finder_preferences for insert to authenticated with check ((select auth.uid())=user_id);
create policy finder_preferences_update on public.finder_preferences for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy finder_preferences_delete on public.finder_preferences for delete to authenticated using ((select auth.uid())=user_id);
commit;
