-- Run on the development database. Fixture changes are rolled back.
begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users limit 1), true);
select set_config('test.league_owner', current_setting('request.jwt.claim.sub'), true);
set local role authenticated;
insert into public.saved_leagues (user_id,league_id,name,season) values (auth.uid(),'99999999999999999999','RLS rollback fixture','2026');
do $$ begin
 if (select count(*) from public.saved_leagues where league_id='99999999999999999999') <> 1 then raise exception 'Owner read failed'; end if;
 update public.saved_leagues set name='Owner update passed' where league_id='99999999999999999999';
 if not found then raise exception 'Owner update failed'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$ begin
 if exists (select 1 from public.saved_leagues where league_id='99999999999999999999') then raise exception 'Cross-account read allowed'; end if;
 update public.saved_leagues set name='Forbidden' where league_id='99999999999999999999';
 if found then raise exception 'Cross-account update allowed'; end if;
 delete from public.saved_leagues where league_id='99999999999999999999';
 if found then raise exception 'Cross-account delete allowed'; end if;
 begin
  insert into public.saved_leagues (user_id,league_id,name,season) values (current_setting('test.league_owner')::uuid,'99999999999999999998','Forbidden','2026');
  raise exception 'Cross-account insert allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.league_owner'), true);
do $$ begin
 begin
  update public.saved_leagues set user_id='00000000-0000-4000-8000-000000000002' where league_id='99999999999999999999';
  raise exception 'Ownership change allowed';
 exception when insufficient_privilege then null; end;
 delete from public.saved_leagues where league_id='99999999999999999999';
 if not found then raise exception 'Owner delete failed'; end if;
end $$;
reset role;
do $$ begin
 if has_table_privilege('anon','public.saved_leagues','select') or has_table_privilege('anon','public.saved_leagues','insert') or has_table_privilege('anon','public.saved_leagues','update') or has_table_privilege('anon','public.saved_leagues','delete') then raise exception 'Anonymous access allowed'; end if;
end $$;
rollback;
select 'PASS: owner CRUD, cross-account denial, ownership protection, anonymous denial; fixtures rolled back' as result;
