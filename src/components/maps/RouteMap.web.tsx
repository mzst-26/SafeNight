/**
 * RouteMap.web — Leaflet + OpenStreetMap (free, no key).
 *
 * This completely replaces the web map engine while preserving the
 * RouteMap props and message contract used by the rest of the app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { BADGES_JS } from "@/src/components/maps/inline/badges";
import { CORE_JS } from "@/src/components/maps/inline/core";
import { FORMAT_JS } from "@/src/components/maps/inline/format";
import { LEGEND_JS } from "@/src/components/maps/inline/legend";
import { ROUTE_OVERLAY_CSS } from "@/src/components/maps/inline/overlayCss";
import { SCREEN_CLUSTER_JS } from "@/src/components/maps/inline/screenCluster";
import {
  OSM_ATTRIBUTION,
  RL_ATTRIBUTION_HEIGHT_PX,
  RL_CALLOUT_OFFSET_PX,
  RL_CASING_COLOR,
  RL_CASING_OPACITY,
  RL_CASING_WIDTH,
  RL_CRIME_MERGE_PX,
  RL_CRIME_SIZE,
  RL_CRIME_SIZE_LARGE,
  RL_DASH,
  RL_HIT_WIDTH,
  RL_LEGEND_ATTRIBUTION_GAP_PX,
  RL_LINE_OPACITY,
  RL_LINE_WIDTH,
  RL_RELAYOUT_DEBOUNCE_MS,
  RL_TOUCH_TARGET_PX,
  RL_UNSELECTED_WIDTH,
} from "@/src/components/maps/mapConstants";
import type { RouteMapProps } from "@/src/components/maps/RouteMap.types";

export const buildLeafletHtml = (showZoomControls: boolean) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"><\/script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body,#map{width:100%;height:100%;overflow:hidden;background:#e8eaed}
    .road-label{background:rgba(17,24,39,.85);color:#fff;border-radius:8px;padding:2px 6px;font-size:9px;font-weight:600;white-space:nowrap}
    .search-pin-wrap{position:relative;display:block;width:28px;height:30px;pointer-events:none;overflow:visible}
    .search-pin-dot{width:18px;height:18px;border-radius:50%;background:var(--pin-color,#ef4444);border:2px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.35);position:absolute;left:50%;bottom:6px;transform:translateX(-50%) scale(1);transform-origin:50% 100%;transition:transform .16s ease}
    .search-pin-dot:after{content:'';position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid var(--pin-color,#ef4444);filter:drop-shadow(0 1px 1px rgba(0,0,0,.22))}
    .search-pin-label{position:absolute;left:50%;top:24px;transform:translateX(-50%);background:transparent;color:#0b1220;border:0;border-radius:0;padding:0;font-size:11px;font-weight:800;line-height:1.15;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:none;text-shadow:-1px 0 rgba(255,255,255,.96),0 1px rgba(255,255,255,.96),1px 0 rgba(255,255,255,.96),0 -1px rgba(255,255,255,.96),0 0 2px rgba(255,255,255,.9)}
    .search-pin-wrap.selected{width:28px;height:30px}
    .search-pin-wrap.selected{pointer-events:auto}
    .search-pin-wrap.selected .search-pin-dot{width:24px;height:24px;border-width:3px;box-shadow:0 5px 16px rgba(0,0,0,.34);bottom:6px;transform:translateX(-50%) scale(1)}
    .search-pin-wrap.selected .search-pin-dot:after{bottom:-8px;border-left-width:6px;border-right-width:6px;border-top-width:9px}
    .search-pin-wrap.selected .search-pin-label{display:none}
    .search-pin-card{position:absolute;left:calc(100% + 12px);bottom:2px;margin-top:0;background:#ffffff;border:1px solid rgba(148,163,184,.35);border-radius:12px;padding:8px 10px;min-width:168px;max-width:min(260px,48vw);box-shadow:0 8px 20px rgba(2,6,23,.22);text-shadow:none}
    .search-pin-card-head{display:flex;align-items:flex-start;gap:8px}
    .search-pin-card-title{flex:1;font-size:13px;font-weight:800;color:#0f172a;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .search-pin-card-close{border:0;background:transparent;color:#98a2b3;font-size:16px;font-weight:700;line-height:1;cursor:pointer;padding:0;margin:0}
    .search-pin-card-close:hover{color:#344054}
    .search-pin-card-subtitle{margin-top:4px;font-size:11px;font-weight:500;color:#475467;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .search-pin-card-meta{margin-top:6px;font-size:11px;font-weight:600;color:#1570ef;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .search-pin-card-coords{margin-top:4px;font-size:11px;font-weight:500;color:#344054}
    .search-pin-card-actions{margin-top:8px;display:flex;justify-content:flex-end}
    .search-pin-card-btn{border:0;border-radius:8px;background:#1570ef;color:#ffffff;font-size:11px;font-weight:700;padding:6px 10px;cursor:pointer;line-height:1}
    .search-pin-card-btn:hover{background:#0f5fd1}
    .pin-size-mid .search-pin-dot{transform:translateX(-50%) scale(0.86)}
    .pin-size-mid .search-pin-wrap.selected .search-pin-dot{transform:translateX(-50%) scale(0.84)}
    .pin-size-far .search-pin-dot{transform:translateX(-50%) scale(0.7)}
    .pin-size-far .search-pin-wrap.selected .search-pin-dot{transform:translateX(-50%) scale(0.68)}
    .pin-size-far .search-pin-label{font-size:10px;max-width:120px}
    .pin-card-compact .search-pin-card{padding:7px 9px;min-width:152px;max-width:min(220px,46vw)}
    .pin-card-compact .search-pin-card-title{font-size:12px}
    .pin-card-compact .search-pin-card-subtitle,.pin-card-compact .search-pin-card-meta,.pin-card-compact .search-pin-card-coords{font-size:10px}
    .hide-selected-pin-cards .search-pin-wrap.selected .search-pin-card{display:none}
    @media (max-width: 768px){
      .search-pin-card{min-width:146px;max-width:min(200px,60vw);padding:7px 9px}
      .search-pin-card-title{font-size:12px}
      .search-pin-card-subtitle,.search-pin-card-meta,.search-pin-card-coords{font-size:10px}
    }
    .friend-chip{display:flex;align-items:center;gap:4px;background:#7C3AED;color:#fff;border:2px solid #fff;border-radius:14px;padding:2px 6px 2px 2px;font-size:10px;font-weight:600;white-space:nowrap}
    .friend-dot{width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:10px}
    .hide-pin-labels .search-pin-wrap:not(.selected) .search-pin-label{display:none}
    .hide-pin-labels .friend-chip > div:last-child{display:none}
    .nav-dot{width:18px;height:18px;border-radius:50%;background:#1570EF;border:3px solid #fff;box-shadow:0 0 0 2px rgba(21,112,239,.25)}
    /* Hide default leaflet zoom controls for our web layout */
    .leaflet-control-zoom{display:none!important}
    .leaflet-top.leaflet-left{margin-top:10px;margin-left:10px}
    @keyframes vizscan{0%,100%{opacity:.95}50%{opacity:.45}}
    .viz-search-zone{pointer-events:none;background:rgba(88,28,235,.22);border:1.5px solid rgba(167,139,250,.7);border-radius:5px;padding:4px 12px;color:#ddd6fe;font-size:10px;font-weight:700;letter-spacing:.5px;white-space:nowrap;display:flex;align-items:center;gap:5px;animation:vizscan 1.8s ease-in-out infinite;backdrop-filter:blur(6px)}
    /* Route overlays (routeLayers prop): shared appearance from inline/*, Leaflet positioning below. */
    ${ROUTE_OVERLAY_CSS}
    .rl-callout-icon,.rl-crime-icon,.rl-badge-icon{background:none;border:0}
    .rl-callout-icon .rl-callout{position:relative;transform:translate(-50%,calc(-100% - ${RL_CALLOUT_OFFSET_PX}px))}
    .rl-badge-icon .rl-pill-hit{position:relative;transform:translate(-50%,-50%)}
    .leaflet-control.rl-legend{pointer-events:auto}
    /* Lifted so the legend's bottom margin clears the attribution box in the opposite corner (height + gap). */
    .leaflet-bottom .leaflet-control.rl-legend{margin-bottom:${RL_ATTRIBUTION_HEIGHT_PX + RL_LEGEND_ATTRIBUTION_GAP_PX}px}
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    ${CORE_JS}
    ${FORMAT_JS}
    ${BADGES_JS}
    ${LEGEND_JS}
    ${SCREEN_CLUSTER_JS}
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
    var vizRect = null;
    var vizLabel = null;
    var vizAnimTimer = null;
    var vizClearTimer = null;
    var vizExternalPct = null;
    var lastOutOfRangeCueToken = 0;
    var outOfRangeCameraHoldUntil = 0;
    var outOfRangeBlinkTimers = [];
    var userCameraOverrideUntil = 0;
    var PIN_LABEL_MIN_ZOOM = 13.0;
    var isMapDragging = false;
    var lastMapDragAt = 0;

    // Route layers (routeLayers prop). Everything below is inert unless a route layer spec is present.
    // The colour ramp comes only from spec.legend.ramp (see inline/legend.ts), never from a constant here.
    var RL_DASH = ${JSON.stringify(RL_DASH)};
    var RL_LINE_WIDTH = ${RL_LINE_WIDTH};
    var RL_LINE_OPACITY = ${RL_LINE_OPACITY};
    var RL_TOUCH_TARGET_PX = ${RL_TOUCH_TARGET_PX};
    var RL_CRIME_MERGE_PX = ${RL_CRIME_MERGE_PX};
    var RL_RELAYOUT_DEBOUNCE_MS = ${RL_RELAYOUT_DEBOUNCE_MS};
    var RL_UNSELECTED_WIDTH = ${RL_UNSELECTED_WIDTH};
    var RL_HIT_WIDTH = ${RL_HIT_WIDTH};
    var RL_CASING = { color:${JSON.stringify(RL_CASING_COLOR)}, width:${RL_CASING_WIDTH}, opacity:${RL_CASING_OPACITY} };
    var routeOverlayLayer = null;
    var routePointsLayer = null;
    var lastRouteLayers = null;
    var lastRouteHighlight = null;
    var legendEl = null;
    var legendCtl = null;
    var legendControl = null;
    // What the overlay badges are drawn from, so they can be merged/separated again when the zoom changes.
    var lastRouteOverlay = null;
    var lastOverlayZoom = null;
    var overlayLayoutTimer = null;

    // Offset strategies for non-overlapping label placement (relative to pin center)
    // Prefer close placement first; only spread out when overlap requires it.
    var pinLabelOffsetCandidates = [
      { x: 0, y: -34 },
      { x: 0, y: 30 },
      { x: 50, y: -6 },
      { x: -50, y: -6 },
      { x: 38, y: -30 },
      { x: -38, y: -30 },
      { x: 38, y: 28 },
      { x: -38, y: 28 },
      // Maximum spread fallback (existing max distance behavior)
      { x: 0, y: -50 },
      { x: 0, y: 45 },
      { x: 70, y: -10 },
      { x: -70, y: -10 },
      { x: 50, y: -40 },
      { x: -50, y: -40 },
      { x: 50, y: 40 },
      { x: -50, y: 40 }
    ];

    var pinLabelLayoutScheduler = null;
    var candidatePinLabelMarkers = [];

    function rectsOverlap(r1, r2, minGap){
      minGap = minGap || 3;
      return !(r1.right + minGap < r2.left || r2.right + minGap < r1.left || 
               r1.bottom + minGap < r2.top || r2.bottom + minGap < r1.top);
    }

    function rectInsideViewport(rect, margin){
      margin = margin || 2;
      var winW = window.innerWidth, winH = window.innerHeight;
      return rect.left >= margin && rect.right <= winW - margin && 
             rect.top >= margin && rect.bottom <= winH - margin;
    }

    function layoutCandidatePinLabels(){
      if(!candidatePinLabelMarkers.length) return;
      
      // Sort by lat/lng for deterministic placement
      var entries = candidatePinLabelMarkers.slice().sort(function(a, b){
        if(Math.abs(a.lat - b.lat) > 0.00001) return b.lat - a.lat;
        if(Math.abs(a.lng - b.lng) > 0.00001) return a.lng - b.lng;
        return (a.id || '').localeCompare(b.id || '');
      });

      var placedRects = [];
      var unresolved = false;

      entries.forEach(function(entry){
        if(!entry.el) return;
        var placed = false;
        var labelWrap = entry.el.querySelector('.search-pin-label');
        if(!labelWrap) return;

        // Always reset from prior layout pass before probing positions.
        labelWrap.style.display = '';

        // Try each offset candidate
        for(var i = 0; i < pinLabelOffsetCandidates.length; i++){
          var candidate = pinLabelOffsetCandidates[i];
          
          // Temporarily apply offset
          labelWrap.style.position = 'absolute';
          labelWrap.style.left = candidate.x + 'px';
          labelWrap.style.top = candidate.y + 'px';
          labelWrap.style.transform = 'translateX(-50%)';
          
          // Measure
          var rect = labelWrap.getBoundingClientRect();
          var testRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };

          // Check viewport bounds
          if(!rectInsideViewport(testRect, 2)){
            continue;
          }

          // Check collision with already placed labels
          var collides = placedRects.some(function(pr){
            return rectsOverlap(testRect, pr, 3);
          });

          if(!collides){
            placedRects.push(testRect);
            placed = true;
            break;
          }
        }

        if(!placed){
          unresolved = true;
          labelWrap.style.display = 'none';
        }
      });

      // Hide all labels if too many unresolved collisions
      if(unresolved && candidatePinLabelMarkers.length >= 2){
        candidatePinLabelMarkers.forEach(function(e){
          var lw = e.el ? e.el.querySelector('.search-pin-label') : null;
          if(lw) lw.style.display = 'none';
        });
      }
    }

    function schedulePinLabelLayout(){
      if(!map) return;
      if(pinLabelLayoutScheduler) clearTimeout(pinLabelLayoutScheduler);
      pinLabelLayoutScheduler = setTimeout(function(){
        pinLabelLayoutScheduler = null;
        requestAnimationFrame(function(){
          layoutCandidatePinLabels();
        });
      }, 70);
    }

    function shouldIgnoreMarkerSelection(){
      if(isMapDragging) return true;
      return Date.now() - lastMapDragAt < 220;
    }

    function updatePinLabelVisibility(){
      if(!map || !document.body) return;
      var zoom = map.getZoom();
      var shouldHide = zoom < PIN_LABEL_MIN_ZOOM;
      if(shouldHide) document.body.classList.add('hide-pin-labels');
      else document.body.classList.remove('hide-pin-labels');

      document.body.classList.remove('pin-size-near','pin-size-mid','pin-size-far');
      if(zoom < 11.8) document.body.classList.add('pin-size-far');
      else if(zoom < 14.8) document.body.classList.add('pin-size-mid');
      else document.body.classList.add('pin-size-near');

      if(zoom < 13.0) document.body.classList.add('hide-selected-pin-cards');
      else document.body.classList.remove('hide-selected-pin-cards');
      if(zoom < 14.0) document.body.classList.add('pin-card-compact');
      else document.body.classList.remove('pin-card-compact');
    }

    // Explicit target origin for messages to the parent. The srcDoc iframe has no sandbox,
    // so it shares the parent's origin. If that cannot be read, fall back to '*'.
    var POST_TARGET_ORIGIN = (function(){
      try{
        var o = window.parent.location.origin;
        return (typeof o === 'string' && o && o !== 'null') ? o : '*';
      }catch(e){ return '*'; }
    })();

    function sendMsg(t, d){
      try{
        var m = Object.assign({ type:t }, d || {});
        window.parent.postMessage(JSON.stringify(m), POST_TARGET_ORIGIN);
        window.dispatchEvent(new CustomEvent('leaflet-msg', { detail:m }));
      }catch(e){}
    }

    function setFollowMode(next){
      if(isFollowingNav === next) return;
      isFollowingNav = next;
      sendMsg('navFollowChanged', { isFollowing: next });
    }

    function markUserCameraOverride(){
      userCameraOverrideUntil = Date.now() + 900;
      if(map && map.stop) map.stop();
      sendMsg('userInteracted', {});
      if(lastNavLL){
        userInteracted = true;
        setFollowMode(false);
      }
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
      if(routeOverlayLayer) routeOverlayLayer.clearLayers();
      if(routePointsLayer) routePointsLayer.clearLayers();
      lastRouteLayers = null;
      lastRouteOverlay = null;
      layerRoutes.clearLayers();
      layerMarkers.clearLayers();
      layerFriends.clearLayers();
      layerLabels.clearLayers();
      layerRange.clearLayers();
      candidatePinLabelMarkers = [];
    }

    function clearOutOfRangeBlink(){
      while(outOfRangeBlinkTimers.length){
        clearTimeout(outOfRangeBlinkTimers.pop());
      }
      try{
        var ring = layerRange && layerRange.getLayers ? layerRange.getLayers()[0] : null;
        if(ring && ring.setStyle){
          ring.setStyle({color:'#22c55e',fillColor:'#22c55e',fillOpacity:0.04});
        }
      }catch(e){}
    }

    function triggerOutOfRangeCue(d){
      if(!d || !d.origin || !d.maxDistanceKm) return false;

      // Hold camera updates briefly so regular pan/fit updates cannot undo this cue.
      outOfRangeCameraHoldUntil = Date.now() + 2200;

      clearOutOfRangeBlink();

      // Ensure range ring exists before blink, even if this update did not draw it yet.
      if(layerRange){
        layerRange.clearLayers();
        L.polygon(makeCirclePolygon(d.origin.lat,d.origin.lng,d.maxDistanceKm,64),{color:'#22c55e',weight:2.5,fillColor:'#22c55e',fillOpacity:0.04,dashArray:'6 4'}).addTo(layerRange);
      }

      map.stop();
      var center = d.navLocation || d.origin;
      map.flyTo([center.lat, center.lng], 13.5, {
        animate:true,
        duration:0.85,
        easeLinearity:0.2,
      });

      var blinkStarted = false;
      var startBlink = function(){
        if(blinkStarted) return;
        blinkStarted = true;
        var ring = layerRange && layerRange.getLayers ? layerRange.getLayers()[0] : null;
        if(!ring || !ring.setStyle) return;

        var red = function(){ ring.setStyle({color:'#ef4444',fillColor:'#ef4444',fillOpacity:0.12}); };
        var normal = function(){ ring.setStyle({color:'#22c55e',fillColor:'#22c55e',fillOpacity:0.04}); };

        red();
        outOfRangeBlinkTimers.push(setTimeout(normal, 180));
        outOfRangeBlinkTimers.push(setTimeout(red, 360));
        outOfRangeBlinkTimers.push(setTimeout(normal, 540));
      };

      map.once('moveend', function(){
        outOfRangeBlinkTimers.push(setTimeout(startBlink, 1500));
      });
      outOfRangeBlinkTimers.push(setTimeout(startBlink, 2500));
      return true;
    }

    // Progress text is no longer drawn on the map; the loader in the sidebar shows it.
    function vizSetProgress(pct, msg){}

    function clearVisualization(){
      if(vizAnimTimer){ clearInterval(vizAnimTimer); vizAnimTimer=null; }
      if(vizRect){ map.removeLayer(vizRect); vizRect=null; }
      if(vizLabel){ map.removeLayer(vizLabel); vizLabel=null; }
    }

    function drawSearchZoneFromCoords(coords){
      var oLat=Number(coords.oLat), oLng=Number(coords.oLng), dLat=Number(coords.dLat), dLng=Number(coords.dLng);
      if(!isFinite(oLat)||!isFinite(oLng)||!isFinite(dLat)||!isFinite(dLng)) return;

      var dLatRad=(dLat-oLat)*Math.PI/180, dLngRad=(dLng-oLng)*Math.PI/180;
      var oLatRad=oLat*Math.PI/180, dLatAbsRad=dLat*Math.PI/180;
      var a=Math.sin(dLatRad/2)*Math.sin(dLatRad/2)
        + Math.cos(oLatRad)*Math.cos(dLatAbsRad)*Math.sin(dLngRad/2)*Math.sin(dLngRad/2);
      var straightLineDist=6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));

      var corridorBufferM=Math.max(700, Math.min(1000, straightLineDist * 0.3));
      var minLat=Math.min(oLat,dLat), maxLat=Math.max(oLat,dLat);
      var minLng=Math.min(oLng,dLng), maxLng=Math.max(oLng,dLng);
      var midLat=(oLat+dLat)/2;
      var metersPerDegLat=111320;
      var metersPerDegLng=Math.max(1000, 111320*Math.cos(midLat*Math.PI/180));
      var bufferLatDeg=corridorBufferM/metersPerDegLat;
      var bufferLngDeg=corridorBufferM/metersPerDegLng;
      var south=minLat-bufferLatDeg, north=maxLat+bufferLatDeg;
      var west=minLng-bufferLngDeg,  east=maxLng+bufferLngDeg;

      var heightM=(north-south)*metersPerDegLat;
      var widthM=(east-west)*metersPerDegLng;
      if(widthM<heightM){ var extra=(heightM-widthM)/2/metersPerDegLng; west-=extra; east+=extra; }
      else if(heightM<widthM){ var extra2=(widthM-heightM)/2/metersPerDegLat; south-=extra2; north+=extra2; }

      if(vizRect){ map.removeLayer(vizRect); vizRect=null; }
      vizRect = L.rectangle([[south,west],[north,east]], {
        color:'#a78bfa',
        weight:2,
        fillColor:'#7C3AED',
        fillOpacity:0.10,
        interactive:false,
      }).addTo(map);

      if(vizLabel){ map.removeLayer(vizLabel); vizLabel=null; }
      var icon=L.divIcon({
        className:'',
        html:'<div class="viz-search-zone">&#128269; Analysing area&hellip;</div>',
        iconSize:[180,28],
        iconAnchor:[90,14],
      });
      vizLabel = L.marker([(south+north)/2,(west+east)/2],{icon:icon,interactive:false}).addTo(map);

      vizSetProgress(vizExternalPct != null ? vizExternalPct : 8, null);

      var pulseStep=0;
      if(vizAnimTimer){ clearInterval(vizAnimTimer); vizAnimTimer=null; }
      vizAnimTimer = setInterval(function(){
        pulseStep++;
        if(vizRect){
          var op = 0.06 + 0.10 * (0.5 + 0.5 * Math.sin(pulseStep * 0.314));
          vizRect.setStyle({ fillOpacity: op });
        }
        if(vizExternalPct!=null){ vizSetProgress(vizExternalPct, null); }
      }, 1000);
    }

    function addFriendMarker(f){
      // Friend names are user-supplied: every piece reaching innerHTML goes through safeLabel().
      var name=String(f.name||'');
      var initial=safeLabel((name.charAt(0)||'?').toUpperCase());
      var label=safeLabel((name||'Friend').slice(0,14));
      var icon=L.divIcon({
        className:'',
        html:'<div class="friend-chip"><div class="friend-dot">'+initial+'</div><div>'+label+'</div></div>',
        iconSize:[80,24],
        iconAnchor:[20,12]
      });
      L.marker([f.lat,f.lng],{icon:icon}).addTo(layerFriends);
    }

    function addRoadLabel(l){
      var txt=safeLabel(String(l.name||'').slice(0,12));
      var bg=rlColor(l.color,'#111827');
      var icon=L.divIcon({className:'',html:'<div class="road-label" style="background:'+bg+'">'+txt+'</div>',iconSize:[120,18],iconAnchor:[60,9]});
      L.marker([l.lat,l.lng],{icon:icon,interactive:false}).addTo(layerLabels);
    }

    // ═══ Route layers (Leaflet drawing). One function per concern; shared badge/legend builders live in inline/*. ═══

    // Defensive copy of the spec: every list is an array, the legend an object or null.
    function rlNormalize(raw){
      if(!raw || typeof raw!=='object') return null;
      return {
        lines: Array.isArray(raw.lines) ? raw.lines : [],
        callouts: Array.isArray(raw.callouts) ? raw.callouts : [],
        crimeClusters: Array.isArray(raw.crimeClusters) ? raw.crimeClusters : [],
        points: Array.isArray(raw.points) ? raw.points : [],
        legend: (raw.legend && typeof raw.legend==='object') ? raw.legend : null
      };
    }

    function rlCoords(list){
      var out=[];
      if(!Array.isArray(list)) return out;
      for(var i=0;i<list.length;i++){
        var c=list[i];
        if(Array.isArray(c) && rlIsNum(c[0]) && rlIsNum(c[1])) out.push([c[0],c[1]]);
      }
      return out;
    }

    function rlLatLng(p){
      return (p && rlIsNum(p.lat) && rlIsNum(p.lng)) ? [p.lat,p.lng] : null;
    }

    // Leaflet divIcon html is a string, so shared DOM builders are serialised. Listeners do not survive
    // this; selection is bound to the Leaflet marker instead.
    function rlIconHtml(el){ return el.outerHTML; }

    // Light points only from zoom 17, or when lights are the highlighted category.
    // CCTV and shops only when highlighted.
    function rlPointVisible(kind, zoom, hl){
      if(kind==='light') return hl==='light' || (rlIsNum(zoom) && zoom>=RL_LIGHT_ZOOM);
      if(kind==='cctv' || kind==='shop') return hl===kind;
      return false;
    }

    // --- Route lines ---------------------------------------------------------

    // Unselected route: solid grey line, plus a wide (touch-target sized) invisible hit line that selects it.
    // Hit lines are drawn before the selected route (updateMap), so the selected route sits above them.
    function rlDrawUnselected(group, latlngs, onSelect){
      L.polyline(latlngs,{color:RL_GREY,weight:RL_UNSELECTED_WIDTH,opacity:1,lineCap:'round',lineJoin:'round',interactive:false}).addTo(group);
      var hit=L.polyline(latlngs,{color:RL_GREY,weight:RL_HIT_WIDTH,opacity:0,lineCap:'round',lineJoin:'round'});
      hit.on('click', onSelect);
      hit.addTo(group);
    }

    // Selected route: a white casing under every coloured line (all casings first),
    // then the coloured lines. Dashed lines use a dotted dash as a second channel.
    function rlDrawSelected(group, lines, fallbackLatLngs){
      var runs=[];
      for(var i=0;i<lines.length;i++){
        var ln=lines[i]||{};
        var coords=rlCoords(ln.coords);
        if(coords.length<2) continue;
        runs.push({ coords:coords, color:rlColor(ln.color,RL_FALLBACK_BLUE), dashed:ln.dashed===true });
      }
      if(runs.length===0 && fallbackLatLngs.length>=2){
        runs.push({ coords:fallbackLatLngs, color:RL_FALLBACK_BLUE, dashed:false });
      }
      // Interactive so a tap on the selected route is taken here, not by an unselected route's wide hit line below it.
      runs.forEach(function(run){
        L.polyline(run.coords,{color:RL_CASING.color,weight:RL_CASING.width,opacity:RL_CASING.opacity,lineCap:'round',lineJoin:'round',interactive:true}).addTo(group);
      });
      runs.forEach(function(run){
        var opts={color:run.color,weight:RL_LINE_WIDTH,opacity:RL_LINE_OPACITY,lineCap:'round',lineJoin:'round',interactive:true};
        if(run.dashed) opts.dashArray=RL_DASH;
        L.polyline(run.coords,opts).addTo(group);
      });
    }

    // --- Callout -------------------------------------------------------------

    // Only one label: the first callout with a valid position. Positioned above the point by CSS.
    function rlDrawCallouts(group, callouts){
      for(var i=0;i<callouts.length;i++){
        var c=callouts[i]||{};
        var p=rlLatLng(c);
        if(!p) continue;
        var icon=L.divIcon({
          className:'rl-callout-icon',
          html:rlIconHtml(rlBuildCallout(c.text)),
          iconSize:[0,0],
          iconAnchor:[0,0]
        });
        L.marker(p,{icon:icon,interactive:false,keyboard:false,zIndexOffset:1000}).addTo(group);
        return;
      }
    }

    // --- Crime clusters ------------------------------------------------------

    // Crime is shown as count badges only, never as individual dots.
    function rlDrawCrime(group, clusters){
      for(var i=0;i<clusters.length;i++){
        var c=clusters[i]||{};
        var p=rlLatLng(c);
        if(!p || !rlIsNum(c.count) || c.count<1) continue;
        var n=Math.floor(c.count);
        var size=rlCrimeIsLarge(n)?${RL_CRIME_SIZE_LARGE}:${RL_CRIME_SIZE};
        var icon=L.divIcon({
          className:'rl-crime-icon',
          html:rlIconHtml(rlBuildCrimeBadge(n)),
          iconSize:[size,size],
          iconAnchor:[size/2,size/2]
        });
        L.marker(p,{icon:icon,interactive:false,keyboard:false,zIndexOffset:500}).addTo(group);
      }
    }

    // --- Score pills ---------------------------------------------------------

    // One score pill per route. Tapping a non-selected pill selects that route; the selected pill is not tappable.
    // project (optional) maps lat/lng to container pixels: a pill whose touch target would overlap an earlier
    // pill is shifted vertically (inline/screenCluster.ts), so every pill stays tappable.
    function rlDrawBadges(group, badges, project, obstacles){
      if(!Array.isArray(badges)) return;
      var items=[];
      for(var i=0;i<badges.length;i++){
        var b=badges[i]||{};
        var p=rlLatLng(b);
        if(p) items.push({ b:b, i:i, p:p });
      }
      var shifts=[];
      if(project){
        var spread=separatePills(items.map(function(it){
          var q=project(it.p[0], it.p[1]) || {};
          return { x:q.x, y:q.y, priority:it.b.selected===true };
        }), RL_TOUCH_TARGET_PX, obstacles);
        shifts=spread.map(function(r){ return r.dy; });
      }
      items.forEach(function(it, k){
        var sel=it.b.selected===true;
        var el=rlBuildPill(it.b, it.i);
        var dy=shifts[k];
        if(dy) el.style.top=(Math.round(dy*10)/10)+'px';
        var icon=L.divIcon({
          className:'rl-badge-icon',
          html:rlIconHtml(el),
          iconSize:[0,0],
          iconAnchor:[0,0]
        });
        var marker=L.marker(it.p,{icon:icon,interactive:!sel,keyboard:false,zIndexOffset:sel?900:800});
        if(!sel){
          (function(routeId){
            marker.on('click', function(){ sendMsg('selectRoute', { id:routeId }); });
          })(it.b.routeId);
        }
        marker.addTo(group);
      });
    }

    // Callout, crime badges and score pills are positioned in screen space, so they are drawn together
    // and drawn again whenever the zoom changes (see rlScheduleOverlayLayout).
    function rlProjector(){
      if(!map || typeof map.latLngToContainerPoint!=='function') return null;
      return function(lat, lng){
        try{
          var q=map.latLngToContainerPoint([lat,lng]);
          return { x:q.x, y:q.y };
        }catch(e){ return null; }
      };
    }

    function rlDrawOverlay(){
      if(!routeOverlayLayer) return;
      routeOverlayLayer.clearLayers();
      lastOverlayZoom = map ? map.getZoom() : null;
      var o=lastRouteOverlay;
      if(!o) return;
      var project=rlProjector();
      var obstacles=[];
      if(o.showRoute){
        // Merge the crime badges first; the pills then move off them (the badges stay put).
        var crimes=project ? mergeScreenClusters(o.rl.crimeClusters, project, RL_CRIME_MERGE_PX) : o.rl.crimeClusters;
        rlDrawCallouts(routeOverlayLayer, o.rl.callouts);
        rlDrawCrime(routeOverlayLayer, crimes);
        if(project) crimes.forEach(function(c){
          var q=project(c.lat, c.lng);
          if(q) obstacles.push({ x:q.x, y:q.y, r:(rlCrimeIsLarge(Math.floor(c.count))?${RL_CRIME_SIZE_LARGE}:${RL_CRIME_SIZE})/2 });
        });
      }
      rlDrawBadges(routeOverlayLayer, o.badges, project, obstacles);
    }

    // zoomend/moveend: draw the overlay again once things settle, but only when the zoom actually changed.
    function rlScheduleOverlayLayout(){
      if(!map || !lastRouteOverlay) return;
      if(overlayLayoutTimer) clearTimeout(overlayLayoutTimer);
      overlayLayoutTimer = setTimeout(function(){
        overlayLayoutTimer = null;
        if(!lastRouteOverlay) return;
        var z=map.getZoom();
        if(lastOverlayZoom!==null && Math.abs(z-lastOverlayZoom)<0.01) return;
        rlDrawOverlay();
      }, RL_RELAYOUT_DEBOUNCE_MS);
    }

    // --- Points (lights, cctv, shops) ---------------------------------------

    function rlDrawPoints(group, points, zoom, hl){
      for(var i=0;i<points.length;i++){
        var pt=points[i]||{};
        var kind=pt.kind;
        if(!rlPointVisible(kind, zoom, hl)) continue;
        var p=rlLatLng(pt);
        if(!p || !RL_POINT_COLORS.hasOwnProperty(kind)) continue;
        L.circleMarker(p,{radius:kind===hl?7:5,color:'#ffffff',weight:1.5,fillColor:RL_POINT_COLORS[kind],fillOpacity:1,interactive:false}).addTo(group);
      }
    }

    // Points depend on the zoom, so this runs again on every zoomend.
    function rlRenderPoints(){
      if(!routePointsLayer) return;
      routePointsLayer.clearLayers();
      if(!lastRouteLayers) return;
      rlDrawPoints(routePointsLayer, lastRouteLayers.points, map.getZoom(), lastRouteHighlight);
    }

    // --- Legend (built by inline/legend.ts) ----------------------------------

    function rlRenderLegend(legend){
      if(legendCtl) legendCtl.update(legend);
    }

    function rlSetLegendVisible(on){
      if(legendCtl) legendCtl.setVisible(on);
    }

    function init(){
      map = L.map('map', {
        zoomControl:${showZoomControls ? "true" : "false"},
        attributionControl:true,
        zoomSnap:0,
        zoomDelta:1,
        wheelPxPerZoomLevel:20,
        wheelDebounceTime:10,
        zoomAnimation:true,
        fadeAnimation:true,
        markerZoomAnimation:true,
      }).setView([51.5074,-0.1278], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        maxNativeZoom: 19,
        detectRetina: true,
        keepBuffer: 8,
        updateWhenZooming: true,
        updateInterval: 100,
        attribution: ${JSON.stringify(OSM_ATTRIBUTION)}
      }).addTo(map);

      layerRoutes = L.layerGroup().addTo(map);
      layerMarkers = L.layerGroup().addTo(map);
      layerFriends = L.layerGroup().addTo(map);
      layerLabels = L.layerGroup().addTo(map);
      layerRange = L.layerGroup().addTo(map);
      routeOverlayLayer = L.layerGroup().addTo(map);
      routePointsLayer = L.layerGroup().addTo(map);

      // The legend (inline/legend.ts) starts collapsed on narrow iframes; a user toggle is remembered after that.
      legendControl = L.control({position:'bottomleft'});
      legendControl.onAdd = function(){
        var el=document.createElement('div');
        el.className='leaflet-control rl-legend';
        legendEl=el;
        legendCtl=rlBuildLegend(el,{dashArray:RL_DASH});
        if(L.DomEvent && L.DomEvent.disableClickPropagation) L.DomEvent.disableClickPropagation(el);
        return el;
      };
      legendControl.addTo(map);

      map.on('click', function(e){
        sendMsg('press', { lat:e.latlng.lat, lng:e.latlng.lng });
      });

      map.on('contextmenu', function(e){
        sendMsg('longpress', { lat:e.latlng.lat, lng:e.latlng.lng });
      });

      map.on('mousedown', function(e){
        markUserCameraOverride();
        if(longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = setTimeout(function(){
          sendMsg('longpress', { lat:e.latlng.lat, lng:e.latlng.lng });
        }, 650);
      });
      map.on('mouseup', function(){ if(longPressTimer) clearTimeout(longPressTimer); });
      map.on('mousemove', function(){ if(longPressTimer) clearTimeout(longPressTimer); });

      map.on('dragstart', function(){
        isMapDragging = true;
        markUserCameraOverride();
      });

      map.on('dragend', function(){
        isMapDragging = false;
        lastMapDragAt = Date.now();
        const center = map.getCenter();
        sendMsg('mapCenterChanged', { lat: center.lat, lng: center.lng });
        schedulePinLabelLayout();
      });

      map.on('zoomstart', function(e){
        if(e && e.originalEvent){
          markUserCameraOverride();
        }
      });

      map.on('wheel', function(){ markUserCameraOverride(); });

      map.on('zoomend', function(){
        rlRenderPoints();
        updatePinLabelVisibility();
        schedulePinLabelLayout();
        rlScheduleOverlayLayout();
      });

      map.on('moveend', function(){
        schedulePinLabelLayout();
        rlScheduleOverlayLayout();
      });
      
      window.addEventListener('resize', schedulePinLabelLayout);
      window.addEventListener('orientationchange', schedulePinLabelLayout);
      updatePinLabelVisibility();

      ready = true;
      sendMsg('ready', {});
      if(lastData) updateMap(lastData);
    }

    // London is only a first-load fallback. Later updates (e.g. the origin
    // field being edited) must not move the map away from where the user is.
    var londonFallbackShown=false;

    // ═══ updateMap: one function per concern. ctx carries the per-update state they share. ═══

    // Origin and destination dots. Their positions join the fit bounds unless only candidates are focused.
    function drawEndpoints(d, ctx){
      if(d.origin && !d.navLocation){
        L.circleMarker([d.origin.lat,d.origin.lng],{radius:7,color:'#fff',weight:3,fillColor:'#4285F4',fillOpacity:1}).addTo(layerMarkers);
        if(!ctx.focusCandidatesOnly){
          ctx.bounds.push([d.origin.lat,d.origin.lng]);
        }
      }

      if(d.destination){
        L.circleMarker([d.destination.lat,d.destination.lng],{radius:8,color:'#fff',weight:2,fillColor:'#ef4444',fillOpacity:1}).addTo(layerMarkers);
        if(!ctx.focusCandidatesOnly){
          ctx.bounds.push([d.destination.lat,d.destination.lng]);
        }
      }
    }

    // Unselected routes: wide hit line (routeLayers mode) or the legacy grey line. Clicking selects the route.
    function drawUnselectedRoutes(d, ctx){
      (d.routes||[]).forEach(function(r){
        if(r.selected) return;
        var latlngs=r.path.map(function(p){return [p.lat,p.lng];});
        if(ctx.rl){
          rlDrawUnselected(layerRoutes, latlngs, function(){ sendMsg('selectRoute', { id:r.id }); });
        } else {
          var poly=L.polyline(latlngs,{color:'#98a2b3',weight:5,opacity:0.6}).addTo(layerRoutes);
          poly.on('click', function(){ sendMsg('selectRoute', { id:r.id }); });
        }
        if(!ctx.focusCandidatesOnly){
          for(var i=0;i<latlngs.length;i++) ctx.bounds.push(latlngs[i]);
        }
      });
    }

    // Selected route: route-layer lines, legacy coloured segments, or a plain blue line. Returns the route or null.
    function drawSelectedRoute(d, ctx){
      var selected=null;
      for(var i=0;i<(d.routes||[]).length;i++) if(d.routes[i].selected) { selected=d.routes[i]; break; }
      if(!selected) return null;

      var selLatLngs=selected.path.map(function(p){ return [p.lat,p.lng]; });
      if(ctx.rl){
        rlDrawSelected(layerRoutes, ctx.rl.lines, selLatLngs);
      } else if(d.segments && d.segments.length>0){
        d.segments.forEach(function(seg){
          L.polyline(seg.path.map(function(p){return [p.lat,p.lng];}),{color:seg.color,weight:7,opacity:0.9}).addTo(layerRoutes);
        });
      } else {
        L.polyline(selLatLngs,{color:'#4285F4',weight:6,opacity:0.9}).addTo(layerRoutes);
      }
      if(!ctx.focusCandidatesOnly){
        for(var j=0;j<selLatLngs.length;j++) ctx.bounds.push(selLatLngs[j]);
      }
      return selected;
    }

    // A search-candidate pin (with its details card when selected). Pins stay drawn in routeLayers mode.
    function addCandidatePin(m, ctx){
      var isSelectedCandidate = !!m.isSelected;
      var candidateColor = normalizePinColor(m.pinColor);
      var raw = String(m.popupTitle || m.label || 'Place').trim();
      var trimmed = raw.length > 18 ? raw.slice(0, 18) + '…' : raw;
      var popupTitle = safeLabel(m.popupTitle || raw || 'Place');
      var popupSubtitle = safeLabel(m.popupSubtitle || raw || '');
      var popupMeta = safeLabel(m.popupMeta || '');
      var popupCoords = safeLabel(m.popupCoords || '');
      var popupButtonLabel = safeLabel(m.popupButtonLabel || 'Select');
      var selectedCardHtml = isSelectedCandidate
        ? '<div class="search-pin-card"><div class="search-pin-card-head"><div class="search-pin-card-title">'+popupTitle+'</div><button class="search-pin-card-close" type="button" aria-label="Close details">×</button></div><div class="search-pin-card-subtitle">'+popupSubtitle+'</div>'+
          (popupMeta ? '<div class="search-pin-card-meta">'+popupMeta+'</div>' : '')+
          (popupCoords ? '<div class="search-pin-card-coords">'+popupCoords+'</div>' : '')+
          '<div class="search-pin-card-actions"><button class="search-pin-card-btn" type="button">'+popupButtonLabel+'</button></div></div>'
        : '<div class="search-pin-label">'+safeLabel(trimmed)+'</div>';
      var icon=L.divIcon({
        className:'',
        html:'<div class="search-pin-wrap'+(isSelectedCandidate?' selected':'')+'" style="--pin-color:'+candidateColor+'"><div class="search-pin-dot"></div>'+selectedCardHtml+'</div>',
        iconSize:[34,40],
        iconAnchor:[17,34],
      });
      var pin=L.marker([m.lat,m.lng],{icon:icon}).addTo(layerMarkers);
      var markerEl = pin.getElement && pin.getElement();

      // Track unselected labels for collision layout
      if(!isSelectedCandidate && markerEl){
        candidatePinLabelMarkers.push({ id: m.id, lat: m.lat, lng: m.lng, el: markerEl });
      }

      pin.on('click', function(){
        if(shouldIgnoreMarkerSelection()) return;
        sendMsg('selectMarker', { id:m.id });
      });
      if(isSelectedCandidate){
        var buttonEl = markerEl ? markerEl.querySelector('.search-pin-card-btn') : null;
        if(buttonEl){
          buttonEl.addEventListener('click', function(ev){
            ev.preventDefault();
            ev.stopPropagation();
            if(shouldIgnoreMarkerSelection()) return;
            sendMsg('findSafeRoutes', { id:m.id });
          });
        }
        var closeEl = markerEl ? markerEl.querySelector('.search-pin-card-close') : null;
        if(closeEl){
          closeEl.addEventListener('click', function(ev){
            ev.preventDefault();
            ev.stopPropagation();
            sendMsg('dismissMarkerDetails', { id:m.id });
          });
        }
      }
      if(ctx.includeCandidateBounds){
        ctx.bounds.push([m.lat,m.lng]);
      }
    }

    // Safety markers: candidate pins always; legacy category dots only when routeLayers is not set.
    function drawSafetyMarkers(d, ctx){
      var hl = ctx.hl;
      (d.safetyMarkers||[]).forEach(function(m){
        var isCandidate = m.id && String(m.id).indexOf('search-candidate:')===0;
        if(ctx.rl && !isCandidate) return;
        var k=m.kind||'crime';
        if(hl && hl!==k) return;
        if(isCandidate){
          addCandidatePin(m, ctx);
          return;
        }

        var isHl=hl && hl===k;
        var radius=(k==='via')?8:(isHl?7:4);
        L.circleMarker([m.lat,m.lng],{radius:radius,color:'#fff',weight:isHl?2:1,fillColor:SAFETY_MARKER_COLORS[k]||SAFETY_MARKER_FALLBACK_COLOR,fillOpacity:isHl?1:0.85}).addTo(layerMarkers);
      });
    }

    // Friends: breadcrumb trail, planned route (dashed) and the name chip.
    function drawFriends(d){
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
    }

    // Route overlay: callout, crime badges, points (only with a selected route), legend, and the score pills.
    function drawRouteOverlay(d, ctx, selected){
      var rl = ctx.rl;
      lastRouteLayers = rl && selected ? rl : null;
      lastRouteHighlight = ctx.hl;
      lastRouteOverlay = rl ? { rl:rl, showRoute:!!lastRouteLayers, badges:d.routeBadges } : null;
      rlDrawOverlay();
      if(lastRouteLayers) rlRenderPoints();
      if(rl) rlRenderLegend(rl.legend);
      rlSetLegendVisible(!!lastRouteLayers);
    }

    function drawRoadLabels(d){
      var hasRoutes = Array.isArray(d.routes) && d.routes.length > 0;
      if(d.showExtraDetail && hasRoutes){
        (d.roadLabels||[]).forEach(addRoadLabel);
      }
    }

    function drawRangeRing(d){
      if(d.origin && d.maxDistanceKm && d.maxDistanceKm>0 && !d.navLocation){
        L.polygon(makeCirclePolygon(d.origin.lat,d.origin.lng,d.maxDistanceKm,64),{color:'#22c55e',weight:2.5,fillColor:'#22c55e',fillOpacity:0.04,dashArray:'6 4'}).addTo(layerRange);
      }
    }

    // Camera: navigation follow, pan-to, fit-bounds and the first-load London fallback.
    function applyCamera(d, ctx){
      var london=[51.5074,-0.1278];
      var bounds=ctx.bounds;
      var isUserCameraOverride = ctx.isUserCameraOverride;
      var isOutOfRangeCameraHold = Date.now() < outOfRangeCameraHoldUntil;
      var fitBottomPadding = Math.max(40, Number(d.fitBottomPadding || 40));
      var fitTopPadding = Math.max(40, Number(d.fitTopPadding || 40));
      var fitSidePadding = Math.max(24, Number(d.fitSidePadding || 40));
      var candidateFitTopPadding = Math.max(40, Number(d.candidateFitTopPadding || fitTopPadding));
      var candidateFitBottomPadding = Math.max(40, Number(d.candidateFitBottomPadding || fitBottomPadding));
      var candidateFitSidePadding = Math.max(24, Number(d.candidateFitSidePadding || fitSidePadding));
      var isExplicitCandidateRefit = !!d.fitCandidateBounds;

      if(d.navLocation){
        lastNavLL=[d.navLocation.lat,d.navLocation.lng];
        var navIcon=L.divIcon({className:'',html:'<div class="nav-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});
        L.marker(lastNavLL,{icon:navIcon}).addTo(layerMarkers);
        if(!userInteracted && !isOutOfRangeCameraHold && !isUserCameraOverride){
          setFollowMode(true);
          var navZoom=isPipMode?15:17;
          if(Math.abs(map.getZoom()-navZoom)>0.05){
            map.stop();
            map.flyTo(lastNavLL,navZoom,{animate:true,duration:0.45,easeLinearity:0.2,noMoveStart:true});
          }else{
            map.stop();
            map.panTo(lastNavLL,{animate:true,duration:0.35,easeLinearity:0.2,noMoveStart:true});
          }
        }
      } else {
        lastNavLL=null;
        userInteracted=false;
        setFollowMode(true);
      }

      if(!isOutOfRangeCameraHold && !isUserCameraOverride && d.panTo){
        map.stop();
        map.flyTo([d.panTo.lat,d.panTo.lng], Math.max(map.getZoom(),16), {
          animate:true,
          duration:0.32,
          easeLinearity:0.25,
        });
      } else if(!isOutOfRangeCameraHold && d.fitBounds && bounds.length>0 && !d.navLocation && (isExplicitCandidateRefit || !isUserCameraOverride)){
        map.stop();
        map.fitBounds(bounds, {
          paddingTopLeft:[isExplicitCandidateRefit ? candidateFitSidePadding : fitSidePadding, isExplicitCandidateRefit ? candidateFitTopPadding : fitTopPadding],
          paddingBottomRight:[isExplicitCandidateRefit ? candidateFitSidePadding : fitSidePadding, isExplicitCandidateRefit ? candidateFitBottomPadding : fitBottomPadding],
          maxZoom:16,
          animate:true,
          duration:0.36,
          easeLinearity:0.25,
        });
      } else if(!isOutOfRangeCameraHold && !isUserCameraOverride && !d.origin && !d.navLocation && bounds.length===0 && !londonFallbackShown){
        londonFallbackShown=true;
        map.stop();
        map.flyTo(london,13,{animate:true,duration:0.45,easeLinearity:0.2});
      }
    }

    function updateMap(d){
      if(!ready || !d) return;
      lastData = d;
      clearLayers();

      var ctx = {
        bounds: [],
        focusCandidatesOnly: !!d.fitCandidateBounds,
        includeCandidateBounds: !!d.fitCandidateBounds,
        isUserCameraOverride: Date.now() < userCameraOverrideUntil,
        hl: d.highlightCategory||null,
        rl: rlNormalize(d.routeLayers)
      };

      if(typeof d.isInPipMode!=='undefined') isPipMode=!!d.isInPipMode;

      drawEndpoints(d, ctx);
      drawUnselectedRoutes(d, ctx);
      var selected = drawSelectedRoute(d, ctx);
      drawSafetyMarkers(d, ctx);
      drawFriends(d);
      drawRouteOverlay(d, ctx, selected);
      drawRoadLabels(d);
      drawRangeRing(d);
      applyCamera(d, ctx);

      // Apply out-of-range cue last so it cannot be overridden by regular camera updates.
      if(d.outOfRangeCueToken && d.outOfRangeCueToken !== lastOutOfRangeCueToken){
        if(triggerOutOfRangeCue(d)){
          lastOutOfRangeCueToken = d.outOfRangeCueToken;
        }
      }

      // Trigger label layout after all markers added
      schedulePinLabelLayout();
    }

    window.updateMap = updateMap;
    window.setMapType = function(_type){};
    window.setPipMode = function(pip){ isPipMode=!!pip; };
    window.recenterNavigation = function(){
      userInteracted=false;
      setFollowMode(true);
      if(lastNavLL){
        map.stop();
        map.flyTo(lastNavLL,isPipMode?15:17,{animate:true,duration:0.45,easeLinearity:0.2});
      }
    };
    window.setVizProgress = function(pct,msg){
      if(pct==null || !isFinite(Number(pct))){ vizExternalPct = null; return; }
      vizExternalPct = Math.max(0, Math.min(100, Number(pct)));
      vizSetProgress(vizExternalPct, msg || null);
    };
    window.startVizStream = function(v){
      if(vizClearTimer){ clearTimeout(vizClearTimer); vizClearTimer=null; }
      clearVisualization();
      if(!v) return;
      try{ drawSearchZoneFromCoords(JSON.parse(v)); }catch(e){}
    };
    window.stopVizStream = function(){
      if(vizClearTimer){ clearTimeout(vizClearTimer); vizClearTimer=null; }
      vizExternalPct = null;
      vizClearTimer = setTimeout(function(){ clearVisualization(); vizClearTimer=null; }, 700);
    };

    init();
  <\/script>
</body>
</html>`;

export const RouteMap = ({
  origin,
  destination,
  routes,
  selectedRouteId,
  showExtraDetail = true,
  safetyMarkers = [],
  routeSegments = [],
  roadLabels = [],
  routeLayers = null,
  routeBadges,
  panTo,
  fitCandidateBoundsToken = 0,
  fitTopPadding = 40,
  fitBottomPadding = 40,
  fitSidePadding = 40,
  candidateFitTopPadding,
  candidateFitBottomPadding,
  candidateFitSidePadding,
  showZoomControls = true,
  isNavigating = false,
  navigationLocation,
  navigationHeading,
  mapType = "roadmap",
  highlightCategory,
  maxDistanceKm,
  friendMarkers = [],
  isInPipMode = false,
  recenterSignal = 0,
  outOfRangeCueSignal = 0,
  vizStreamUrl = null,
  vizProgressPct = null,
  vizProgressMessage = null,
  onSelectRoute,
  onSelectMarker,
  onFindSafeRoutes,
  onDismissMarkerDetails,
  onLongPress,
  onMapPress,
  onMapCenterChanged,
  onNavigationFollowChange,
  onUserInteraction,
}: RouteMapProps) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const [hasError, setHasError] = useState(false);
  const prevGeoKeyRef = useRef("");
  const prevPanKeyRef = useRef(-1);
  const prevFitCandidateBoundsTokenRef = useRef(0);
  const prevVizUrlRef = useRef<string | null>(null);

  const callbacksRef = useRef({
    onMapPress,
    onLongPress,
    onSelectRoute,
    onSelectMarker,
    onFindSafeRoutes,
    onDismissMarkerDetails,
    onNavigationFollowChange,
    onUserInteraction,
    onMapCenterChanged,
  });
  callbacksRef.current = {
    onMapPress,
    onLongPress,
    onSelectRoute,
    onSelectMarker,
    onFindSafeRoutes,
    onDismissMarkerDetails,
    onNavigationFollowChange,
    onUserInteraction,
    onMapCenterChanged,
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
    showExtraDetail,
    safetyMarkers,
    routeSegments,
    roadLabels,
    routeLayers,
    routeBadges,
    panTo,
    fitCandidateBoundsToken,
    fitTopPadding,
    fitBottomPadding,
    fitSidePadding,
    candidateFitTopPadding,
    candidateFitBottomPadding,
    candidateFitSidePadding,
    isNavigating,
    navigationLocation,
    navigationHeading,
    highlightCategory,
    maxDistanceKm,
    friendMarkers,
    isInPipMode,
    outOfRangeCueSignal,
  });
  propsRef.current = {
    origin,
    destination,
    routes,
    selectedRouteId,
    showExtraDetail,
    safetyMarkers,
    routeSegments,
    roadLabels,
    routeLayers,
    routeBadges,
    panTo,
    fitCandidateBoundsToken,
    fitTopPadding,
    fitBottomPadding,
    fitSidePadding,
    candidateFitTopPadding,
    candidateFitBottomPadding,
    candidateFitSidePadding,
    isNavigating,
    navigationLocation,
    navigationHeading,
    highlightCategory,
    maxDistanceKm,
    friendMarkers,
    isInPipMode,
    outOfRangeCueSignal,
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
      id: m.id,
      kind: m.kind,
      label: m.label,
      pinColor: (m as any).pinColor,
      isSelected: Boolean((m as any).isSelected),
      popupTitle: (m as any).popupTitle,
      popupSubtitle: (m as any).popupSubtitle,
      popupMeta: (m as any).popupMeta,
      popupCoords: (m as any).popupCoords,
      popupButtonLabel: (m as any).popupButtonLabel,
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
    const geoChanged = geoKey !== prevGeoKeyRef.current;
    if (geoChanged) prevGeoKeyRef.current = geoKey;

    const fitCandidateBounds =
      (p.fitCandidateBoundsToken ?? 0) !== prevFitCandidateBoundsTokenRef.current;
    if (fitCandidateBounds) {
      prevFitCandidateBoundsTokenRef.current = p.fitCandidateBoundsToken ?? 0;
    }

    const hasExplicitFitTargets = Boolean(p.destination) || p.routes.length > 0;
    const fitBounds = fitCandidateBounds || (geoChanged && hasExplicitFitTargets);

    let panToData: { lat: number; lng: number } | null = null;
    if (p.panTo && p.panTo.key !== prevPanKeyRef.current) {
      prevPanKeyRef.current = p.panTo.key;
      panToData = toLL(p.panTo.location);
    }

    const payload = {
      origin: p.origin ? toLL(p.origin) : null,
      destination: p.destination ? toLL(p.destination) : null,
      routes: mappedRoutes,
      showExtraDetail: p.showExtraDetail ?? true,
      segments,
      safetyMarkers: mkrs,
      roadLabels: labels,
      routeLayers: p.routeLayers ?? null,
      routeBadges: (p.routeBadges ?? []).map((b) => ({
        routeId: b.routeId,
        lat: b.lat,
        lng: b.lng,
        text: b.text,
        selected: b.selected === true,
      })),
      fitBounds,
      fitCandidateBounds,
      fitTopPadding: p.fitTopPadding ?? 40,
      fitBottomPadding: p.fitBottomPadding ?? 40,
      fitSidePadding: p.fitSidePadding ?? 40,
      candidateFitTopPadding: p.candidateFitTopPadding ?? p.fitTopPadding ?? 40,
      candidateFitBottomPadding: p.candidateFitBottomPadding ?? p.fitBottomPadding ?? 40,
      candidateFitSidePadding: p.candidateFitSidePadding ?? p.fitSidePadding ?? 40,
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
      outOfRangeCueToken: p.outOfRangeCueSignal || 0,
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
          case "selectMarker":
            cbs.onSelectMarker?.(msg.id);
            break;
          case "findSafeRoutes":
            cbs.onFindSafeRoutes?.(msg.id);
            break;
          case "dismissMarkerDetails":
            cbs.onDismissMarkerDetails?.(msg.id);
            break;
          case "navFollowChanged":
            cbs.onNavigationFollowChange?.(Boolean(msg.isFollowing));
            break;
          case "userInteracted":
            cbs.onUserInteraction?.();
            break;
          case "mapCenterChanged":
            cbs.onMapCenterChanged?.({ latitude: msg.lat, longitude: msg.lng });
            break;
          case "styleError":
            setHasError(true);
            break;
        }
      } catch {
        /* ignore */
      }
    };

    // Only accept messages from our own map iframe (ignore other windows/origins).
    const onWindowMessage = (event: MessageEvent) => {
      if (
        !iframeRef.current?.contentWindow ||
        event.source !== iframeRef.current.contentWindow
      ) {
        return;
      }
      handler(event);
    };
    window.addEventListener("message", onWindowMessage);
    const custom = (e: Event) =>
      handler({ data: (e as CustomEvent).detail } as MessageEvent);
    window.addEventListener("leaflet-msg", custom);
    return () => {
      window.removeEventListener("message", onWindowMessage);
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
    showExtraDetail,
    safetyMarkers,
    routeSegments,
    roadLabels,
    routeLayers,
    routeBadges,
    panTo,
    isNavigating,
    navigationLocation,
    navigationHeading,
    highlightCategory,
    maxDistanceKm,
    friendMarkers,
    isInPipMode,
    outOfRangeCueSignal,
    fitCandidateBoundsToken,
    fitTopPadding,
    fitBottomPadding,
    fitSidePadding,
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

  const mapHtml = useMemo(() => buildLeafletHtml(showZoomControls), [showZoomControls]);

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
