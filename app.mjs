import {initializeCloudAuth,cloudStore,cloudUser} from './cloud-auth.mjs';
import {MODES,uid,esc,safeURL,located,minutes,clock,schedule,zonedInstant,validateState,makeStop,kml,ics,PLACE_TAGS,normalizeTags,stopEmoji,wheelIntent,relocateStop,routingTarget,googleDirectionsURL,getDetailsPlaceId,placeSearchQuery,needsPlaceRematch,bindPlaceDetails,normalizePreparation,dayPreparations,activeWalkFrom,activeWalkTo} from './core.mjs?v=4.3';
import {transportPlan,routeQueryMode,computeTransitWalkRoute,computeWalkTransitRoute} from './transport-plan.mjs?v=4.3';
import {ROUTE_TTL_MS,routeCacheKey,geometryForStorage,readGeometryCache} from './route-cache.mjs?v=4.3';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let preparationPanelOpen=false;
let state,tripId,dayId,selection=null,overview=false,picking=false,engine='osm',googleMap,googleObjects=[],leafletObjects=[],routeBusy=false,routeCache=new Map(),saveQueue=Promise.resolve(),searchResults=[],lastSearch=0,toastTimer;
let STORE='roam-cloud-state-v1';
const trip=()=>state.trips.find(t=>t.id===tripId), day=()=>trip()?.days.find(d=>d.id===dayId);
const dayColors=['#216961','#a4864e','#7964a1','#537db0','#b46e61','#718d54'];
const map=L.map('map',{zoomControl:false,doubleClickZoom:false,scrollWheelZoom:false,zoomSnap:0}).setView([47.499,19.053],13);
L.control.zoom({position:'topright'}).addTo(map);
const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map);
let tileErrors=0;tiles.on('tileerror',()=>{if(++tileErrors===5)toast('地图底图加载失败；计划与标记仍可使用，请检查网络。')});
map.on('click',e=>{if(picking)acceptMapPoint({lat:e.latlng.lat,lng:e.latlng.lng})});
map.on('dblclick',e=>{if(!picking&&day())editStop(null,e.latlng.lat,e.latlng.lng)});
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000)}
function modal(title,html){$('#modal').dataset.transportAudit='false';$('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;if(!$('#modal').open)$('#modal').showModal()}
function close(){ $('#modal').close() }
function links(refs){return `<div class="ref-links">${(refs??[]).map(r=>`<a href="${esc(safeURL(r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.title||r.url)}</a>`).join('')}</div>`}
function refText(refs){return (refs??[]).map(r=>`${r.title} | ${r.url}`).join('\n')}
function parseRefs(text){return text.split('\n').filter(x=>x.trim()).map(line=>{const i=line.lastIndexOf('|');const url=(i>=0?line.slice(i+1):line).trim();if(!safeURL(url))throw Error('参考链接须是 http/https 网页地址；每行填“标题 | 网址”');return {title:i>=0?line.slice(0,i).trim():new URL(url).hostname,url:safeURL(url)}})}
function field(name,label,value,type='text',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value??'')}" ${extra}></label>`}
function area(name,label,value){return `<label>${label}<textarea name="${name}">${esc(value??'')}</textarea></label>`}
function refsField(name,refs){return `<label class="refs-edit">参考贴链接（小红书 / Instagram / 任意网页）<textarea name="${name}" placeholder="标题 | https://…">${esc(refText(refs))}</textarea><span>每行一条：标题 | 网址。仅保存链接，不抓取帖子内容。</span></label>`}
function footer(del=''){return `<div class="form-footer">${del?`<button type="button" class="danger" data-action="${del}">删除</button>`:''}<button type="button" class="secondary" data-action="close-modal">取消</button><button type="submit" class="primary">保存</button></div>`}
function dateLabel(d){return new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'short',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'))}
async function init(){
 await initializeCloudAuth();STORE+=':'+cloudUser().id;
 const remote=await cloudStore.loadState();
 let draft;try{draft=JSON.parse(localStorage.getItem(STORE+'-draft'))}catch{}
 const hasDraft=draft?.dirty&&draft.payload;
 state=hasDraft?validateState(draft.payload):remote;
 if(hasDraft&&draft.baseRevision!==cloudStore.revision)cloudStore.freeze();
 tripId=state.trips[0]?.id;dayId=trip()?.days[0]?.id;
 render(true);map.invalidateSize();
 if(cloudStore.conflicted){$('#saveStatus').textContent='● 云端有新版本 · 本机草稿已保留';$('#retryCloudBtn').hidden=false;$('#saveStatus').classList.add('save-error')}
 else if(hasDraft)persist();else $('#saveStatus').textContent='● 已与云端同步';
 await restoreRouteGeometry();await restoreGoogleMode();
}
function persist(){
 let payload,draftSaved=false;
 try{state=validateState(state);payload=structuredClone(state)}catch(error){toast('保存失败：'+error.message);return}
 try{localStorage.setItem(STORE+'-draft',JSON.stringify({payload,baseRevision:cloudStore.revision,dirty:true}));draftSaved=true}catch{toast('本机备份空间不足，仍会尝试云端保存；请保持页面打开。')}
 $('#saveStatus').textContent='● 正在同步…';$('#saveStatus').classList.remove('save-error')
 saveQueue=saveQueue.catch(()=>{}).then(async()=>{
  try{
   await cloudStore.saveState(payload);
   try{const latest=JSON.parse(localStorage.getItem(STORE+'-draft')||'null');
   if(JSON.stringify(latest?.payload)===JSON.stringify(payload))localStorage.removeItem(STORE+'-draft');
   else if(latest){latest.baseRevision=cloudStore.revision;localStorage.setItem(STORE+'-draft',JSON.stringify(latest))}}catch{}
   $('#saveStatus').textContent='● 已保存到云端';$('#retryCloudBtn').hidden=true;
  }catch(error){$('#saveStatus').textContent=cloudStore.conflicted?'● 云端有新版本 · 同步已暂停':draftSaved?'● 本机草稿已保存 · 云端未同步':'● 云端未同步 · 请导出备份';$('#saveStatus').classList.add('save-error');$('#retryCloudBtn').hidden=false;toast(error.message)}
 });
}
function retryCloudSave(){
 if(!state)return location.reload();
 if(!cloudStore.conflicted)return persist();
 modal('另一台设备更新了行程',`<p class="help-text">为避免覆盖新内容，已暂停同步。当前修改仍保存在本设备；先导出草稿，再加载云端版本，可通过导入合并需要保留的行程。</p><div class="form-footer"><button data-action="close-modal" class="secondary">保留当前草稿</button><button data-action="resolve-cloud-conflict" class="primary">导出草稿并加载云端</button></div>`);
}
function render(fit=false){if(!trip()){tripId=state.trips[0]?.id;dayId=trip()?.days[0]?.id}if(trip()&&!day())dayId=trip().days[0]?.id;const t=trip(),d=day();if(panelStopId&&!d?.stops.some(s=>s.id===panelStopId))closePlacePanel();$('#tripName').textContent=t?.name??'创建第一段旅程';$('#sideTitle').textContent=t?.name??'新的旅程';const sorted=t?.days.map(d=>d.date).sort()??[];$('#tripDates').textContent=sorted.length?`${sorted[0]} — ${sorted.at(-1)} · ${sorted.length} 天 · 当地时间`:'在地图上，开始你的第一天。';$('#dayEyebrow').textContent=d?`DAY ${t.days.indexOf(d)+1} · ${dateLabel(d.date)}`:'DAILY PLAN';$('#dayTitle').textContent=d?.title??'添加每天的计划';$('#mapTitle').textContent=overview?'把整段旅程，连在一起。':d?.title??'沿着地图，慢慢出发。';$('#dayNote').textContent=d?.note??'';renderDayPreparations(d);if(panelStop())$('#placePreparation').innerHTML=preparationHTML(panelStop());$('#overviewBtn').classList.toggle('active',overview);$('#dayTabs').innerHTML=(t?.days??[]).map((d,i)=>`<button class="day-tab ${dayId===d.id&&!overview?'active':''}" data-day="${d.id}" title="${esc(d.title)}" aria-label="${esc(d.date+' '+d.title)}"><span class="tab-top"><span>DAY ${String(i+1).padStart(2,'0')}</span><span>↗</span></span><span class="tab-name">${esc(d.title)}</span><span class="tab-date">${esc(d.date.slice(5).replace('-','/'))}</span></button>`).join('');const rows=d?schedule(d):[];const travel=rows.reduce((n,r)=>n+(r.i?r.s.incoming.minutes:0),0);$('#dayStats').innerHTML=`<span>⌖ ${rows.length} 个安排</span><span>↔ 交通预算 ${travel} 分钟</span>${rows.some(r=>r.late)?'<span class="warning">⚠ 时间冲突</span>':''}`;$('#timeline').innerHTML=rows.length?rows.map(r=>{const m=MODES[r.s.incoming.mode],cached=engine==='google'?getRoute(d,r.i):null;return `${r.i?`<div role="button" tabindex="0" class="leg-row ${selection?.id===r.s.id&&selection.type==='leg'?'selected':''}" data-leg="${r.s.id}"><span class="mode-icon" style="color:${m.color}">${m.icon}</span><span class="leg-caption">${m.name}${r.s.incoming.line&&r.s.incoming.line!==m.name?' · <b>'+esc(r.s.incoming.line)+'</b>':''}<small>${r.s.incoming.minutes} 分钟${cached?.lines?.length?' · 实际 '+esc(cached.lines.join(' → ')):''}</small></span><span class="leg-status">${cached?(cached.geometryOnly?'已保存轨迹':'实际路线'):located(r.s)&&located(d.stops[r.i-1])?'示意线':'待定位'}</span></div>`:''}<div role="button" tabindex="0" class="stop-card ${selection?.id===r.s.id&&selection.type==='stop'?'selected':''}" data-stop="${r.s.id}" id="stop-${r.s.id}"><span class="stop-index">${r.i+1}</span><div class="stop-time">${clock(r.start)}${r.s.stay?' — '+clock(r.end):''}${r.late?` <span class="warning">晚于固定时间 ${r.late} 分钟</span>`:''}</div><div class="stop-title"><span class="stop-emoji" aria-label="${esc(normalizeTags(r.s).map(k=>PLACE_TAGS[k].label).join('、'))}">${stopEmoji(r.s)}</span> ${esc(r.s.name)}</div><div class="stop-meta"><span>${esc(normalizeTags(r.s).map(k=>PLACE_TAGS[k].label).join(' · '))}</span><span>${r.s.stay?'停留 '+r.s.stay+' 分钟':'出发 / 抵达'}</span>${r.s.preparation?.needed?`<span class="prep-badge ${r.s.preparation.completed?'is-done':''}">${r.s.preparation.completed?'✓ 已准备':'! 提前准备'}</span>`:''}${!located(r.s)?'<span class="warning">待定位</span>':''}${r.s.refs.length?`<span class="ref-count">↗ ${r.s.refs.length} 参考贴</span>`:''}</div></div>`}).join(''):'<div class="empty">一天的故事，从第一个地点开始。<br>搜索地点，或点击「地图选点」。</div>';drawMap(fit);renderDetail();updateRouteStatus()}
function routeKey(d,i,tz=trip()?.timezone){return routeCacheKey(d,i,tz)}
function getRoute(d,i){
 if(!i)return null;
 const key=routeKey(d,i),cached=routeCache.get(key);
 if(cached&&cached.expiresAt<=Date.now()){routeCache.delete(key);return null}
 return cached??null;
}

function visibleDays(){return overview?trip()?.days??[]:day()?[day()]:[]}
function drawMap(fit=false){leafletObjects.forEach(x=>map.removeLayer(x));leafletObjects=[];googleObjects.forEach(x=>{if('setMap'in x)x.setMap(null);else x.map=null});googleObjects=[];for(const d of visibleDays()){const color=dayColors[(trip().days.indexOf(d))%dayColors.length];d.stops.forEach((s,i)=>{if(!located(s))return;const active=selection?.id===s.id,markerColor=overview?color:'#487d64';if(engine==='osm'){const icon=L.divIcon({className:'number-pin',html:`<div class="pin-body ${active?'active':''}" style="${overview?'border-color:'+color:''}"><span>${i+1}</span></div>`,iconSize:[30,36],iconAnchor:[15,32]});const marker=L.marker([s.lat,s.lng],{icon,keyboard:true,title:s.name,zIndexOffset:i}).addTo(map).bindTooltip(esc(s.name),{direction:'top',offset:[0,-28]}).on('click',()=>{if(picking)acceptMapPoint({lat:s.lat,lng:s.lng,placeId:s.placeId,name:s.name});else selectItem(d.id,s.id,'stop',true)});leafletObjects.push(marker)}else{const el=document.createElement('div');el.className='pin-body '+(active?'active':'');el.style.borderColor=markerColor;const n=document.createElement('span');n.textContent=i+1;el.dataset.emoji=stopEmoji(s);el.title=stopEmoji(s)+' '+s.name;el.append(n);const marker=new google.maps.marker.AdvancedMarkerElement({position:{lat:s.lat,lng:s.lng},map:googleMap,content:el,title:s.name,zIndex:i});marker.addListener('click',()=>{if(picking)acceptMapPoint({lat:s.lat,lng:s.lng,placeId:s.placeId,name:s.name});else selectItem(d.id,s.id,'stop',true)});googleObjects.push(marker)}if(i&&located(d.stops[i-1])){const prev=d.stops[i-1],cached=engine==='google'?getRoute(d,i):null,legActive=selection?.id===s.id&&selection.type==='leg',c=overview?color:MODES[s.incoming.mode].color;if(engine==='osm'){const line=L.polyline([[prev.lat,prev.lng],[s.lat,s.lng]],{color:c,weight:legActive?6:4,opacity:legActive?1:.85,dashArray:'6 7',interactive:true}).addTo(map).on('click',()=>selectItem(d.id,s.id,'leg',true));line.bindTooltip(`${esc(MODES[s.incoming.mode].name)} · ${esc(prev.name)} → ${esc(s.name)}<br>路线示意，非导航`);leafletObjects.push(line)}else{const points=cached?.path??[{lat:prev.lat,lng:prev.lng},{lat:s.lat,lng:s.lng}];const line=new google.maps.Polyline({map:googleMap,path:points,strokeColor:c,strokeWeight:legActive?7:4,strokeOpacity:cached?.95:0,icons:cached?[]:[{icon:{path:'M 0,-1 0,1',strokeColor:c,strokeOpacity:.7,scale:2},offset:'0',repeat:'12px'}],zIndex:legActive?10:1});line.addListener('click',()=>selectItem(d.id,s.id,'leg',true));googleObjects.push(line)}}})}if(fit)fitMap();}
function fitMap(points=null,maxZoom=15){points??=visibleDays().flatMap(d=>d.stops.filter(located).map(s=>[s.lat,s.lng]));if(!points.length)return;const rightPad=selection&&innerWidth>760?Math.min(390,$('.map-stage').clientWidth*.46):55;if(engine==='osm'){map.invalidateSize();map.fitBounds(points,{paddingTopLeft:[45,155],paddingBottomRight:[rightPad,135],maxZoom,animate:false})}else{const bounds=new google.maps.LatLngBounds();points.forEach(([lat,lng])=>bounds.extend({lat,lng}));googleMap.fitBounds(bounds,{left:55,right:rightPad,top:155,bottom:135});google.maps.event.addListenerOnce(googleMap,'idle',()=>{if(googleMap.getZoom()>maxZoom)googleMap.setZoom(maxZoom)})}}
function cityFocus(){const candidates=day()?.stops.filter(s=>located(s)&&!['机场','住宿','交通'].includes(s.category))??[];fitMap(candidates.length?candidates.map(s=>[s.lat,s.lng]):null,15)}
function selectItem(did,id,type,fromMap=false){if(matchMedia('(max-width:760px)').matches)$('.sidebar').classList.remove('mobile-open');const changed=dayId!==did;dayId=did;selection={id,type};if(changed)overview=false;render(false);if(panelStopId&&(panelStopId!==id||type!=='stop'))closePlacePanel();const d=day(),i=d.stops.findIndex(s=>s.id===id),s=d.stops[i];if(type==='stop'&&located(s)){if(engine==='osm')map.panTo([s.lat,s.lng]);else googleMap.panTo({lat:s.lat,lng:s.lng});if(engine==='osm'&&map.getZoom()<14)map.setZoom(14);else if(engine==='google'&&googleMap.getZoom()<14)googleMap.setZoom(14)}else if(type==='leg'&&i&&located(s)&&located(d.stops[i-1])){const r=engine==='google'?getRoute(d,i):null;fitMap(r?.path.map(p=>[p.lat,p.lng])??[[d.stops[i-1].lat,d.stops[i-1].lng],[s.lat,s.lng]],16)}if(fromMap)$(`#stop-${id}`)?.scrollIntoView({behavior:'smooth',block:'center'})}
function renderDetail(){const box=$('#detail');if(!selection||!day()){box.hidden=true;return}const d=day(),i=d.stops.findIndex(s=>s.id===selection.id),s=d.stops[i];if(!s){selection=null;box.hidden=true;return}box.hidden=false;const r=schedule(d)[i],m=MODES[s.incoming.mode],cached=engine==='google'?getRoute(d,i):null;let html='<button class="detail-close" data-action="close-detail" aria-label="关闭详情">×</button>';if(selection.type==='stop'){html+=`<div class="eyebrow">STOP ${String(i+1).padStart(2,'0')} · ${esc(normalizeTags(s).map(k=>PLACE_TAGS[k].label).join(' · '))}</div><h3>${stopEmoji(s)} ${esc(s.name)}</h3><p>${clock(r.start)}${s.stay?' — '+clock(r.end)+' · 停留 '+s.stay+' 分钟':''}${!located(s)?' · 地点待确认':''}</p>${preparationBadge(s)}<p>${esc(s.note||'给这个地点添加一些旅行灵感吧。')}</p>${links(s.refs)}<div class="detail-actions"><button data-action="stop-edit">✎ 编辑地点与参考贴</button><button data-action="place-info">详细介绍</button><button data-action="relocate-stop">⌖ 重新选点</button>${located(s)?`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.lat+','+s.lng)}${s.placeId?'&query_place_id='+encodeURIComponent(s.placeId):''}" target="_blank" rel="noopener noreferrer">Google 地图 ↗</a>`:''}</div>`}else{const prev=d.stops[i-1],officialURL=googleDirectionsURL(prev,s);html+=`<div class="eyebrow">${esc(m.name)} · LEG ${i}</div><h3>${esc(prev?.name??'起点')} → ${stopEmoji(s)} ${esc(s.name)}</h3><p>计划 ${clock(r.depart)} 出发 · 交通预算 ${s.incoming.minutes} 分钟${r.wait?' · 抵达后留白 '+r.wait+' 分钟':''}</p>${s.incoming.line?`<p class="planned-line">${s.incoming.routing==='recommended'?'Google 推荐':'计划线路'}：${esc(s.incoming.line)}</p>`:''}<p>${esc(s.incoming.note||'可添加换乘说明、车次、站台及参考链接。')}</p>`;if(cached){html+=routeSummaryHTML(cached)}else html+=`<p class="warning">${located(s)&&located(prev)?'当前显示地点间的直线示意，尚未计算实际道路 / 交通路线。':'起点或终点尚未定位，请先补充坐标。'}</p>`;html+=`${links(s.incoming.refs)}<div class="detail-actions"><button data-action="leg-edit">✎ 交通与参考贴</button><button data-action="route-leg" ${routeBusy?'disabled':''}>${cached?(cached.geometryOnly?'更新路线与详情':'重新计算'):'计算实际路线'}</button>${officialURL?`<a href="${esc(officialURL)}" target="_blank" rel="noopener noreferrer" title="在 Google 官方地图中比较路线方案">Google 地图路线 ↗</a>`:'<button disabled title="请先补充起点和终点位置">Google 地图路线 ↗</button>'}${Number.isFinite(cached?.duration)?'<button data-action="adopt-duration">采用路线时长</button>':''}</div><p class="official-route-hint">在 Google 地图中比较备选方案；出发日期与时间请在打开后设置。</p>`}box.innerHTML=html}
function updateRouteStatus(){
 const rows=visibleDays().flatMap(d=>d.stops.slice(1).map((s,j)=>({d,i:j+1,s})));
 const cached=engine==='google'?rows.map(x=>getRoute(x.d,x.i)).filter(Boolean):[];
 const count=cached.length,persisted=cached.filter(r=>r.persisted).length,unsaved=count-persisted;
 $('#modeLegend').innerHTML=overview?(trip()?.days??[]).map((d,i)=>`<span><i style="background:${dayColors[i%dayColors.length]}"></i>第${i+1}天</span>`).join(''):[...new Set(rows.map(x=>x.s.incoming.mode))].map(key=>`<span><i style="background:${MODES[key].color}"></i>${MODES[key].name}</span>`).join('');
 $('#engineLabel').textContent=engine==='google'?'Google Maps':'OpenStreetMap';
 $('#routeStatus').textContent=count?`${count} 段实际轨迹 · 其余虚线为示意`:'虚线为路线示意，非实际道路轨迹';
 $('#routeSaveStatus').textContent=unsaved?`${unsaved} 段尚未保存 · 点补全重试`:routeStoreError?'轨迹保存失败 · 请重试':persisted?`${persisted} 段已保存到云端`:'';
 $('#routeSaveStatus').classList.toggle('save-error',Boolean(routeStoreError)||unsaved>0);
 $('#routeSaveStatus').title=routeStoreError||'轨迹在获取后30天内自动复用；出行前可刷新公交方案。';
 $('#routeWarnings').textContent=engine==='google'?[...new Set(rows.flatMap(x=>getRoute(x.d,x.i)?.warnings??[]))].join(' · '):'';
 $('#routeDayBtn').disabled=routeBusy;
 $('#routeDayBtn').textContent=routeBusy?'正在逐段计算…':count?'补全当天路线 ↗':'计算当天实际路线 ↗';
 $('#routeDayBtn').title='复用已保存轨迹，仅计算缺失或失效的路段';
 $('#refreshRoutesBtn').hidden=!count;$('#refreshRoutesBtn').disabled=routeBusy;
}

function bindForm(handler){$('#editorForm').addEventListener('submit',e=>{e.preventDefault();try{handler(new FormData(e.target))}catch(err){toast(err.message)}})}
function editTrip(isNew=false){const t=isNew?{name:'新的旅程',description:'',timezone:'Europe/Budapest',notes:''}:trip();if(!t)return;modal(isNew?'新建行程':'编辑行程',`<form id="editorForm">${field('name','行程名称',t.name,'text','required maxlength="150"')}${field('description','一句话介绍',t.description)}${field('timezone','时区（IANA，例如 Europe/Budapest / Asia/Shanghai）',t.timezone,'text','required')}${area('notes','行程备注',t.notes)}${footer(isNew?'':'trip-delete')}</form>`);bindForm(f=>{const values={name:f.get('name').trim(),description:f.get('description'),timezone:f.get('timezone').trim(),notes:f.get('notes')};if(!values.name)throw Error('请填写行程名称');new Intl.DateTimeFormat('en',{timeZone:values.timezone});if(isNew){const t={id:uid(),...values,days:[]};state.trips.push(t);tripId=t.id;dayId=null;selection=null}else Object.assign(t,values);persist();close();render(true);if(isNew)editDay(true)})}
function editDay(isNew=false){if(!trip()){editTrip(true);return}let next=new Date((trip().days.at(-1)?.date??new Date().toISOString().slice(0,10))+'T12:00:00Z');if(trip().days.length)next.setUTCDate(next.getUTCDate()+1);const d=isNew?{date:next.toISOString().slice(0,10),title:'新的一天',subtitle:'',start:'09:00',note:''}:day();if(!d)return;modal(isNew?'添加每天计划':'编辑当天计划',`<form id="editorForm">${field('title','当天主题',d.title,'text','required maxlength="150"')}<div class="form-row">${field('date','日期',d.date,'date','required')}${field('start','当天起始时间',d.start,'time','required')}</div>${field('subtitle','路线关键词',d.subtitle)}${area('note','当天提醒与备选安排',d.note)}${footer(isNew?'':'day-delete')}</form>`);bindForm(f=>{const values={date:f.get('date'),title:f.get('title').trim(),subtitle:f.get('subtitle'),start:f.get('start'),note:f.get('note')};if(!values.title)throw Error('请填写主题');if(isNew){const n={id:uid(),...values,stops:[]};trip().days.push(n);dayId=n.id}else Object.assign(d,values);trip().days.sort((a,b)=>a.date.localeCompare(b.date));selection=null;overview=false;persist();close();render(true)})}
function editStop(id=null,lat=null,lng=null,location=null,resume=null){
 if(!day()){editDay(true);return}
 const existing=day().stops.find(s=>s.id===id);
 let s=resume?.base??structuredClone(existing??makeStop('新地点',lat,lng));
 if(location)s=relocateStop(s,location,{rename:!existing});
 const position=resume?.fields?.position??(existing?day().stops.indexOf(existing):day().stops.length);
 modal(existing?'编辑地点与安排':'添加地点 / 安排',`<form id="editorForm">${field('name','地点 / 安排名称',s.name,'text','required maxlength="200"')}<div class="location-tools"><span>${s.locationSource==='google'?'📍 已选择 Google 地点 · 导航使用地点入口':'⌖ 使用经纬度导航落点'}</span><button type="button" data-action="editor-pick">在地图上${existing?'重新选点':'选择地点'}</button></div><div class="form-row">${field('lat','纬度（可留空）',s.lat,'number','step="any" min="-90" max="90"')}${field('lng','经度（可留空）',s.lng,'number','step="any" min="-180" max="180"')}</div><p class="help-text">可点击 Google 地图上的商家 / 景点，或点地图空白处选择坐标。桥梁可选岸边入口作为导航落点。</p><div class="form-row"><div class="place-tag-field"><span>地点属性（可多选）</span>${tagPicker(s)}</div>${field('stay','停留分钟',s.stay,'number','required min="0" max="1440" step="1"')}</div><div class="form-row">${field('start','固定开始时间（留空自动衔接）',s.start,'time')}<label>放在当天第几个位置<select name="position">${Array.from({length:day().stops.length+(existing?0:1)},(_,i)=>`<option value="${i}" ${i===Number(position)?'selected':''}>${i+1}</option>`).join('')}</select></label></div>${preparationEditor(s)}${field('placeQuery','Google 地点检索名称（可选，用当地名称更准确）',s.placeQuery??'')}${area('note','游玩安排 / 注意事项',s.note)}${refsField('refs',s.refs)}<div class="modal-section">从上一站到这里</div><div class="form-row">${modeField(s.incoming.mode)}${field('travel','交通预算分钟',s.incoming.minutes,'number','required min="0" max="1440" step="1"')}</div>${field('line','具体线路（例如 M2 → 10路巴士）',s.incoming.line??'')}${area('legNote','换乘与路段说明',s.incoming.note)}${footer(existing?'stop-delete':'')}</form>`);
 $('#modal').dataset.stopId=s.id;
 if(resume){
  for(const name of ['prepNeeded','prepCompleted'])$('#editorForm').elements.namedItem(name).checked=Object.hasOwn(resume.fields,name);
  for(const [name,value] of Object.entries(resume.fields)){
   if((location&&['lat','lng','placeQuery'].includes(name))||(!existing&&location&&name==='name'))continue;
   const input=$('#editorForm').elements.namedItem(name);
   if(input&&name!=='tags'){if(input.type==='checkbox')input.checked=value==='on';else input.value=value;}
  }
  $$('#editorForm input[name="tags"]').forEach(input=>input.checked=resume.tags.includes(input.value));
 }
 editorContext={id,base:s};
 bindForm(f=>{
  const la=f.get('lat').trim(),ln=f.get('lng').trim();
  if(Boolean(la)!==Boolean(ln))throw Error('经纬度请同时填写或同时留空');
  const lat=la?Number(la):null,lng=ln?Number(ln):null;
  const moved=s.lat!==lat||s.lng!==lng;
  const values={...s,name:f.get('name').trim(),lat,lng,tags:f.getAll('tags'),category:f.getAll('tags')[0]??'景点',placeId:moved?'':s.placeId??'',locationSource:moved?'coordinates':s.locationSource??'coordinates',placeQuery:(f.get('placeQuery')??'').trim(),stay:Number(f.get('stay')),start:f.get('start'),note:f.get('note'),preparation:{...normalizePreparation(s.preparation),needed:f.has('prepNeeded'),completed:f.has('prepCompleted'),note:f.get('prepNote'),ticketInfo:f.get('ticketInfo'),bookingURL:f.get('bookingURL').trim()},refs:parseRefs(f.get('refs')),incoming:{...s.incoming,mode:f.get('mode'),minutes:Number(f.get('travel')),line:f.get('line')??'',note:f.get('legNote')}};
  if(!values.name)throw Error('请填写地点名称');
  const candidate=structuredClone(state),cd=candidate.trips.find(t=>t.id===tripId).days.find(d=>d.id===dayId);
  cd.stops=cd.stops.filter(x=>x.id!==s.id);cd.stops.splice(Number(f.get('position')),0,values);
  validateState(candidate);
  const changedLocation=existing&&JSON.stringify(routingTarget(existing))!==JSON.stringify(routingTarget(values));
  state=candidate;selection={id:s.id,type:'stop'};persist();close();render(false);selectItem(dayId,s.id,'stop');
  if(panelStopId===s.id){$('#placePanelTitle').textContent=stopEmoji(values)+' '+values.name;renderReferencePages(values);loadPlaceInfo(true)}
  if(changedLocation)refreshAdjacentRoutes(s.id);
 });
}

function modeField(mode){return `<label>交通方式<select name="mode">${Object.entries(MODES).map(([key,m])=>`<option value="${key}" ${mode===key?'selected':''}>${m.name}</option>`).join('')}</select></label>`}
function editLeg(){const s=day()?.stops.find(s=>s.id===selection?.id);if(!s)return;modal('编辑路段与参考贴',`<form id="editorForm"><div class="form-row">${modeField(s.incoming.mode)}${field('travel','交通预算分钟',s.incoming.minutes,'number','required min="0" max="1440" step="1"')}</div>${field('line','具体线路（例如 M2 → 10路巴士）',s.incoming.line??'')}${area('note','换乘说明 / 车次 / 站台',s.incoming.note)}${refsField('refs',s.incoming.refs)}${footer()}</form>`);bindForm(f=>{const incoming={...s.incoming,mode:f.get('mode'),routing:s.incoming.routing??'mode',minutes:Number(f.get('travel')),line:f.get('line')??'',note:f.get('note'),refs:parseRefs(f.get('refs'))};s.incoming=incoming;persist();close();render(false)})}
function manageTrips(){modal('我的行程',`${state.trips.map(t=>`<div class="trip-item" role="button" tabindex="0" data-trip="${t.id}"><div><b>${esc(t.name)}</b><p>${esc(t.description)}</p></div><span class="item-days">${t.days.length} 天 ↗</span></div>`).join('')||'<p class="help-text">还没有行程，创建一段新的旅程吧。</p>'}<div class="form-footer"><button data-action="new-trip" class="primary">＋ 新建行程</button></div>`)}
function confirmDelete(type){const names={trip:'整个行程及其所有计划',day:'当天计划及其所有安排',stop:'这个地点及其入站交通段'};modal('确认删除',`<p class="help-text">将删除${names[type]}。建议先导出 JSON 备份。</p><div class="form-footer"><button data-action="close-modal" class="secondary">取消</button><button class="primary" data-confirm-delete="${type}" data-delete-id="${esc($('#modal').dataset.stopId??'')}">确认删除</button></div>`)}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportMenu(){if(!trip())return toast('请先创建行程');modal('导出行程',`<p class="help-text">JSON 完整保留每天计划、交通预算、地点与参考贴，可重新导入。已采纳的交通说明也会保留；不包含Google Key、原始查询结果或路线轨迹。</p><div class="file-options"><button data-action="export-trip"><b>↧ 当前行程 · JSON</b><small>完整备份，适合分享、迁移与重新导入</small></button><button data-action="export-all"><b>↧ 全部行程 · JSON</b><small>当前账户所有旅行计划的完整备份</small></button><button data-action="export-kml"><b>↧ 地图地点与示意线 · KML</b><small>在 Google My Maps 中导入；每一天一个文件夹，直线不是导航轨迹</small></button><button data-action="export-ics"><b>↧ 时间安排 · 日历 ICS</b><small>导入 Google / Apple 日历，按行程时区换算为 UTC</small></button></div>`)}
function settings(){modal('地图与实际路线',`<p class="help-text">默认的 OpenStreetMap 无需 Key。Google 模式会在应用内显示 Google 底图，并通过 Routes Library 逐段绘制真实步行、地铁、巴士与火车路线。</p><form id="editorForm"><label>地图服务<select name="engine"><option value="osm" ${engine==='osm'?'selected':''}>OpenStreetMap · 无需 Key</option><option value="google" ${engine==='google'?'selected':''}>Google Maps · 自备 Key</option></select></label>${field('key','Google Maps JavaScript API Key',sessionStorage.getItem('roam-google-key')??'','password','autocomplete="off"')}<p class="help-text">在 Google Cloud 开启计费、Maps JavaScript API 和 Routes API。将浏览器 Key 的网站来源限制加入 <code>${esc(new URL('./',location.href).href+'*')}</code>，地点介绍及评论还需开启 Places API (New)，并加入 Key 的 API 限制。API 限制只允许使用到的服务，并设置用量额度。Key 只在当前浏览器会话内保存，不写入行程文件。路线与地点详情请求可能计费；只有点击详情或计算路线时才请求。</p><p class="help-text">切换底图不会自动请求路线；点击「计算当天实际路线」才逐段调用。公交会使用计划日期和当地出发时间；采纳推荐的路段不限单一交通类型，最终换乘以返回步骤为准。游船航程请手工安排。</p>${footer()}</form><div class="modal-section">全程交通核对</div><p class="help-text">按Google返回的推荐线路更新整个行程的交通说明；保留固定时间和交通预算，并列出需要额外留时间的路段。</p><button type="button" class="secondary" data-action="audit-transport">按 Google 推荐更新全程交通</button>`);bindForm(async f=>{const chosen=f.get('engine');if(chosen==='google'){const key=f.get('key').trim();if(!key)return toast('请填写 Google API Key');const button=$('#editorForm button[type="submit"]');button.disabled=true;try{await connectGoogle(key);sessionStorage.setItem('roam-google-key',key);sessionStorage.setItem('roam-map-engine','google');engine='google';$('#map').hidden=true;$('#gmap').hidden=false;close();render(true);toast('Google 地图已连接，可计算当天的实际路线')}catch(err){button.disabled=false;engine='osm';$('#map').hidden=false;$('#gmap').hidden=true;map.invalidateSize();toast('Google 连接失败：'+err.message)}}else{sessionStorage.setItem('roam-map-engine','osm');engine='osm';$('#map').hidden=false;$('#gmap').hidden=true;close();map.invalidateSize();render(true)}})}
let googleLoading=null;
async function connectGoogle(key){if(!window.google?.maps?.importLibrary){if(googleLoading)await googleLoading;else{googleLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');let done=false;const timer=setTimeout(()=>fail('加载超时，请检查网络 / Key'),18000);function fail(message){if(done)return;done=true;clearTimeout(timer);script.remove();googleLoading=null;reject(Error(message))}window.roamGoogleReady=()=>{if(done)return;done=true;clearTimeout(timer);resolve()};window.gm_authFailure=()=>{fail('Key 未获授权，请核对 API、网站限制与计费');engine='osm';$('#gmap').hidden=true;$('#map').hidden=false;map.invalidateSize();render(true);toast('Google Key 验证失败，已恢复 OpenStreetMap')};script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key,v:'weekly',loading:'async',callback:'roamGoogleReady',language:'zh-CN'});script.onerror=()=>fail('无法加载 Google Maps');document.head.append(script)});await googleLoading}}await Promise.all([google.maps.importLibrary('maps'),google.maps.importLibrary('marker'),google.maps.importLibrary('routes')]);if(!googleMap){googleMap=new google.maps.Map($('#gmap'),{center:{lat:47.499,lng:19.053},zoom:13,mapId:'DEMO_MAP_ID',disableDefaultUI:true,zoomControl:true,gestureHandling:'greedy',scrollwheel:false,isFractionalZoomEnabled:true,clickableIcons:true});googleMap.addListener('click',e=>{if(e.placeId){e.stop();pickGooglePlace(e.placeId)}else if(picking)acceptMapPoint({lat:e.latLng.lat(),lng:e.latLng.lng()})})}}
let transportAudit=[];
function stepsFor(route){return (route.legs??[]).flatMap(l=>(l.steps??[]).map(s=>{const t=s.transitDetails;if(t)return `${t.transitLine?.shortName??t.transitLine?.name??'公共交通'} · ${t.departureStop?.name??''} → ${t.arrivalStop?.name??''}${t.headsign?' · 往 '+t.headsign:''}`;return (s.instructions??s.travelMode??'步行').replace(/<[^>]*>/g,'')}))}
async function fetchGoogleRoute(d,i,tz,recommended=false){
 const s=d.stops[i],p=d.stops[i-1],m=MODES[s.incoming.mode],r=schedule(d)[i];
 const request={origin:await googleRoutingTarget(p),destination:await googleRoutingTarget(s),travelMode:m.google,fields:['path','legs','distanceMeters','durationMillis','warnings']};
 if(m.google==='TRANSIT'){
  request.departureTime=zonedInstant(d.date,r.depart,tz);
  if(!recommended&&s.incoming.routing!=='recommended'&&m.transit)request.transitPreference={allowedTransitModes:[m.transit]};
 }
 const {Route}=await google.maps.importLibrary('routes');
 const walkFrom=!recommended&&activeWalkFrom(s.incoming),walkTo=!recommended&&activeWalkTo(s.incoming);
 const route=walkTo?await computeWalkTransitRoute(options=>Route.computeRoutes(options),request,walkTo):walkFrom?await computeTransitWalkRoute(options=>Route.computeRoutes(options),request,walkFrom):(await Route.computeRoutes(request)).routes?.[0];
 if(!route?.path?.length)throw Error('没有找到可用路线');
 return route;
}
async function cacheGoogleRoute(d,i,tz,route,createdAt=Date.now()){
 const key=routeKey(d,i,tz);
 const cached={createdAt,expiresAt:createdAt+ROUTE_TTL_MS,geometryOnly:false,persisted:false,path:route.path.map(p=>({lat:typeof p.lat==='function'?p.lat():p.lat,lng:typeof p.lng==='function'?p.lng():p.lng})),distance:route.distanceMeters??0,duration:route.durationMillis??0,steps:stepsFor(route),lines:transitLines(route),warnings:route.warnings??[]};
 routeCache.set(key,cached);await saveRouteGeometry(key,cached);
}
async function computeLeg(d,i,tz){
 const s=d.stops[i],p=d.stops[i-1],m=MODES[s.incoming.mode];
 if(!located(s)||!located(p))return '待定位';
 if(!m.google)return '游船需手动确认';
 await cacheGoogleRoute(d,i,tz,await fetchGoogleRoute(d,i,tz));return null;
}
async function auditTripTransport(){
 if(routeBusy)return toast('请等当前路线计算完成');
 if(engine!=='google'){toast('先连接 Google 地图后再核对');return}
 const original=structuredClone(trip());if(!original)return;
 const tasks=original.days.flatMap(d=>d.stops.slice(1).map((s,j)=>({d,s,i:j+1})));transportAudit=[];
 routeBusy=true;showTransportAudit(0,tasks.length);updateRouteStatus();
 let updated=0;
 try{
  for(const {d,s,i} of tasks){
   const previous=d.stops[i-1],row={date:d.date,from:previous.name,to:s.name,old:s.incoming.line||MODES[s.incoming.mode].name,line:'',status:''};
   transportAudit.push(row);
   try{
    if(!located(s)||!located(previous)){row.status='待定位，保留原计划';continue}
    if(!MODES[s.incoming.mode].google){row.status='需人工确认，保留原计划';continue}
    if(JSON.stringify(routingTarget(previous))===JSON.stringify(routingTarget(s))){row.status='同一地点，保留原计划';continue}
    const route=await fetchGoogleRoute(d,i,original.timezone,true),plan=transportPlan(route,MODES[s.incoming.mode].google==='TRANSIT'?'WALK':s.incoming.mode);
    const currentTrip=state.trips.find(t=>t.id===original.id),currentDay=currentTrip?.days.find(x=>x.id===d.id),index=currentDay?.stops.findIndex(x=>x.id===s.id),current=currentDay?.stops[index];
    if(!current||routeKey(currentDay,index,original.timezone)!==routeKey(d,i,original.timezone)||JSON.stringify(current.incoming)!==JSON.stringify(s.incoming)){row.status='核对期间此段有修改，保留你的编辑';continue}
    const depart=clock(schedule(d)[i].depart),source=`按 ${d.date} ${depart} 当地出发时间查询。`,budget=s.incoming.minutes;
    row.line=plan.line;row.duration=plan.minutes;row.budget=budget;
    row.status=plan.minutes>budget?`已更新；约${plan.minutes}分钟，超出预算${plan.minutes-budget}分钟`:'已更新';
    current.incoming={...current.incoming,mode:plan.mode,routing:MODES[plan.mode].google==='TRANSIT'?'recommended':'mode',line:plan.line,note:`${source}
${plan.note}
${plan.minutes>budget?`当前交通预算${budget}分钟偏紧，Google估计约${plan.minutes}分钟；请调整出发时间或预算。`:'乘车前再次查看班次与站台，预留候车和步行时间。'}`};
    // The line's icon follows the actual vehicle, but future queries remain unrestricted.
    await cacheGoogleRoute(currentDay,index,original.timezone,route);updated++;persist();
   }catch(e){row.status='未查得，保留原计划：'+String(e.message).slice(0,220)}
   finally{showTransportAudit(transportAudit.length,tasks.length);if(dayId===d.id)render(false)}
  }
 }finally{routeBusy=false;render(false);showTransportAudit(tasks.length,tasks.length);toast(`已核对 ${tasks.length} 段，更新 ${updated} 段；固定时刻和交通预算保留。`)}
}
function showTransportAudit(done,total){
 const changing=transportAudit.filter(r=>r.line&&r.old!==r.line).length,warnings=transportAudit.filter(r=>r.duration>r.budget).length;
 const html=`<p class="help-text">Google Maps · 已核对 ${done} / ${total} 段，${changing} 段线路文字变化${warnings?'，'+warnings+'段超出原交通预算':''}。按计划日期与当地出发时间查询，公共交通不限地铁、巴士或火车。地点顺序、固定时刻和预算保留；步行仍按步行查询。</p><div class="transport-audit-table"><table><thead><tr><th>路段</th><th>原计划</th><th>查询结果</th></tr></thead><tbody>${transportAudit.map(r=>`<tr><td><small>${esc(r.date)}</small><b>${esc(r.from)} → ${esc(r.to)}</b></td><td>${esc(r.old)}</td><td>${esc(r.line)}<small class="${r.duration>r.budget?'warning':''}">${esc(r.status||'查询中…')}</small></td></tr>`).join('')}</tbody></table></div><div class="form-footer"><button data-action="close-modal" class="secondary">关闭</button></div>`;
 if($('#modal').open&&$('#modal').dataset.transportAudit==='true')$('#modalBody').innerHTML=html;
 else if(done===0||done===total){modal('Google 推荐交通核对',html);$('#modal').dataset.transportAudit='true'}
}
async function calculate(all=false,force=false){
 if(routeBusy)return;
 if(engine!=='google'){settings();toast('请先连接 Google 地图，再获取实际路线');return}
 if(!day())return;
 const d=structuredClone(day()),tz=trip().timezone;
 const indexes=all?d.stops.map((_,i)=>i).slice(1):[d.stops.findIndex(s=>s.id===selection?.id)].filter(i=>i>0);
 if(!indexes.length)return toast('当天至少需要两个安排');
 routeBusy=true;updateRouteStatus();let success=0,skipped=0,reused=0,failed=[];
 try{
  for(const i of indexes){
   try{
    const cached=routeCache.get(routeKey(d,i,tz));
    if(!force&&cached&&cached.expiresAt>Date.now()){
     // Also allow retrying a failed disk save without another Google query.
     if(!cached.persisted)await saveRouteGeometry(routeKey(d,i,tz),cached);
     reused++;continue;
    }
    const reason=await computeLeg(d,i,tz);if(reason)skipped++;else success++;
   }catch(e){failed.push(`${i}段：${e.message}`)}
   if(dayId===d.id)render(false);
  }
 }finally{routeBusy=false;render(false)}
 toast(`新计算 ${success} 段${reused?' · 复用 '+reused+' 段':''}${skipped?' · 跳过 '+skipped+' 段（待定位 / 游船）':''}${failed.length?' · 失败 '+failed.length+' 段':''}${routeStoreError||indexes.some(i=>routeCache.get(routeKey(d,i,tz))?.persisted===false)?' · 云端保存失败，可点击补全重试':''}`);
 if(failed.length)modal('部分路段未能计算',`<p class="help-text">其余路线已显示并保存，失败路段可稍后单独重算。刷新失败时仍保留原有未过期轨迹。</p>${failed.map(x=>`<p class="help-text">${esc(x)}</p>`).join('')}<p class="help-text">请检查 Key 权限、Routes API、计费及计划日期的公交时刻覆盖范围。</p>`);
}

async function search(e){e.preventDefault();const q=$('#searchInput').value.trim();if(q.length<2)return toast('请输入至少两个字符');if(Date.now()-lastSearch<1100)return;lastSearch=Date.now();const box=$('#searchResults');box.hidden=false;box.innerHTML='<div class="results-info">正在查找地点…</div>';try{const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q='+encodeURIComponent(q),{headers:{'Accept':'application/json'}});if(!r.ok)throw Error('地点搜索暂时不可用');searchResults=await r.json();box.innerHTML=searchResults.length?searchResults.map((s,i)=>`<button data-search-index="${i}" type="button">⌖ ${esc(s.display_name)}<br><small>添加到当天计划 ↗ · © OpenStreetMap / Nominatim</small></button>`).join(''):'<div class="results-info">没有找到结果，试试当地名称和城市，或使用地图选点。</div>'}catch(e){box.innerHTML='<div class="results-info">'+esc(e.message)+'；可直接在地图选点添加。</div>'}}
const actions={
 'retry-cloud-save':retryCloudSave,'resolve-cloud-conflict':()=>{download(JSON.stringify(state,null,2),'Roam-未同步草稿.json','application/json');localStorage.removeItem(STORE+'-draft');location.reload()},'audit-transport':auditTripTransport,'trips':manageTrips,'new-trip':()=>editTrip(true),'trip-edit':()=>editTrip(),'new-day':()=>editDay(true),'day-edit':()=>editDay(),'new-stop':()=>editStop(),'stop-edit':()=>editStop(selection?.id),'leg-edit':editLeg,
 'close-modal':close,'close-detail':()=>{closePlacePanel();selection=null;render(false)},'stop-delete':()=>confirmDelete('stop'),'day-delete':()=>confirmDelete('day'),'trip-delete':()=>confirmDelete('trip'),
 'fit':()=>{overview=false;selection=null;render(true)},'city':cityFocus,'overview':()=>{overview=!overview;selection=null;render(true)},'pick':()=>beginMapPick(),'cancel-pick':cancelMapPick,'settings':settings,'route-day':()=>calculate(true),'refresh-routes':()=>calculate(true,true),'route-leg':()=>calculate(false,true),'adopt-duration':()=>{const s=day().stops.find(s=>s.id===selection.id),i=day().stops.indexOf(s),r=getRoute(day(),i);if(r){s.incoming.minutes=Math.ceil(r.duration/60000);persist();render(false);toast('已采用路线时长；请查看是否与固定开始时间冲突')}},
 'import':()=>$('#importFile').click(),'export':exportMenu,'export-trip':()=>{download(JSON.stringify({schemaVersion:1,trips:[trip()]},null,2),trip().name+'.json','application/json');toast('已导出当前行程')},'export-all':()=>{download(JSON.stringify(state,null,2),'roam-全部行程.json','application/json');toast('已导出全部行程')},'export-kml':()=>download(kml(trip()),trip().name+'.kml','application/vnd.google-earth.kml+xml'),'export-ics':()=>download(ics(trip()),trip().name+'.ics','text/calendar'),
 'editor-pick':()=>beginEditorPick(),'relocate-stop':()=>beginMapPick(selection?.id),'use-picked-place':usePickedPlace,'dismiss-picked-place':dismissPickedPlace,'photo-prev':()=>showPlacePhoto(-1),'photo-next':()=>showPlacePhoto(1),'photo-enlarge':enlargePlacePhoto,'use-detail-location':useDetailLocation,'place-info':()=>openPlacePanel(),'close-place-panel':closePlacePanel,'retry-place-info':()=>loadPlaceInfo(true),'refresh-place-match':()=>loadPlaceInfo(true,true),
 'toggle-preparations':()=>togglePreparations(),'close-preparations':()=>closePreparations(),
 'toggle-sidebar':()=>$('.sidebar').classList.toggle('mobile-open'),
 'help':()=>modal('把旅行，放回地图上',`<p class="help-text">1. 左上切换或新建「行程」，每个行程可以添加多天计划。左侧日期卡片切换当天，「全程总览」同时显示所有天。</p><p class="help-text">2. 地图始终是主体。点地图标记或左侧地点看详情，点交通段高亮并放大该段。若机场或维也纳让视野过远，用「城市聚焦」查看当天景点。</p><p class="help-text">3. 搜索地点、双击地图或点「地图选点」添加安排。编辑地点可调整位置顺序、固定开始时间、停留时长与参考贴。交通方式、换乘说明及路段参考贴可单独编辑。</p><p class="help-text">4. 未填固定时间的安排自动衔接上一站。固定时间前有空闲会保留留白；若交通或停留导致赶不上，时间线会标出冲突。</p><p class="help-text">5. 地点连线默认是直线示意，不代表可通行路径。在「地图设置」接入 Google Key 后，按段或按天计算实际路线。实际轨迹自动保存到本机，获取后30天内刷新可直接恢复。补全只计算缺失路段；需要最新方案时点「刷新当天路线」。换乘文字与耗时按需重新查询。</p><p class="help-text">6. 修改自动保存到当前账户的云端数据库，并在本设备保留未同步草稿。JSON 支持完整导入导出；KML 用于 Google My Maps；ICS 用于日历。底图与搜索需要联网。源码与操作说明见项目 README.md。</p>`)
};
document.addEventListener('click',e=>{const prep=e.target.closest('[data-prep-toggle]');if(prep){e.preventDefault();const s=day()?.stops.find(s=>s.id===prep.dataset.prepToggle);if(s){s.preparation={...normalizePreparation(s.preparation),completed:!s.preparation?.completed};persist();render(false)}return}const prepEdit=e.target.closest('[data-prep-edit]');if(prepEdit){e.preventDefault();selection={id:prepEdit.dataset.prepEdit,type:'stop'};editStop(selection.id);return}const b=e.target.closest('[data-action]');if(b){e.preventDefault();try{const result=actions[b.dataset.action]?.();if(result instanceof Promise)result.catch(err=>toast(err.message))}catch(err){toast(err.message)}return}const candidate=e.target.closest('[data-place-candidate]');if(candidate){chooseGooglePlace(candidate.dataset.placeCandidate);return}const reference=e.target.closest('[data-reference]');if(reference){openReference(Number(reference.dataset.reference));return}const d=e.target.closest('[data-day]');if(d){dayId=d.dataset.day;selection=null;overview=false;render(true);return}const stop=e.target.closest('[data-stop]'),leg=e.target.closest('[data-leg]');if(stop||leg){selectItem(dayId,stop?.dataset.stop??leg.dataset.leg,stop?'stop':'leg');return}const t=e.target.closest('[data-trip]');if(t){tripId=t.dataset.trip;dayId=trip().days[0]?.id;overview=false;selection=null;close();render(true);return}const searchItem=e.target.closest('[data-search-index]');if(searchItem){const r=searchResults[Number(searchItem.dataset.searchIndex)];$('#searchResults').hidden=true;editStop(null,Number(r.lat),Number(r.lon));$('#editorForm input[name="name"]').value=r.name??r.display_name.split(',')[0];return}const c=e.target.closest('[data-confirm-delete]');if(c){const type=c.dataset.confirmDelete;if(type==='trip'){state.trips=state.trips.filter(t=>t.id!==tripId);tripId=state.trips[0]?.id;dayId=trip()?.days[0]?.id}else if(type==='day'){trip().days=trip().days.filter(d=>d.id!==dayId);dayId=trip().days[0]?.id}else day().stops=day().stops.filter(s=>s.id!==c.dataset.deleteId);selection=null;persist();close();render(true);toast('已删除');return}if(!e.target.closest('.map-search'))$('#searchResults').hidden=true});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role="button"]')){e.preventDefault();e.target.click()}if(e.key==='Escape'){closePreparations();closePlacePanel();selection=null;cancelMapPick();$('#searchResults').hidden=true;$('.sidebar').classList.remove('mobile-open');render(false)}});
$('#searchForm').addEventListener('submit',search);
$('#importFile').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  if(file.size>5*1024*1024)throw Error('文件不能超过5 MB');
  const raw=JSON.parse(await file.text()),imported=validateState(raw,{newIds:true});
  if(!imported.trips.length)throw Error('文件中没有行程');
  const combined={schemaVersion:1,trips:[...state.trips,...imported.trips]};validateState(combined);
  state=combined;tripId=imported.trips[0].id;dayId=trip().days[0]?.id;selection=null;overview=false;persist();render(true);
  await saveQueue;
  if($('#saveStatus').classList.contains('save-error')){toast('行程已加入本机草稿，云端未同步；请先重试同步。');return}
  const importedRoutes=[...readGeometryCache(raw.routeGeometry).values()].filter(r=>Date.now()-r.createdAt<29*86400000);
  if(!importedRoutes.length){toast(`已导入并同步 ${imported.trips.length} 个行程`);return}
  routeBusy=true;updateRouteStatus();let saved=0,failed=0;
  for(let i=0;i<importedRoutes.length;i+=6){await Promise.allSettled(importedRoutes.slice(i,i+6).map(async route=>{
   const entry={...route,persisted:false};routeCache.set(entry.key,entry);
   if(await saveRouteGeometry(entry.key,entry))saved++;else failed++;
  }));}
  toast(`行程已导入 · ${saved} 段轨迹已同步${failed?' · '+failed+' 段未同步，可点补全重试':''}`);
 }catch(error){toast('导入失败：'+error.message)}finally{e.target.value='';routeBusy=false;render(false)}
});
installMapGestures();window.addEventListener('resize',()=>map.invalidateSize());
window.addEventListener('beforeunload',e=>{if(routeBusy){e.preventDefault();e.returnValue=''}});
init().catch(e=>{$('#saveStatus').textContent='● 云端读取失败';$('#saveStatus').classList.add('save-error');$('#retryCloudBtn').hidden=false;toast('初始化失败：'+e.message)});

function tagPicker(stop){
 const selected=normalizeTags(stop);
 return `<div class="tag-picker">${Object.entries(PLACE_TAGS).map(([key,t])=>`<label class="tag-choice"><input type="checkbox" name="tags" value="${esc(key)}" ${selected.includes(key)?'checked':''}><span>${t.emoji} ${t.label}</span></label>`).join('')}</div>`;
}
function transitLines(route){
 return [...new Set((route.legs??[]).flatMap(leg=>(leg.steps??[]).flatMap(step=>{
  const line=step.transitDetails?.transitLine;
  return line?[line.shortName||line.name||'公共交通']:[];
 })))];
}
async function restoreGoogleMode(){
 const key=sessionStorage.getItem('roam-google-key');
 if(!key||sessionStorage.getItem('roam-map-engine')==='osm')return;
 try{
  await connectGoogle(key);engine='google';$('#map').hidden=true;$('#gmap').hidden=false;render(true);
 }catch{toast('已保留 Google Key；地图暂未连接，请在地图设置重试。')}
}

// Trackpad scrolling is panning; macOS/Chromium reports a pinch as ctrl+wheel.
// Three-finger drag reaches the browser as an ordinary mouse drag when macOS enables it.
function installMapGestures(){
 const pending={x:0,y:0,zoom:0};let frame=0;
 const flush=()=>{
  frame=0;
  if(pending.zoom){
   if(engine==='google'&&googleMap)googleMap.setZoom(Math.max(2,Math.min(21,googleMap.getZoom()+pending.zoom)));
   else map.setZoom(Math.max(2,Math.min(19,map.getZoom()+pending.zoom)),{animate:false});
  }
  if(pending.x||pending.y){
   if(engine==='google'&&googleMap)googleMap.panBy(pending.x,pending.y);
   else map.panBy([pending.x,pending.y],{animate:false});
  }
  pending.x=pending.y=pending.zoom=0;
 };
 for(const node of [$('#map'),$('#gmap')]){
  node.addEventListener('wheel',event=>{
   event.preventDefault();event.stopImmediatePropagation();
   const intent=wheelIntent(event,node.clientHeight);
   if(intent.type==='zoom')pending.zoom+=intent.change;
   else{pending.x+=intent.x;pending.y+=intent.y}
   if(!frame)frame=requestAnimationFrame(flush);
  },{capture:true,passive:false});
  let scale=1;
  node.addEventListener('gesturestart',event=>{event.preventDefault();scale=event.scale||1},{passive:false});
  node.addEventListener('gesturechange',event=>{
   event.preventDefault();const next=event.scale||1;
   pending.zoom+=Math.log2(next/scale);scale=next;
   if(!frame)frame=requestAnimationFrame(flush);
  },{passive:false});
 }
}
let panelStopId=null,placeLoadToken=0,placeCandidates=[],placesMemory=new Map(),panelCloseTimer;
function panelStop(){
 return state?.trips.flatMap(t=>t.days.flatMap(d=>d.stops)).find(s=>s.id===panelStopId);
}
function closePlacePanel(){
 panelStopId=null;placeLoadToken++;activePhotos=[];photoRenderToken++;
 const panel=$('#placePanel'),closedAt=placeLoadToken;
 panel.classList.remove('is-open');panel.inert=true;panel.setAttribute('aria-hidden','true');
 document.querySelector('main').classList.toggle('has-place-panel',preparationPanelOpen);
 clearTimeout(panelCloseTimer);
 // Release embedded pages after the exit animation, without clearing a reopened panel.
 panelCloseTimer=setTimeout(()=>{
  if(panelStopId===null&&placeLoadToken===closedAt){
   $('#referencePages').replaceChildren();$('#googlePlaceBody').replaceChildren();
  }
 },360);
 renderDetail();
}

function renderReferencePages(stop){
 $('#referencePages').innerHTML=stop.refs.length?`<h3>收藏的参考页面 <small>${stop.refs.length}</small></h3>${stop.refs.map((r,i)=>`<section class="reference-card"><div><b>${esc(r.title||new URL(r.url).hostname)}</b><small>${esc(new URL(r.url).hostname)}</small></div><div class="reference-actions"><button data-reference="${i}">展开页面</button><a href="${esc(safeURL(r.url))}" target="_blank" rel="noopener noreferrer">原文 ↗</a></div><div class="reference-preview" id="reference-preview-${i}" hidden></div></section>`).join('')}<p class="panel-hint">点击「展开页面」才加载。站点可能要求登录或禁止内嵌，此时可打开原文。</p>`:'';
}
function openReference(index){
 const ref=panelStop()?.refs[index];if(!ref)return;
 const box=$(`#reference-preview-${index}`),button=$(`[data-reference="${index}"]`);
 if(!box.hidden){box.hidden=true;box.replaceChildren();button.textContent='展开页面';return}
 const url=safeURL(ref.url);if(!url)return;
 box.hidden=false;button.textContent='收起页面';
 const frame=document.createElement('iframe');
 frame.title=ref.title||'旅行参考页面';frame.sandbox='allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
 frame.referrerPolicy='no-referrer';frame.src=url;
 const note=document.createElement('p');note.className='panel-hint';note.textContent='若网页空白或提示拒绝连接，请使用上方「原文」入口。';
 box.append(frame,note);
}
async function openPlacePanel(){
 if(selection?.type!=='stop')return;
 closePreparations();
 panelStopId=selection.id;const stop=panelStop();if(!stop)return;
 clearTimeout(panelCloseTimer);
 const panel=$('#placePanel');
 $('#placePanelTitle').textContent=stopEmoji(stop)+' '+stop.name;
 $('#placePreparation').innerHTML=preparationHTML(stop);
 panel.inert=false;panel.setAttribute('aria-hidden','false');panel.classList.add('is-open');
 document.querySelector('main').classList.add('has-place-panel');
 renderReferencePages(stop);renderDetail();$('#detail').scrollTop=0;
 await loadPlaceInfo();
}

function placeError(error){
 const message=String(error?.message??error??'请求失败');
 return `<div class="place-error"><h3>Google 地点介绍暂未加载</h3><p>请在现有项目开启 <b>Places API (New)</b>，并把它加入这个 Key 的 API 限制。地图和路线已有权限不代表地点详情也已开启。</p><p>Key 和现有行程已保留。重新配置后可直接重试。</p><details><summary>查看请求错误</summary><p>${esc(message.replace(/AIza[\w-]+/g,'[Key已隐藏]'))}</p></details><button data-action="retry-place-info" class="secondary">重试加载</button></div>`;
}
function distanceTo(stop,place){
 if(!located(stop)||!place.location)return Infinity;
 const lat=typeof place.location.lat==='function'?place.location.lat():place.location.lat;
 const lng=typeof place.location.lng==='function'?place.location.lng():place.location.lng;
 return Math.hypot((lat-stop.lat)*111,(lng-stop.lng)*111*Math.cos(stop.lat*Math.PI/180));
}
function placeMatchForm(stop){
 return `<form id="placeMatchForm" class="place-match-form"><label for="placeMatchQuery">Google 地点检索名称</label><div class="place-match-input"><input id="placeMatchQuery" name="query" value="${esc(placeSearchQuery(stop))}" required maxlength="300" placeholder="当地名称和城市"><button type="submit">重新搜索</button></div><p>选择下方结果后更换介绍。地图位置与已保存路线保持不变；需要移动标记时再点「用此 Google 地点重新定位」。</p></form><div id="placeMatchResults"></div>`;
}
async function loadPlaceInfo(force=false,rematch=false){
 const stop=panelStop();if(!stop)return;
 const token=++placeLoadToken,body=$('#googlePlaceBody'),infoId=getDetailsPlaceId(stop);
 const valid=()=>panelStopId===stop.id&&token===placeLoadToken;
 placeCandidates=[];activePhotos=[];photoRenderToken++;detailPlaceId=null;
 if(engine!=='google'){
  body.innerHTML='<div class="place-error"><h3>连接 Google 查看地点介绍</h3><p>请在地图设置连接已保存的 Google Key，并开启 Places API (New)。参考页面可以直接在上方展开。</p><button data-action="settings" class="secondary">地图设置</button><button data-action="retry-place-info" class="secondary">重试加载</button></div>';return;
 }
 let results=body;
 body.innerHTML='<div class="panel-loading">正在向 Google 获取地点介绍…</div>';
 try{
  const {Place}=await google.maps.importLibrary('places');if(!valid())return;
  if(infoId&&!rematch&&!needsPlaceRematch(stop)){
   if(!force&&placesMemory.has(infoId)){renderGooglePlace(placesMemory.get(infoId));return}
   const place=new Place({id:infoId,requestedLanguage:'zh-CN'});
   await fetchGooglePlace(place,token);return;
  }
  body.innerHTML=placeMatchForm(stop);results=$('#placeMatchResults');
  requestAnimationFrame(()=>{
   if(valid())$('#placePanel').scrollTo({top:Math.max(0,body.offsetTop-$('.place-panel-header').offsetHeight),behavior:'smooth'});
  });
  $('#placeMatchForm').addEventListener('submit',event=>{
   event.preventDefault();if(!valid())return;
   const query=new FormData(event.currentTarget).get('query').trim();if(!query)return;
   const current=panelStop();if(!current||current.id!==stop.id)return;
   current.placeQuery=query;persist();loadPlaceInfo(true,true);
  });
  results.innerHTML='<div class="panel-loading">正在重新搜索 Google 地点…</div>';
  const request={textQuery:placeSearchQuery(stop),fields:['id','displayName','formattedAddress','location'],maxResultCount:5,language:'zh-CN'};
  if(located(stop))request.locationBias={center:{lat:stop.lat,lng:stop.lng},radius:1500};
  const result=await Place.searchByText(request);if(!valid())return;
  placeCandidates=result.places??[];
  if(!placeCandidates.length){results.innerHTML='<p class="panel-hint">没有找到匹配地点。可在上方修改名称和城市后重新搜索，原匹配仍保留。</p>';return}
  const normal=s=>String(s).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const best=placeCandidates[0],name=normal(best.displayName),query=normal(placeSearchQuery(stop));
  if(!infoId&&!rematch&&!/待选|待确认|周边|待核实|区域/.test(stop.name)&&distanceTo(stop,best)<1.5&&(placeCandidates.length===1||query.includes(name)||name.includes(query))){
   await chooseGooglePlace(best.id);return;
  }
  results.innerHTML=`<div class="google-attribution">Google Maps · 重新匹配地点</div>${placeCandidates.map(p=>`<button class="place-candidate" data-place-candidate="${esc(p.id)}"><b>${esc(p.displayName)}${p.id===infoId?' <small>当前匹配</small>':''}</b><span>${esc(p.formattedAddress??'')}</span><small>使用此地点的介绍、照片与评论 ↗</small></button>`).join('')}`;
 }catch(error){if(valid())results.innerHTML=placeError(error)}
}
async function chooseGooglePlace(id){
 const stop=panelStop(),place=placeCandidates.find(p=>p.id===id);if(!stop||!place)return;
 Object.assign(stop,bindPlaceDetails(stop,id));persist();renderDetail();
 $('#googlePlaceBody').innerHTML='<div class="panel-loading">正在刷新介绍、照片与评论…</div>';
 const token=++placeLoadToken;
 try{await fetchGooglePlace(place,token)}catch(error){if(token===placeLoadToken)$('#googlePlaceBody').innerHTML=placeError(error)}
}

async function fetchGooglePlace(place,token){
 await place.fetchFields({fields:['id','displayName','formattedAddress','googleMapsURI','websiteURI','rating','userRatingCount','editorialSummary','regularOpeningHours','reviews','attributions','location']});
 if(token!==placeLoadToken||!panelStopId)return;
 placesMemory.set(place.id,place);renderGooglePlace(place);
}
function panelLink(url,label){return safeURL(url)?`<a href="${esc(safeURL(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:''}
function renderGooglePlace(place){
 detailPlaceId=place.id;
 const ratings=typeof place.rating==='number'?`<div class="place-rating"><b>${place.rating.toFixed(1)}</b><span>★</span><small>${place.userRatingCount??0} 条评分</small></div>`:'';
 const hours=place.regularOpeningHours?.weekdayDescriptions??[];
 const reviews=place.reviews??[];
 $('#googlePlaceBody').innerHTML=`<div class="google-attribution">Google Maps · 地点资料</div><h3 class="google-place-name">${esc(place.displayName??'')}</h3><p class="place-address">${esc(place.formattedAddress??'')}</p>${ratings}<div id="placePhotos" class="place-photos"><p class="panel-hint">正在加载地点照片…</p></div><div class="place-quick-links">${panelLink(place.googleMapsURI,'Google 地图与全部评论')}${panelLink(place.websiteURI,'官方网站')}<button data-action="use-detail-location">用此 Google 地点重新定位</button></div><section class="place-description"><h3>地点介绍</h3><p>${esc(place.editorialSummary||'Google 未提供这个地点的文字简介，可参考下方营业信息、评论和上方收藏页面。')}</p></section>${hours.length?`<details class="opening-hours"><summary>营业时间</summary>${hours.map(h=>`<p>${esc(h)}</p>`).join('')}<small>实际以店铺或场馆通知为准</small></details>`:''}<section class="place-reviews"><h3>Google 评论 <small>${reviews.length?'精选 '+reviews.length+' 条':''}</small></h3>${reviews.length?reviews.map(r=>`<article class="review"><div class="review-author">${panelLink(r.authorAttribution?.uri,r.authorAttribution?.displayName??'Google 用户')||esc(r.authorAttribution?.displayName??'Google 用户')}<span>${esc(r.rating??'')} ★</span></div><small>${esc(r.relativePublishTimeDescription??'')}</small><p>${esc(r.text??r.originalText??'这条评论没有文字。')}</p>${panelLink(r.googleMapsURI,'查看原评论')}</article>`).join(''):'<p class="panel-hint">Google 没有返回可显示的评论。</p>'}</section>${(place.attributions??[]).map(a=>`<small>${panelLink(a.providerURI,a.provider??'来源')}</small>`).join('')}<p class="panel-hint">资料由 Google Maps 提供；API 仅返回部分评论，不代表完整评论列表。仅在当前页面内存保留。</p>`;
 loadPlacePhotos(place.id,placeLoadToken);
}

let editorContext=null,pickContext=null,pickedPlace=null,pickLoadToken=0;
let activePhotos=[],activePhotoIndex=0,photoRenderToken=0,detailPlaceId=null;
function dismissPickedPlace(){pickLoadToken++;pickedPlace=null;$('#pickedPlace').hidden=true;$('#pickedPlace').replaceChildren()}
function beginMapPick(id=null,resume=null){
 if(!day())return editDay(true);
 dismissPickedPlace();pickContext={id,dayId,tripId,resume};picking=true;
 $('#pickPrompt').textContent=id?'重新定位：点击 Google 地点或地图空白处':'添加安排：点击 Google 地点或地图空白处';
 $('#pickBanner').hidden=false;$('#searchResults').hidden=true;
 $('.sidebar').classList.remove('mobile-open');
 if(panelStopId)closePlacePanel();$('#detail').hidden=true;
}
function beginEditorPick(){
 if(!editorContext)return;
 const form=$('#editorForm'),f=new FormData(form);
 const resume={base:structuredClone(editorContext.base),fields:Object.fromEntries(f),tags:f.getAll('tags')};
 const id=editorContext.id;close();beginMapPick(id,resume);
}
function cancelMapPick(){
 const context=pickContext;
 picking=false;pickContext=null;$('#pickBanner').hidden=true;dismissPickedPlace();renderDetail();
 if(context?.resume&&context.dayId===dayId&&context.tripId===tripId)editStop(context.id,null,null,null,context.resume);
}
function acceptMapPoint(point){
 const context=pickContext;
 if(context&&(context.dayId!==dayId||context.tripId!==tripId)){cancelMapPick();return toast('日期已切换，请重新选点')}
 picking=false;pickContext=null;$('#pickBanner').hidden=true;dismissPickedPlace();
 editStop(context?.id??null,point.lat,point.lng,point,context?.resume??null);
}
async function pickGooglePlace(id){
 const token=++pickLoadToken;const card=$('#pickedPlace');
 pickedPlace=null;card.hidden=false;card.innerHTML='<p>正在识别 Google 地点…</p><button data-action="dismiss-picked-place">取消</button>';
 try{
  const {Place}=await google.maps.importLibrary('places');
  const place=new Place({id,requestedLanguage:'zh-CN'});
  await place.fetchFields({fields:['id','displayName','formattedAddress','location']});
  if(token!==pickLoadToken)return;
  if(!place.location)throw Error('该地点没有可用坐标，请改选地图空白处');
  pickedPlace={placeId:place.id,name:place.displayName,lat:place.location.lat(),lng:place.location.lng()};
  const existing=day()?.stops.find(s=>s.id===pickContext?.id);
  card.innerHTML=`<span class="eyebrow">GOOGLE MAPS · 已选地点</span><h3>${esc(place.displayName)}</h3><p>${esc(place.formattedAddress??'')}</p>${existing?`<p class="panel-hint">替换「${esc(existing.name)}」的位置，保留时间、属性与参考贴。</p>`:''}<div class="detail-actions"><button data-action="use-picked-place" class="primary">${existing?'使用此地点重新定位':'添加到当天安排'}</button><button data-action="dismiss-picked-place">取消</button></div>`;
 }catch(error){if(token===pickLoadToken)card.innerHTML=`<p>${esc(String(error.message).replace(/AIza[\w-]+/g,'[Key已隐藏]'))}</p><p class="panel-hint">可在地图空白处选择坐标，或在地图设置检查 Places API (New)。</p><button data-action="dismiss-picked-place">关闭</button>`}
}
function usePickedPlace(){if(pickedPlace)acceptMapPoint(pickedPlace)}
async function googleRoutingTarget(stop){
 const target=routingTarget(stop);
 if(!target.placeId)return target;
 const {Place}=await google.maps.importLibrary('places');
 return new Place({id:target.placeId});
}
async function refreshAdjacentRoutes(id){
 if(engine!=='google'||routeBusy){toast('地点已更新，相关路线已失效，可重新计算实际路线');return}
 const d=structuredClone(day()),index=d.stops.findIndex(s=>s.id===id),tz=trip().timezone;
 const indexes=[index,index+1].filter(i=>i>0&&i<d.stops.length);
 routeBusy=true;updateRouteStatus();let failed=0;
 try{for(const i of indexes){try{if(await computeLeg(d,i,tz))failed++}catch{failed++}}}
 finally{routeBusy=false;render(false);toast(failed?'地点已更新，部分相邻路线未获取成功，可单独重算':'地点已更新，前后相邻路线已重新计算')}
}
function useDetailLocation(){
 const stop=panelStop(),place=placesMemory.get(detailPlaceId);
 if(!stop||!place?.location)return;
 const point={name:place.displayName,placeId:place.id,lat:place.location.lat(),lng:place.location.lng()};
 editStop(stop.id,null,null,point);
}
async function loadPlacePhotos(id,token){
 detailPlaceId=id;activePhotos=[];activePhotoIndex=0;photoRenderToken++;
 try{
  const {Place}=await google.maps.importLibrary('places');
  const place=new Place({id,requestedLanguage:'zh-CN'});
  // Photo objects and URLs are requested afresh, never persisted or cached with metadata.
  await place.fetchFields({fields:['photos']});
  if(token!==placeLoadToken||!panelStopId)return;
  activePhotos=place.photos??[];
  if(!activePhotos.length){$('#placePhotos').innerHTML='<p class="panel-hint">Google 暂未提供这个地点的照片。</p>';return}
  showPlacePhoto(0);
 }catch{if(token===placeLoadToken&&$('#placePhotos'))$('#placePhotos').innerHTML='<p class="panel-hint">照片暂时未能加载，请重试地点介绍。</p>'}
}
function photoCredits(photo){
 return (photo.authorAttributions??[]).map(a=>panelLink(a.uri,a.displayName)||esc(a.displayName)).join(' · ');
}
function showPlacePhoto(delta){
 if(!activePhotos.length||!$('#placePhotos'))return;
 activePhotoIndex=(activePhotoIndex+delta+activePhotos.length)%activePhotos.length;
 const photo=activePhotos[activePhotoIndex],token=++photoRenderToken;
 const box=$('#placePhotos');
 box.innerHTML=`<div class="photo-frame"><button class="photo-open" data-action="photo-enlarge" aria-label="放大地点照片"><img alt="${esc(panelStop()?.name)} · Google 地点照片 ${activePhotoIndex+1}"></button>${activePhotos.length>1?'<button class="photo-arrow photo-prev" data-action="photo-prev" aria-label="上一张照片">‹</button><button class="photo-arrow photo-next" data-action="photo-next" aria-label="下一张照片">›</button>':''}<span class="photo-count">${activePhotoIndex+1} / ${activePhotos.length}</span></div><div class="photo-credit">照片：${photoCredits(photo)||'Google Maps'} ${panelLink(photo.googleMapsURI,'在 Google 查看')}</div>`;
 const img=box.querySelector('img');
 Promise.resolve(photo.getURI({maxWidth:900,maxHeight:650})).then(uri=>{if(token===photoRenderToken){img.onerror=()=>{if(token===photoRenderToken)img.replaceWith(Object.assign(document.createElement('p'),{className:'panel-hint',textContent:'这张照片加载失败，可切换下一张。'}))};img.src=uri}}).catch(()=>{if(token===photoRenderToken)img.alt='照片暂未加载，可切换下一张'});
}
async function enlargePlacePhoto(){
 const photo=activePhotos[activePhotoIndex];if(!photo)return;
 const token=photoRenderToken;
 const uri=await photo.getURI({maxWidth:1600,maxHeight:1200});if(token!==photoRenderToken)return;
 modal('地点照片',`<figure class="photo-large"><img src="${esc(uri)}" alt="${esc(panelStop()?.name)}"><figcaption>Google Maps · ${photoCredits(photo)}</figcaption></figure>`);
}


let routeStoreError='';
async function restoreRouteGeometry(){
 try{routeCache=readGeometryCache(await cloudStore.loadRoutes());routeStoreError=''}
 catch(error){routeStoreError=error.message;toast(error.message)}
 updateRouteStatus();
}
async function saveRouteGeometry(key,cached){
 const geometry=geometryForStorage(key,cached);
 if(!geometry){routeStoreError='路线坐标无法保存';return false}
 try{await cloudStore.saveRoute(geometry);cached.persisted=true;routeStoreError='';return true}
 catch(error){cached.persisted=false;routeStoreError=error.message;return false}
}
function routeSummaryHTML(cached){
 const when=value=>new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
 const stamp=`<p class="route-cache-stamp">${cached.persisted?'✓ 轨迹已保存到云端':'轨迹尚未同步云端'} · ${when(cached.createdAt)}<br>有效至 ${when(cached.expiresAt)}</p>`;
 if(cached.geometryOnly)return `${stamp}<p>地图已恢复上次查询的实际轨迹。已采纳的线路说明保存在行程中；最新预计耗时和详细步骤可点「更新路线与详情」查询，或打开 Google 地图比较方案。</p>`;
 return `${stamp}<p>Google 路线：${(cached.distance/1000).toFixed(1)} km · 约 ${Math.ceil(cached.duration/60000)} 分钟（不会自动覆盖你的时间预算）</p>${cached.steps.map(t=>`<div class="step">${esc(t)}</div>`).join('')}${cached.warnings.map(w=>`<p class="warning">${esc(w)}</p>`).join('')}`;
}

function expireRouteGeometry(){
 let changed=false;
 for(const [key,route] of routeCache){
  if(route.expiresAt<=Date.now()){routeCache.delete(key);changed=true}
 }
 if(changed&&state)render(false);
}
setInterval(expireRouteGeometry,60000);
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible')expireRouteGeometry();
});

function preparationHTML(stop){
 const p=normalizePreparation(stop.preparation);
 if(!p.ticketInfo&&!p.needed)return '';
 return `<section class="preparation-card ${p.needed?(p.completed?'is-done':'needs-preparation'):''}" aria-label="门票与提前准备"><div class="prep-heading"><b>${p.needed?(p.completed?'✓ 已准备':'! 需要提前准备'):'门票 / 预约'}</b><button data-action="stop-edit" title="编辑门票与准备事项">编辑</button></div>${p.ticketInfo?`<p>${esc(p.ticketInfo)}</p>`:''}${p.needed?`<p class="prep-note">${esc(p.note||'请补充需要准备的内容。')}</p><button class="prep-complete" data-prep-toggle="${esc(stop.id)}">${p.completed?'↶ 改为待准备':'✓ 标为已准备'}</button>`:''}${p.bookingURL?`<a href="${esc(p.bookingURL)}" target="_blank" rel="noopener noreferrer">购票 / 预约说明 ↗</a>`:''}${p.checkedOn?`<small>核实于 ${esc(p.checkedOn)} · 以预订页面为准</small>`:''}</section>`;
}
function preparationBadge(stop){
 const p=normalizePreparation(stop.preparation);
 return p.needed?`<button class="compact-prep-badge ${p.completed?'is-done':''}" data-action="toggle-preparations" title="查看当天出发前准备" aria-label="查看当天出发前准备">${p.completed?'✓ 已准备':'! 需提前准备'}</button>`:'';
}
function renderDayPreparations(d){
 const items=dayPreparations(d),pending=items.filter(x=>!x.completed).length;
 $('#preparationToggle').innerHTML=`<span>☑</span><span class="prep-label-full">出发前准备</span><span class="prep-label-short">待办</span>${items.length?` <span class="prep-count ${pending?'':'is-done'}">${pending||'✓'}</span>`:''}`;
 $('#preparationToggle').setAttribute('aria-expanded',String(preparationPanelOpen));
 $('#preparationToggle').classList.toggle('active',preparationPanelOpen);
 $('#preparationDay').textContent=d?`${dateLabel(d.date)} · ${d.title}`:'先创建一天计划';
 $('#preparationProgress').textContent=items.length?`${pending} 项待办 · ${items.length-pending} 项已准备`:'这一天没有待办事项';
 $('#preparationList').innerHTML=items.length?items.map(p=>`<article class="preparation-task ${p.completed?'is-done':''}"><div class="preparation-task-heading"><button class="task-check" data-prep-toggle="${esc(p.stop.id)}" aria-label="${p.completed?'改为待准备':'标为已准备'}：${esc(p.stop.name)}" aria-pressed="${p.completed}">${p.completed?'✓':'○'}</button><button class="task-stop" data-stop="${esc(p.stop.id)}">${p.index+1}. ${esc(p.stop.name)}</button><button class="task-edit" data-prep-edit="${esc(p.stop.id)}" aria-label="编辑准备事项：${esc(p.stop.name)}">✎</button></div><p>${esc(p.note||p.ticketInfo||'请补充准备事项')}</p>${p.bookingURL?`<a href="${esc(p.bookingURL)}" target="_blank" rel="noopener noreferrer">购票 / 预约说明 ↗</a>`:''}</article>`).join(''):'<div class="preparation-empty">轻装出发。<br>在地点编辑中勾选「需要提前准备」，这里会自动整理。</div>';
}
function togglePreparations(){
 if(preparationPanelOpen){closePreparations();return}
 closePlacePanel();preparationPanelOpen=true;
 const panel=$('#preparationPanel');panel.inert=false;panel.setAttribute('aria-hidden','false');panel.classList.add('is-open');
 document.querySelector('main').classList.add('has-place-panel');$('#detail').scrollTop=0;renderDayPreparations(day());
}
function closePreparations(){
 preparationPanelOpen=false;
 const panel=$('#preparationPanel');panel.classList.remove('is-open');panel.inert=true;panel.setAttribute('aria-hidden','true');
 document.querySelector('main').classList.toggle('has-place-panel',Boolean(panelStopId));
 $('#preparationToggle').setAttribute('aria-expanded','false');$('#preparationToggle').classList.remove('active');
}
function preparationEditor(stop){
 const p=normalizePreparation(stop.preparation);
 return `<fieldset class="preparation-editor"><legend>门票与提前准备</legend>${area('ticketInfo','门票 / 预约说明（例如：建议提前购票、可现场买、免费外观）',p.ticketInfo)}<div class="form-row"><label class="inline-check"><input type="checkbox" name="prepNeeded" ${p.needed?'checked':''}>需要提前准备 · 红色提醒</label><label class="inline-check"><input type="checkbox" name="prepCompleted" ${p.completed?'checked':''}>已准备完成</label></div>${area('prepNote','要准备什么 / 预约时间 / 所需证件',p.note)}${field('bookingURL','购票 / 预约说明链接',p.bookingURL,'url')}<p class="panel-hint">勾选「需要提前准备」后，会自动汇总到地图右上角的「出发前准备」中。完成后可以随时改回待办。</p></fieldset>`;
}
