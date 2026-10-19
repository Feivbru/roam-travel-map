import {MODES,located,routingTarget,schedule,activeWalkFrom,activeWalkTo} from './core.mjs?v=4.3';
import {routeQueryMode} from './transport-plan.mjs?v=4.3';

export const ROUTE_TTL_MS=30*24*60*60*1000;
export const MAX_CACHE_ROUTES=1000;
export const MAX_CACHE_POINTS=200000;

export function routeCacheKey(day,index,timezone){
 const destination=day.stops[index],origin=day.stops[index-1];
 if(!index||!origin||!destination)return '';
 const walkFrom=activeWalkFrom(destination.incoming),walkTo=activeWalkTo(destination.incoming),source=routingTarget(origin),target=routingTarget(destination);
 return JSON.stringify([1,walkTo?{...source,walkTo:{lat:walkTo.lat,lng:walkTo.lng}}:source,walkFrom?{...target,walkFrom:{lat:walkFrom.lat,lng:walkFrom.lng}}:target,routeQueryMode(destination.incoming),day.date,schedule(day)[index].depart,timezone]);
}
function validTarget(target){
 if(!target||typeof target!=='object')return false;
 return typeof target.placeId==='string'&&target.placeId.length>0&&target.placeId.length<=300||located(target)&&Math.abs(target.lat)<=90&&Math.abs(target.lng)<=180;
}
export function validRouteKey(key){
 if(typeof key!=='string'||key.length>2400)return false;
 try{
  const value=JSON.parse(key);
  return Array.isArray(value)&&value.length===7&&value[0]===1&&validTarget(value[1])&&validTarget(value[2])&&Boolean(MODES[value[3]]?.google)&&/^\d{4}-\d{2}-\d{2}$/.test(value[4])&&Number.isInteger(value[5])&&value[5]>=0&&value[5]<=1000000&&typeof value[6]==='string'&&value[6].length>0&&value[6].length<=100;
 }catch{return false}
}
// Persist only route coordinates and cache bookkeeping. API durations, text, lines and Keys stay out.
export function geometryForStorage(key,route,now=Date.now()){
 if(!validRouteKey(key)||!Number.isInteger(route?.createdAt)||route.createdAt>now+30000||route.createdAt<=0)return null;
 const expiresAt=route.createdAt+ROUTE_TTL_MS;
 if(expiresAt<=now||!Array.isArray(route.path)||route.path.length<2||route.path.length>10000)return null;
 if(route.path.some(point=>!point||!located(point)||Math.abs(point.lat)>90||Math.abs(point.lng)>180))return null;
 return {key,createdAt:route.createdAt,expiresAt,path:route.path.map(({lat,lng})=>({lat,lng}))};
}
export function readGeometryCache(raw,now=Date.now()){
 const cache=new Map();let points=0;
 if(raw?.schemaVersion!==1||!Array.isArray(raw.routes))return cache;
 const routes=raw.routes.slice(0,MAX_CACHE_ROUTES).map(route=>geometryForStorage(route?.key,route,now)).filter(Boolean).sort((a,b)=>b.createdAt-a.createdAt);
 for(const route of routes){
  if(cache.has(route.key)||points+route.path.length>MAX_CACHE_POINTS)continue;
  points+=route.path.length;
  cache.set(route.key,{...route,geometryOnly:true,persisted:true,steps:[],lines:[],warnings:[]});
 }
 return cache;
}
