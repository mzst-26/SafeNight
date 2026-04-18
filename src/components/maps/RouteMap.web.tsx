/**
 * RouteMap.web — Leaflet + OpenStreetMap (free, no key).
 *
 * This completely replaces the web map engine while preserving the
 * RouteMap props and message contract used by the rest of the app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { RouteMapProps } from "@/src/components/maps/RouteMap.types";

const buildLeafletHtml = () => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body,#map{width:100%;height:100%;overflow:hidden;background:#e8eaed}
    .road-label{background:rgba(17,24,39,.85);color:#fff;border-radius:8px;padding:2px 6px;font-size:9px;font-weight:600;white-space:nowrap}
    .friend-chip{display:flex;align-items:center;gap:4px;background:#7C3AED;color:#fff;border:2px solid #fff;border-radius:14px;padding:2px 6px 2px 2px;font-size:10px;font-weight:600;white-space:nowrap}
    .friend-dot{width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:10px}
    .nav-dot{width:18px;height:18px;border-radius:50%;background:#1570EF;border:3px solid #fff;box-shadow:0 0 0 2px rgba(21,112,239,.25)}
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = null;
    var ready = false;
    var lastData = null;
    var isPipMode = false;
    var isFollowingNav = true;
    var userInteracted = false;
    var lastNavLL = null;
    var longPressTimer = null;

    var layerRoutes = null;
    var layerMarkers = null;
    var layerFriends = null;
    var layerLabels = null;
    var layerRange = null;

    function sendMsg(t, d){
      try{
        var m = Object.assign({ type:t }, d || {});
        window.parent.postMessage(JSON.stringify(m), '*');
        window.dispatchEvent(new CustomEvent('leaflet-msg', { detail:m }));
      }catch(e){}
    }

    function setFollowMode(next){
      if(isFollowingNav === next) return;
      isFollowingNav = next;
      sendMsg('navFollowChanged', { isFollowing: next });
    }

    function makeCirclePolygon(lat,lng,radiusKm,steps){
      var pts=[]; var R=6378137; var d=radiusKm*1000/R;
      var lat1=lat*Math.PI/180, lng1=lng*Math.PI/180;
      for(var i=0;i<=steps;i++){
        var brng=(i/steps)*2*Math.PI;
        var lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(brng));
        var lng2=lng1+Math.atan2(Math.sin(brng)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
        pts.push([lat2*180/Math.PI,lng2*180/Math.PI]);
      }
      return pts;
    }

    function clearLayers(){
      layerRoutes.clearLayers();
      layerMarkers.clearLayers();
      layerFriends.clearLayers();
      layerLabels.clearLayers();
      layerRange.clearLayers();
    }

    function addFriendMarker(f){
      var initial=((f.name||'?').charAt(0)||'?').toUpperCase();
      var label=(f.name||'Friend').slice(0,14);
      var icon=L.divIcon({
        className:'',
        html:'<div class="friend-chip"><div class="friend-dot">'+initial+'</div><div>'+label+'</div></div>',
        iconSize:[80,24],
        iconAnchor:[20,12]
      });
      L.marker([f.lat,f.lng],{icon:icon}).addTo(layerFriends);
    }

    function addRoadLabel(l){
      var txt=(l.name||'').slice(0,12);
      var icon=L.divIcon({className:'',html:'<div class="road-label" style="background:'+(l.color||'#111827')+'">'+txt+'</div>',iconSize:[120,18],iconAnchor:[60,9]});
      L.marker([l.lat,l.lng],{icon:icon,interactive:false}).addTo(layerLabels);
    }

    function init(){
      map = L.map('map', { zoomControl:true, attributionControl:true }).setView([51.5074,-0.1278], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      layerRoutes = L.layerGroup().addTo(map);
      layerMarkers = L.layerGroup().addTo(map);
      layerFriends = L.layerGroup().addTo(map);
      layerLabels = L.layerGroup().addTo(map);
      layerRange = L.layerGroup().addTo(map);

      map.on('click', function(e){
        sendMsg('press', { lat:e.latlng.lat, lng:e.latlng.lng });
      });

      map.on('contextmenu', function(e){
        sendMsg('longpress', { lat:e.latlng.lat, lng:e.latlng.lng });
      });

      map.on('mousedown', function(e){
        if(longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = setTimeout(function(){
          sendMsg('longpress', { lat:e.latlng.lat, lng:e.latlng.lng });
        }, 650);
      });
      map.on('mouseup', function(){ if(longPressTimer) clearTimeout(longPressTimer); });
      map.on('mousemove', function(){ if(longPressTimer) clearTimeout(longPressTimer); });

      map.on('dragstart', function(){
        if(lastNavLL){
          userInteracted = true;
          setFollowMode(false);
        }
      });

      ready = true;
      sendMsg('ready', {});
      if(lastData) updateMap(lastData);
    }

    function updateMap(d){
      if(!ready || !d) return;
      lastData = d;
      clearLayers();

      var london=[51.5074,-0.1278];
      var bounds=[];
      var colorMap={crime:'#ef4444',shop:'#22c55e',light:'#facc15',bus_stop:'#3b82f6',cctv:'#8b5cf6',dead_end:'#f97316',via:'#d946ef'};

      if(typeof d.isInPipMode!=='undefined') isPipMode=!!d.isInPipMode;

      if(d.origin && !d.navLocation){
        L.circleMarker([d.origin.lat,d.origin.lng],{radius:7,color:'#fff',weight:3,fillColor:'#4285F4',fillOpacity:1}).addTo(layerMarkers);
        bounds.push([d.origin.lat,d.origin.lng]);
      }

      if(d.destination){
        L.circleMarker([d.destination.lat,d.destination.lng],{radius:8,color:'#fff',weight:2,fillColor:'#ef4444',fillOpacity:1}).addTo(layerMarkers);
        bounds.push([d.destination.lat,d.destination.lng]);
      }

      (d.routes||[]).forEach(function(r){
        if(r.selected) return;
        var latlngs=r.path.map(function(p){return [p.lat,p.lng];});
        var poly=L.polyline(latlngs,{color:'#98a2b3',weight:5,opacity:0.6}).addTo(layerRoutes);
        poly.on('click', function(){ sendMsg('selectRoute', { id:r.id }); });
        for(var i=0;i<latlngs.length;i++) bounds.push(latlngs[i]);
      });

      var selected=null;
      for(var i=0;i<(d.routes||[]).length;i++) if(d.routes[i].selected) { selected=d.routes[i]; break; }

      if(selected){
        var selLatLngs=selected.path.map(function(p){ return [p.lat,p.lng]; });
        if(d.segments && d.segments.length>0){
          d.segments.forEach(function(seg){
            L.polyline(seg.path.map(function(p){return [p.lat,p.lng];}),{color:seg.color,weight:7,opacity:0.9}).addTo(layerRoutes);
          });
        } else {
          L.polyline(selLatLngs,{color:'#4285F4',weight:6,opacity:0.9}).addTo(layerRoutes);
        }
        for(var j=0;j<selLatLngs.length;j++) bounds.push(selLatLngs[j]);
      }

      var hl=d.highlightCategory||null;
      (d.safetyMarkers||[]).forEach(function(m){
        var k=m.kind||'crime';
        if(hl && hl!==k) return;
        var isHl=hl && hl===k;
        var radius=(k==='via')?8:(isHl?7:4);
        L.circleMarker([m.lat,m.lng],{radius:radius,color:'#fff',weight:isHl?2:1,fillColor:colorMap[k]||'#94a3b8',fillOpacity:isHl?1:0.85}).addTo(layerMarkers);
      });

      (d.friendMarkers||[]).forEach(function(f){
        var ap=f.path||[];
        var rp=f.routePath||[];
        for(var k=0;k<ap.length-1;k++){
          L.polyline([[ap[k].lat,ap[k].lng],[ap[k+1].lat,ap[k+1].lng]],{color:'#7C3AED',weight:5,opacity:0.8}).addTo(layerFriends);
        }
        if(rp.length>=2){
          L.polyline(rp.map(function(p){return [p.lat,p.lng];}),{color:'#7C3AED',weight:4,opacity:0.45,dashArray:'6 5'}).addTo(layerFriends);
        }
        addFriendMarker(f);
      });

      (d.roadLabels||[]).forEach(addRoadLabel);

      if(d.origin && d.maxDistanceKm && d.maxDistanceKm>0 && !d.navLocation){
        L.polygon(makeCirclePolygon(d.origin.lat,d.origin.lng,d.maxDistanceKm,64),{color:'#22c55e',weight:2.5,fillColor:'#22c55e',fillOpacity:0.04,dashArray:'6 4'}).addTo(layerRange);
      }

      if(d.navLocation){
        lastNavLL=[d.navLocation.lat,d.navLocation.lng];
        var navIcon=L.divIcon({className:'',html:'<div class="nav-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});
        L.marker(lastNavLL,{icon:navIcon}).addTo(layerMarkers);
        if(!userInteracted){
          setFollowMode(true);
          map.setView(lastNavLL,isPipMode?15:17,{animate:true});
        }
      } else {
        lastNavLL=null;
        userInteracted=false;
        setFollowMode(true);
      }

      if(d.panTo){
        map.setView([d.panTo.lat,d.panTo.lng], Math.max(map.getZoom(),16), { animate:true });
      } else if(d.fitBounds && bounds.length>0 && !d.navLocation){
        map.fitBounds(bounds, { padding:[40,40], maxZoom:16, animate:true });
      } else if(!d.origin && !d.navLocation && bounds.length===0){
        map.setView(london,13,{animate:true});
      }
    }

    window.updateMap = updateMap;
    window.setMapType = function(_type){};
    window.setPipMode = function(pip){ isPipMode=!!pip; };
    window.recenterNavigation = function(){
      userInteracted=false;
      setFollowMode(true);
      if(lastNavLL) map.setView(lastNavLL,isPipMode?15:17,{animate:true});
    };
    window.setVizProgress = function(_pct,_msg){};
    window.startVizStream = function(_v){};
    window.stopVizStream = function(){};

    init();
  <\/script>
</body>
</html>`;

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
  mapType = "roadmap",
  highlightCategory,
  maxDistanceKm,
  friendMarkers = [],
  isInPipMode = false,
  recenterSignal = 0,
  vizStreamUrl = null,
  vizProgressPct = null,
  vizProgressMessage = null,
  onSelectRoute,
  onLongPress,
  onMapPress,
  onNavigationFollowChange,
}: RouteMapProps) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const [hasError, setHasError] = useState(false);
  const prevGeoKeyRef = useRef("");
  const prevPanKeyRef = useRef(-1);
  const prevVizUrlRef = useRef<string | null>(null);

  const callbacksRef = useRef({
    onMapPress,
    onLongPress,
    onSelectRoute,
    onNavigationFollowChange,
  });
  callbacksRef.current = {
    onMapPress,
    onLongPress,
    onSelectRoute,
    onNavigationFollowChange,
  };

  const vizStateRef = useRef({
    vizStreamUrl,
    vizProgressPct,
    vizProgressMessage,
  });
  vizStateRef.current = {
    vizStreamUrl,
    vizProgressPct,
    vizProgressMessage,
  };

  const propsRef = useRef({
    origin,
    destination,
    routes,
    selectedRouteId,
    safetyMarkers,
    routeSegments,
    roadLabels,
    panTo,
    isNavigating,
    navigationLocation,
    navigationHeading,
    highlightCategory,
    maxDistanceKm,
    friendMarkers,
    isInPipMode,
  });
  propsRef.current = {
    origin,
    destination,
    routes,
    selectedRouteId,
    safetyMarkers,
    routeSegments,
    roadLabels,
    panTo,
    isNavigating,
    navigationLocation,
    navigationHeading,
    highlightCategory,
    maxDistanceKm,
    friendMarkers,
    isInPipMode,
  };

  const pushUpdate = useCallback(() => {
    if (!readyRef.current || !iframeRef.current?.contentWindow) return;
    const p = propsRef.current;
    const toLL = (c: { latitude: number; longitude: number }) => ({
      lat: c.latitude,
      lng: c.longitude,
    });

    const mappedRoutes = p.routes.map((r) => ({
      id: r.id,
      selected: r.id === p.selectedRouteId,
      path: r.path.map(toLL),
    }));
    const segments = p.routeSegments.map((seg) => ({
      color: seg.color,
      path: seg.path.map(toLL),
    }));
    const mkrs = p.safetyMarkers.map((m) => ({
      kind: m.kind,
      label: m.label,
      lat: m.coordinate.latitude,
      lng: m.coordinate.longitude,
    }));
    const labels = p.roadLabels.map((l) => ({
      name: l.displayName,
      color: l.color,
      lat: l.coordinate.latitude,
      lng: l.coordinate.longitude,
    }));

    const geoKey = [
      p.origin ? `${p.origin.latitude},${p.origin.longitude}` : "",
      p.destination
        ? `${p.destination.latitude},${p.destination.longitude}`
        : "",
      p.routes.map((r) => r.id).join(","),
      p.selectedRouteId ?? "",
    ].join("|");
    const fitBounds = geoKey !== prevGeoKeyRef.current;
    if (fitBounds) prevGeoKeyRef.current = geoKey;

    let panToData: { lat: number; lng: number } | null = null;
    if (p.panTo && p.panTo.key !== prevPanKeyRef.current) {
      prevPanKeyRef.current = p.panTo.key;
      panToData = toLL(p.panTo.location);
    }

    const payload = {
      origin: p.origin ? toLL(p.origin) : null,
      destination: p.destination ? toLL(p.destination) : null,
      routes: mappedRoutes,
      segments,
      safetyMarkers: mkrs,
      roadLabels: labels,
      fitBounds,
      panTo: panToData,
      navLocation:
        p.isNavigating && p.navigationLocation
          ? toLL(p.navigationLocation)
          : null,
      navHeading: p.navigationHeading,
      highlightCategory: p.highlightCategory || null,
      maxDistanceKm: p.maxDistanceKm || null,
      friendMarkers: p.friendMarkers.map((f) => ({
        name: f.name,
        lat: f.lat,
        lng: f.lng,
        destinationName: f.destinationName || null,
        path: f.path ?? [],
        routePath: f.routePath ?? [],
      })),
      isInPipMode: p.isInPipMode || false,
    };

    try {
      const win = iframeRef.current.contentWindow as any;
      if (win.updateMap) win.updateMap(payload);
    } catch {
      /* cross-origin */
    }
  }, []);

  // Listen for messages from the MapLibre iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const msg =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        const cbs = callbacksRef.current;
        switch (msg.type) {
          case "ready":
            readyRef.current = true;
            pushUpdate();
            // Fire any pending viz stream that arrived before ready
            try {
              const viz = vizStateRef.current;
              if (viz.vizStreamUrl && iframeRef.current?.contentWindow) {
                const win = iframeRef.current.contentWindow as any;
                if (win.startVizStream) win.startVizStream(viz.vizStreamUrl);
                if (win.setVizProgress)
                  win.setVizProgress(
                    viz.vizProgressPct,
                    viz.vizProgressMessage || "",
                  );
              }
            } catch {
              /* ignore */
            }
            break;
          case "press":
            cbs.onMapPress?.({ latitude: msg.lat, longitude: msg.lng });
            break;
          case "longpress":
            cbs.onLongPress?.({ latitude: msg.lat, longitude: msg.lng });
            break;
          case "selectRoute":
            cbs.onSelectRoute?.(msg.id);
            break;
          case "navFollowChanged":
            cbs.onNavigationFollowChange?.(Boolean(msg.isFollowing));
            break;
          case "styleError":
            setHasError(true);
            break;
        }
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("message", handler);
    const custom = (e: Event) =>
      handler({ data: (e as CustomEvent).detail } as MessageEvent);
    window.addEventListener("leaflet-msg", custom);
    return () => {
      window.removeEventListener("message", handler);
      window.removeEventListener("leaflet-msg", custom);
    };
  }, [pushUpdate]);

  // Push when props change
  useEffect(() => {
    pushUpdate();
  }, [
    origin,
    destination,
    routes,
    selectedRouteId,
    safetyMarkers,
    routeSegments,
    roadLabels,
    panTo,
    isNavigating,
    navigationLocation,
    navigationHeading,
    highlightCategory,
    maxDistanceKm,
    friendMarkers,
    isInPipMode,
    pushUpdate,
  ]);

  // Switch tile layer on mapType change
  useEffect(() => {
    if (!readyRef.current || !iframeRef.current?.contentWindow) return;
    try {
      const win = iframeRef.current.contentWindow as any;
      if (win.setMapType) win.setMapType("roadmap");
    } catch {
      /* ignore */
    }
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

  // ── Start/stop pathfinding visualisation in the map iframe ──
  useEffect(() => {
    if (vizStreamUrl === prevVizUrlRef.current) return;
    prevVizUrlRef.current = vizStreamUrl;
    if (!readyRef.current || !iframeRef.current?.contentWindow) return;
    try {
      const win = iframeRef.current.contentWindow as any;
      if (vizStreamUrl) {
        if (win.startVizStream) win.startVizStream(vizStreamUrl);
      } else {
        if (win.stopVizStream) win.stopVizStream();
      }
    } catch {
      /* cross-origin */
    }
  }, [vizStreamUrl]);

  useEffect(() => {
    if (!readyRef.current || !iframeRef.current?.contentWindow) return;
    try {
      const win = iframeRef.current.contentWindow as any;
      if (win.setVizProgress)
        win.setVizProgress(vizProgressPct, vizProgressMessage || "");
    } catch {
      /* ignore */
    }
  }, [vizProgressPct, vizProgressMessage]);

  const mapHtml = useMemo(() => buildLeafletHtml(), []);

  return (
    <View style={styles.container}>
      <iframe
        ref={iframeRef as any}
        srcDoc={mapHtml}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          position: "absolute",
          top: 0,
          left: 0,
        }}
        title="Map"
        onError={() => setHasError(true)}
      />
      {hasError ? (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Map unavailable</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f4f7" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  placeholderText: { color: "#667085", fontSize: 14 },
});

export default RouteMap;
