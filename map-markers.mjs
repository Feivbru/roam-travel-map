import {located,normalizeTags,PLACE_TAGS,esc} from './core.mjs';

function distance(a,b){
 const rad=Math.PI/180;
 const x=(a.lng-b.lng)*rad*Math.cos((a.lat+b.lat)/2*rad),y=(a.lat-b.lat)*rad;
 return Math.hypot(x,y)*6371000;
}
function sameLocation(a,b){
 const meters=distance(a,b);
 // Exact coordinates may represent differently named visits to the same place.
 // Nearby entrances only combine when they share a Google place or a name.
 const name=s=>s.name.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
 return meters<1||(meters<=20&&((a.placeId&&a.placeId===b.placeId)||(name(a)&&name(a)===name(b))));
}

export function groupMapVisits(days,allDays=days){
 const groups=[];
 for(const day of days){
  day.stops.forEach((stop,index)=>{
   if(!located(stop))return;
   const visit={stop,day,index,dayIndex:allDays.indexOf(day),isStart:index===0,isEnd:index===day.stops.length-1};
   // Compare with the anchor, not the last visit, to avoid merging a chain of nearby places.
   const group=groups.find(g=>sameLocation(g.visits[0].stop,stop));
   if(group)group.visits.push(visit);
   else groups.push({lat:stop.lat,lng:stop.lng,visits:[visit]});
  });
 }
 return groups;
}

export function markerVisits(group,selectedId,overview=false){
 const limit=overview?3:5,visits=group.visits;
 if(visits.length<=limit)return visits;
 const chosen=new Set([visits[0],visits.at(-1)]);
 const selected=visits.find(v=>v.stop.id===selectedId);
 if(selected)chosen.add(selected);
 for(const v of visits){if(chosen.size>=limit)break;chosen.add(v)}
 return visits.filter(v=>chosen.has(v));
}

export const visitNumber=(v,overview=false)=>`${overview?'D'+(v.dayIndex+1)+'·':''}${v.index+1}`;
export const visitRole=v=>[v.isStart?'起点':'',v.isEnd?'终点':''].filter(Boolean).join(' / ');

// Layout history belongs to a stable place key, not the currently selected stop.
// A small overlap is preferable to moving a label. Entry and exit use different
// thresholds so zooming around a boundary cannot toggle the offset repeatedly.
export function arrangePinLabels(rects,previous=[]){
 const placed=[];
 const origin={x:0,y:0};
 const directions=[[0,-1],[0,1],[-1,0],[1,0],[-Math.SQRT1_2,-Math.SQRT1_2],[Math.SQRT1_2,-Math.SQRT1_2],[-Math.SQRT1_2,Math.SQRT1_2],[Math.SQRT1_2,Math.SQRT1_2]];
 return rects.map((rect,i)=>{
  const prior=previous[i],current=prior?{x:prior.x,y:prior.y}:origin;
  const bounds=offset=>({left:rect.left+offset.x,top:rect.top+offset.y,right:rect.left+offset.x+rect.width,bottom:rect.top+offset.y+rect.height});
  const overlap=offset=>{
   const next=bounds(offset);
   return placed.reduce((worst,p)=>{
    const w=Math.max(0,Math.min(next.right,p.right)-Math.max(next.left,p.left));
    const h=Math.max(0,Math.min(next.bottom,p.bottom)-Math.max(next.top,p.top));
    // Edge contact and up to 4px of intrusion are harmless.
    if(Math.min(w,h)<=4)return worst;
    const area=Math.min(rect.width*rect.height,(p.right-p.left)*(p.bottom-p.top));
    return Math.max(worst,w*h/Math.max(1,area));
   },0);
  };
  const clearHome=()=>{
   const home=bounds(origin),gap=22;
   return placed.every(p=>home.right+gap<=p.left||home.left-gap>=p.right||home.bottom+gap<=p.top||home.top-gap>=p.bottom);
  };
  let chosen=current,direction=prior?.direction;
  if((current.x||current.y)&&clearHome())chosen=origin;
  else if(overlap(current)>((current.x||current.y) ? .30 : .18)){
   // Once assigned, keep this direction even if the opposite side becomes cheaper.
   const rays=direction?[direction]:directions;
   const candidates=rays.flatMap(ray=>[40,56,72,96,120].map(length=>({x:Math.round(ray[0]*length),y:Math.round(ray[1]*length),direction:ray})));
   let best={...current,direction,score:Math.max(0,overlap(current)-.18)*1000};
   for(const candidate of candidates){
    const score=Math.max(0,overlap(candidate)-.18)*1000+Math.hypot(candidate.x-current.x,candidate.y-current.y)*.35;
    if(score<best.score)best={...candidate,score};
   }
   chosen=best;direction=best.direction;
  }
  placed.push(bounds(chosen));
  return {x:chosen.x,y:chosen.y,...(direction?{direction}: {})};
 });
}

export function mapMarkerHTML(group,{selectedId,overview=false,colors=['#487d64']}={}){
 const active=group.visits.some(v=>v.stop.id===selectedId);
 const tags=[...new Set(group.visits.flatMap(v=>normalizeTags(v.stop)))];
 const visible=markerVisits(group,selectedId,overview),extra=group.visits.length-visible.length;
 const color=overview?colors[group.visits[0].dayIndex%colors.length]:'#487d64';
 const roles=[group.visits.some(v=>v.isStart)?'起点':'',group.visits.some(v=>v.isEnd)?'终点':''].filter(Boolean);
 const label=tags.map(k=>PLACE_TAGS[k].label).join('、')+'；'+group.visits.map(v=>`${visitNumber(v,overview)} ${v.stop.name}${visitRole(v)?'（'+visitRole(v)+'）':''}`).join('；');
 const numbers=visible.map(v=>`<span class="visit-pin-number ${v.stop.id===selectedId?'is-selected':''}" style="--visit-color:${overview?colors[v.dayIndex%colors.length]:color}">${visitNumber(v,overview)}</span>`).join('');
 return {active,label,html:`<div class="map-pin-anchor"><div class="visit-pin ${active?'is-active':''} ${group.visits.length>1?'is-repeated':''} ${roles.length?'is-endpoint':''}" style="--pin-color:${color}"><div class="visit-pin-main"><span class="visit-pin-type" aria-hidden="true">${tags.slice(0,2).map(k=>PLACE_TAGS[k].emoji).join('')}${tags.length>2?'<small>+</small>':''}</span><span class="visit-pin-numbers">${numbers}${extra?`<span class="visit-pin-more">+${extra}</span>`:''}</span></div>${roles.length?`<div class="visit-pin-roles">${roles.join('<span>·</span>')}</div>`:''}</div></div>`};
}
