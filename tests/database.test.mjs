import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('真实PostgreSQL规则：未登录拒绝、用户隔离、禁止绕过revision、路线坐标校验',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(await readFile(new URL('../supabase/migrations/001_roam.sql',import.meta.url),'utf8'));
  const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
  await db.query('insert into auth.users values($1),($2)',[a,b]);
  await db.exec('set role anon');await assert.rejects(db.query('select * from public.roam_states'),/permission denied/);await assert.rejects(db.query(`select public.save_roam_state(0,'{"schemaVersion":1,"trips":[]}'::jsonb)`),/permission denied/);
  await db.exec('reset role;set role authenticated');
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[a]);
  assert.equal((await db.query(`select public.save_roam_state(0,'{"schemaVersion":1,"trips":[]}'::jsonb) as rev`)).rows[0].rev,1);
  await assert.rejects(db.query(`select public.save_roam_state(0,'{"schemaVersion":1,"trips":[]}'::jsonb)`),/ROAM_CONFLICT/);
  await assert.rejects(db.query(`update public.roam_states set revision=999`),/permission denied/);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[b]);
  assert.equal((await db.query('select * from public.roam_states')).rows.length,0);
  await assert.rejects(db.query(`select public.save_roam_state(1,'{"schemaVersion":1,"trips":[]}'::jsonb)`),/ROAM_CONFLICT/);
  await db.query(`select public.save_roam_state(0,'{"schemaVersion":1,"trips":[]}'::jsonb)`);
  assert.equal((await db.query('select user_id from public.roam_states')).rows[0].user_id,b);
  const key=JSON.stringify([1,{lat:47,lng:19},{lat:48,lng:20},'METRO','2027-05-01',900,'Europe/Budapest']),stamp=Date.now();
  await db.query('select public.save_roam_route($1,$2,$3)',[key,stamp,JSON.stringify([{lat:47,lng:19},{lat:48,lng:20}])]);
  await assert.rejects(db.query('select public.save_roam_route($1,$2,$3)',[key,stamp,JSON.stringify([{lat:91,lng:19},{lat:48,lng:20}])]),/Invalid coordinates/);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[a]);assert.equal((await db.query('select * from public.roam_routes')).rows.length,0);
  await db.query(`select set_config('request.jwt.claim.sub','',false)`);await assert.rejects(db.query(`select public.save_roam_state(0,'{"schemaVersion":1,"trips":[]}'::jsonb)`),/Authentication required/);
 }finally{await db.close()}
});
test('地图Key数据库权限：匿名拒绝、其他账号不可读写、可更换和清空',async()=>{
 const db=new PGlite(),a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',key='AIza'+'x'.repeat(35);
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(await readFile(new URL('../supabase/migrations/003_map_settings.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1),($2)',[a,b]);
  await db.exec('set role anon');await assert.rejects(db.query('select * from public.roam_map_settings'),/permission denied/);await assert.rejects(db.query('select public.save_roam_map_settings($1,$2)',['google',key]),/permission denied/);
  await db.exec('reset role;set role authenticated');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[a]);
  await db.query('select public.save_roam_map_settings($1,$2)',['google',key]);assert.equal((await db.query('select google_api_key from public.roam_map_settings')).rows[0].google_api_key,key);
  await assert.rejects(db.query('update public.roam_map_settings set google_api_key=$1',[key]),/permission denied/);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[b]);assert.equal((await db.query('select * from public.roam_map_settings')).rows.length,0);
  await db.query('select public.save_roam_map_settings($1,$2)',['osm','']);assert.equal((await db.query('select user_id from public.roam_map_settings')).rows[0].user_id,b);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[a]);const replacement='AIza'+'y'.repeat(35);await db.query('select public.save_roam_map_settings($1,$2)',['google',replacement]);assert.equal((await db.query('select google_api_key from public.roam_map_settings')).rows[0].google_api_key,replacement);
  await assert.rejects(db.query('select public.save_roam_map_settings($1,$2)',['google','bad']),/Invalid map settings/);
  await db.query('select public.save_roam_map_settings($1,$2)',['osm','']);assert.equal((await db.query('select google_api_key from public.roam_map_settings')).rows[0].google_api_key,'');
  await db.query(`select set_config('request.jwt.claim.sub','',false)`);await assert.rejects(db.query('select public.save_roam_map_settings($1,$2)',['osm','']),/Authentication required/);
 }finally{await db.close()}
});
