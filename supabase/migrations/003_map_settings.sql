-- Per-account browser Maps key; separate from itineraries and exports.
begin;
create table public.roam_map_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 engine text not null check (engine in ('osm','google')),
 google_api_key text not null default '' check (google_api_key='' or google_api_key ~ '^AIza[A-Za-z0-9_-]{35}$'),
 updated_at timestamptz not null default now(),
 check (engine<>'google' or google_api_key<>'')
);
alter table public.roam_map_settings enable row level security;
revoke all on public.roam_map_settings from public,anon,authenticated;
grant select on public.roam_map_settings to authenticated;
create policy own_roam_map_settings on public.roam_map_settings for select to authenticated using ((select auth.uid())=user_id);
create function public.save_roam_map_settings(new_engine text,new_google_api_key text) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 if new_engine is null or new_engine not in ('osm','google') or new_google_api_key is null or (new_google_api_key<>'' and new_google_api_key !~ '^AIza[A-Za-z0-9_-]{35}$') or (new_engine='google' and new_google_api_key='') then raise exception 'Invalid map settings';end if;
 insert into public.roam_map_settings(user_id,engine,google_api_key) values(uid,new_engine,new_google_api_key)
 on conflict(user_id) do update set engine=excluded.engine,google_api_key=excluded.google_api_key,updated_at=now();
end;$$;
revoke all on function public.save_roam_map_settings(text,text) from public,anon;
grant execute on function public.save_roam_map_settings(text,text) to authenticated;
commit;
