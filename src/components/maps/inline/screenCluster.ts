/**
 * Shared screen-space helpers for the route overlay badges: merging crime clusters that
 * would overlap on screen, and nudging score pills off each other and off the badges. Pill displacement is capped at one touch
 * target, so separation is best effort: centres are NOT guaranteed minPx apart when the cap is hit.
 *
 * Both are pure plain-JS functions (no DOM, no map): the renderer passes its own projection
 * (Leaflet map.latLngToContainerPoint, MapLibre map.project) and applies the result. They
 * work in screen pixels, so the outcome depends on the zoom and is recomputed when it changes.
 *
 * Standalone: needs nothing from CORE_JS.
 */
export const SCREEN_CLUSTER_JS = `
    /* ── Shared screen-space helpers (inline/screenCluster.ts) ── */
    /* Counts are clamped so merged sums (and weighted means) stay finite. */
    var RL_SC_MAX_COUNT = 1e9;
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
        if(!c || !rlScNum(c.lat) || !rlScNum(c.lng) || !(c.count>=1)) continue;
        var pt=null;
        try{ pt=project(c.lat, c.lng); }catch(e){ pt=null; }
        var ok=!!pt && rlScNum(pt.x) && rlScNum(pt.y);
        items.push({ idx:i, lat:c.lat, lng:c.lng, x:ok?pt.x:0, y:ok?pt.y:0, count:Math.min(Math.floor(c.count), RL_SC_MAX_COUNT),
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

    function rlScValidObstacles(obstacles){
      var list=[];
      if(!Array.isArray(obstacles)) return list;
      for(var i=0;i<obstacles.length;i++){
        var o=obstacles[i];
        if(o && rlScNum(o.x) && rlScNum(o.y) && rlScNum(o.r) && o.r>0) list.push(o);
      }
      return list;
    }

    /* Number of overlaps of one pill (touch square of side gap) with the badge circles. */
    function rlScCircleHits(x, y, gap, obstacles){
      var n=0, half=gap/2;
      for(var i=0;i<obstacles.length;i++){
        var dx=Math.max(Math.abs(x-obstacles[i].x)-half, 0);
        var dy=Math.max(Math.abs(y-obstacles[i].y)-half, 0);
        if(dx*dx+dy*dy < obstacles[i].r*obstacles[i].r) n++;
      }
      return n;
    }

    function rlScUnusable(p, gap){
      return !p || !rlScNum(p.x) || !rlScNum(p.y) || !(gap>0) || !isFinite(gap);
    }

    /*
     * Greedy pass (used beyond four pills, and the baseline the exhaustive search must beat).
     * Each pill in input order is moved vertically, never more than gap, to the nearest spot with
     * the fewest overlaps against pills placed before it and against the badge circles.
     */
    function separatePillsGreedy(points, minPx, obstacles){
      var out=[];
      if(!Array.isArray(points)) return out;
      var gap=Number(minPx);
      var circles=rlScValidObstacles(obstacles);
      var placed=[];
      function hits(x, y){
        var n=rlScCircleHits(x, y, gap, circles);
        for(var q=0;q<placed.length;q++){
          if(Math.abs(x-placed[q].x)<gap && Math.abs(y-placed[q].y)<gap) n++;
        }
        return n;
      }
      for(var i=0;i<points.length;i++){
        var p=points[i];
        if(rlScUnusable(p, gap)){
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
          for(var m=0;m<circles.length;m++){
            candidates.push(circles[m].y+gap/2+circles[m].r);
            candidates.push(circles[m].y-gap/2-circles[m].r);
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

    /*
     * Keeps score-pill touch targets (squares of minPx) from overlapping each other and from covering
     * the crime badges (obstacles: [{ x, y, r }] circles, in the same pixel space). Pills are the
     * ones that move: vertically, never more than minPx (so the result is best effort, not a guarantee).
     * points are { x, y, priority? } in draw order; a priority pill (the selected route) is displaced
     * least. Up to four pills are solved exhaustively over shifts {-gap, -gap/2, 0, gap/2, gap} (the greedy
     * result is the incumbent): fewest overlaps first, then the priority pills' displacement, then the
     * total displacement. More pills use separatePillsGreedy. Returns { x, y, dy } per point, dy being the vertical shift.
     */
    function separatePills(points, minPx, obstacles){
      if(!Array.isArray(points)) return [];
      var gap=Number(minPx);
      var circles=rlScValidObstacles(obstacles);
      var idx=[];
      for(var i=0;i<points.length;i++){
        if(!rlScUnusable(points[i], gap)) idx.push(i);
      }
      if(idx.length>4 || idx.length===0) return separatePillsGreedy(points, minPx, obstacles);
      var steps=[0, gap/2, -gap/2, gap, -gap];
      var cur=[], best=null, bestCost=null;
      function cost(){
        var overlaps=0, prio=0, total=0;
        for(var a=0;a<idx.length;a++){
          var pa=points[idx[a]], ya=pa.y+cur[a];
          overlaps+=rlScCircleHits(pa.x, ya, gap, circles);
          for(var b=a+1;b<idx.length;b++){
            var pb=points[idx[b]];
            if(Math.abs(pa.x-pb.x)<gap && Math.abs(ya-(pb.y+cur[b]))<gap) overlaps++;
          }
          total+=Math.abs(cur[a]);
          if(pa.priority) prio+=Math.abs(cur[a]);
        }
        return [overlaps, prio, total];
      }
      function search(depth){
        if(depth===idx.length){
          var c=cost();
          if(!bestCost || c[0]<bestCost[0] || (c[0]===bestCost[0] && (c[1]<bestCost[1] || (c[1]===bestCost[1] && c[2]<bestCost[2])))){
            bestCost=c; best=cur.slice();
          }
          return;
        }
        for(var s=0;s<steps.length;s++){ cur[depth]=steps[s]; search(depth+1); }
      }
      /* The greedy result may sit off the shift grid; it is the incumbent the grid search must strictly beat. */
      var greedy=separatePillsGreedy(points, minPx, obstacles);
      for(var g=0;g<idx.length;g++) cur[g]=greedy[idx[g]].dy;
      bestCost=cost(); best=cur.slice();
      search(0);
      var out=[];
      for(var k=0;k<points.length;k++){
        var pos=idx.indexOf(k);
        var dy=pos>=0 ? best[pos] : 0;
        var q=points[k];
        out.push({ x:q?q.x:undefined, y:q?q.y+dy:undefined, dy:dy });
      }
      return out;
    }
`;
