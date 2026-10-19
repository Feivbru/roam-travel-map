-- Run once in the dedicated Roam project. No itinerary or credentials are included.
begin;
create table if not exists public.roam_states (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null,
 revision bigint not null default 1 check (revision > 0),
 updated_at timestamptz not null default now(),
 constraint valid_roam_state check (jsonb_typeof(payload)='object' and (payload->>'schemaVersion') is not distinct from '1' and jsonb_typeof(payload->'trips')='array' and jsonb_array_length(payload->'trips')<=100 and octet_length(payload::text)<=5242880)
);
create table if not exists public.roam_routes (
 user_id uuid not null references auth.users(id) on delete cascade,
 route_key text not null check (length(route_key)<=2400),
 created_at_ms bigint not null,
 expires_at timestamptz not null,
 path jsonb not null check (jsonb_typeof(path)='array' and jsonb_array_length(path) between 2 and 10000),
 primary key (user_id,route_key)
);
create index if not exists roam_routes_expiration on public.roam_routes(expires_at);
alter table public.roam_states enable row level security;
alter table public.roam_routes enable row level security;
revoke all on public.roam_states,public.roam_routes from anon,authenticated;
grant select on public.roam_states,public.roam_routes to authenticated;
drop policy if exists own_roam_state on public.roam_states;
create policy own_roam_state on public.roam_states for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists own_roam_routes on public.roam_routes;
create policy own_roam_routes on public.roam_routes for select to authenticated using ((select auth.uid())=user_id and expires_at>now());
create or replace function public.save_roam_state(expected_revision bigint,new_payload jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); next_revision bigint;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 if expected_revision is null or expected_revision<0 or new_payload is null or jsonb_typeof(new_payload)<>'object' or (new_payload->>'schemaVersion') is distinct from '1' or jsonb_typeof(new_payload->'trips') is distinct from 'array' then raise exception 'Invalid state';end if;
 if expected_revision=0 then
  insert into public.roam_states(user_id,payload,revision) values(uid,new_payload,1) on conflict(user_id) do nothing returning revision into next_revision;
 else
  update public.roam_states set payload=new_payload,revision=revision+1,updated_at=now() where user_id=uid and revision=expected_revision returning revision into next_revision;
 end if;
 if next_revision is null then raise exception 'ROAM_CONFLICT' using errcode='40001';end if;
 return next_revision;
end;$$;
create or replace function public.save_roam_route(new_route_key text,new_created_at_ms bigint,new_path jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); point jsonb; key_data jsonb; expiration timestamptz;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 if new_route_key is null or length(new_route_key)>2400 or new_created_at_ms is null or new_created_at_ms<=0 or new_created_at_ms>extract(epoch from now())*1000+30000 then raise exception 'Invalid route metadata';end if;
 key_data:=new_route_key::jsonb;
 if jsonb_typeof(key_data)<>'array' or jsonb_array_length(key_data)<>7 or key_data->>0<>'1' or key_data->>3 not in ('WALK','METRO','BUS','TRAM','TRANSIT','RAIL','DRIVE','BIKE') then raise exception 'Invalid route key';end if;
 if new_path is null or jsonb_typeof(new_path)<>'array' or jsonb_array_length(new_path) not between 2 and 10000 then raise exception 'Invalid path';end if;
 for point in select value from jsonb_array_elements(new_path) loop
  if jsonb_typeof(point->'lat') is distinct from 'number' or jsonb_typeof(point->'lng') is distinct from 'number' or abs((point->>'lat')::numeric)>90 or abs((point->>'lng')::numeric)>180 or (point-'lat'-'lng')<>'{}'::jsonb then raise exception 'Invalid coordinates';end if;
 end loop;
 -- Expire one day early; hourly cleanup leaves a margin within the 30-day cache allowance.
 expiration:=to_timestamp(new_created_at_ms/1000.0)+interval '29 days';
 delete from public.roam_routes where user_id=uid and expires_at<=now();
 if expiration<=now() then raise exception 'Expired route';end if;
 if (select count(*) from public.roam_routes where user_id=uid)>=1000 and not exists(select 1 from public.roam_routes where user_id=uid and route_key=new_route_key) then raise exception 'Route cache full';end if;
 if (select coalesce(sum(jsonb_array_length(path)),0) from public.roam_routes where user_id=uid and route_key<>new_route_key)+jsonb_array_length(new_path)>200000 then raise exception 'Route point quota exceeded';end if;
 insert into public.roam_routes(user_id,route_key,created_at_ms,expires_at,path) values(uid,new_route_key,new_created_at_ms,expiration,new_path)
 on conflict(user_id,route_key) do update set created_at_ms=excluded.created_at_ms,expires_at=excluded.expires_at,path=excluded.path where public.roam_routes.created_at_ms<=excluded.created_at_ms;
end;$$;
revoke all on function public.save_roam_state(bigint,jsonb),public.save_roam_route(text,bigint,jsonb) from public,anon;
grant execute on function public.save_roam_state(bigint,jsonb),public.save_roam_route(text,bigint,jsonb) to authenticated;
commit;
