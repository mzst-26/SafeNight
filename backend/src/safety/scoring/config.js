/**
 * Tunable constants for the safety scoring model (spec section 11).
 * Every scoring tunable lives here so the rationale sits next to the number.
 * The one exception is the per-category crime severity table, which is data and
 * lives in services/crimeSeverity.js.
 *
 * Sections: factor weights and priors (top), lighting, crime and darkness models, route ranking,
 * then the graph builder (road scores, edge evidence, cells, radii, penalties) and the path search.
 */

// Floor on a factor's safety before taking its log: one factor at 0 bounds edge risk below 1.
const MIN_FACTOR_SAFETY = 0.05;

// Base weights per factor, before the darkness gate and level renormalisation. Sum to 1.
const BASE_WEIGHTS = Object.freeze({
  // Darkness is the main night-time hazard; scaled by darkness so daylight routes ignore it. Was 0.30: with the
  // lighting estimate no longer shrunk by 4 (LIGHTING.SHRINK_PSEUDO_COUNT) it spans a wider range, so the weight
  // can fall a little and the calibration archetypes still land in range (scripts/eval/calibration-table.js).
  lighting: 0.28,
  // Recent crime is the other direct harm signal, but cells are coarse (500 m, 12 months), so it sits just below lighting.
  crime: 0.25,
  // Road class only; dead-end and footpath effects moved to isolation, so this drops from the old 0.22-0.25.
  road: 0.15,
  // Open places, CCTV and transit merged; matches the old CCTV+openPlaces weight (0.15-0.19) with transit folded in.
  // Was 0.18: raised to 0.20 so a quiet street (nothing open nearby at night) sits clearly below a busy one, which
  // keeps unmapped residential (C) and the crime hotspot (G) under their calibration ceilings.
  activity: 0.2,
  // New factor (dead ends, footpath through nothing); weakest evidence, so the smallest weight.
  isolation: 0.12,
});

// Neutral prior safety for a factor with no data (null safety). It is used with n = 0, so it
// carries no evidence, but it still counts in the blend: missing data is never silently good.
// Each prior is at or below 0.6, so an unknown factor never reads as clearly safe (0.95 and up).
const PRIOR_SAFETY = Object.freeze({
  // No evidence either way; the tag-based lighting prior is also centred on 0.5.
  lighting: 0.5,
  // Most streets have modest recorded crime, so the prior leans slightly safe but stays cautious.
  crime: 0.6,
  // Road class alone does not establish safety, so the prior sits at the mid-point.
  road: 0.5,
  // Below the mid-point: at night, unmapped activity more often means a quiet street, so the cautious case is assumed.
  activity: 0.4,
  // Most streets are not dead ends or isolated footpaths, so the prior is mildly safe.
  isolation: 0.6,
});

// Prudent uncertainty load (edgeRisk): final risk = risk + UNCERTAINTY_RISK_LOAD * (1 - certainty) * (1 - risk).
// We price what we do not know: an edge whose factors rest on priors instead of evidence (an unmapped residential
// street with no lamp data, say) must read visibly riskier than the same estimate backed by a surveyed tag or lamps.
// The (1 - risk) factor keeps the result inside [0, 1] and leaves a risk of 1 at 1; (1 - certainty) makes the load
// vanish for fully evidenced edges. Started at 0.15, which gave an A-C (lit vs unmapped residential) gap of only
// 7 points at night; 0.23 gives 8 (A 68, C 60) with C still Safe and every other archetype inside its range
// (scripts/eval/calibration-table.js). Higher (0.30) pushes A below its 68 floor.
const UNCERTAINTY_RISK_LOAD = 0.23;

// A route edge counts as "poor" when its risk reaches this level (used for worstStretch reporting).
const RISK_POOR_THRESHOLD = 0.6;

// dominantCause is only reported when edge risk reaches this level, so safe edges carry no cause.
const CAUSE_MIN_RISK = 0.1;

// Blend between mean edge risk and the cube-mean (M3) in route aggregation; higher favours worst stretches.
const CUBE_MEAN_BLEND = 0.4;

// Evidence strength: an estimate with n = EVIDENCE_PSEUDO_COUNT counts as half-certain.
// Used by edge risk and lighting alike, through evidence.js.
const EVIDENCE_PSEUDO_COUNT = 4;

// Crime risk (empirical-Bayes shrinkage towards an area prior). Units are in crimes, km and months.
const CRIME = Object.freeze({
  // Recency: a crime one half-life old counts half as much. Four months keeps the latest few months dominant within a 12-month window.
  HALF_LIFE_MONTHS: 4,
  // Prior weight k in km-equivalents: 2 km of local exposure carries as much weight as the area prior.
  PRIOR_STRENGTH: 2,
  // Weighted crimes per km that map to a risk of 1 - e^-1 (~0.63). Was 6: 20 violent crimes in a 500 m cell with
  // about 2.5 km of mapped road is 4.4 per km, which reads 53% risk at 6 and 67% at 4 (hotspot target). Confirm on real data via the eval backtest.
  RATE_SCALE: 4,
  // Severity for a category missing from the table. Middling, so unrecognised data is neither ignored nor alarming.
  SEVERITY_FALLBACK: 0.4,
  // Non-violent crime is divided by (1 + FOOTFALL_K * P)^FOOTFALL_BETA where P is presence: busy places record more
  // petty crime because more people (and shops) are there, not because walking is more dangerous. Violent crime,
  // robbery, sexual offences, theft from the person and weapons are never discounted.
  FOOTFALL_K: 2,
  FOOTFALL_BETA: 0.5,
  // Guardian bonus: crime risk multiplied by (1 - g), g = min(GUARDIAN_MAX, CCTV * n_cctv_80m + VENUE * n_open_80m).
  GUARDIAN_CCTV: 0.03,
  GUARDIAN_VENUE: 0.02,
  GUARDIAN_MAX: 0.15,
  // Pedestrian-relevance fallback for a category missing from the table (services/crimeSeverity.js).
  RELEVANCE_FALLBACK: 0.4,
});

// Darkness: a smoothstep over solar elevation in degrees, 0 in daylight and 1 at full night.
const DARKNESS = Object.freeze({
  // Elevation at which darkness starts (civil dusk): 6 deg above the horizon is daylit.
  START_DEG: 6,
  // Elevation at which darkness is complete (end of civil twilight): 6 deg below the horizon.
  FULL_DEG: -6,
});

// Lighting inference: P(lit) estimates from tags, lamps and mapping completeness.
const LIGHTING = Object.freeze({
  // Neutral P(lit) that effectiveLit shrinks towards: 0.5 is "no idea".
  NEUTRAL_LIT: 0.5,

  // Pseudo-count of neutral evidence in effectiveLit: (pLit*n + 0.5*c) / (n + c). Lighting only; the
  // certainty weight (EVIDENCE_PSEUDO_COUNT, 4) is separate. The priors below are already shrunk towards 0.5
  // and use a small n, so shrinking again by 4 double-counts the caution: in the Plymouth backtest it made
  // the estimate worse than the road-class rate (Brier .139 vs .121, AUC .79 vs .82) while the raw pLit was on
  // par. At 1 the estimate beats it (see scripts/eval/README.md). Explicit tags still dominate (n = 20).
  SHRINK_PSEUDO_COUNT: 1,

  // Explicit OSM lit tags are surveyed, so they carry strong evidence (n = 20).
  // 'limited' and 'automatic' are conditional, so they stay at 0.5 with less weight (n = 10).
  EXPLICIT: Object.freeze({
    yes: Object.freeze({ pLit: 0.95, n: 20 }),
    '24/7': Object.freeze({ pLit: 0.95, n: 20 }),
    no: Object.freeze({ pLit: 0.05, n: 20 }),
    limited: Object.freeze({ pLit: 0.5, n: 10 }),
    automatic: Object.freeze({ pLit: 0.5, n: 10 }),
  }),

  // Street-lamp evidence within LAMP_RADIUS_M of the segment.
  LAMP: Object.freeze({
    // One lamp within LAMP_RADIUS_M is a strong sign the segment is lit; the one-lamp level, not the many-lamp level.
    PLIT_ONE: 0.85,
    // Three or more lamps indicate a well-lit stretch.
    PLIT_MANY: 0.92,
    MANY_THRESHOLD: 3,
    // Evidence added to n when lamps are found.
    EVIDENCE_N: 6,
  }),

  // A lit=yes way vertex within LAMP_RADIUS_M of the segment (a neighbouring way is tagged lit). This is
  // evidence from a mapper's tag, not a lamp: it says the street next door is lit, so it is weaker than a lamp.
  NEIGHBOUR_LIT: Object.freeze({
    // Same floor as one lamp: a tagged-lit neighbour makes lit likely, but it never reaches the many-lamp level.
    PLIT: 0.85,
    // Half the lamp evidence (LAMP.EVIDENCE_N = 6): the tag may describe the neighbour, not this segment.
    EVIDENCE_N: 3,
  }),

  // Absence of lamps is informative only for isolated paths (not roads), and only where lamps are mapped nearby.
  // On roads it points the wrong way: Plymouth backtest, ways with no mapped lamp within 30 m are still ~82% lit,
  // because lamps are sparsely mapped. On a path with no road beside it, a lamp-free surrounding is real information.
  ABSENCE: Object.freeze({
    // Below this density the area's lamp mapping is too sparse for a missing lamp to mean anything.
    MIN_LAMP_DENSITY_PER_KM: 2,
    // Need enough mapped road in the area to judge.
    MIN_AREA_WAY_KM: 0.3,
    // A densely lamped area with no lamp here lowers an isolated path's P(lit) to 60% of its prior.
    PLIT_FACTOR: 0.6,
    // Evidence added to n for an informative absence.
    EVIDENCE_N: 3,
  }),

  // A footway, cycleway, steps or pedestrian way within SIDEWALK_RADIUS_M of a road is treated as that road's
  // sidewalk: Plymouth backtest, such ways are mostly lit because the road beside them is. Roads here are
  // trunk to service; footway-like and path classes never count as the road.
  SIDEWALK_RADIUS_M: 25,

  // Way-level sidewalk test (roadProximity.classifyWayContext). A footway is a sidewalk only when it runs ALONG a
  // street for most of the OSM way, not when one sample point happens to be near a road: a path that merely ends at
  // a street, or a footbridge over a trunk road with a lane under one end, is not lit by that road.
  WAY_CONTEXT: Object.freeze({
    // Share of the way's sample points (every 10 m) that must be within SIDEWALK_RADIUS_M of a qualifying street.
    MIN_ALONGSIDE_FRACTION: 0.6,
    // Angle (degrees, 0 to 90) above which a path meets its nearest street crosswise: crossing, not alongside.
    // 60 leaves room for kerb-side paths that wobble or curve away, but excludes anything closer to square than to parallel.
    MAX_PARALLEL_ANGLE_DEG: 60,
    // Ways shorter than this are links to a street (a 25 m path joining a cul-de-sac to a road): they end at the
    // street by nature, so the parallel test is skipped; the proximity fraction still applies.
    SHORT_LINK_M: 40,
    // A path within this distance of a motorway/trunk (and crossing it) is a crossing structure. Mapped bridges rarely
    // share a node with the road underneath, so the test is geometric intersection OR (this close AND crossing bearing).
    CROSSING_NEAR_M: 15,
    // Bearing difference (degrees) above which a path near a barrier road counts as crossing rather than running beside it.
    CROSSING_MIN_ANGLE_DEG: 60,
    // A way tagged bridge=yes within BRIDGE_NEAR_M of a barrier road at more than BRIDGE_MIN_ANGLE_DEG is crossing it
    // (the road runs below). Looser than the untagged test because the tag says the way passes over something.
    BRIDGE_NEAR_M: 25,
    BRIDGE_MIN_ANGLE_DEG: 30,
  }),

  // Tag-based priors by road class and speed, used when there is no explicit lit tag. Road-class priors are the
  // Plymouth backtest lit rates shrunk towards 0.5 (about observed * 0.9 + 0.05) with small n, because the
  // labelled sample is the 42% of ways a mapper chose to tag and untagged streets are probably less lit.
  PRIOR: Object.freeze({
    // path, track and bridleway: mostly unlit (observed path .19, track .02).
    PATH: Object.freeze({ pLit: 0.12, n: 3 }),
    // Footway-like way within SIDEWALK_RADIUS_M of a road. Observed lit rate near a road: footway .65, steps .61,
    // cycleway .87, pedestrian .95 (pooled about .68), well above the same classes far from a road. The pooled
    // rate is shrunk only slightly: a prior of .88 (the road rate) was too high for footways and steps.
    SIDEWALK_NEAR_ROAD: Object.freeze({ pLit: 0.72, n: 3 }),
    // Footway-like way with no road nearby: a park or woodland path. Observed: footway .36, steps .43, cycleway .64
    // (pooled about .41, tagged ways only). Held below that because untagged park paths are likely darker.
    SIDEWALK_ISOLATED: Object.freeze({ pLit: 0.33, n: 3 }),
    // Footway-like way when the caller has no geometry: the observed pooled rate (footway .54, steps .55), weak.
    SIDEWALK_UNKNOWN: Object.freeze({ pLit: 0.5, n: 2 }),
    // Footway-like way that crosses a motorway/trunk (footbridge, underpass, ramp): usually wooded or fenced and
    // outside the lit street frontage, and the trunk's own lighting does not reach the structure. Dark and
    // unobserved, so a low prior with n 3. Slightly under the isolated-path prior (0.33): the owner-reported
    // Plymouth A38 footbridge was dark and wooded. An explicit lit tag still wins.
    CROSSING_STRUCTURE: Object.freeze({ pLit: 0.3, n: 3 }),
    // Trunk, primary and secondary roads (observed .89 to .98); one shared value, so trunk (.89) sets it.
    MAJOR: Object.freeze({ pLit: 0.9, n: 4 }),
    // An urban speed limit (at most URBAN_SPEED_MAX_KMH) implies street lighting (30 mph ways are ~95% lit).
    URBAN_SPEED: Object.freeze({ pLit: 0.9, n: 4 }),
    // Residential roads with a sidewalk (observed residential .97).
    RESIDENTIAL_SIDEWALK: Object.freeze({ pLit: 0.9, n: 4 }),
    // Residential roads without sidewalk information: same class rate, a little less certain.
    RESIDENTIAL: Object.freeze({ pLit: 0.88, n: 3 }),
    // Tertiary roads (observed .98).
    TERTIARY: Object.freeze({ pLit: 0.9, n: 3 }),
    // Service roads are often private and sometimes unlit (observed .68).
    SERVICE: Object.freeze({ pLit: 0.62, n: 3 }),
    // Unclassified roads (observed .77) and anything else with no class information.
    UNKNOWN: Object.freeze({ pLit: 0.72, n: 3 }),
  }),

  // An OSM maxspeed at or under this (km/h) counts as urban, which implies lit streets.
  URBAN_SPEED_MAX_KMH: 50,
  // Converts an mph maxspeed to km/h.
  MPH_TO_KMH: 1.609344,
  // Named maxspeed values with a fixed speed. GB:urban is the UK built-up limit: 30 mph, about 48 km/h.
  NAMED_MAXSPEED_KMH: Object.freeze({ 'gb:urban': 48 }),
});


// ── Presence, remoteness and crime vs footfall (spec section 12) ─────────────

// Presence index P(hour, x) in [0, 1]: how likely a passer-by or open premises is near a point at this hour.
// P = clamp01(B(class) * (0.35 + 0.65 * L) * H(hour, type) + LATE). Replaces the old global night discount.
const PRESENCE = Object.freeze({
  // B: base footfall by settlement class (population bands in the gazetteer): a metropolis street stays populated
  // at 23:00, a village street does not. Ratios roughly follow ordinary night-time pedestrian counts.
  CLASS_BASE: Object.freeze({
    metropolis: 1.0, city: 0.7, largeTown: 0.5, town: 0.35, village: 0.15, rural: 0.08,
  }),
  // L = log10(1 + venues) / log10(1 + VENUE_SATURATION): food and drink venues within 1 km, saturating at 200.
  VENUE_SATURATION: 200,
  VENUE_RADIUS_M: 1000,
  // OSM amenity values that count as food and drink venues. Counted whether or not open at the build hour: they
  // describe what kind of place this is; the hour curve and LATE describe who is there now.
  VENUE_AMENITIES: Object.freeze(['pub', 'bar', 'restaurant', 'cafe', 'fast_food', 'nightclub', 'biergarten', 'food_court', 'ice_cream']),
  // Venue counts and settlement class are looked up per cell of this size (degrees, ~550 m) and cached, so the cost
  // is O(cells + venues), not O(edges * venues).
  CELL_DEG: 0.005,
  // Settlement class is looked up per cell of this size (degrees, ~1 km) and cached.
  SETTLEMENT_CELL_DEG: 0.01,
  // Class assumed when the gazetteer is unavailable: the calibration scenes and Plymouth are 'city'.
  DEFAULT_CLASS: 'city',
  // 0.35 of the base survives with no venues at all (people live and walk there); the other 0.65 scales with L.
  VENUE_FLOOR: 0.35,
  VENUE_SPAN: 0.65,
  // Type derivation. 'park' when remoteness reaches PARK_MIN_REMOTENESS; 'centre' when 40 venues within 1 km or 5
  // open places within 80 m (CENTRE_*); otherwise 'residential'.
  PARK_MIN_REMOTENESS: 0.6,
  CENTRE_MIN_VENUES: 40,
  CENTRE_MIN_OPEN_PLACES: 5,
  // H(hour) anchors [hour, value], linearly interpolated and wrapping at midnight.
  HOUR_CURVE: Object.freeze({
    // Town centres: busy all day, taper through the evening, thin at 4h, a few early workers by 6h.
    centre: Object.freeze([[0, 0.8], [2, 0.6], [4, 0.3], [6, 0.5], [8, 1.0], [21, 1.0], [22, 0.9], [23, 0.85]]),
    // Residential: commute peaks (8h, 17h), quiet midday, empty after 23h.
    residential: Object.freeze([
      [0, 0.22], [1, 0.15], [3, 0.1], [5, 0.1], [6, 0.4], [7, 0.8], [8, 1.0], [9, 0.7], [12, 0.6], [15, 0.8],
      [17, 1.0], [19, 0.9], [20, 0.8], [21, 0.6], [22, 0.5], [23, 0.3],
    ]),
    // Parks: moderate by day, almost nobody after dusk (21h on) until the early morning.
    park: Object.freeze({ DAY: 0.5, NIGHT: 0.05, NIGHT_FROM_HOUR: 21, NIGHT_TO_HOUR: 6 }),
  }),
  // LATE: venues open in the late window add up to LATE_MAX (full at LATE_VENUES_FULL venues within 80 m).
  LATE_MAX: 0.15,
  LATE_VENUES_FULL: 3,
  LATE_FROM_HOUR: 22,
  LATE_TO_HOUR: 5,
});

// Remoteness R0 in [0, 0.8] (the three terms sum to 0.8; the rest is reserved for building/land-use data that is not
// ingested yet). Per edge midpoint, from the spatial grids; O(1) per edge.
const REMOTENESS = Object.freeze({
  // Distance (m) to the nearest non-path road, ramp 25 -> 150: a path within 25 m of a street is overlooked by it.
  ROAD_WEIGHT: 0.40, ROAD_NEAR_M: 25, ROAD_FAR_M: 150,
  // Non-path road segments with midpoints within 100 m, ramp 0 -> 10 (a built-up area has many).
  WAYS_WEIGHT: 0.30, WAYS_RADIUS_M: 100, WAYS_FULL: 10,
  // Open places within 100 m, ramp 0 -> 10.
  PLACES_WEIGHT: 0.10, PLACES_RADIUS_M: 100, PLACES_FULL: 10,
  // Hazard H = R * (1 - P) * darkness; lit reduces it H_eff = H * (1 - LIT_RELIEF * lightingEffective); the edge's
  // safety is multiplied by (1 - HAZARD_STRENGTH * H_eff). Darkness gates it: an empty path by day is fine.
  // Cell size (degrees, ~110 m) of the grids behind the three queries, which reach 100 to 150 m: 5 x 5 cells per lookup
  // instead of the 11 x 11 the shared 55 m grids need. A speed choice only; results are exact.
  GRID_CELL_DEG: 0.001,
  LIT_RELIEF: 0.35,
  HAZARD_STRENGTH: 0.4,
  // Remoteness below FREE counts as none: R0 is never 0 in sparsely mapped suburbs (a street with no cafe within
  // 100 m already scores 0.1 on the places term, and a 100 m grid has only ~8 segment midpoints within 100 m), and
  // a street the walker is on is not remote. Between FREE and MAX (the largest R0, the sum of the three weights) the
  // effective remoteness rises linearly from 0 to MAX, so a path far from every road is unchanged at 0.8.
  FREE: 0.3,
  MAX: 0.8,
});

// Weak lit tag (lightingStage): lit=yes on a crossing structure or isolated path, with no mapped lamp within
// LAMP_NEAR_PATH_M while the surrounding area has mapped lamps (so lamp mapping is dense enough for absence to mean
// something), is weak evidence: a mapper tagged the whole way but nothing near it is lit (A38 footbridge).
const WEAK_LIT = Object.freeze({ pLit: 0.7, n: 6 });

// Floor for the activity factor: a street with no open places, cameras or transit nearby is
// quiet, not hostile, so activity safety never drops below this. Equal to PRIOR_SAFETY.activity so
// that having activity data that shows nothing nearby is never worse than having no data at all.
const ACTIVITY_FLOOR = 0.4;

// Night-time floor for a low-presence street (rural or deserted residential): an empty night street is worse than an
// empty day street. The floor runs from ACTIVITY_FLOOR_NIGHT at presence 0 to ACTIVITY_FLOOR at presence
// ACTIVITY_FLOOR_FULL_PRESENCE (0.10, what a Plymouth residential street with two pubs has at 23:00), and applies to
// daytime unconditionally (by darkness). The unknown-data prior takes the same floor, so data showing nothing nearby
// is never worse than no data at all.
const ACTIVITY_FLOOR_NIGHT = 0.25;
const ACTIVITY_FLOOR_FULL_PRESENCE = 0.1;

// Open places count with weight min(1, PLACE_PRESENCE_BASE + PLACE_PRESENCE_SLOPE * P) in the activity load (replaces the old
// global night discount, 0.4 from 22:00 to 06:00). 0.25 + 1.5 * 0.10 = 0.40 reproduces the old late-night weight for the Plymouth suburb.
const PLACE_PRESENCE_BASE = 0.25;
const PLACE_PRESENCE_SLOPE = 1.5;

// Roads at or above this speed (km/h, 50 mph) with no sidewalk are treated as walking hazards.
// Set well above urban limits because 95% of ways carry no sidewalk tag at all.
const HAZARD_SPEED_KMH = 80;

// Longest route, as a multiple of the shortest, that may still be ranked. Raised from 1.5 to 2.0: with the
// damped exposure (LENGTH_EXPOSURE_EXPONENT) a 2x route must already be about 29% safer to win. Candidate
// generation caps each search at SEARCH.MAX_ROUTE_DISTANCE_FACTOR (2.5) x the straight line, and A* may
// then go up to SEARCH.MAX_DETOUR_FACTOR (1.5) x that cap (graph/routing.js), so a candidate's path can
// reach 3.75x the straight line (direct routes; each via-waypoint leg has its own cap, VIA_LEG_DISTANCE_FACTOR).
// At 1.5 a 650 m route at 70 could not be recommended against a 383 m route at 22.
const MAX_LENGTH_RATIO = 2.0;

// Exponent on route length (in km) in exposure H = routeRisk * lengthKm^LENGTH_EXPOSURE_EXPONENT.
// 1 would make risk add per metre (H = routeRisk * length), so a short bad route beats a longer, far
// safer one: 383 m at risk 0.775 scores 0.48 against 0.24 for 650 m at 0.301. Danger concentrates in
// weak stretches rather than adding up per metre, so length is damped. 0 would ignore length.
// At 0.5, a route 1.4x longer wins only when its risk is more than 15.5% lower (1 - 1/1.4^0.5 = 15.48%).
const LENGTH_EXPOSURE_EXPONENT = 0.5;

// Radius (m) within which a mapped street lamp counts as lighting an edge. This is the radius
// the graph builder (services/graph/lightingStage.js) uses when it counts lamps for lightingInference's lampCount30m input,
// so the count and the constant must agree. lightingInference itself only sees the count.
const LAMP_RADIUS_M = 30;

// ── Graph builder (services/graph/*) ────────────────────────────────────────

// Road class score (0 to 1) feeding the road factor: bigger, busier roads are better watched and lit; paths and
// steps are the weakest. The keys are also the walkable highway set, so a class missing here is not routed.
const ROAD_TYPE_SCORES = Object.freeze({
  trunk: 0.90,
  primary: 0.95,
  secondary: 0.85,
  tertiary: 0.75,
  unclassified: 0.55,
  residential: 0.50,
  living_street: 0.55,
  service: 0.40,
  // Pedestrian classes (road CLASS only; lighting, isolation and remoteness carry the rest). Raised from the v1 legacy
  // values (footway 0.25, cycleway 0.35, path 0.15, steps 0.10, track 0.10), which treated any footway as dangerous
  // even by day: a lit park path in daylight scored 48 (Moderate). A footway is where pedestrians are meant to be, so
  // it is no worse than a residential street (0.50) on class alone (0.70 puts a lit park path at 60+ by day, the target); it stays below the roads that have traffic watching
  // them (secondary 0.85). A park path at night is penalised by darkness, the isolated-path penalty and remoteness.
  pedestrian: 0.72,
  cycleway: 0.66,
  footway: 0.70,
  // Unsurfaced or informal ways: still walkable but less used and less overlooked.
  path: 0.45,
  steps: 0.40,
  track: 0.30,
});

// Score for a walkable class that has no entry above (cannot happen today: the table defines the walkable set).
const ROAD_SCORE_FALLBACK = 0.3;

// Safety taken off the road score for an unpaved surface (unpaved is scarier at night). Graded by how rough it is.
const SURFACE_PENALTIES = Object.freeze({
  gravel: 0.04,
  dirt: 0.06,
  grass: 0.04,
  mud: 0.12,
  sand: 0.08,
  earth: 0.06,
});

// Path classes that take the unlit-path isolation penalty when no lamp is mapped within LAMP_NEAR_PATH_M.
const PATH_CLASS_HIGHWAYS = new Set(['path', 'track', 'bridleway', 'footway', 'steps', 'cycleway']);

// Radius (m) within which a mapped lamp saves a path from the unlit-path isolation penalty. Wider than
// LAMP_RADIUS_M on purpose: LAMP_RADIUS_M (30 m) is how far a lamp lights a segment for the lighting estimate,
// while this is how close a lamp must be for a lonely path not to be judged "nothing lit, nobody passing". A lamp
// 40 m away does not light the path (lighting stays uncertain) but shows the area is lit and used. Do not merge them.
const LAMP_NEAR_PATH_M = 60;

// Edge-building tunables.
const GRAPH = Object.freeze({
  // Evidence strength (n) for the factors that are not produced by inferLighting or crimeRisk.
  ROAD_N: 10,        // road class is an OSM tag, so the class itself is well evidenced
  ACTIVITY_N: 8,     // counts of places, CCTV and transit within fixed radii
  ISOLATION_N: 6,    // dead ends come from topology; footpath lamp checks are local
  CACHE_LIGHT_N: 6,  // a non-verified lights-cache record (status lit, limited or unlit)

  // A lights-cache record counts as verified at this confidence; a verified record is near-ground-truth.
  CACHE_VERIFIED_CONFIDENCE: 0.8,
  CACHE_VERIFIED_UNLIT: Object.freeze({ pLit: 0.05, n: 20 }),
  CACHE_VERIFIED_LIT: Object.freeze({ pLit: 0.95, n: 20 }),

  // Isolation penalties (safety units). A dead end halves safety (was 0.3) and an isolated path with no mapped
  // lamp within LAMP_NEAR_PATH_M leaves almost none (was 0.25): nobody passes by and nothing is lit. Sidewalks
  // (footway-like ways within reach of a road) never take the path penalty. Tuned jointly with BASE_WEIGHTS
  // against the calibration archetypes: a pedestrian alone on a dark path at 23:00 must read Use Caution.
  DEAD_END_PENALTY: 0.5,
  UNLIT_PATH_PENALTY: 0.95,

  // Cells for area stats and crime aggregation.
  AREA_CELL_DEG: 0.003,   // ~300 m, the area in which lamp density is judged
  CRIME_CELL_M: 500,      // crime aggregation cell
  CRIME_PRIOR_FLOOR: 0.1, // weighted crimes per km, lowest allowed area prior
  NODE_GRID_CELL_DEG: 0.001, // ~110 m cells of the nearest-node spatial grid
  METRES_PER_DEG_LAT: 111320,

  // A segment shorter than this is raised to it: two nodes at the same coordinates must stay joined, because
  // dropping the edge would split the network. 0.5 m is below any real walking step and keeps costs finite.
  MIN_EDGE_LENGTH_M: 0.5,

  // Activity radii (m).
  CCTV_RADIUS_M: 80,
  PLACE_RADIUS_M: 80,
  TRANSIT_RADIUS_M: 150,

  // Activity load = PLACE_WEIGHT * open places * presence weight + CCTV_WEIGHT * cameras + TRANSIT_WEIGHT * stops,
  // turned into a safety by a saturating curve above ACTIVITY_FLOOR. A camera counts about 2.7 open places.
  PLACE_WEIGHT: 0.15,
  CCTV_WEIGHT: 0.4,
  TRANSIT_WEIGHT: 0.1,
});

// Place opening heuristic when opening_hours is missing or unparseable. Hours are London wall-clock hours.
const OPENING_HOURS = Object.freeze({
  ALWAYS_OPEN: Object.freeze(['hospital', 'clinic', 'pharmacy', 'fuel', 'atm', 'police', 'fire_station', 'hotel', 'hostel', 'parking', 'toilets']),
  EVENING: Object.freeze(['pub', 'bar', 'nightclub', 'biergarten', 'casino', 'restaurant', 'fast_food', 'food_court', 'ice_cream', 'cafe']),
  EXTENDED_SHOPS: Object.freeze(['convenience', 'supermarket', 'kiosk', 'mall']),
  EVENING_HOURS: Object.freeze({ from: 10, to: 24 }),
  EXTENDED_SHOP_HOURS: Object.freeze({ from: 6, to: 23 }),
  DEFAULT_HOURS: Object.freeze({ from: 7, to: 20 }),
});

// Crime data status. Anything other than OK is treated as an outage, so missing data never reads as safe.
const CRIME_STATUS = Object.freeze({ OK: 'ok', UNAVAILABLE: 'unavailable' });

// ── Path search (services/graph/routing.js, candidates.js) ──────────────────

const SEARCH = Object.freeze({
  // Expansion budget for one safest-path search (and, shared, all candidate searches of one findKSafestRoutes).
  // Exceeding it is reported as a path-not-found unless a route was already found.
  MAX_ASTAR_EXPANSIONS: 3_000_000,
  // The A* loops check for cancellation every (CANCEL_CHECK_MASK + 1) heap pops.
  CANCEL_CHECK_MASK: 1023,
  // A* never lets effective safety fall below this, so an edge cost stays finite (cost = distance / safety).
  MIN_EFFECTIVE_SAFETY: 0.05,
  // A* search path may be at most this multiple of the maxDistM it is given. A direct route search passes
  // maxDistM = straight-line distance x MAX_ROUTE_DISTANCE_FACTOR, so its path cap is 3.75x straight line.
  MAX_DETOUR_FACTOR: 1.5,
  // Route candidates are searched within this multiple of the straight-line distance (before MAX_DETOUR_FACTOR).
  MAX_ROUTE_DISTANCE_FACTOR: 2.5,
  // With a via waypoint, each of the two legs may use this share of the candidate distance cap.
  VIA_LEG_DISTANCE_FACTOR: 0.7,
  // Each found route adds this to the penalty of its edges, steering the next search elsewhere.
  PENALTY_INCREMENT: 0.15,
  // Two candidates sharing more than this fraction of edges are the same route.
  DUPLICATE_OVERLAP: 0.85,
  // Extra searches beyond k, to absorb duplicate candidates.
  EXTRA_SEARCHES: 3,
  // Default snap radius (m) when mapping a coordinate to the nearest graph node.
  NEAREST_NODE_MAX_M: 500,
});

// Avoidance candidates (services/graph/candidates.js). The k normal candidates share most of their edges, because the
// penalty step is small next to a long common route: a weak crossing in the middle of a trip stays in every one of
// them even when a different crossing exists. So after the normal pass the best route's weak stretches are blocked in
// turn and the route is searched again from the origin; the usual exposure ranking decides whether it wins.
const AVOID = Object.freeze({
  // Extra searches per request, one per weak stretch, longest first. Two bounds the cost to 2 more A* runs in a
  // pass that already runs k + EXTRA_SEARCHES; a route with more weak stretches is a poor route either way.
  MAX_STRETCHES: 2,
  // A weak stretch is worth routing around from this length (m). Shorter spans (a 30 m underpass) cost the walker
  // little exposure, and a detour long enough to avoid them rarely wins the ranking.
  MIN_STRETCH_M: 60,
  // The blocked edges' cost is multiplied by this, not removed: large enough that a 25x longer way round is still
  // preferred (so a real alternative is found), finite so that a route still exists when there is no alternative.
  PENALTY: 25,
  // A result that still uses more than this share (by length) of the blocked stretch did not avoid it and is dropped.
  MAX_STRETCH_REUSE: 0.5,
  // An avoidance route is the same route as an existing candidate when each covers at least this share of the
  // other's edges. Stricter than SEARCH.DUPLICATE_OVERLAP (0.85) on purpose: an avoidance route differs from the
  // best route in one local detour, which on a route of many short edges can be under 15% of the edges, so the
  // 0.85 rule would discard exactly the candidates this pass exists to find.
  DUPLICATE_OVERLAP: 0.98,
});

// Settlement class of a point (spec section 12, scoring/settlements.js). Class thresholds are on the
// population of the covering settlement. Radius of influence: clamp(PER_SQRT_THOUSAND * sqrt(pop / 1000), MIN, MAX) km.
// MAX also bounds the lookup window, so a large city still covers its suburbs (London reaches Brixton, ~5 km away).
const SETTLEMENT = Object.freeze({
  CLASS_MIN_POPULATION: Object.freeze({ metropolis: 1000000, city: 100000, largeTown: 30000, town: 5000 }),
  RADIUS_KM: Object.freeze({ PER_SQRT_THOUSAND: 0.6, MIN: 0.8, MAX: 12 }),
});

module.exports = Object.freeze({
  AVOID,
  ACTIVITY_FLOOR,
  ACTIVITY_FLOOR_NIGHT,
  ACTIVITY_FLOOR_FULL_PRESENCE,
  PLACE_PRESENCE_BASE,
  PLACE_PRESENCE_SLOPE,
  PRESENCE,
  REMOTENESS,
  WEAK_LIT,
  HAZARD_SPEED_KMH,
  MAX_LENGTH_RATIO,
  LENGTH_EXPOSURE_EXPONENT,
  LAMP_RADIUS_M,
  LAMP_NEAR_PATH_M,
  MIN_FACTOR_SAFETY,
  BASE_WEIGHTS,
  PRIOR_SAFETY,
  UNCERTAINTY_RISK_LOAD,
  RISK_POOR_THRESHOLD,
  CAUSE_MIN_RISK,
  CUBE_MEAN_BLEND,
  EVIDENCE_PSEUDO_COUNT,
  CRIME,
  DARKNESS,
  LIGHTING,
  ROAD_TYPE_SCORES,
  ROAD_SCORE_FALLBACK,
  SURFACE_PENALTIES,
  PATH_CLASS_HIGHWAYS,
  GRAPH,
  OPENING_HOURS,
  CRIME_STATUS,
  SEARCH,
  SETTLEMENT,
});
