/**
 * routes/directions.js — Proxy endpoint for OSRM (Open Source Routing Machine).
 *
 * OSRM is 100% free, no API key required, and provides identical functionality to Google Directions.
 * Supports walking, cycling, driving modes with alternative routes and full geometry.
 */

const express = require('express');
const {
  validateLatitude,
  validateLongitude,
} = require('../../shared/validation/validate');

const router = express.Router();

const OSRM_BASE = 'https://router.project-osrm.org/route/v1';

// ─── API call tracking ───────────────────────────────────────────────────────
let directionsApiCalls = 0;

// Map user modes to OSRM profiles
const getModeProfile = (mode) => {
  const modeMap = {
    walking: 'foot',
    driving: 'car',
    bicycling: 'bike',
    transit: 'foot', // Fall back to foot for transit (OSRM doesn't have public transit)
  };
  return modeMap[mode] || 'foot';
};

// ─── GET /api/directions ─────────────────────────────────────────────────────
// Query params: origin_lat, origin_lng, dest_lat, dest_lng, mode?, waypoints?
router.get('/', async (req, res) => {
  try {
    // Validate origin
    const oLat = validateLatitude(req.query.origin_lat);
    const oLng = validateLongitude(req.query.origin_lng);
    if (!oLat.valid) return res.status(400).json({ error: oLat.error });
    if (!oLng.valid) return res.status(400).json({ error: oLng.error });

    // Validate destination
    const dLat = validateLatitude(req.query.dest_lat);
    const dLng = validateLongitude(req.query.dest_lng);
    if (!dLat.valid) return res.status(400).json({ error: dLat.error });
    if (!dLng.valid) return res.status(400).json({ error: dLng.error });

    // Mode (default: walking)
    const allowedModes = ['walking', 'driving', 'bicycling', 'transit'];
    const mode = allowedModes.includes(req.query.mode) ? req.query.mode : 'walking';
    const profile = getModeProfile(mode);

    // Build OSRM URL: /route/v1/{profile}/{lon1},{lat1};{lon2},{lat2}
    // Note: OSRM uses longitude,latitude (opposite of typical lat,lng)
    let url = `${OSRM_BASE}/${profile}/${oLng.value},${oLat.value};${dLng.value},${dLat.value}?` +
      `alternatives=true&overview=full&geometries=polyline&steps=true`;

    // Optional waypoints — validate and add if provided
    if (req.query.waypoints) {
      const raw = req.query.waypoints;
      // Basic sanity: only allow digits, commas, pipes, periods, colons, minus, spaces
      if (/^[0-9.,|:\-\s]+$/i.test(raw) && raw.length < 2000) {
        // Parse waypoints and convert to OSRM format
        // Input format: "via:lat,lng|via:lat,lng" or "lat,lng|lat,lng"
        const waypointStrings = raw.split('|');
        const waypointsFormatted = waypointStrings.map((wp) => {
          const cleaned = wp.replace('via:', '').trim();
          const [lat, lng] = cleaned.split(',').map((c) => c.trim());
          // OSRM wants lng,lat
          return `${lng},${lat}`;
        }).join(';');
        
        // Insert waypoints into coordinate string
        const coords = url.split('?')[0];
        const base = coords.substring(0, coords.lastIndexOf(';'));
        const dest = coords.substring(coords.lastIndexOf(';'));
        url = `${base};${waypointsFormatted}${dest}?alternatives=true&overview=full&geometries=polyline&steps=true`;
      }
    }

    directionsApiCalls++;
    console.log(`[directions] 🌐 OSRM API call #${directionsApiCalls} → ${oLat.value},${oLng.value} → ${dLat.value},${dLng.value} mode=${mode} profile=${profile}${req.query.waypoints ? ' +waypoints' : ''}`);
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.code !== 'Ok') {
      console.error(`[directions] ❌ OSRM error: code=${data.code}, message="${data.message || 'none'}"`);
      return res.status(400).json({ 
        status: 'ZERO_RESULTS',
        error_message: data.message || 'No route found'
      });
    }

    // Transform OSRM response to match expected format (Google Directions style)
    const routes = (data.routes || []).slice(0, 5).map((route, idx) => {
      // Flatten steps from all legs
      const allLegs = route.legs || [];
      const transformedSteps = allLegs.flatMap((leg) =>
        (leg.steps || [])
          .filter((s) => s.maneuver) // skip depart/arrive without geometry
          .map((s) => {
            // Build a human-readable instruction from OSRM maneuver data
            const m = s.maneuver;
            let instruction = s.name ? s.name : '';
            const mod = m.modifier || '';
            const type = m.type || '';

            if (type === 'depart') {
              instruction = `Head ${mod || 'north'}${s.name ? ' on ' + s.name : ''}`;
            } else if (type === 'arrive') {
              instruction = 'Arrive at your destination';
            } else if (type === 'turn') {
              instruction = `Turn ${mod}${s.name ? ' onto ' + s.name : ''}`;
            } else if (type === 'new name' || type === 'continue') {
              instruction = `Continue${s.name ? ' on ' + s.name : ''}`;
            } else if (type === 'merge') {
              instruction = `Merge${s.name ? ' onto ' + s.name : ''}`;
            } else if (type === 'roundabout' || type === 'rotary') {
              const exit = m.exit ? ` and take exit ${m.exit}` : '';
              instruction = `Enter the roundabout${exit}${s.name ? ' onto ' + s.name : ''}`;
            } else if (type === 'fork') {
              instruction = `Take the ${mod || 'right'} fork${s.name ? ' onto ' + s.name : ''}`;
            } else if (type === 'end of road') {
              instruction = `At the end of the road, turn ${mod || 'right'}${s.name ? ' onto ' + s.name : ''}`;
            } else {
              instruction = `${type}${mod ? ' ' + mod : ''}${s.name ? ' — ' + s.name : ''}`;
            }

            // Map OSRM maneuver type+modifier to Google-style maneuver strings
            let maneuver;
            if (mod.includes('left') && type === 'turn') maneuver = mod.includes('slight') ? 'turn-slight-left' : mod.includes('sharp') ? 'turn-sharp-left' : 'turn-left';
            else if (mod.includes('right') && type === 'turn') maneuver = mod.includes('slight') ? 'turn-slight-right' : mod.includes('sharp') ? 'turn-sharp-right' : 'turn-right';
            else if (type === 'roundabout') maneuver = 'roundabout-right';
            else if (mod === 'uturn') maneuver = 'uturn-left';
            else maneuver = 'straight';

            // OSRM intersection locations: start = first, end = last
            const startLoc = m.location; // [lng, lat]
            const intersections = s.intersections || [];
            const endIntersection = intersections.length > 0 ? intersections[intersections.length - 1] : null;
            const endLoc = endIntersection ? endIntersection.location : startLoc;

            return {
              html_instructions: instruction,
              distance: { value: Math.round(s.distance || 0) },
              duration: { value: Math.round(s.duration || 0) },
              start_location: { lat: startLoc[1], lng: startLoc[0] },
              end_location: { lat: endLoc[1], lng: endLoc[0] },
              maneuver,
            };
          })
      );

      return {
        legs: [{
          distance: { text: `${(route.distance / 1609.344).toFixed(1)} mi`, value: route.distance },
          duration: { text: `${Math.round(route.duration / 60)} mins`, value: Math.round(route.duration) },
          end_location: { lat: dLat.value, lng: dLng.value },
          start_location: { lat: oLat.value, lng: oLng.value },
          steps: transformedSteps,
        }],
        overview_polyline: { points: route.geometry },
        summary: `Route ${idx + 1}`,
      };
    });

    console.log(`[directions] 📦 Response: ${routes.length} routes, primary: ${(routes[0]?.legs[0]?.distance?.text || 'N/A')}`);

    res.json({
      status: 'OK',
      routes,
    });
  } catch (err) {
    console.error('[directions] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
