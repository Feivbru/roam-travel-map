import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOperations} from '../mcp/operations.mjs';
import {createMcpHandler,sha256} from '../mcp/http.mjs';
import {connectRoam} from '../mcp/client.mjs';
const empty={schemaVersion:1,trips:[]};
const setup=[{type:'trip.create',id:'trip',name:'测试旅行',timezone:'Europe/Budapest'},{type:'day.create',trip_id:'trip',id:'day',date:'2026-10-25',title:'第一天'},{type:'stop.create',trip_id:'trip',day_id:'day',id:'stop',name:'Hotel',lat:47.5,lng:19.05,tags:['住宿'],incoming:{mode:'METRO',minutes:20,line:'M2'},preparation:{needed:true,note:'带护照'}}];
test('MCP原子修改：创建、嵌套交通/准备合并、移动、定位解绑和全部校验',()=>{
 const {state}=applyOperations(empty,setup);assert.equal(empty.trips.length,0);const s=state.trips[0].days[0].stops[0];assert.equal(s.incoming.mode,'METRO');
 const updated=applyOperations(state,[{type:'stop.update',trip_id:'trip',day_id:'day',stop_id:'stop',patch:{incoming:{line:'M2 + 步行'},preparation:{completed:true},note:'新备注'}}]);const u=updated.state.trips[0].days[0].stops[0];assert.equal(u.incoming.minutes,20);assert.equal(u.preparation.note,'带护照');assert.equal(u.preparation.completed,true);
 s.placeId='old-place';s.locationSource='google';s.detailsPlaceId='old-place';const moved=applyOperations(state,[{type:'stop.update',trip_id:'trip',day_id:'day',stop_id:'stop',patch:{lat:47.51}}]).state.trips[0].days[0].stops[0];assert.equal(moved.placeId,'');assert.equal(moved.locationSource,'coordinates');
 assert.throws(()=>applyOperations(state,[{type:'stop.update',trip_id:'trip',day_id:'day',stop_id:'stop',patch:{stay:80}},{type:'day.update',trip_id:'trip',day_id:'day',patch:{date:'2026-02-30'}}]));assert.equal(state.trips[0].days[0].stops[0].stay,45);
 assert.throws(()=>applyOperations(state,[{type:'trip.update',trip_id:'trip',patch:{google_api_key:'not-allowed'}}]));
 assert.throws(()=>applyOperations(empty,[{type:'trip.create',id:'trip',name:'X',timezone:'not/a/timezone'}]));
 const n=applyOperations(state,[{type:'stop.create',trip_id:'trip',day_id:'day',id:'stop2',name:'Museum',position:0},{type:'stop.move',trip_id:'trip',day_id:'day',stop_id:'stop2',position:1}]);assert.equal(n.state.trips[0].days[0].stops[1].id,'stop2');
 const deleted=applyOperations(n.state,[{type:'stop.delete',trip_id:'trip',day_id:'day',stop_id:'stop2'},{type:'day.delete',trip_id:'trip',day_id:'day'},{type:'trip.delete',trip_id:'trip'}]);assert.deepEqual(deleted.state,empty);
});
test('真实MCP协议：握手、列工具、读取、默认预览、CAS提交、拒绝跨令牌写入、HTTP授权',async()=>{
 const token='roam_'+'a'.repeat(43),tokenHash=await sha256(token);let record={revision:0,payload:structuredClone(empty)},writes=0,writeAllowed=true,revoked=false;
 const backend={authenticate:async()=>{if(revoked)throw Object.assign(Error(),{code:'UNAUTHORIZED'});return {can_write:writeAllowed}},read:async()=>structuredClone(record),history:async()=>[],save:async(revision,payload)=>{assert.equal(revision,record.revision);writes++;record={revision:revision+1,payload};return {revision:record.revision,change_id:crypto.randomUUID()}}};
 const handler=createMcpHandler(hash=>{assert.equal(hash,tokenHash);return backend});
 const fetch=async(input,init)=>handler(new Request(input,init));
 const client=await connectRoam({token,url:'http://127.0.0.1/mcp',fetch});
 try{
  const list=await client.listTools();assert.equal(list.tools.length,7);assert.ok(!JSON.stringify(list).includes('google_api_key'));
  const call=async(name,args={})=>client.callTool({name,arguments:args});
  assert.equal((await call('roam_list_trips')).structuredContent.revision,0);
  const preview=await call('roam_apply_changes',{expected_revision:0,operations:setup,summary:'创建测试计划'});assert.equal(preview.isError,undefined);assert.equal(preview.structuredContent.dry_run,true);assert.equal(writes,0);
  const save=await call('roam_apply_changes',{expected_revision:0,operations:preview.structuredContent.operations,dry_run:false,summary:'创建测试计划'});assert.equal(save.structuredContent.revision,1);assert.equal(writes,1);
  const day=await call('roam_get_day',{trip_id:'trip',day_id:'day'});assert.equal(day.structuredContent.day.stops[0].name,'Hotel');
  const stale=await call('roam_apply_changes',{expected_revision:0,operations:setup,dry_run:false,summary:'旧版本'});assert.equal(stale.isError,true);assert.match(stale.content[0].text,/ROAM_CONFLICT/);assert.equal(writes,1);
  writeAllowed=false;const readClient=await connectRoam({token,url:'http://127.0.0.1/mcp',fetch});try{const denied=await readClient.callTool({name:'roam_apply_changes',arguments:{expected_revision:1,operations:[{type:'trip.delete',trip_id:'trip'}],dry_run:false,summary:'拒绝删除'}});assert.equal(denied.isError,true);assert.equal(writes,1)}finally{await readClient.close()}
  revoked=true;await assert.rejects(call('roam_list_trips'));
 }finally{await client.close()}
 assert.equal((await handler(new Request('http://127.0.0.1/mcp',{method:'POST'}))).status,401);
 assert.equal((await handler(new Request('http://127.0.0.1/mcp',{method:'POST',headers:{origin:'https://evil.example',authorization:'Bearer '+token}}))).status,403);
});
