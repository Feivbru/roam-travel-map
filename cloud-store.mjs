import {validateState} from './core.mjs';
import {geometryForStorage,readGeometryCache} from './route-cache.mjs';
export class CloudConflict extends Error { constructor(){super('另一台设备已更新行程。当前修改保留在本设备，请先导出，再加载云端版本。');this.name='CloudConflict';} }
export function createCloudStore(client,userId){
 let revision=0,conflicted=false;
 return {
  get revision(){return revision},get conflicted(){return conflicted},freeze(){conflicted=true},
  async loadState(){
   const {data,error}=await client.from('roam_states').select('payload,revision').eq('user_id',userId).maybeSingle();
   if(error)throw Error('云端行程读取失败：'+error.message);
   revision=data?.revision??0;conflicted=false;
   return data?validateState(data.payload):{schemaVersion:1,trips:[]};
  },
  async saveState(state){
   if(conflicted)throw new CloudConflict();
   const payload=validateState(state);
   const {data,error}=await client.rpc('save_roam_state',{expected_revision:revision,new_payload:payload});
   if(error){if(error.code==='40001'||error.message?.includes('ROAM_CONFLICT')){conflicted=true;throw new CloudConflict()}throw Error('云端暂未保存：'+error.message)}
   revision=Number(data);return revision;
  },
  async loadRoutes(){
   const {data,error}=await client.from('roam_routes').select('route_key,created_at_ms,path').eq('user_id',userId).gt('expires_at',new Date().toISOString()).order('created_at_ms',{ascending:false}).limit(1000);
   if(error)throw Error('云端路线读取失败：'+error.message);
   return {schemaVersion:1,routes:[...readGeometryCache({schemaVersion:1,routes:(data??[]).map(r=>({key:r.route_key,createdAt:r.created_at_ms,path:r.path}))}).values()]};
  },
  async saveRoute(route){
   const clean=geometryForStorage(route.key,route);if(!clean)throw Error('路线坐标或有效期无效');
   const {error}=await client.rpc('save_roam_route',{new_route_key:clean.key,new_created_at_ms:clean.createdAt,new_path:clean.path});
   if(error)throw Error('云端路线保存失败：'+error.message);
  }
 };
}
