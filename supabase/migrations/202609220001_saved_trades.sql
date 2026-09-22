begin;
create function public.dt_valid_trade_assets(assets jsonb) returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(assets) <> 'array' then false else
    not exists (select 1 from jsonb_array_elements(assets) a where not coalesce(
      jsonb_typeof(a) = 'object' and jsonb_typeof(a->'id') = 'string' and length(a->>'id') between 1 and 80
      and jsonb_typeof(a->'name') = 'string' and length(a->>'name') between 1 and 180
      and a->>'position' in ('QB','RB','WR','TE','PICK'), false)) end;
$$;
revoke all on function public.dt_valid_trade_assets(jsonb) from public, anon;
grant execute on function public.dt_valid_trade_assets(jsonb) to authenticated;
create table public.saved_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  league_id text not null check (league_id ~ '^[0-9]{8,25}$'),
  roster_id text not null check (roster_id ~ '^[0-9]{1,4}$'),
  partner_id text not null check (partner_id ~ '^[0-9]{1,4}$' and partner_id <> roster_id),
  send jsonb not null check (jsonb_typeof(send) = 'array' and jsonb_array_length(send) between 1 and 3 and octet_length(send::text) <= 2500),
  receive jsonb not null check (jsonb_typeof(receive) = 'array' and jsonb_array_length(receive) between 1 and 3 and octet_length(receive::text) <= 2500),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check (jsonb_array_length(send) + jsonb_array_length(receive) <= 4),
  check (public.dt_valid_trade_assets(send) and public.dt_valid_trade_assets(receive)),
  unique (user_id, fingerprint)
);
alter table public.saved_trades enable row level security;
revoke all on public.saved_trades from anon, authenticated;
grant select, insert, delete on public.saved_trades to authenticated;
create policy own_trades_read on public.saved_trades for select to authenticated using ((select auth.uid()) = user_id);
create policy own_trades_add on public.saved_trades for insert to authenticated with check ((select auth.uid()) = user_id);
create policy own_trades_remove on public.saved_trades for delete to authenticated using ((select auth.uid()) = user_id);
create function public.dt_limit_saved_trades() returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is distinct from new.user_id then
    raise exception 'Sign in to save your own trades.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if exists (select 1 from public.saved_trades where user_id = new.user_id and fingerprint = new.fingerprint) then return new; end if;
  if (select count(*) from public.saved_trades where user_id = new.user_id) >= 50 then
    raise exception 'Unpin a trade before saving another.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.dt_limit_saved_trades() from public, anon, authenticated;
create trigger limit_saved_trades before insert on public.saved_trades for each row execute function public.dt_limit_saved_trades();
commit;
