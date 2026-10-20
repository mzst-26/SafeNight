/**
 * Shared screen-space helpers for the route overlay badges: merging crime clusters that
 * would overlap on screen, and nudging score pills apart so their touch targets never overlap.
 *
 * Both are pure plain-JS functions (no DOM, no map): the renderer passes its own projection
 * (Leaflet map.latLngToContainerPoint, MapLibre map.project) and applies the result. They
 * work in screen pixels, so the outcome depends on the zoom and is recomputed when it changes.
 *
 * Standalone: needs nothing from CORE_JS.
 */
export const SCREEN_CLUSTER_JS = `
    /* ── Shared screen-space helpers (inline/screenCluster.ts) ── */
    function rlScNum(v){ return typeof v==='number' && isFinite(v); }

    /* One merged cluster: counts summed, severity max, position the count-weighted mean (lat/lng and pixels). */
    function rlScCombine(group){
      if(group.length===1) return group[0];
      var total=0, lat=0, lng=0, x=0, y=0, sev=0, idx=group[0].idx;
      for(var i=0;i<group.length;i++){
        var g=group[i];
        total+=g.count;
        lat+=g.lat*g.count; lng+=g.lng*g.count; x+=g.x*g.count; y+=g.y*g.count;
        if(g.sev>sev) sev=g.sev;
        if(g.idx<idx) idx=g.idx;
      }
      return { idx:idx, lat:lat/total, lng:lng/total, x:x/total, y:y/total, count:total, sev:sev, fixed:false };
    }

    /*
     * Greedy screen-space merge. Clusters are visited highest count first (ties: lat, lng, then
     * input order); each one absorbs every not yet used cluster whose projected centre is closer
     * than minPx to its own. Passes repeat on the merged result until every remaining pair is at
     * least minPx apart. Input is not mutated; the output keeps the input order (by earliest member)
     * and holds { lat, lng, count, maxSeverity }. A cluster whose projection fails is never merged.
     */
    function mergeScreenClusters(clusters, project, minPx){
      var out=[];
      if(!Array.isArray(clusters)) return out;
      var limit=Number(minPx);
      var items=[];
      for(var i=0;i<clusters.length;i++){
        var c=clusters[i];
        if(!c || !rlScNum(c.lat) || !rlScNum(c.lng) || !rlScNum(c.count) || c.count<1) continue;
        var pt=null;
        try{ pt=project(c.lat, c.lng); }catch(e){ pt=null; }
        var ok=!!pt && rlScNum(pt.x) && rlScNum(pt.y);
        items.push({ idx:i, lat:c.lat, lng:c.lng, x:ok?pt.x:0, y:ok?pt.y:0, count:Math.floor(c.count),
          sev:rlScNum(c.maxSeverity)?c.maxSeverity:0, fixed:!ok });
      }
      var again = isFinite(limit) && limit>0;
      while(again){
        again=false;
        items.sort(function(a,b){ return (b.count-a.count) || (a.lat-b.lat) || (a.lng-b.lng) || (a.idx-b.idx); });
        var used=[];
        var next=[];
        for(var a=0;a<items.length;a++){
          if(used[a]) continue;
          used[a]=true;
          var seed=items[a];
          var group=[seed];
          if(!seed.fixed){
            for(var b=a+1;b<items.length;b++){
              if(used[b] || items[b].fixed) continue;
              var dx=items[b].x-seed.x, dy=items[b].y-seed.y;
              if(Math.sqrt(dx*dx+dy*dy)<limit){ used[b]=true; group.push(items[b]); }
            }
          }
          if(group.length>1) again=true;
          next.push(rlScCombine(group));
        }
        items=next;
      }
      items.sort(function(a,b){ return a.idx-b.idx; });
      for(var k=0;k<items.length;k++){
        out.push({ lat:items[k].lat, lng:items[k].lng, count:items[k].count, maxSeverity:items[k].sev });
      }
      return out;
    }

    /*
     * Keeps score-pill touch targets (squares of minPx) from overlapping. points are { x, y } pixel
     * centres in draw order. A later pill that overlaps an earlier one is moved vertically, never
     * more than minPx, to the nearest spot that clears every pill placed before it (so the centres
     * end up at least minPx apart). Returns { x, y, dy } per point, dy being the vertical shift.
     */
    function separatePills(points, minPx){
      var out=[];
      if(!Array.isArray(points)) return out;
      var gap=Number(minPx);
      var placed=[];
      function hits(x, y){
        var n=0;
        for(var q=0;q<placed.length;q++){
          if(Math.abs(x-placed[q].x)<gap && Math.abs(y-placed[q].y)<gap) n++;
        }
        return n;
      }
      for(var i=0;i<points.length;i++){
        var p=points[i];
        if(!p || !rlScNum(p.x) || !rlScNum(p.y) || !(gap>0)){
          out.push({ x:p?p.x:undefined, y:p?p.y:undefined, dy:0 });
          continue;
        }
        var best=p.y, bestHits=hits(p.x, p.y);
        if(bestHits>0){
          var candidates=[];
          for(var j=0;j<placed.length;j++){
            if(Math.abs(p.x-placed[j].x)<gap){
              candidates.push(placed[j].y+gap);
              candidates.push(placed[j].y-gap);
            }
          }
          for(var k=0;k<candidates.length;k++){
            var cy=candidates[k];
            if(Math.abs(cy-p.y)>gap) continue;
            var h=hits(p.x, cy);
            var better = h<bestHits
              || (h===bestHits && Math.abs(cy-p.y)<Math.abs(best-p.y))
              || (h===bestHits && Math.abs(cy-p.y)===Math.abs(best-p.y) && cy>best);
            if(better){ best=cy; bestHits=h; }
          }
        }
        placed.push({ x:p.x, y:best });
        out.push({ x:p.x, y:best, dy:best-p.y });
      }
      return out;
    }
`;
