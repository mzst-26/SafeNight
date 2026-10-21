/**
 * Worst-stretch highlight for the AI Insights "show findings" action (H5).
 *
 * The web (Leaflet) and native (MapLibre) pages draw only the part of a route between the two
 * ends of its worst stretch, with the stretch's callout. The functions below are plain JS with no
 * DOM and no map, so both pages can embed them. Their TS-side counterpart, worstStretchForMap,
 * reads the stretch from a route the map was given.
 *
 * Standalone: needs nothing from CORE_JS.
 */

import type { DirectionsRoute } from '@/src/types/geo';

export interface StretchPoint {
  lat: number;
  lng: number;
}

export interface MapWorstStretch {
  start: StretchPoint;
  end: StretchPoint;
  lengthM: number;
  cause: string | null;
}

export const STRETCH_HIGHLIGHT_JS = `
    /* ── Worst-stretch highlight (inline/stretchHighlight.ts) ── */
    function rlValidLatLng(p){
      return !!p && typeof p.lat==='number' && typeof p.lng==='number' && isFinite(p.lat) && isFinite(p.lng);
    }

    /* The point on the path nearest to p: { i: segment index, t: 0..1 along it, lat, lng, d: squared distance }.
       Planar approximation with longitude scaled by the cosine of p's latitude; fine over a walking route. */
    function rlNearestOnPath(path, p){
      var k=Math.cos(p.lat*Math.PI/180), best=null;
      for(var i=0;i<path.length-1;i++){
        var a=path[i], b=path[i+1];
        var ax=a.lng*k, ay=a.lat, dx=b.lng*k-ax, dy=b.lat-ay;
        var len2=dx*dx+dy*dy;
        var t=len2>0 ? ((p.lng*k-ax)*dx+(p.lat-ay)*dy)/len2 : 0;
        t=Math.max(0, Math.min(1, t));
        var ex=p.lng*k-(ax+t*dx), ey=p.lat-(ay+t*dy), d=ex*ex+ey*ey;
        if(!best || d<best.d){
          best={ i:i, t:t, lat:a.lat+t*(b.lat-a.lat), lng:a.lng+t*(b.lng-a.lng), d:d };
        }
      }
      return best;
    }

    /* The part of a route line between the two ends of its worst stretch, as { lat, lng } points in route order.
       Both ends are exact points on the line; the route's own vertices lie between them. Empty when the line has
       fewer than two valid points, an end is invalid, or both ends are the same spot. */
    function rlStretchPath(path, start, end){
      var pts=(path||[]).filter(rlValidLatLng);
      if(pts.length<2 || !rlValidLatLng(start) || !rlValidLatLng(end)) return [];
      var a=rlNearestOnPath(pts, start), b=rlNearestOnPath(pts, end);
      if(!a || !b) return [];
      if(a.i===b.i && a.t===b.t) return [];
      var lo=a, hi=b;
      if(b.i+b.t < a.i+a.t){ lo=b; hi=a; }
      var out=[{ lat:lo.lat, lng:lo.lng }];
      for(var k=lo.i+1;k<=hi.i;k++) out.push({ lat:pts[k].lat, lng:pts[k].lng });
      out.push({ lat:hi.lat, lng:hi.lng });
      return out;
    }

    /* The point halfway along a line, by length (where the callout sits). Null for an empty line. */
    function rlPathHalfway(pts){
      if(!pts || !pts.length) return null;
      var k=Math.cos(pts[0].lat*Math.PI/180), total=0, lens=[];
      for(var i=0;i<pts.length-1;i++){
        var dx=(pts[i+1].lng-pts[i].lng)*k, dy=pts[i+1].lat-pts[i].lat;
        var l=Math.sqrt(dx*dx+dy*dy);
        lens.push(l); total+=l;
      }
      if(total<=0) return { lat:pts[0].lat, lng:pts[0].lng };
      var target=total/2, acc=0;
      for(var j=0;j<lens.length;j++){
        if(acc+lens[j]>=target){
          var t=lens[j]>0 ? (target-acc)/lens[j] : 0;
          return { lat:pts[j].lat+t*(pts[j+1].lat-pts[j].lat), lng:pts[j].lng+t*(pts[j+1].lng-pts[j].lng) };
        }
        acc+=lens[j];
      }
      return { lat:pts[pts.length-1].lat, lng:pts[pts.length-1].lng };
    }

    /* Callout text for a worst stretch. Same wording as buildCallouts in routeLayers.ts. */
    function rlStretchCalloutText(stretch){
      var label = stretch.cause==='lighting' ? 'Unlit stretch' : 'High-risk stretch';
      return label+' · '+Math.round(stretch.lengthM)+' m';
    }
`;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The worst stretch of a route as the map needs it, read from the route's safety data. Routes
 * without a stretch (or without safety data) give null. Only lat/lng are kept from each end.
 */
export function worstStretchForMap(route: DirectionsRoute): MapWorstStretch | null {
  // Routes from the safety pipeline carry `safety` at runtime; DirectionsRoute does not declare it.
  const safety = (route as { safety?: { worstStretch?: unknown } | null }).safety;
  const stretch = safety?.worstStretch as
    | { start?: StretchPoint; end?: StretchPoint; lengthM?: unknown; cause?: unknown }
    | null
    | undefined;
  if (!stretch?.start || !stretch.end || !isFiniteNumber(stretch.lengthM)) return null;
  return {
    start: { lat: stretch.start.lat, lng: stretch.start.lng },
    end: { lat: stretch.end.lat, lng: stretch.end.lng },
    lengthM: stretch.lengthM,
    cause: typeof stretch.cause === 'string' ? stretch.cause : null,
  };
}
