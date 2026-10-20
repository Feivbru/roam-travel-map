import {pinLeaderSegment} from './map-markers.mjs';

// One noninteractive pane for ALL connectors, below EVERY itinerary marker.
export function createPinLeaderLayers({map,pins,engine}){
 const svg=()=>{
  const el=document.createElementNS('http://www.w3.org/2000/svg','svg');
  el.setAttribute('class','map-pin-leaders');el.setAttribute('aria-hidden','true');
  el.setAttribute('width','1');el.setAttribute('height','1');return el;
 };
 const leafletSvg=svg(),pane=map.createPane('pinLeaderPane');
 pane.style.zIndex='450';pane.style.pointerEvents='none';pane.append(leafletSvg);
 let googleOverlay,googleSvg;
 const paint=(root,project,enabled)=>{
  if(!root)return;
  root.innerHTML=enabled?pins().flatMap(pin=>{
   if(!pin.el.isConnected||!pin.geometry)return [];
   const end=pinLeaderSegment(pin.geometry,pin.offset);
   if(!end)return [];
   const point=project(pin);if(!point)return [];
   const x=point.x,y=point.y;
   return [`<line x1="${x}" y1="${y}" x2="${x+end.x}" y2="${y+end.y}"/><circle cx="${x}" cy="${y}" r="2.3"/>`];
  }).join(''):'';
 };
 const drawLeaflet=()=>paint(leafletSvg,p=>map.latLngToLayerPoint([p.lat,p.lng]),engine()==='osm');
 map.on('move zoom viewreset',drawLeaflet);
 map.on('zoomstart',()=>{leafletSvg.style.visibility='hidden'});
 map.on('zoomend',()=>{leafletSvg.style.visibility='';drawLeaflet()});
 return {
  clear(){leafletSvg.replaceChildren();googleSvg?.replaceChildren()},
  redraw(){drawLeaflet();googleOverlay?.draw()},
  connectGoogle(googleMap){
   if(googleOverlay)return;
   googleOverlay=new class extends google.maps.OverlayView{
    onAdd(){googleSvg=svg();this.getPanes().overlayLayer.append(googleSvg)}
    draw(){
     const projection=this.getProjection();if(!projection)return;
     paint(googleSvg,p=>projection.fromLatLngToDivPixel(new google.maps.LatLng(p.lat,p.lng)),engine()==='google');
    }
    onRemove(){googleSvg?.remove();googleSvg=null}
   }();
   googleOverlay.setMap(googleMap);
  }
 };
}
