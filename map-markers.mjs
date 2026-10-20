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

// Move labels only, never the map coordinate. Highest-priority pins are placed first.
export function arrangePinLabels(rects){
 const placed=[];
 return rects.map(rect=>{
  const candidates=[[0,0],[0,-54],[0,54],[-74,0],[74,0],[-74,-54],[74,-54],[-74,54],[74,54],[0,-108],[0,108],[-148,0],[148,0]];
  let best;
  for(const [x,y] of candidates){
   const next={left:rect.left+x,top:rect.top+y,right:rect.left+x+rect.width,bottom:rect.top+y+rect.height};
   const overlap=placed.reduce((sum,p)=>sum+Math.max(0,Math.min(next.right+5,p.right)-Math.max(next.left-5,p.left))*Math.max(0,Math.min(next.bottom+5,p.bottom)-Math.max(next.top-5,p.top)),0);
   const score=overlap*100+Math.hypot(x,y);
   if(!best||score<best.score)best={x,y,next,score};
   if(!score)break;
  }
  placed.push(best.next);return {x:best.x,y:best.y};
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
