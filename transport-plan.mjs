import {MODES} from './core.mjs?v=4.3';

export function transitVehicleMode(type=''){
 if(['SUBWAY','METRO_RAIL'].includes(type))return 'METRO';
 if(['TRAM','LIGHT_RAIL'].includes(type))return 'TRAM';
 if(['RAIL','HEAVY_RAIL','COMMUTER_TRAIN','HIGH_SPEED_TRAIN','LONG_DISTANCE_TRAIN','MONORAIL'].includes(type))return 'RAIL';
 if(['BUS','INTERCITY_BUS','TROLLEYBUS','SHARE_TAXI'].includes(type))return 'BUS';
 return 'TRANSIT';
}

// Adopt a compact itinerary choice, never the whole API response.
export function transportPlan(route,fallbackMode='WALK'){
 const steps=(route.legs??[]).flatMap(leg=>leg.steps??[]),rides=steps.filter(s=>s.transitDetails);
 if(!steps.length)throw Error('Google 未返回可核对的交通步骤');
 const modeSet=new Set(rides.map(s=>transitVehicleMode(s.transitDetails.transitLine?.vehicle?.vehicleType)));
 const mode=rides.length?(modeSet.size===1?[...modeSet][0]:'TRANSIT'):fallbackMode;
 const lineParts=[],instructions=[];
 for(const s of steps){
  const t=s.transitDetails;
  if(t){
   const line=t.transitLine?.shortName||t.transitLine?.name||'公共交通';
   const from=t.departureStop?.name||'',to=t.arrivalStop?.name||'';
   lineParts.push(`${line}${from&&to?'（'+from+' → '+to+'）':''}`);
   instructions.push(`乘 ${line}${t.headsign?'，往 '+t.headsign:''}${from?'；'+from+' 上车':''}${to?'，'+to+' 下车':''}。`);
  }else if(s.travelMode==='WALKING'||s.travelMode==='WALK'){
   if(lineParts.at(-1)!=='步行')lineParts.push('步行');
  }
 }
 if(!rides.length){lineParts.splice(0,lineParts.length,MODES[mode]?.name||'步行');instructions.push(`按地图上的${MODES[mode]?.name||'步行'}路线前往。`);}
 const line=lineParts.join(' → ');
 // Long multi-change descriptions stay intact in the note, not a truncated line name.
 return {mode,line:line.length<=180?line:rides.map(s=>s.transitDetails.transitLine?.shortName||s.transitDetails.transitLine?.name||'公共交通').join(' → ').slice(0,180),note:instructions.join('\n'),minutes:Number.isFinite(route.durationMillis)?Math.ceil(route.durationMillis/60000):null};
}

export function routeQueryMode(incoming){
 return MODES[incoming.mode]?.google==='TRANSIT'&&incoming.routing==='recommended'?'TRANSIT':incoming.mode;
}

// Google transit modes are preferences, so split at the chosen station to guarantee a walking finish.
export async function computeTransitWalkRoute(compute,request,walkFrom){
 const station={lat:walkFrom.lat,lng:walkFrom.lng};
 const transit=(await compute({...request,destination:station,transitPreference:{allowedTransitModes:['SUBWAY']}})).routes?.[0];
 const rides=(transit?.legs??[]).flatMap(leg=>leg.steps??[]).filter(step=>step.transitDetails);
 if(!transit?.path?.length||!rides.length||rides.some(step=>transitVehicleMode(step.transitDetails.transitLine?.vehicle?.vehicleType)!=='METRO'))throw Error('未找到到指定下车站的纯地铁路线，保留计划供手动核对');
 const walk=(await compute({origin:station,destination:request.destination,travelMode:'WALKING',fields:request.fields})).routes?.[0];
 if(!walk?.path?.length)throw Error('未找到下车站到目的地的步行路线');
 return {path:[...transit.path,...walk.path],legs:[...(transit.legs??[]),...(walk.legs??[])],distanceMeters:(transit.distanceMeters??0)+(walk.distanceMeters??0),durationMillis:(transit.durationMillis??0)+(walk.durationMillis??0),warnings:[...(transit.warnings??[]),...(walk.warnings??[])]};
}

// Walking first: query metro departure only after the access walk has finished.
export async function computeWalkTransitRoute(compute,request,walkTo){
 const station={lat:walkTo.lat,lng:walkTo.lng};
 const walk=(await compute({origin:request.origin,destination:station,travelMode:'WALKING',fields:request.fields})).routes?.[0];
 if(!walk?.path?.length||!Number.isFinite(walk.durationMillis)||walk.durationMillis<0)throw Error('未找到会场到指定地铁站的步行路线');
 const transit=(await compute({...request,origin:station,departureTime:new Date(request.departureTime.getTime()+walk.durationMillis),transitPreference:{allowedTransitModes:['SUBWAY']}})).routes?.[0];
 const rides=(transit?.legs??[]).flatMap(leg=>leg.steps??[]).filter(step=>step.transitDetails);
 if(!transit?.path?.length||!rides.length||rides.some(step=>transitVehicleMode(step.transitDetails.transitLine?.vehicle?.vehicleType)!=='METRO'))throw Error('未找到从指定上车站出发的纯地铁路线，保留计划供手动核对');
 return {path:[...walk.path,...transit.path],legs:[...(walk.legs??[]),...(transit.legs??[])],distanceMeters:(walk.distanceMeters??0)+(transit.distanceMeters??0),durationMillis:walk.durationMillis+(transit.durationMillis??0),warnings:[...(walk.warnings??[]),...(transit.warnings??[])]};
}
