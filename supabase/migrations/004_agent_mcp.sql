begin;
create table public.roam_agent_tokens (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 label text not null check(length(label) between 1 and 80),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 token_hint text not null check(length(token_hint) between 1 and 24),
 can_write boolean not null default false,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 last_used_at timestamptz,
 rate_window timestamptz not null default now(),request_count integer not null default 0
);
create index roam_agent_tokens_owner on public.roam_agent_tokens(user_id);
create table public.roam_agent_changes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 token_id uuid references public.roam_agent_tokens(id) on delete set null,
 summary text not null check(length(summary) between 1 and 240),
 before_revision bigint not null,after_revision bigint not null,
 previous_payload jsonb not null,
 created_at timestamptz not null default now()
);
create index roam_agent_changes_owner on public.roam_agent_changes(user_id,after_revision desc);
alter table public.roam_agent_tokens enable row level security;
alter table public.roam_agent_changes enable row level security;
revoke all on public.roam_agent_tokens,public.roam_agent_changes from public,anon,authenticated;
grant select(id,user_id,label,token_hint,can_write,created_at,expires_at,revoked_at,last_used_at) on public.roam_agent_tokens to authenticated;
grant select(id,user_id,summary,before_revision,after_revision,created_at) on public.roam_agent_changes to authenticated;
create policy own_agent_tokens on public.roam_agent_tokens for select to authenticated using((select auth.uid())=user_id);
create policy own_agent_changes on public.roam_agent_changes for select to authenticated using((select auth.uid())=user_id);
create function public.create_roam_agent_token(new_label text,new_token_hash text,new_token_hint text,allow_write boolean,valid_days integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();token_id uuid;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 if new_label is null or length(trim(new_label)) not between 1 and 80 or new_token_hash is null or new_token_hash !~ '^[a-f0-9]{64}$' or new_token_hint is null or length(new_token_hint) not between 1 and 24 or allow_write is null or valid_days is null or valid_days not between 1 and 90 then raise exception 'Invalid token settings';end if;
 -- Serialize quota checks for one account without touching its itinerary.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,17));
 if (select count(*) from public.roam_agent_tokens where user_id=uid and revoked_at is null and expires_at>now())>=8 then raise exception '最多同时保留8个有效令牌，请先撤销旧令牌';end if;
 insert into public.roam_agent_tokens(user_id,label,token_hash,token_hint,can_write,expires_at) values(uid,trim(new_label),new_token_hash,new_token_hint,allow_write,now()+make_interval(days=>valid_days)) returning id into token_id;
 return token_id;
end;$$;
create function public.revoke_roam_agent_token(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 update public.roam_agent_tokens set revoked_at=coalesce(revoked_at,now()) where id=target_id and user_id=auth.uid();
end;$$;
-- Only the Edge Function's server credential can resolve a token hash.
-- A hash stolen from a database dump is not accepted by the HTTP bearer interface.
create function public.roam_agent_owner(new_token_hash text,require_write boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.roam_agent_tokens;
begin
 select * into t from public.roam_agent_tokens where token_hash=new_token_hash and revoked_at is null and expires_at>now() for update;
 if not found then raise exception 'ROAM_AGENT_UNAUTHORIZED' using errcode='42501';end if;
 if require_write and not t.can_write then raise exception 'ROAM_AGENT_READ_ONLY' using errcode='42501';end if;
 return t.user_id;
end;$$;
create function public.authenticate_roam_agent(new_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid;t public.roam_agent_tokens;
begin
 uid:=public.roam_agent_owner(new_token_hash);
 select * into t from public.roam_agent_tokens where token_hash=new_token_hash;
 if t.rate_window>now()-interval '1 minute' and t.request_count>=120 then raise exception 'ROAM_AGENT_RATE_LIMIT';end if;
 update public.roam_agent_tokens set last_used_at=now(),rate_window=case when rate_window<=now()-interval '1 minute' then now() else rate_window end,request_count=case when rate_window<=now()-interval '1 minute' then 1 else request_count+1 end where id=t.id;
 return jsonb_build_object('token_id',t.id,'can_write',t.can_write,'expires_at',t.expires_at);
end;$$;
create function public.read_roam_agent_state(new_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=public.roam_agent_owner(new_token_hash);result jsonb;
begin
 select jsonb_build_object('revision',revision,'payload',payload) into result from public.roam_states where user_id=uid;
 return coalesce(result,'{"revision":0,"payload":{"schemaVersion":1,"trips":[]}}'::jsonb);
end;$$;
create function public.save_roam_agent_state(new_token_hash text,expected_revision bigint,new_payload jsonb,change_summary text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=public.roam_agent_owner(new_token_hash,true);old_payload jsonb;old_revision bigint;next_revision bigint;change_id uuid;token_id uuid;
begin
 if expected_revision is null or expected_revision<0 or new_payload is null or jsonb_typeof(new_payload)<>'object' or (new_payload->>'schemaVersion') is distinct from '1' or jsonb_typeof(new_payload->'trips') is distinct from 'array' or change_summary is null or length(trim(change_summary)) not between 1 and 240 then raise exception 'Invalid state';end if;
 select payload,revision into old_payload,old_revision from public.roam_states where user_id=uid for update;
 old_revision:=coalesce(old_revision,0);old_payload:=coalesce(old_payload,'{"schemaVersion":1,"trips":[]}'::jsonb);
 if old_revision<>expected_revision then raise exception 'ROAM_CONFLICT' using errcode='40001';end if;
 if expected_revision=0 then
  insert into public.roam_states(user_id,payload,revision) values(uid,new_payload,1) on conflict(user_id) do nothing returning revision into next_revision;
 else
  update public.roam_states set payload=new_payload,revision=revision+1,updated_at=now() where user_id=uid and revision=expected_revision returning revision into next_revision;
 end if;
 if next_revision is null then raise exception 'ROAM_CONFLICT' using errcode='40001';end if;
 select id into token_id from public.roam_agent_tokens where token_hash=new_token_hash;
 insert into public.roam_agent_changes(user_id,token_id,summary,before_revision,after_revision,previous_payload) values(uid,token_id,trim(change_summary),old_revision,next_revision,old_payload) returning id into change_id;
 delete from public.roam_agent_changes where user_id=uid and id in (select id from public.roam_agent_changes where user_id=uid order by after_revision desc offset 10);
 return jsonb_build_object('revision',next_revision,'change_id',change_id);
end;$$;
create function public.list_roam_agent_changes(new_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=public.roam_agent_owner(new_token_hash);result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(c) order by c.after_revision desc),'[]'::jsonb) into result from (select id,summary,before_revision,after_revision,created_at from public.roam_agent_changes where user_id=uid order by after_revision desc limit 10)c;
 return result;
end;$$;
create function public.undo_roam_agent_change(new_token_hash text,target_change_id uuid,expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=public.roam_agent_owner(new_token_hash,true);c public.roam_agent_changes;
begin
 select * into c from public.roam_agent_changes where id=target_change_id and user_id=uid;
 if not found then raise exception 'Change not found';end if;
 -- Never restore a whole snapshot over a later human or agent edit.
 if c.after_revision is distinct from expected_revision then raise exception 'ROAM_CONFLICT' using errcode='40001';end if;
 return public.save_roam_agent_state(new_token_hash,expected_revision,c.previous_payload,'撤销：'||left(c.summary,230));
end;$$;
revoke all on function public.create_roam_agent_token(text,text,text,boolean,integer),public.revoke_roam_agent_token(uuid) from public,anon;
grant execute on function public.create_roam_agent_token(text,text,text,boolean,integer),public.revoke_roam_agent_token(uuid) to authenticated;
revoke all on function public.roam_agent_owner(text,boolean),public.authenticate_roam_agent(text),public.read_roam_agent_state(text),public.save_roam_agent_state(text,bigint,jsonb,text),public.list_roam_agent_changes(text),public.undo_roam_agent_change(text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.roam_agent_owner(text,boolean),public.authenticate_roam_agent(text),public.read_roam_agent_state(text),public.save_roam_agent_state(text,bigint,jsonb,text),public.list_roam_agent_changes(text),public.undo_roam_agent_change(text,uuid,bigint) to service_role;
commit;
