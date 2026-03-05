/**
 * RouteMap.web — Leaflet + OpenStreetMap tiles (100 % free, no API key).
 *
 * Replaces Google Maps JS SDK entirely.  All features preserved:
 *   – Route polylines (safety-coloured segments)
 *   – Safety markers (crime, shop, light, bus_stop)
 *   – Road labels, navigation mode, pan-to, long-press, click handlers
 *   – Map type switching (roadmap / satellite / hybrid / terrain)
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { MapType, RouteMapProps } from '@/src/components/maps/RouteMap.types';

// ── Tile URLs for different map styles (all free / no key) ───────────────────

const TILE_URLS: Record<MapType, string> = {
  roadmap: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  satellite:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  hybrid:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  terrain: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
};

const TILE_ATTR: Record<MapType, string> = {
  roadmap:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  satellite: '&copy; Esri, Maxar, Earthstar Geographics',
  hybrid:
    '&copy; Esri | &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  terrain:
    '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
};

// ── Build Leaflet HTML page (embedded in iframe blob) ────────────────────────

const buildLeafletHtml = () => `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden}
#viewport{width:100%;height:100%;overflow:hidden;position:relative}
#map{width:100%;height:100%;transition:transform 0.5s ease-out;transform-origin:center 65%}
.nav-arrow{background:none;border:none}
.map-ctrl{position:absolute;right:12px;bottom:100px;z-index:1000;display:flex;flex-direction:column;gap:4px}
.map-btn{width:38px;height:38px;border:none;border-radius:8px;background:rgba(255,255,255,.95);
  box-shadow:0 2px 8px rgba(0,0,0,.2);font-size:20px;font-weight:700;color:#1D2939;
  cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;line-height:1}
.map-btn:hover{background:#e4e7ec}

.road-label{background:rgba(0,0,0,.7);color:#fff;padding:2px 8px;border-radius:9px;
  font-size:9px;font-weight:600;white-space:nowrap;border:none;box-shadow:none}
.friend-marker{display:flex;align-items:center;gap:4px;background:#7C3AED;color:#fff;padding:3px 8px 3px 3px;
  border-radius:16px;font-size:11px;font-weight:600;white-space:nowrap;border:2px solid #fff;
  box-shadow:0 2px 8px rgba(124,58,237,.4);line-height:1.2}
.friend-dot{width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.25);
  display:flex;align-items:center;justify-content:center;font-size:12px}
.leaflet-control-attribution{display:none!important}
</style>
</head><body>
<div id="viewport">
<div id="map"></div>
<div class="map-ctrl">
<button class="map-btn" onclick="map.zoomIn()">+</button>
<button class="map-btn" onclick="map.zoomOut()">&minus;</button>
</div>

</div>
<script>
var isPipMode = false;
var map,tileLayer,markers=[],polylines=[],navMarker=null,longPressTimer=null,longPressLatLng=null;
var isNavMode=false,currentRotation=0,userInteracted=false,lastNavLL=null;
var isFollowingNav=true;
var rangeCircle=null;

function clearArr(a){for(var i=0;i<a.length;i++)map.removeLayer(a[i]);a.length=0;}

function sendMsg(t,d){
  try{var m=Object.assign({type:t},d||{});
    window.parent.postMessage(JSON.stringify(m),'*');
    window.dispatchEvent(new CustomEvent('leaflet-msg',{detail:m}));
  }catch(e){}
}

function setFollowMode(next){
  if(isFollowingNav===next) return;
  isFollowingNav=next;
  sendMsg('navFollowChanged',{isFollowing:next});
}

map=L.map('map',{center:[50.3755,-4.1427],zoom:13,zoomControl:false,attributionControl:false});
tileLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  attribution:'&copy; OpenStreetMap',maxZoom:19}).addTo(map);

map.on('contextmenu',function(e){sendMsg('longpress',{lat:e.latlng.lat,lng:e.latlng.lng});});
var touchStart=null;
map.on('mousedown',function(e){touchStart=Date.now();longPressLatLng=e.latlng;
  longPressTimer=setTimeout(function(){if(longPressLatLng)sendMsg('longpress',{lat:longPressLatLng.lat,lng:longPressLatLng.lng});},600);});
map.on('mousemove',function(){if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;}});
map.on('mouseup',function(){if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;}});
map.on('click',function(e){if(Date.now()-(touchStart||0)<500)sendMsg('press',{lat:e.latlng.lat,lng:e.latlng.lng});});
sendMsg('ready',{});

map.on('dragstart',function(){if(isNavMode){userInteracted=true;setFollowMode(false);}});

// PiP setter — called from host to hide controls immediately
window.setPipMode = function(pip){
  isPipMode = !!pip;
  var ctrl = document.querySelector('.map-ctrl'); if(ctrl) ctrl.style.display = isPipMode ? 'none' : 'flex';
};

window.recenterNavigation = function(){
  userInteracted=false;
  setFollowMode(true);
  if(isNavMode&&lastNavLL){
    map.panTo(lastNavLL);
    if(map.getZoom()<17) map.setZoom(17);
  }
};

function setNavView(heading,entering){
  var mapEl=document.getElementById('map');
  if(!entering){isNavMode=false;currentRotation=0;userInteracted=false;mapEl.style.transform='none';mapEl.style.transition='transform 0.4s ease-out';return;}
  isNavMode=true;
  // Positive rotation (CW) brings heading direction to the top.
  var target=(heading||0),diff=target-currentRotation;
  while(diff>180)diff-=360;while(diff<-180)diff+=360;
  // Dead-zone: ignore < 8° to prevent jitter. Adaptive duration.
  if(Math.abs(diff)<8) return;
  currentRotation+=diff;
  var dur=Math.abs(diff)>=30?'0.25s':'0.5s';
  mapEl.style.transition='transform '+dur+' ease-out';
  mapEl.style.transform='rotate('+currentRotation+'deg)';
}

function setTileUrl(u,a){if(tileLayer)map.removeLayer(tileLayer);
  tileLayer=L.tileLayer(u,{attribution:a,maxZoom:19}).addTo(map);}

/* ── On-route helpers (used for friend path coloring) ────────────── */
function haversineM(a,b){
  var R=6371000,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180;
  var sa=Math.sin(dLat/2),sb=Math.sin(dLng/2);
  return 2*R*Math.asin(Math.sqrt(sa*sa+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*sb*sb));
}
function distToSegM(p,a,b){
  var dx=b.lng-a.lng,dy=b.lat-a.lat,lenSq=dx*dx+dy*dy;
  if(lenSq===0) return haversineM(p,a);
  var t=Math.max(0,Math.min(1,((p.lng-a.lng)*dx+(p.lat-a.lat)*dy)/lenSq));
  return haversineM(p,{lat:a.lat+t*dy,lng:a.lng+t*dx});
}
function isPointOnRoute(p,routePath,thresholdM){
  if(!routePath||routePath.length<2) return false;
  for(var i=0;i<routePath.length-1;i++){
    if(distToSegM(p,routePath[i],routePath[i+1])<=thresholdM) return true;
  }
  return false;
}

function updateMap(d){
  if(d && typeof d.isInPipMode !== 'undefined'){
    isPipMode = !!d.isInPipMode;
    var ctrl = document.querySelector('.map-ctrl'); if(ctrl) ctrl.style.display = isPipMode ? 'none' : 'flex';
  }
  clearArr(markers);clearArr(polylines);
  var bounds=L.latLngBounds([]),hasBounds=false;

  /* Origin blue dot */
  if(d.origin&&!d.navLocation){
    var p=L.latLng(d.origin.lat,d.origin.lng);
    markers.push(L.circleMarker(p,{radius:8,fillColor:'#4285F4',fillOpacity:1,color:'#fff',weight:3}).bindTooltip('Your location').addTo(map));
    markers.push(L.circleMarker(p,{radius:3.5,fillColor:'#fff',fillOpacity:1,color:'#fff',weight:0}).addTo(map));
    bounds.extend(p);hasBounds=true;
  }
  /* Destination */
  if(d.destination){
    var dp=L.latLng(d.destination.lat,d.destination.lng);
    markers.push(L.marker(dp).bindTooltip('Destination').addTo(map));
    bounds.extend(dp);hasBounds=true;
  }

  /* Unselected routes */
  (d.routes||[]).forEach(function(r){if(r.selected)return;
    var ll=r.path.map(function(p){return[p.lat,p.lng];});
    var pl=L.polyline(ll,{color:'#98a2b3',opacity:.5,weight:5}).addTo(map);
    pl.on('click',function(){sendMsg('selectRoute',{id:r.id});});
    polylines.push(pl);bounds.extend(pl.getBounds());hasBounds=true;
  });

  function nearestIdx(path,pt){var best=0,bestD=1e18;
    for(var i=0;i<path.length;i++){var dl=path[i].lat-pt.lat,dn=path[i].lng-pt.lng,dd=dl*dl+dn*dn;if(dd<bestD){bestD=dd;best=i;}}return best;}

  /* Selected route */
  var sel=(d.routes||[]).find(function(r){return r.selected;});
  if(sel){
    if(d.navLocation&&sel.path.length>1){
      var np={lat:d.navLocation.lat,lng:d.navLocation.lng},si=nearestIdx(sel.path,np);
      if(si>0){var tp=[];for(var ti=0;ti<=si;ti++)tp.push([sel.path[ti].lat,sel.path[ti].lng]);tp.push([np.lat,np.lng]);
        polylines.push(L.polyline(tp,{color:'#1D2939',opacity:.7,weight:7}).addTo(map));}
      if(d.segments&&d.segments.length>0){
        d.segments.forEach(function(sg){var fp=[];var st=false;
          for(var i=0;i<sg.path.length;i++){var sp=sg.path[i];if(!st){var idx=nearestIdx(sel.path,sp);if(idx>=si)st=true;}
            if(st)fp.push([sp.lat,sp.lng]);}
          if(fp.length>=2)polylines.push(L.polyline(fp,{color:sg.color,opacity:.9,weight:7}).addTo(map));});
      }else{var rp=[[np.lat,np.lng]];for(var ri=si;ri<sel.path.length;ri++)rp.push([sel.path[ri].lat,sel.path[ri].lng]);
        polylines.push(L.polyline(rp,{color:'#4285F4',opacity:.85,weight:6}).addTo(map));}
    }else{
      if(d.segments&&d.segments.length>0){d.segments.forEach(function(sg){var sp=sg.path.map(function(p){return[p.lat,p.lng];});
        polylines.push(L.polyline(sp,{color:sg.color,opacity:.9,weight:7}).addTo(map));});
      }else{var sp2=sel.path.map(function(p){return[p.lat,p.lng];});
        polylines.push(L.polyline(sp2,{color:'#4285F4',opacity:.85,weight:6}).addTo(map));}
    }
    sel.path.forEach(function(p){bounds.extend(L.latLng(p.lat,p.lng));});hasBounds=true;
  }

  /* Safety markers */
  var mc={crime:'#ef4444',shop:'#22c55e',light:'#facc15',bus_stop:'#3b82f6',cctv:'#8b5cf6',dead_end:'#f97316'};
  var hl=d.highlightCategory||null;
  (d.safetyMarkers||[]).forEach(function(m){
    var k=m.kind||'crime';
    var isHl=hl&&hl===k;
    var isDim=hl&&hl!==k;
    if(isDim)return;
    var r=isHl?8:((k==='light'||k==='crime')?3:4);
    var op=isHl?1:0.85;
    var w=isHl?2:1;
    markers.push(L.circleMarker([m.lat,m.lng],{radius:r,fillColor:mc[k]||'#94a3b8',
      fillOpacity:op,color:'#fff',weight:w}).bindTooltip(m.label||k).addTo(map));
  });

  /* Road labels */
  (d.roadLabels||[]).forEach(function(l){var t=l.name.slice(0,12);
    var ic=L.divIcon({className:'',html:'<div class="road-label" style="background:'+l.color+'">'+t+'</div>',iconSize:null});
    markers.push(L.marker([l.lat,l.lng],{icon:ic,interactive:false}).addTo(map));});

  /* Fit bounds */
  if(d.fitBounds&&hasBounds&&!d.navLocation)map.fitBounds(bounds,{padding:[40,40],maxZoom:16});
  if(d.panTo){map.panTo([d.panTo.lat,d.panTo.lng]);if(map.getZoom()<16)map.setZoom(16);}

  /* Range circle */
  if(rangeCircle){map.removeLayer(rangeCircle);rangeCircle=null;}
  if(d.origin&&d.maxDistanceKm&&d.maxDistanceKm>0&&!d.navLocation){
    rangeCircle=L.circle([d.origin.lat,d.origin.lng],{
      radius:d.maxDistanceKm*1000,
      color:'#22c55e',weight:2.5,opacity:0.8,
      fillColor:'#22c55e',fillOpacity:0.04,
      dashArray:'8,6',
      interactive:false
    }).addTo(map);
  }

  /* Friend markers */
  (d.friendMarkers||[]).forEach(function(f){
    var initial=(f.name||'?').charAt(0).toUpperCase();
    var label=f.name||(f.destinationName?'Friend':'Friend');
    var tooltip=f.destinationName?label+' \u2192 '+f.destinationName:label;
    var ic=L.divIcon({className:'',
      html:'<div class="friend-marker"><div class="friend-dot">'+initial+'</div>'+label+'</div>',
      iconSize:null,iconAnchor:[14,14]});
    markers.push(L.marker([f.lat,f.lng],{icon:ic,zIndexOffset:500}).bindTooltip(tooltip).addTo(map));
  });

  /* Friend planned routes (dashed purple — the route they clicked navigate on) */
  (d.friendMarkers||[]).forEach(function(f){
    if(f.routePath && f.routePath.length >= 2){
      var pts=f.routePath.map(function(p){return[p.lat,p.lng];});
      polylines.push(L.polyline(pts,{color:'#7C3AED',opacity:0.45,weight:5,dashArray:'8,5',interactive:false}).addTo(map));
    }
  });

  /* Friend actual path (purple = on-route ≤30m of planned, orange = off-route) */
  (d.friendMarkers||[]).forEach(function(f){
    var ap=f.path||[], rp=f.routePath||[];
    for(var i=0;i<ap.length-1;i++){
      var mid={lat:(ap[i].lat+ap[i+1].lat)/2, lng:(ap[i].lng+ap[i+1].lng)/2};
      var onRoute=isPointOnRoute(mid, rp, 30);
      polylines.push(L.polyline([[ap[i].lat,ap[i].lng],[ap[i+1].lat,ap[i+1].lng]],
        {color:onRoute?'#7C3AED':'#f97316', opacity:0.9, weight:5, interactive:false}).addTo(map));
    }
  });

  /* Navigation arrow + 3D nav view */
  if(navMarker){map.removeLayer(navMarker);navMarker=null;}
  if(d.navLocation){var h=d.navHeading||0;
    lastNavLL=[d.navLocation.lat,d.navLocation.lng];
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">'
      +'<circle cx="22" cy="22" r="19" fill="#1570EF" stroke="white" stroke-width="3"/>'
      +'<polygon points="22,7 29,27 22,22 15,27" fill="white" transform="rotate('+(-h)+',22,22)"/></svg>';
    var ni=L.divIcon({className:'nav-arrow',
      html:'<img src="data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg)+'" width="44" height="44"/>',
      iconSize:[44,44],iconAnchor:[22,22]});
    navMarker=L.marker(lastNavLL,{icon:ni,interactive:false,zIndexOffset:1000}).addTo(map);
    if(!userInteracted){setFollowMode(true);map.panTo(lastNavLL);if(map.getZoom()<17)map.setZoom(17);}
    setNavView(h,true);
  }else{userInteracted=false;setFollowMode(true);setNavView(0,false);}
}
<\/script>
</body></html>`;

// ─────────────────────────────────────────────────────────────────────────────
// React component — embeds Leaflet via an iframe blob on web
// ─────────────────────────────────────────────────────────────────────────────

export const RouteMap = ({
  origin,
  destination,
  routes,
  selectedRouteId,
  safetyMarkers = [],
  routeSegments = [],
  roadLabels = [],
  panTo,
  isNavigating = false,
  navigationLocation,
  navigationHeading,
  mapType = 'roadmap',
  highlightCategory,
  maxDistanceKm,
  friendMarkers = [],
  isInPipMode = false,
  recenterSignal = 0,
  onSelectRoute,
  onLongPress,
  onMapPress,
  onNavigationFollowChange,
}: RouteMapProps) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const [hasError, setHasError] = useState(false);
  const prevGeoKeyRef = useRef('');
  const prevPanKeyRef = useRef(-1);
  const prevMapTypeRef = useRef(mapType);

  const callbacksRef = useRef({ onMapPress, onLongPress, onSelectRoute, onNavigationFollowChange });
  callbacksRef.current = { onMapPress, onLongPress, onSelectRoute, onNavigationFollowChange };

  // Listen for messages from the Leaflet iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        const cbs = callbacksRef.current;
        switch (msg.type) {
          case 'ready':
            readyRef.current = true;
            pushUpdate();
            break;
          case 'press':
            cbs.onMapPress?.({ latitude: msg.lat, longitude: msg.lng });
            break;
          case 'longpress':
            cbs.onLongPress?.({ latitude: msg.lat, longitude: msg.lng });
            break;
          case 'selectRoute':
            cbs.onSelectRoute?.(msg.id);
            break;
          case 'navFollowChanged':
            cbs.onNavigationFollowChange?.(Boolean(msg.isFollowing));
            break;
        }
      } catch { /* ignore */ }
    };

    window.addEventListener('message', handler);
    const custom = (e: Event) => handler({ data: (e as CustomEvent).detail } as MessageEvent);
    window.addEventListener('leaflet-msg', custom);
    return () => { window.removeEventListener('message', handler); window.removeEventListener('leaflet-msg', custom); };
  }, []);

  const pushUpdate = () => {
    if (!readyRef.current || !iframeRef.current?.contentWindow) return;
    const toLL = (c: { latitude: number; longitude: number }) => ({ lat: c.latitude, lng: c.longitude });

    const mappedRoutes = routes.map((r) => ({
      id: r.id,
      selected: r.id === selectedRouteId,
      path: r.path.map(toLL),
    }));
    const segments = routeSegments.map((seg) => ({ color: seg.color, path: seg.path.map(toLL) }));
    const mkrs = safetyMarkers.map((m) => ({
      kind: m.kind, label: m.label,
      lat: m.coordinate.latitude, lng: m.coordinate.longitude,
    }));
    const labels = roadLabels.map((l) => ({
      name: l.displayName, color: l.color,
      lat: l.coordinate.latitude, lng: l.coordinate.longitude,
    }));

    const geoKey = [
      origin ? `${origin.latitude},${origin.longitude}` : '',
      destination ? `${destination.latitude},${destination.longitude}` : '',
      routes.map((r) => r.id).join(','),
      selectedRouteId ?? '',
    ].join('|');
    const fitBounds = geoKey !== prevGeoKeyRef.current;
    if (fitBounds) prevGeoKeyRef.current = geoKey;

    let panToData: { lat: number; lng: number } | null = null;
    if (panTo && panTo.key !== prevPanKeyRef.current) {
      prevPanKeyRef.current = panTo.key;
      panToData = toLL(panTo.location);
    }

    const payload = {
      origin: origin ? toLL(origin) : null,
      destination: destination ? toLL(destination) : null,
      routes: mappedRoutes,
      segments,
      safetyMarkers: mkrs,
      roadLabels: labels,
      fitBounds,
      panTo: panToData,
      navLocation: isNavigating && navigationLocation ? toLL(navigationLocation) : null,
      navHeading: navigationHeading,
      highlightCategory: highlightCategory || null,
      maxDistanceKm: maxDistanceKm || null,
      friendMarkers: friendMarkers.map((f) => ({
        name: f.name,
        lat: f.lat,
        lng: f.lng,
        destinationName: f.destinationName || null,
        path: f.path ?? [],
        routePath: f.routePath ?? [],
      })),
      isInPipMode: isInPipMode || false,
    };

    try {
      const win = iframeRef.current.contentWindow as any;
      if (win.updateMap) win.updateMap(payload);
    } catch { /* cross-origin */ }
  };

  // Push when props change
  useEffect(() => { pushUpdate(); }, [
    origin, destination, routes, selectedRouteId,
    safetyMarkers, routeSegments, roadLabels, panTo,
    isNavigating, navigationLocation, navigationHeading,
    highlightCategory, maxDistanceKm, friendMarkers,
  ]);

  // Switch tile layer on mapType change
  useEffect(() => {
    if (!readyRef.current || !iframeRef.current?.contentWindow) return;
    if (mapType === prevMapTypeRef.current) return;
    prevMapTypeRef.current = mapType;
    try {
      const win = iframeRef.current.contentWindow as any;
      if (win.setTileUrl) win.setTileUrl(TILE_URLS[mapType], TILE_ATTR[mapType]);
    } catch { /* ignore */ }
  }, [mapType]);

  // Immediate PiP injection — set iframe.setPipMode without waiting for full update
  useEffect(() => {
    if (!readyRef.current || !iframeRef.current?.contentWindow) return;
    try {
      const win = iframeRef.current.contentWindow as any;
      if (win && win.setPipMode) win.setPipMode(isInPipMode ? true : false);
    } catch {}
  }, [isInPipMode]);

  useEffect(() => {
    if (!readyRef.current || !iframeRef.current?.contentWindow) return;
    try {
      const win = iframeRef.current.contentWindow as any;
      if (win && win.recenterNavigation) win.recenterNavigation();
    } catch {}
  }, [recenterSignal]);

  // Blob URL for iframe src
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    const blob = new Blob([buildLeafletHtml()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, []);

  return (
    <View style={styles.container}>
      {blobUrl ? (
        <iframe
          ref={iframeRef as any}
          src={blobUrl}
          style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', top: 0, left: 0 }}
          title="Map"
          onError={() => setHasError(true)}
        />
      ) : null}
      {hasError ? (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Map unavailable</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f4f7' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: '#667085', fontSize: 14 },
});

export default RouteMap;
