import {z} from 'zod';
import {validateState,makeStop,relocateStop,MODES,PLACE_TAGS,schedule,clock,dayPreparations,googleDirectionsURL} from '../core.mjs';
const text=(n)=>z.string().max(n),id=z.string().min(1).max(200),time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const refs=z.array(z.object({title:text(200),url:z.url().refine(s=>/^https?:/.test(s),'仅支持HTTP/HTTPS链接')}).strict()).max(30);
const interchange=z.object({name:text(200),lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180)}).strict();
const incoming=z.object({mode:z.enum(Object.keys(MODES)).optional(),minutes:z.number().int().min(0).max(1440).optional(),line:text(180).optional(),note:text(10000).optional(),refs:refs.optional(),routing:z.enum(['mode','recommended']).optional(),walkFrom:interchange.nullable().optional(),walkTo:interchange.nullable().optional()}).strict();
const preparation=z.object({needed:z.boolean().optional(),completed:z.boolean().optional(),note:text(6000).optional(),ticketInfo:text(4000).optional(),bookingURL:text(2000).optional(),checkedOn:date.or(z.literal('')).optional()}).strict();
const tripFields={name:text(150).min(1),timezone:text(100).min(1),description:text(500).optional(),notes:text(10000).optional()};
const dayFields={title:text(150).min(1),date,start:time.optional(),subtitle:text(500).optional(),note:text(10000).optional()};
const stopFields={name:text(200).min(1),lat:z.number().min(-90).max(90).nullable().optional(),lng:z.number().min(-180).max(180).nullable().optional(),tags:z.array(z.enum(Object.keys(PLACE_TAGS))).min(1).max(6).optional(),stay:z.number().int().min(0).max(1440).optional(),start:time.or(z.literal('')).optional(),note:text(10000).optional(),placeId:text(300).optional(),placeQuery:text(300).optional(),locationSource:z.enum(['google','coordinates']).optional(),refs:refs.optional(),preparation:preparation.optional(),incoming:incoming.optional()};
const position=z.number().int().min(0).max(199).optional();
export const operationSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('trip.create'),id:id.optional(),...tripFields}).strict(),
 z.object({type:z.literal('trip.update'),trip_id:id,patch:z.object(tripFields).partial().strict()}).strict(),
 z.object({type:z.literal('trip.delete'),trip_id:id}).strict(),
 z.object({type:z.literal('day.create'),trip_id:id,id:id.optional(),...dayFields}).strict(),
 z.object({type:z.literal('day.update'),trip_id:id,day_id:id,patch:z.object(dayFields).partial().strict()}).strict(),
 z.object({type:z.literal('day.delete'),trip_id:id,day_id:id}).strict(),
 z.object({type:z.literal('stop.create'),trip_id:id,day_id:id,id:id.optional(),position,...stopFields}).strict(),
 z.object({type:z.literal('stop.update'),trip_id:id,day_id:id,stop_id:id,patch:z.object(stopFields).partial().strict()}).strict(),
 z.object({type:z.literal('stop.delete'),trip_id:id,day_id:id,stop_id:id}).strict(),
 z.object({type:z.literal('stop.move'),trip_id:id,day_id:id,stop_id:id,position:z.number().int().min(0).max(199)}).strict()
]);
export const operationsSchema=z.array(operationSchema).min(1).max(100);
export function findTrip(state,tripId){const t=state.trips.find(t=>t.id===tripId);if(!t)throw Error('找不到行程 ID：'+tripId);return t}
export function findDay(state,tripId,dayId){const t=findTrip(state,tripId),d=t.days.find(d=>d.id===dayId);if(!d)throw Error('找不到当天计划 ID：'+dayId);return {t,d}}
export function tripSummary(t){return {id:t.id,name:t.name,timezone:t.timezone,days:t.days.map(d=>({id:d.id,date:d.date,title:d.title,stops:d.stops.length}))}}
export function dayView(state,tripId,dayId){const {t,d}=findDay(state,tripId,dayId);return {trip_id:t.id,timezone:t.timezone,day:d,timeline:schedule(d).map(r=>({stop_id:r.s.id,start:clock(r.start),end:clock(r.end),late_minutes:r.late,travel_minutes:r.i?r.s.incoming.minutes:0,google_directions_url:r.i?googleDirectionsURL(d.stops[r.i-1],r.s):''})),preparations:dayPreparations(d).map(p=>({stop_id:p.stop.id,name:p.stop.name,needed:p.needed,completed:p.completed,note:p.note,ticketInfo:p.ticketInfo,bookingURL:p.bookingURL}))}}
function stopPatch(stop,patch){
 let next=stop;
 if(('lat'in patch||'lng'in patch)&&!('placeId'in patch)){
  const point={lat:patch.lat===undefined?stop.lat:patch.lat,lng:patch.lng===undefined?stop.lng:patch.lng};
  if(point.lat===null&&point.lng===null)next={...stop,...point,placeId:'',detailsPlaceId:'',detailsPlaceQuery:'',locationSource:'coordinates',placeQuery:''};
  else next=relocateStop(stop,point);
 }
 next={...next,...patch};
 if('placeId'in patch&&!('locationSource'in patch))next.locationSource=patch.placeId?'google':'coordinates';
 if(patch.preparation)next.preparation={...stop.preparation,...patch.preparation};
 if(patch.incoming){next.incoming={...stop.incoming,...patch.incoming};for(const k of ['walkFrom','walkTo'])if(next.incoming[k]===null)delete next.incoming[k]}
 return next;
}
export function applyOperations(raw,ops){
 const state=validateState(raw),operations=operationsSchema.parse(ops),changes=[];
 for(const op of operations){
  if(op.type.endsWith('.create'))op.id??=crypto.randomUUID();
  if(op.type==='trip.create'){state.trips.push({id:op.id,name:op.name,timezone:op.timezone,description:op.description??'',notes:op.notes??'',days:[]});changes.push({type:op.type,id:op.id,name:op.name});continue}
  const t=findTrip(state,op.trip_id);
  if(op.type==='trip.update'){Object.assign(t,op.patch);changes.push({type:op.type,id:t.id,name:t.name});continue}
  if(op.type==='trip.delete'){state.trips.splice(state.trips.indexOf(t),1);changes.push({type:op.type,id:t.id,name:t.name});continue}
  if(op.type==='day.create'){t.days.push({id:op.id,date:op.date,title:op.title,start:op.start??'09:00',subtitle:op.subtitle??'',note:op.note??'',stops:[]});t.days.sort((a,b)=>a.date.localeCompare(b.date));changes.push({type:op.type,id:op.id,name:op.title});continue}
  const {d}=findDay(state,t.id,op.day_id);
  if(op.type==='day.update'){Object.assign(d,op.patch);t.days.sort((a,b)=>a.date.localeCompare(b.date));changes.push({type:op.type,id:d.id,name:d.title});continue}
  if(op.type==='day.delete'){t.days.splice(t.days.indexOf(d),1);changes.push({type:op.type,id:d.id,name:d.title});continue}
  if(op.type==='stop.create'){
   const {type,trip_id,day_id,position,id,...fields}=op;
   const s=stopPatch({...makeStop(fields.name),id},fields),at=position??d.stops.length;
   if(at>d.stops.length)throw Error('插入位置超出当天安排数量（position 从0开始）');
   d.stops.splice(at,0,s);changes.push({type,id:s.id,name:s.name});continue;
  }
  const i=d.stops.findIndex(s=>s.id===op.stop_id);if(i<0)throw Error('找不到地点 ID：'+op.stop_id);
  const s=d.stops[i];
  if(op.type==='stop.update')d.stops[i]=stopPatch(s,op.patch);
  else if(op.type==='stop.delete')d.stops.splice(i,1);
  else if(op.type==='stop.move'){if(op.position>=d.stops.length)throw Error('移动位置超出当天安排数量');d.stops.splice(i,1);d.stops.splice(op.position,0,s)}
  changes.push({type:op.type,id:s.id,name:d.stops.find(x=>x.id===s.id)?.name??s.name});
 }
 const clean=validateState(state);if(new TextEncoder().encode(JSON.stringify(clean)).length>5*1024*1024)throw Error('行程超过5MB限制');
 const warnings=clean.trips.flatMap(t=>t.days.flatMap(d=>schedule(d).filter(r=>r.late).map(r=>({trip_id:t.id,day_id:d.id,stop_id:r.s.id,name:r.s.name,late_minutes:r.late}))));
 return {state:clean,operations,changes,warnings};
}
