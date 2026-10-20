import test from 'node:test';
import assert from 'node:assert/strict';
import {makeStop} from '../core.mjs';
import {groupMapVisits,mapMarkerHTML,markerVisits,visitNumber,arrangePinLabels} from '../map-markers.mjs';

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
 assert.ok(b.left+b.width<=100||b.left>=195||b.top+b.height<=100||b.top>=149);
 assert.equal(rects[1].left,112);
});
