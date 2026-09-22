begin;
create or replace function public.dt_valid_finder_preferences(value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(value)='array' and jsonb_array_length(value)<=100
 and not exists(select 1 from jsonb_array_elements(value) p where jsonb_typeof(p)<>'object'
 or jsonb_typeof(p->'roster_id') is distinct from 'string' or not (p->>'roster_id' ~ '^\d{1,4}$')
 or coalesce(p->>'mode','') not in ('overall','competing','tanking')
 or not (coalesce(p->>'pickWeight','') in ('low','neutral','high') or coalesce((jsonb_typeof(p->'pickWeight')='number' and p->>'pickWeight' ~ '^-?([0-9]|1[0-9]|20)$'),false)))
 and (select count(*)=count(distinct p->>'roster_id') from jsonb_array_elements(value) p)
$$;
commit;
