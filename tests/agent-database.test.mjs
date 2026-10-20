import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
test('Agent数据库：令牌摘要隔离、撤销/到期/只读、CAS写入、审计与安全撤销、速率限制',async()=>{
 const db=new PGlite(),a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',rw='a'.repeat(64),ro='b'.repeat(64),expired='c'.repeat(64);
 const state={schemaVersion:1,trips:[]};
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
  for(const file of ['001_roam.sql','004_agent_mcp.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1),($2)',[a,b]);
  await db.exec('set role anon');await assert.rejects(db.query('select * from public.roam_agent_tokens'),/permission denied/);await assert.rejects(db.query('select public.read_roam_agent_state($1)',[rw]),/permission denied/);
  await db.exec('reset role;set role authenticated');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[a]);
  const create=async(hash,write)=> (await db.query('select public.create_roam_agent_token($1,$2,$3,$4,30) as id',['测试连接',hash,'roam_…xxxx',write])).rows[0].id;
  const rwid=await create(rw,true),roid=await create(ro,false);await create(expired,true);
  assert.equal((await db.query('select id,can_write from public.roam_agent_tokens')).rows.length,3);
  await assert.rejects(db.query('select token_hash from public.roam_agent_tokens'),/permission denied/);
  await assert.rejects(db.query('select public.read_roam_agent_state($1)',[rw]),/permission denied/);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[b]);assert.equal((await db.query('select id from public.roam_agent_tokens')).rows.length,0);
  await db.query('select public.revoke_roam_agent_token($1)',[rwid]); // no cross-user effect
  await db.exec('reset role');await db.query("update public.roam_agent_tokens set expires_at=now()-interval '1 second' where token_hash=$1",[expired]);
  await db.exec('set role service_role');await assert.rejects(db.query('select public.authenticate_roam_agent($1)',[expired]),/UNAUTHORIZED/);
  assert.equal((await db.query('select public.authenticate_roam_agent($1) as a',[rw])).rows[0].a.can_write,true);
  const read=async hash=>(await db.query('select public.read_roam_agent_state($1) as a',[hash])).rows[0].a;
  const save=async(hash,rev,payload=state)=>(await db.query('select public.save_roam_agent_state($1,$2,$3,$4) as a',[hash,rev,JSON.stringify(payload),'测试修改'])).rows[0].a;
  assert.equal((await read(rw)).revision,0);await assert.rejects(save(ro,0),/READ_ONLY/);
  const change=await save(rw,0);assert.equal(change.revision,1);await assert.rejects(save(rw,0),/ROAM_CONFLICT/);
  const undo=(await db.query('select public.undo_roam_agent_change($1,$2,$3) as a',[rw,change.change_id,1])).rows[0].a;assert.equal(undo.revision,2);
  // A normal website edit makes restoring an older snapshot unsafe.
  await db.exec('reset role;set role authenticated');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[a]);await db.query('select public.save_roam_state(2,$1)',[JSON.stringify(state)]);
  await assert.rejects(db.query('select previous_payload from public.roam_agent_changes'),/permission denied/);
  await db.exec('reset role;set role service_role');await assert.rejects(db.query('select public.undo_roam_agent_change($1,$2,3)',[rw,undo.change_id]),/ROAM_CONFLICT/);
  for(let rev=3;rev<15;rev++)await save(rw,rev);
  assert.equal((await db.query('select public.list_roam_agent_changes($1) as a',[rw])).rows[0].a.length,10);
  await db.exec('reset role');await db.query('update public.roam_agent_tokens set request_count=120,rate_window=now() where id=$1',[rwid]);await db.exec('set role service_role');await assert.rejects(db.query('select public.authenticate_roam_agent($1)',[rw]),/RATE_LIMIT/);
  await db.exec('reset role;set role authenticated');await db.query('select public.revoke_roam_agent_token($1)',[roid]);await db.exec('reset role;set role service_role');await assert.rejects(read(ro),/UNAUTHORIZED/);
 }finally{await db.close()}
});
