export const MODES={WALK:{name:'步行',icon:'↟',color:'#8571b0',google:'WALKING'},METRO:{name:'地铁',icon:'M',color:'#c33162',google:'TRANSIT',transit:'SUBWAY'},BUS:{name:'巴士',icon:'B',color:'#cf9140',google:'TRANSIT',transit:'BUS'},TRAM:{name:'电车',icon:'T',color:'#c96757',google:'TRANSIT',transit:'LIGHT_RAIL'},TRANSIT:{name:'公共交通',icon:'↔',color:'#157d80',google:'TRANSIT'},RAIL:{name:'火车',icon:'R',color:'#4778ad',google:'TRANSIT',transit:'TRAIN'},DRIVE:{name:'驾车',icon:'↗',color:'#5575a6',google:'DRIVING'},BIKE:{name:'骑行',icon:'◎',color:'#6b9162',google:'BICYCLING'},BOAT:{name:'游船',icon:'≈',color:'#3e8ca5',google:null}};
export const uid=()=>crypto.randomUUID();
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeURL(v){try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
export const located=s=>s.lat!==null&&s.lng!==null&&Number.isFinite(s.lat)&&Number.isFinite(s.lng);
export function minutes(t){const [h,m]=t.split(':').map(Number);return h*60+m}
export function clock(n){const v=((n%1440)+1440)%1440;return `${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}${n>=1440?' (+1)':''}`}
export function schedule(day){let cursor=minutes(day.start);return day.stops.map((s,i)=>{const travel=i?s.incoming.minutes:0,depart=cursor,earliest=cursor+travel,fixed=s.start?minutes(s.start):null,start=fixed===null?earliest:Math.max(earliest,fixed);const row={s,i,depart,start,end:start+s.stay,wait:Math.max(0,(fixed??earliest)-earliest),late:fixed===null?0:Math.max(0,earliest-fixed)};cursor=row.end;return row})}
export function zonedInstant(date,total,tz){const [y,m,d]=date.split('-').map(Number);let target=Date.UTC(y,m-1,d,0,total),guess=target;const f=new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});for(let i=0;i<3;i++){const a=Object.fromEntries(f.formatToParts(new Date(guess)).map(p=>[p.type,p.value]));const rendered=Date.UTC(+a.year,+a.month-1,+a.day,+a.hour,+a.minute,+a.second);guess+=target-rendered}return new Date(guess)}
function str(x,label,max=4000){if(typeof x!=='string'||x.length>max)throw Error(`${label}须为不超过 ${max} 字的文本`);return x}
function num(x,label,max){if(!Number.isInteger(x)||x<0||x>max)throw Error(`${label}须为 0–${max} 的数字`);return x}
function time(x,optional=false){if(optional&&x==='')return '';if(typeof x!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(x))throw Error('时间须为 HH:mm');return x}
function refs(x=[]){if(!Array.isArray(x)||x.length>30)throw Error('每个项目最多 30 条参考链接');return x.map(r=>{if(!safeURL(r.url))throw Error('参考链接仅支持 http/https');return {title:str(r.title,'链接标题',200),url:safeURL(r.url)}})}
export function validateState(raw,{newIds=false}={}){if(raw?.schemaVersion!==1||!Array.isArray(raw.trips)||raw.trips.length>100)throw Error('不支持的文件：需要 schemaVersion: 1 和 trips 数组（最多100个行程）');const ids=new Set();function id(x){if(newIds)return uid();if(typeof x!=='string'||!x||ids.has(x))throw Error('项目 ID 缺失或重复');ids.add(x);return x}return {schemaVersion:1,trips:raw.trips.map(t=>{try{new Intl.DateTimeFormat('en',{timeZone:t.timezone})}catch{throw Error('无效的 IANA 时区')}if(!Array.isArray(t.days)||t.days.length>366)throw Error('每天计划格式有误或超过366天');return {id:id(t.id),name:str(t.name,'行程名',150),description:str(t.description??'','描述',500),timezone:t.timezone,notes:str(t.notes??'','行程备注',10000),days:t.days.map(d=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||isNaN(Date.parse(d.date))||new Date(d.date).toISOString().slice(0,10)!==d.date)throw Error('日期须为有效的 YYYY-MM-DD');if(!Array.isArray(d.stops)||d.stops.length>200)throw Error('每天最多 200 个安排');return {id:id(d.id),date:d.date,title:str(d.title,'计划名',150),subtitle:str(d.subtitle??'','副标题',500),start:time(d.start),note:str(d.note??'','当天备注',10000),stops:d.stops.map(s=>{if(!((s.lat===null&&s.lng===null)||(Number.isFinite(s.lat)&&Number.isFinite(s.lng)&&Math.abs(s.lat)<=90&&Math.abs(s.lng)<=180)))throw Error('经纬度必须成对填写，纬度±90，经度±180');if(!MODES[s.incoming?.mode])throw Error('未知的交通方式');return {id:id(s.id),name:str(s.name,'地点名',200),lat:s.lat,lng:s.lng,category:str(s.category??'景点','类型',40),tags:normalizeTags(s),placeId:str(s.placeId??'','Google地点ID',300),locationSource:locationSource(s),detailsPlaceId:str(getDetailsPlaceId(s),'Google details ID',300),detailsPlaceQuery:str(s.detailsPlaceQuery??(getDetailsPlaceId(s)?placeSearchQuery(s):''),'Google details query',300),placeQuery:str(s.placeQuery??'','Google检索名称',300),start:time(s.start??'',true),stay:num(s.stay,'停留时长',1440),note:str(s.note??'','地点备注',10000),preparation:normalizePreparation(s.preparation),refs:refs(s.refs),incoming:{mode:s.incoming.mode,routing:transportRouting(s.incoming.routing),...(s.incoming.walkFrom?{walkFrom:normalizeWalkFrom(s.incoming.walkFrom)}:{}),...(s.incoming.walkTo?{walkTo:normalizeWalkTo(s.incoming.walkTo)}:{}),minutes:num(s.incoming.minutes,'交通时长',1440),line:str(s.incoming.line??'','交通线路',180),note:str(s.incoming.note??'','路段备注',10000),refs:refs(s.incoming.refs)}}})}})}})}}
export function makeStop(name='新地点',lat=null,lng=null){return {id:uid(),name,lat,lng,category:'景点',tags:['景点'],placeId:'',detailsPlaceId:'',detailsPlaceQuery:'',locationSource:'coordinates',placeQuery:'',start:'',stay:45,note:'',preparation:normalizePreparation(),refs:[],incoming:{mode:'WALK',minutes:15,line:'',note:'',refs:[]}}}
export function kml(trip){const x=esc;return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(trip.name)}</name><description>用户计划地点与直线示意连线，不是道路导航轨迹。</description>${trip.days.map(d=>`<Folder><name>${x(d.date+' '+d.title)}</name>${d.stops.map((s,i)=>located(s)?`<Placemark><name>${i+1}. ${x(s.name)}</name><description>${x(stopDescription(s))}</description><Point><coordinates>${s.lng},${s.lat},0</coordinates></Point></Placemark>`:'').join('')}${d.stops.map((s,i)=>i&&located(s)&&located(d.stops[i-1])?`<Placemark><name>${x(MODES[s.incoming.mode].name)} · 示意线</name><LineString><coordinates>${d.stops[i-1].lng},${d.stops[i-1].lat},0 ${s.lng},${s.lat},0</coordinates></LineString></Placemark>`:'').join('')}</Folder>`).join('')}</Document></kml>`}
export function ics(trip){const clean=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');const stamp=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Roam Local//Travel Planner//ZH','CALSCALE:GREGORIAN'];for(const d of trip.days)for(const r of schedule(d)){lines.push('BEGIN:VEVENT',`UID:${r.s.id}@roam.local`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(zonedInstant(d.date,r.start,trip.timezone))}`,`DTEND:${stamp(zonedInstant(d.date,Math.max(r.end,r.start+1),trip.timezone))}`,`SUMMARY:${clean(r.s.name)}`,`DESCRIPTION:${clean(stopDescription(r.s)+'\n'+r.s.refs.map(v=>v.url).join('\n'))}`,`LOCATION:${clean(r.s.name)}`,'END:VEVENT')}lines.push('END:VCALENDAR');return lines.map(line=>{let result='',part='',bytes=0;for(const c of line){const n=new TextEncoder().encode(c).length;if(bytes+n>72){result+=part+'\r\n ';part='';bytes=1}part+=c;bytes+=n}return result+part}).join('\r\n')+'\r\n'}

export const PLACE_TAGS={
 '餐饮':{label:'吃饭',emoji:'🍽️'},'景点':{label:'游玩',emoji:'🏛️'},
 '住宿':{label:'酒店',emoji:'🏨'},'会议':{label:'会议',emoji:'💼'},
 '购物':{label:'购物',emoji:'🛍️'},'交通':{label:'车站',emoji:'🚉'},
 '体验':{label:'体验',emoji:'🎟️'},'机场':{label:'机场',emoji:'✈️'},
 '咖啡':{label:'咖啡',emoji:'☕'},'拍照':{label:'拍照',emoji:'📷'},'休息':{label:'休息',emoji:'🌿'}
};
export function normalizeTags(stop){
 const values=stop.tags??[PLACE_TAGS[stop.category]?stop.category:'景点'];
 if(!Array.isArray(values)||!values.length||values.length>6||values.some(v=>!PLACE_TAGS[v]))throw Error('请选择1–6个预设地点属性');
 return [...new Set(values)];
}
export function stopEmoji(stop){return normalizeTags(stop).map(k=>PLACE_TAGS[k].emoji).join(' ')}
export function wheelIntent({deltaX=0,deltaY=0,deltaMode=0,ctrlKey=false,metaKey=false},height=600){
 const unit=deltaMode===1?16:deltaMode===2?height:1;
 return ctrlKey||metaKey?{type:'zoom',change:Math.max(-.35,Math.min(.35,-deltaY*.012))}:{type:'pan',x:deltaX*unit,y:deltaY*unit};
}

// Details binding alone never changes a manually chosen navigation point.
export function locationSource(stop){
 const source=stop.locationSource??'coordinates';
 if(!['coordinates','google'].includes(source))throw Error('未知的地点定位方式');
 if(source==='google'&&!stop.placeId)throw Error('Google 地点缺少地点 ID');
 return source;
}
export function relocateStop(stop,point,{rename=false}={}){
 if(!located(point)||Math.abs(point.lat)>90||Math.abs(point.lng)>180)throw Error('请选择有效的地图地点');
 return {...stop,lat:point.lat,lng:point.lng,placeId:point.placeId||'',detailsPlaceId:point.placeId||'',detailsPlaceQuery:point.placeId?(point.name||stop.placeQuery||stop.name).trim():'',
  locationSource:point.placeId?'google':'coordinates',
  placeQuery:point.placeId?(point.name||stop.placeQuery):'',
  name:rename&&point.name?point.name:stop.name};
}
export function routingTarget(stop){
 return locationSource(stop)==='google'&&stop.placeId?{placeId:stop.placeId}:{lat:stop.lat,lng:stop.lng};
}

// Maps URLs open the official route planner without a Key or a prior Routes API call.
// Use the same endpoint policy as in-app routing, especially manual bridgehead coordinates.
export function googleDirectionsURL(origin,destination){
 if(!origin||!destination||!located(origin)||!located(destination))return '';
 const params=new URLSearchParams({api:'1'});
 for(const [name,stop] of [['origin',origin],['destination',destination]]){
  params.set(name,`${stop.lat},${stop.lng}`);
  const target=routingTarget(stop);
  if(target.placeId)params.set(name+'_place_id',target.placeId);
 }
 const mode=MODES[destination.incoming?.mode]?.google;
 if(mode)params.set('travelmode',mode.toLowerCase());
 return 'https://www.google.com/maps/dir/?'+params;
}

// A detail-page match is independent of the navigation entrance / manually chosen coordinates.
export const getDetailsPlaceId=stop=>stop.detailsPlaceId??stop.placeId??'';
export const placeSearchQuery=stop=>(stop.placeQuery||'').trim()||stop.name.trim();
export function needsPlaceRematch(stop){
 return !getDetailsPlaceId(stop)||(stop.detailsPlaceQuery??placeSearchQuery(stop))!==placeSearchQuery(stop);
}
export function bindPlaceDetails(stop,id){
 return {...stop,detailsPlaceId:id,detailsPlaceQuery:placeSearchQuery(stop)};
}

// Preparation is user-owned itinerary data, independent of Google matching/routing.
export function normalizePreparation(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('提前准备格式有误');
 for(const key of ['needed','completed'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error('准备状态须为布尔值');
 const bookingURL=str(value.bookingURL??'','购票 / 预约网址',2000);
 if(bookingURL&&!safeURL(bookingURL))throw Error('购票 / 预约链接仅支持 http/https');
 const checkedOn=str(value.checkedOn??'','核实日期',10);
 if(checkedOn&&(!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn)||!Number.isFinite(Date.parse(checkedOn))||new Date(checkedOn).toISOString().slice(0,10)!==checkedOn))throw Error('核实日期无效');
 return {needed:value.needed??false,completed:value.completed??false,note:str(value.note??'','提前准备事项',6000),ticketInfo:str(value.ticketInfo??'','门票与预约说明',4000),bookingURL:bookingURL?safeURL(bookingURL):'',checkedOn};
}
export function dayPreparations(day){return (day?.stops??[]).flatMap((stop,index)=>{const preparation=normalizePreparation(stop.preparation);return preparation.needed?[{stop,index,...preparation}]:[]})}
export function stopDescription(stop){const p=normalizePreparation(stop.preparation);return [stop.note,stop.incoming?.line&&'到达交通：'+stop.incoming.line,stop.incoming?.line&&stop.incoming.note,p.ticketInfo&&'门票 / 预约：'+p.ticketInfo,p.needed&&('提前准备（'+(p.completed?'已完成':'待办')+'）：'+p.note),p.bookingURL].filter(Boolean).join('\n')}

export function transportRouting(value='mode'){if(!['mode','recommended'].includes(value))throw Error('未知的交通查询策略');return value}

// Optional interchange: transit ends here, then continue on foot to the destination.
export function normalizeWalkFrom(value){
 if(!value||!located(value)||Math.abs(value.lat)>90||Math.abs(value.lng)>180)throw Error('下车步行起点坐标无效');
 return {name:str(value.name??'','下车站',200),lat:value.lat,lng:value.lng};
}
export function activeWalkFrom(incoming){
 return incoming?.mode==='METRO'&&incoming.routing!=='recommended'&&incoming.walkFrom?normalizeWalkFrom(incoming.walkFrom):null;
}

// Optional interchange for a walking start before boarding the metro.
export function normalizeWalkTo(value){
 if(!value||!located(value)||Math.abs(value.lat)>90||Math.abs(value.lng)>180)throw Error('地铁上车站坐标无效');
 return {name:str(value.name??'','上车站',200),lat:value.lat,lng:value.lng};
}
export function activeWalkTo(incoming){
 return incoming?.mode==='METRO'&&incoming.routing!=='recommended'&&incoming.walkTo?normalizeWalkTo(incoming.walkTo):null;
}
