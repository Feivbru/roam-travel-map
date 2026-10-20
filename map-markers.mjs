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

const pinBounds=(rect,offset={x:0,y:0})=>({left:rect.left+offset.x,top:rect.top+offset.y,right:rect.left+offset.x+rect.width,bottom:rect.top+offset.y+rect.height});
function pinOverlap(a,b){
 const w=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
 const h=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
 if(Math.min(w,h)<=3)return 0;
 return w*h/Math.max(1,Math.min((a.right-a.left)*(a.bottom-a.top),(b.right-b.left)*(b.bottom-b.top)));
}

// Geometry supplies candidate positions at obstacle edges, rather than scanning
// compass directions at fixed distances. History is a preference, never a lock.
export function arrangePinLabels(rects,previous=[]){
 const placed=[],homes=rects.map(r=>pinBounds(r)),maxShift=96;
 return rects.map((rect,i)=>{
  const old=previous[i],prior=old??{x:0,y:0},home=homes[i];
  const nearby=homes.filter((p,j)=>j!==i&&Math.abs((p.left+p.right-home.left-home.right)/2)<rect.width+maxShift&&Math.abs((p.top+p.bottom-home.top-home.bottom)/2)<rect.height+maxShift);
  const obstacles=placed.filter(p=>Math.abs((p.left+p.right-home.left-home.right)/2)<rect.width+maxShift&&Math.abs((p.top+p.bottom-home.top-home.bottom)/2)<rect.height+maxShift);
  const future=homes.slice(i+1).filter(p=>nearby.includes(p));
  const severity=box=>obstacles.reduce((max,p)=>Math.max(max,pinOverlap(box,p)),0);
  const homeFree=severity(home)<=(old&&(old.x||old.y) ? .08 : .16);
  const xs=new Set([0]),ys=new Set([0]);
  for(const p of [...obstacles,...future]){
   xs.add(p.left-home.right-3);xs.add(p.right-home.left+3);
   ys.add(p.top-home.bottom-3);ys.add(p.bottom-home.top+3);
  }
  // All-neighbor geometry breaks equal-distance ties toward open space.
  let awayX=0,awayY=0;
  for(const p of nearby){
   const dx=(home.left+home.right-p.left-p.right)/2,dy=(home.top+home.bottom-p.top-p.bottom)/2;
   const length=Math.hypot(dx,dy);if(length){awayX+=dx/(length*length);awayY+=dy/(length*length)}
  }
  const awayLength=Math.hypot(awayX,awayY)||1;awayX/=awayLength;awayY/=awayLength;
  const direction=old?.direction??(Math.hypot(prior.x,prior.y)?[prior.x/Math.hypot(prior.x,prior.y),prior.y/Math.hypot(prior.x,prior.y)]:null);
  if(homeFree){placed.push(home);return {x:0,y:0,...(direction?{direction}: {})}}
  const candidates=[{x:0,y:0},{x:prior.x,y:prior.y}];
  // Shorten a historical offset along the same ray as soon as space permits.
  if(direction){
   for(const x of xs){const n=x/direction[0];if(Number.isFinite(n)&&n>=0)candidates.push({x,y:direction[1]*n})}
   for(const y of ys){const n=y/direction[1];if(Number.isFinite(n)&&n>=0)candidates.push({x:direction[0]*n,y})}
  }
  const nearest=values=>[...values].filter(n=>Math.abs(n)<=maxShift).sort((a,b)=>Math.abs(a)-Math.abs(b)).slice(0,16);
  for(const x of nearest(xs))for(const y of nearest(ys))candidates.push({x,y});
  const score=c=>{
   const length=Math.hypot(c.x,c.y);if(length>maxShift+.01)return Infinity;
   if(!length&&!homeFree)return Infinity;
   const box=pinBounds(rect,c),collision=severity(box);
   const futureOverlap=future.reduce((sum,p)=>sum+Math.max(0,pinOverlap(box,p)-.16),0);
   const turn=direction&&length?1-Math.max(-1,Math.min(1,(c.x*direction[0]+c.y*direction[1])/length)):0;
   return Math.max(0,collision-.16)*1600+futureOverlap*170+length+turn*10+Math.hypot(c.x-prior.x,c.y-prior.y)*.06-(c.x*awayX+c.y*awayY)*.06;
  };
  // Prefer the nearest geometry-based placement, with a small stability cost.
  let chosen=candidates[0],best=score(chosen);
  for(const candidate of candidates){const value=score(candidate);if(value<best-.01){chosen=candidate;best=value}}
  const oldScore=score(prior);
  if(old&&severity(pinBounds(rect,prior))<=.28&&oldScore<=best+5)chosen=prior;
  const x=Math.round(chosen.x*10)/10,y=Math.round(chosen.y*10)/10,length=Math.hypot(x,y);
  const result={x,y,...(length?{direction:[x/length,y/length]}:direction?{direction}: {})};
  placed.push(pinBounds(rect,result));return result;
 });
}

// End the connector at the nearest label edge, not at its shifted bottom tip.
// The final few pixels sit beneath the opaque label in the separate lower pane.
export function pinLeaderSegment({width,height},offset){
 if(!offset||(offset.x===0&&offset.y===0))return null;
 const left=-width/2+offset.x,right=width/2+offset.x,top=-height-6+offset.y,bottom=-6+offset.y;
 const x=Math.max(left,Math.min(right,0)),y=Math.max(top,Math.min(bottom,0));
 if(Math.hypot(x,y)<5)return null;
 return {x,y};
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
