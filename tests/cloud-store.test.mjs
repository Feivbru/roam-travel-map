import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudStore,CloudConflict} from '../cloud-store.mjs';
import {routeCacheKey,ROUTE_TTL_MS} from '../route-cache.mjs';
import {makeStop} from '../core.mjs';
const empty={schemaVersion:1,trips:[]};
function client(){const calls=[];let row=null,error=null;return {calls,set row(v){row=v},set error(v){error=v},from(table){calls.push({table});return {select(){return this},eq(key,id){calls.push({key,id});return this},gt(){return this},order(){return this},limit:async()=>({data:row??[],error}),maybeSingle:async()=>({data:row,error})}},rpc:async(name,args)=>{calls.push({name,args});return {data:args.expected_revision===undefined?null:args.expected_revision+1,error}}};}
test('无记录的新账户空白开始，读取按用户ID过滤，保存仅由服务端识别用户',async()=>{const c=client(),s=createCloudStore(c,'user-a');assert.deepEqual(await s.loadState(),empty);assert.equal(s.revision,0);await s.saveState(empty);assert.equal(s.revision,1);assert.deepEqual(c.calls.at(-1),{name:'save_roam_state',args:{expected_revision:0,new_payload:empty}});assert.ok(c.calls.some(v=>v.id==='user-a'));});
test('冲突会冻结后续保存，不能覆盖其他设备的新版本',async()=>{const c=client(),s=createCloudStore(c,'user-a');await s.loadState();c.error={code:'40001',message:'ROAM_CONFLICT'};await assert.rejects(s.saveState(empty),CloudConflict);assert.equal(s.conflicted,true);const n=c.calls.length;await assert.rejects(s.saveState(empty),CloudConflict);assert.equal(c.calls.length,n);});
test('读取失败必须抛出，不能降级为空行程后覆盖云端',async()=>{const c=client(),s=createCloudStore(c,'user-a');c.error={message:'offline'};await assert.rejects(s.loadState(),/读取失败/);});
test('只上传有效路线坐标，Google文字、Key和过期路线不能上传',async()=>{const c=client(),s=createCloudStore(c,'user-a'),a=makeStop('A',47.49,19.04),b=makeStop('B',47.5,19.05),day={date:'2026-10-26',start:'09:00',stops:[a,b]};const key=routeCacheKey(day,1,'Europe/Budapest');await s.saveRoute({key,createdAt:Date.now(),path:[{lat:47.49,lng:19.04},{lat:47.5,lng:19.05}],apiKey:'secret',steps:['Google text']});const data=c.calls.at(-1).args;assert.deepEqual(Object.keys(data).sort(),['new_created_at_ms','new_path','new_route_key']);assert.ok(!JSON.stringify(data).includes('secret'));await assert.rejects(s.saveRoute({key,createdAt:Date.now()-ROUTE_TTL_MS,path:[a,b]}));});
test('地图设置独立于行程，按账号读取，写入不接受用户ID，错误不回显Key',async()=>{
 const c=client(),s=createCloudStore(c,'user-a'),key='AIza'+'x'.repeat(35);
 assert.equal(await s.loadMapSettings(),null);
 c.row={engine:'google',google_api_key:key};assert.deepEqual(await s.loadMapSettings(),{engine:'google',key});
 assert.deepEqual(await s.saveMapSettings({engine:'google',key,user_id:'user-b'}),{engine:'google',key});
 assert.deepEqual(c.calls.at(-1),{name:'save_roam_map_settings',args:{new_engine:'google',new_google_api_key:key}});
 await assert.rejects(s.saveMapSettings({engine:'google',key:''}),/有效/);
 await assert.rejects(s.saveMapSettings({engine:'google',key:'service-secret'}),/有效/);
 await s.saveMapSettings({engine:'osm',key:''});
 c.error={message:'sensitive '+key};await assert.rejects(s.loadMapSettings(),e=>!e.message.includes(key));await assert.rejects(s.saveMapSettings({engine:'google',key}),e=>!e.message.includes(key));
});
test('后台检查远端版本不会提前改写本地revision，确认采用后才更新',async()=>{const c=client(),s=createCloudStore(c,'user-a');await s.loadState();c.row={revision:4,payload:empty};assert.equal(await s.getRemoteRevision(),4);const record=await s.fetchState();assert.equal(s.revision,0);assert.deepEqual(s.adoptState(record),empty);assert.equal(s.revision,4)});
