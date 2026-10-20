import test from 'node:test';
import assert from 'node:assert/strict';
import {makeStop} from '../core.mjs';
import {groupMapVisits,mapMarkerHTML,markerVisits,visitNumber,arrangePinLabels,pinLeaderSegment} from '../map-markers.mjs';

const stop=(name,lat=47.5,lng=19.08,tags=['住宿'])=>({...makeStop(name,lat,lng),tags});
const day=stops=>({id:crypto.randomUUID(),stops});

test('酒店多次到访合并地图标点，保留全部序号、起终点和原始安排',()=>{
 const d=day([stop('Hotel'),stop('Station',47.51,19.08,['交通']),stop('Hotel')]);
 const before=structuredClone(d),groups=groupMapVisits([d]);
 assert.equal(groups.length,2);
 assert.deepEqual(groups[0].visits.map(v=>v.index),[0,2]);
 const result=mapMarkerHTML(groups[0],{selectedId:d.stops[0].id});
 assert.ok(result.active);assert.match(result.html,/🏨/);assert.match(result.html,/起点/);assert.match(result.html,/终点/);
 assert.match(result.label,/1 Hotel（起点）/);assert.match(result.label,/3 Hotel（终点）/);
 assert.deepEqual(d,before);
});

test('同坐标不同名称不覆盖，各次安排和属性仍保留',()=>{
 const groups=groupMapVisits([day([stop('车站出口',47.5,19.08,['交通']),stop('集合点',47.5,19.08,['会议'])])]);
 assert.equal(groups.length,1);assert.equal(groups[0].visits.length,2);
 const result=mapMarkerHTML(groups[0]);assert.match(result.html,/🚉💼/);assert.match(result.label,/车站、会议/);
});

test('附近不同地点保持独立，远端同名酒店和不同入口也不会误合并',()=>{
 const a=stop('Hotel'),b=stop('Station',47.50003),c=stop('Hotel',47.501);
 a.placeId='hotel';c.placeId='hotel';
 assert.equal(groupMapVisits([day([a,b,c])]).length,3);
 const near=stop('Hotel',47.50008);
 assert.equal(groupMapVisits([day([a,near])]).length,1);
 // A sequence of small coordinate changes must not merge an entire street.
 assert.equal(groupMapVisits([day([a,near,stop('Hotel',47.50024)])]).length,2);
});

test('全程总览明确区分天数，未定位安排不冒充起点',()=>{
 const a=day([stop('Hotel'),stop('Food',47.52)]),b=day([stop('未定位',null,null),stop('Hotel')]);
 const groups=groupMapVisits([a,b]);
 assert.deepEqual(groups[0].visits.map(v=>visitNumber(v,true)),['D1·1','D2·2']);
 assert.equal(groups[0].visits[1].isStart,false);
 const result=mapMarkerHTML(groups[0],{overview:true,colors:['#216961','#7964a1']});
 assert.match(result.html,/D1·1/);assert.match(result.html,/D2·2/);assert.match(result.html,/#7964a1/);
 assert.equal(groupMapVisits([b],[a,b])[0].visits[0].dayIndex,1);
});

test('很多次到访时保留首末和选中序号，其余计数明确，完整信息可访问',()=>{
 const d=day(Array.from({length:12},()=>stop('<Hotel>'))),g=groupMapVisits([d])[0];
 const shown=markerVisits(g,d.stops[8].id);
 assert.equal(shown.length,5);assert.ok(shown.some(v=>v.index===0));assert.ok(shown.some(v=>v.index===8));assert.ok(shown.some(v=>v.index===11));
 const result=mapMarkerHTML(g,{selectedId:d.stops[8].id});
 assert.match(result.html,/\+7/);assert.ok(!result.html.includes('<Hotel>'));
 assert.match(result.label,/9 <Hotel>/);assert.equal(g.visits.length,12);
});

test('邻近车站与酒店标签避让，优先保留起终点位置，不改动坐标',()=>{
 const rects=[{left:100,top:100,width:95,height:49},{left:112,top:95,width:50,height:36},{left:300,top:100,width:50,height:36}];
 const offsets=arrangePinLabels(rects);
 assert.deepEqual(offsets[0],{x:0,y:0});assert.notDeepEqual(offsets[1],{x:0,y:0});assert.deepEqual(offsets[2],{x:0,y:0});
 const b={...rects[1],left:rects[1].left+offsets[1].x,top:rects[1].top+offsets[1].y};
 const overlapX=Math.max(0,Math.min(b.left+b.width,195)-Math.max(b.left,100));
 const overlapY=Math.max(0,Math.min(b.top+b.height,149)-Math.max(b.top,100));
 assert.ok(overlapX<=6||overlapY<=6,'允许边缘轻微接触，主体不能互相遮住');
 assert.equal(rects[1].left,112);
});

test('轻微边缘重叠不挪动，平移与亚像素波动不会重新分配方向',()=>{
 const edge=[{left:100,top:100,width:50,height:36},{left:145,top:100,width:50,height:36}];
 assert.deepEqual(arrangePinLabels(edge),[{x:0,y:0},{x:0,y:0}]);
 const crowded=[edge[0],{...edge[1],left:115}];
 const initial=arrangePinLabels(crowded);
 assert.notDeepEqual(initial[1],{x:0,y:0});
 const shifted=crowded.map(r=>({...r,left:r.left+123.4,top:r.top-88.2}));
 assert.deepEqual(arrangePinLabels(shifted,initial),initial);
 const jitter=crowded.map((r,i)=>({...r,left:r.left+(i?.4:0),top:r.top-(i?.3:0)}));
 assert.deepEqual(arrangePinLabels(jitter,initial),initial);
});

test('小幅缩放保持方向，明显更近时允许改变方向缩短引线',()=>{
 const base={left:100,top:100,width:50,height:36};
 const previous=[{x:0,y:0},{x:0,y:-40,direction:[0,-1]}];
 for(const top of [96,100,104,110]){
  const result=arrangePinLabels([base,{...base,top}],previous);
  assert.equal(result[1].x,0);assert.ok(result[1].y<0);
 }
 const closer=arrangePinLabels([base,{...base,top:120}],previous);
 assert.ok(Math.hypot(closer[1].x,closer[1].y)<25,'不为坚持旧方向保留一条60px的引线');
});

test('过长的历史偏移会收短，不再等大片留白才回到原位',()=>{
 const base={left:100,top:100,width:50,height:36};
 const history=[{x:0,y:0},{x:0,y:-120,direction:[0,-1]}];
 const shortened=arrangePinLabels([base,{...base,left:115}],history);
 assert.equal(shortened[1].x,0);assert.ok(shortened[1].y<0&&shortened[1].y>=-40);
 const separated=arrangePinLabels([base,{...base,left:154}],shortened);
 assert.deepEqual(separated[1],{x:0,y:0,direction:[0,-1]});
});

test('避让方向跟随邻居几何位置，没有固定的左上优先',()=>{
 const base={left:100,top:100,width:50,height:36};
 const down=arrangePinLabels([base,{...base,top:125}])[1];
 const up=arrangePinLabels([base,{...base,top:75}])[1];
 const left=arrangePinLabels([base,{...base,left:62}])[1];
 const right=arrangePinLabels([base,{...base,left:138}])[1];
 assert.ok(down.y>0&&Math.hypot(down.x,down.y)<20);
 assert.ok(up.y<0&&Math.hypot(up.x,up.y)<20);
 assert.ok(left.x<0&&Math.hypot(left.x,left.y)<20);
 assert.ok(right.x>0&&Math.hypot(right.x,right.y)<20);
});

test('引线连接标签最近边缘，而非总是连到下方尖角',()=>{
 assert.deepEqual(pinLeaderSegment({width:50,height:36},{x:60,y:0}),{x:35,y:-6});
 assert.deepEqual(pinLeaderSegment({width:50,height:36},{x:0,y:-40}),{x:0,y:-46});
 assert.equal(pinLeaderSegment({width:50,height:36},{x:0,y:0}),null);
 assert.equal(pinLeaderSegment({width:50,height:36},{x:0,y:15}),null);
});

test('连续放大缩小多个来回，方向与布局可重复，不累积漂移',()=>{
 const center={left:200,top:200,width:50,height:36};
 let history=[];const directions=[];
 for(let cycle=0;cycle<3;cycle++){
  for(const gap of [12,16,30,48,56,70,90,70,56,48,30,16,12]){
   history=arrangePinLabels([center,{...center,left:center.left+gap}],history);
   if(history[1].direction)directions.push(history[1].direction.join(','));
   assert.ok(Math.hypot(history[1].x,history[1].y)<=121);
  }
 }
 assert.equal(new Set(directions).size,1);
});
