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
  async loadMapSettings(){
   const {data,error}=await client.from('roam_map_settings').select('engine,google_api_key').eq('user_id',userId).maybeSingle();
   // Never echo server errors here: validation messages may include credential values.
   if(error)throw Error('账号地图设置读取失败，请稍后重试。');
   return data?{engine:data.engine,key:data.google_api_key}:null;
  },
  async saveMapSettings(settings){
   const engine=settings?.engine,key=String(settings?.key??'').trim();
   if(!['osm','google'].includes(engine)||(key&&!/^AIza[A-Za-z0-9_-]{35}$/.test(key))||(engine==='google'&&!key))throw Error('请填写有效的 Google 浏览器 API Key。');
   const {error}=await client.rpc('save_roam_map_settings',{new_engine:engine,new_google_api_key:key});
   if(error)throw Error('账号地图设置未保存，请检查网络后重试。');
   return {engine,key};
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
