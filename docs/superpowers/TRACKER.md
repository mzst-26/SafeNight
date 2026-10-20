# Safety v2 Tracker (living sheet)

Edit freely; log every change in "Change log". Status: `todo` | `doing` | `review` | `changes-requested` | `done` | `blocked`.
Model column: H = Haiku 5.5, S = Sonnet 5.5 (only after H failed the gate on a heavy task).
Spec: `specs/2026-10-19-safety-scoring-v2-design.md`. Branch: `feat/safety-scoring-v2`.

## Phase 0: Plan and baseline

| ID | Task | Owner | Model | Status | Notes |
|----|------|-------|-------|--------|-------|
| P0.1 | Audit backend scoring | explorer a0be… | H | done | 11 weaknesses W1-W11 in spec |
| P0.2 | Audit frontend map rendering | explorer a0a0… | H | done | M1-M2 in spec |
| P0.3 | Write spec + tracker | brain | n/a | done | awaiting owner approval |
| P0.4 | Owner approval | owner | n/a | done | owner delegated full autonomy |
| P0.7 | Review round 1 (R1 a3932, R2/3/6 a5e21) folded into spec v0.3 | brain | n/a | done | |
| P0.5 | Baseline fixture captured (scratchpad baseline_frogmore.json: 67/60/58, 4.4km vs 3.4km) | brain | n/a | done | copy into tests/fixtures in S10 |
| P0.6 | Live-app baseline on :8084 | brain | n/a | done | works, slow; recheck repeatedly |

## Phase 1: Scoring engine (backend/src/safety)

| ID | Task | Depends | Model | Status |
|----|------|---------|-------|--------|
| S1 | `darkness.js` + tests | P0.4 | H | review done: CHANGES (fix pass B) |
| S2 | OSM context (landuse/buildings) = PHASE 2 optional; maxspeed units fixed in v2 | P0.4 | H | deferred (phase 2); geometry proximity used instead |
| S3 | `lightingInference.js` + tests (tags only, v1) | none | H | review done: CHANGES (fix pass B) |
| S4a | `crimeRisk.js` pure EB model + tests | none | H | review done: CHANGES (fix pass B) |
| S4b | Crime aggregation job (osm-ingestion, 500 m cells, 12 months) + outage contract + client | S4a | H/S | todo |
| S5 | `config.js`, `weights.js`, `edgeRisk.js` + property tests | none | H | review done: CHANGES (fix pass B) |
| S6/S7 | `routeAggregate.js` (aggregate, exposure rank, reason) + tests | none | H | review done: CHANGES (fix pass A) |
| S7b | Integration into graph/formatter; riskVector fixed, maxspeed units, sidewalk unknown, dead-end degree over all ways | S1,S3,S4a,S5,S6 | | done (I1/I2, refactored into services/graph/*) |
| S8 | A* uses edgeRisk; fix dead-end, open-state clock | S5 | H | done |
| S9 | Formatter/API additive fields, crime clustering + contract tests | S6,S7 | H | done |
| S10 | Integration tests `/safe-routes` | S8,S9 | H | done |

## Phase 2: Map (frontend)

| ID | Task | Depends | Model | Status |
|----|------|---------|-------|--------|
| M1 | `routeLayers` pure builder + tests | S9 contract | H | done |
| M2 | Web (Leaflet) renders layers; remove purple boxes/dots | M1 | H | done |
| M3 | Native (MapLibre) parity | M1 | H | done |
| M4 | Legend chip, worst-stretch callout, filter consistency | M2 | H | done |
| M5 | Route card shows reason/certainty (route data only) | S9 | H | done |
| M6 | Browser verification on :8084 + screenshots | M2-M5 | H | done |

## Phase 3: Review gates (per phase, then final)

| Gate | Reviewer | Phase 1 | Phase 2 | Final |
|------|----------|---------|---------|-------|
| R1 Correctness | H (S if contested) | | | |
| R2 Performance | H | | | |
| R3 Security | H | | | |
| R4 Code quality (phase-reviewer) | | | | |
| R5 Test adequacy | H | | | |
| R6 UX/Design (design-critic) | n/a | n/a | | |
| R7 Cross-platform | n/a | n/a | | |

Rule: merge only when each applicable gate has ≥2 independent approvals in the latest cycle.

## Status snapshot

- c83e3fa: scoring modules + fix pass A/B + routeLayers (M1) committed; 647 backend / 180 frontend tests green.
- Round-2 review running: R1 a10a7, R5 a3ac9, R4 a07b2.
- Integration running: I1 safetyGraph (adb34), I2 crimeClient/safeRoutes/formatter (a690f). Flag SAFETY_MODEL=v1 keeps old path until final cleanup.
- TODO next: M2/M3 renderers (web/native), M4 legend/callout, M5 route card reason, M6 browser verification; S4b crime aggregation job; eval backtests; A/B compare script; final review gates; cleanup v1.

## Frontend wave (running)

| ID | Task | Agent | Status |
|----|------|-------|--------|
| FP | routeLayers polish (F5, F7 frontend part) | a2796 | done: 68 tests, 100% coverage, 7 mutants killed |
| FA | service types + useHomeScreen routeLayers + routeComparison helper | abe79 | done (uncommitted; 31 new tests) |
| FW | Leaflet web renderer (casing, dashed, badges, legend) | a08fd | doing |
| FN | MapLibre native renderer parity (+ pin maplibre version/SRI) | a3845 | doing |
| I1 | safetyGraph v2 (flag SAFETY_MODEL) | adb34 | done 22 tests, suite 739 green |
| FC | Route cards: reason/certainty/dataQuality (route data only) | a9d24 | done |
| FW/FN | web + native renderers | a08fd / a3845 | done; frontend 316 tests, committed 4a028e6 |
| I2 | API layer: crimeClient status, request hardening, formatter v2 | a690f | done, committed 34e01a0; E2E A/B on :3012 works |
| P1a | polish scoring modules F1-F3,F6,F7 + spec fixes | ada3c | done (347 scoring tests, 100% cov, 34/35 mutants then 35/35) |
| P1b | polish safetyGraph/crimeClient F6,F8,F9,F10 | a5fd8 | done; brain fixes: ACTIVITY_FLOOR=0.4, crime recency anchored on newest data month; suite 856 green |
| CAL | calibration archetypes A-K + route-level targets (calibration.test.js) | aaa5b (Haiku) | partial: 15/18 pass; E=44, H=56, allE label Moderate unmet; RATE_SCALE 6->4 |
| EV | lighting leave-out + lamp-thinning backtests (backend/scripts/eval) | a4b09 | leave-out done (73 tests); thinning + Bristol pending; rerun after LI |
| LI (done d6dd0fe) | lighting fix from backtest (sidewalk-vs-isolated footway by road proximity, priors, absence only for isolated paths, neighbour-lit separate) + coupled recalibration E/H + rerun EV | a1776 (SONNET: heavy, coupled, Haiku CAL only partly met targets) | doing |
| VIS | BLOCKED (permission): visual verification on :8084 needs the user's dev server restarted from the worktree; classifier denied killing pid 72040. Browser restricted to :8084 by owner. Needs owner decision. Original: Visual verification on :8084 (stop user dev server, serve worktree with SAFETY url -> :3012, then RESTORE original `npx expo start` in main checkout) | brain | todo after CAL |
| S4b | multi-month crime history (background-enrich, bounded) | | not done: v2 uses the latest Police month (recency anchored on newest data month); precompute job is future work |

## A/B result (Frogmore -> Thurlestone, 22:00, local service)

- v1 (:3002): 67/60/58, recommended 4.4 km (free extra distance).
- v2 (:3012): 54/50/59, recommended = lowest exposure 3.4 km, reason string shown; certainty .57-.58; absolute scores lower than v1: calibrate (CAL).

## Gate status (full branch)

- R2 performance: PASS (cold 4.7s v2 vs 8.9s v1 on a fresh route; warm ~2ms both; RSS 290 vs 307 MB).
- R3 security: CHANGES (waypoint bbox DoS HIGH; A* no cancel; poi cap; crime key; innerHTML escapes; Leaflet SRI). R6/R7: CHANGES (ramp contrast <3:1 steps 0-2, native attribution missing, dash patterns, hit 22px, crime filter bug, per-kind caps, route score pills). Fix round 3 running: FX-B a4934 (backend), FX-L a793c (builder/hook/cards), FX-W a73a4 (web), FX-N abace (native). Deferred/out of scope (pre-existing): server-side tier enforcement (service unauthenticated), unverified JWT sub for search-cancel keying, iframe sandbox. Report to owner.
- Real-route check after LI (service :3012): 66/62/58 all 'Safe'; recommended route has the smallest weak stretch (137 m vs 564/733 m).
- Tests: backend 1009 (89 suites) x3 green; frontend 316 green; tsc clean.

## Final gate round 1 (HEAD 59ca2ea, superseded)

| Gate | Agent | Verdict |
|------|-------|---------|
| R1 correctness (integration/e2e) | ae0d2 | running |
| R3 security re-check | a902d | running |
| R4 quality (full diff) | a4166 | running |
| R5 tests (mutation, coverage) | a17ab | running |
| R6/R7 UX + parity | ac1ac | running |

Fix round 3 done: FX-B (waypoint/area/A*/crime key), FX-L (ramp, filters, route badges, a11y), FX-W (web), FX-N (native). Brain fixes: ramp re-chosen (#26998E..#370412, search by OKLCH lightness, CVD >=10.2), backend ramp synced and test reads frontend source; MAX_SEARCH_BBOX_KM2 400 -> 900 (premium 20 km trips); known pre-existing HTTP flakiness on main under load (6 unrelated failures seen on main too).
Owner-visible blockers: VIS needs permission to restart :8084 dev server from the worktree.

## FINAL STATE (HEAD c7d5b46)

Gates: R1 correctness APPROVE (round 3) | R2 performance PASS | R3 security APPROVE (round 3) | R4 quality APPROVE with tracked follow-ups | R5 tests PASS (94% mutants killed) | R6/R7 UX+parity: round-3 majors fixed and unit-tested, NOT visually verified in a browser.
Tests: backend 1333, frontend 562, tsc clean.
Open for owner: (1) visual check on :8084 (needs the dev server restarted from this worktree), (2) merge decision, (3) follow-ups F23 (computeSafeRoutes 679 lines), F27 (SafetyPanel inside card Pressable), server-side tier limits/unauthenticated service, disk-cache cap, multi-month crime history.

## Final gate round 2 (superseded, HEAD after 7c1563d + coverage config)

v1 removed, graph extracted to services/graph/* (17 files, golden-snapshot proven identical), ranking exponent 0.5 + cap 2.0x, request/cache/security fixes, shared inline map modules, UX fixes. Backend 1298 tests x3 green, frontend 468 green, tsc clean.

| Gate | Agent | Verdict |
|------|-------|---------|
| R1 correctness | | running |
| R3 security | | running |
| R4 quality | | running |
| R5 tests | | running |
| R6/R7 UX+parity | | running |

## Review log (round Phase-1a, commit 4515237)

- R1 a188c: CHANGES: NaN/range validation, null-factor-as-good (decision: neutral prior n=0), rankRoutes shortest kept, tag normalisation, maxspeed list.
- R4 a4997: CHANGES: duplicated constants (G, N0, severity table), config 'all tunables' claim, shared validation.
- R5 a4450: CHANGES: mutation survivors (certainty weights, smoothstep, rounding, thresholds), uncovered buildReason branches.
- Fix pass A ab9f3 (routeAggregate), fix pass B a00a1 (other modules) running. M1 adcb1 (frontend routeLayers) running.
- Note: one unreproduced full-suite failure seen once (likely concurrent writes); watch for flake.

## Findings queue (changes requested by reviewers)

| # | From | Task | Finding | Status |
|---|------|------|---------|--------|
| F28 | Owner screenshots | data | Footbridge over A38 (ways 33606623/33606620/181986297) is tagged lit=yes in OSM, so explicit tag wins: it still scores Safe (65) although the owner reports it dark. Needs a decision: contradiction rule (lit=yes on an isolated crossing with no mapped lamp within 60 m => weaker evidence) or a user-report/override layer | open, owner decision |
| F29 | Owner screenshots | model | Done in BE-G: way-level crossing/sidewalk classification, uncertainty load 0.23, avoidance candidates; real-route avoidance never fired (no edge reached risk 0.6) | done |
| F21 | Gate2 R1 | MAJOR | same-node origin/dest (>10 m) returned 3 identical 0 m routes: 400 SAME_LOCATION after snap + empty-route duplicate + cap-base robustness | DONE (R1 round 3 approved) |
| F22 | Gate2 R3 | APPROVED | minors: disk cache cap (pre-existing), NaN env queue cap (BE-F), '0x10' number parsing cosmetic, legend dash sample via innerHTML (constants only) | tracked |
| F23 | Gate2 R4 | MAJOR (follow-up, pre-existing) | computeSafeRoutes in routes/safeRoutes.js is 679 lines/complexity ~88 (667 lines on main). Not refactored here: SSE/stream path has ~53% coverage, so a blind rewrite is riskier than leaving it. FOLLOW-UP: add characterization tests for computeSafeRoutes then split into stages (request resolution, data fetch, graph+candidates, light verification, response assembly). Also: routeAggregate.js 391 lines (move buildReason to scoring/reason.js), routeLayers.ts 551 lines, positional-arg sprawl (buildGraph 8, prepareContext 9, findKSafestRoutes 8) | tracked follow-up |
| F24 | Gate2 R4 | MEDIUM | config comment fixes, edgeConfidences removal, breakdown args, crime status single source, residual v1 gates, debugLog dup, test renames | DONE |
| F25 | Gate2 R5 | CHANGES | mutation 35/51 (68.6%): survivors in cache key (safetyLevel missing!), edgeBuilder dead-end/crime default/traffic, lighting density, activity filters/night discount, outage TTL/budget boundaries, same-location boundary, crime cap +1 etc. | DONE: 48/51 killed (94%); 3 survivors proven equivalent |
| F26 | Gate2 R6/R7 | MAJOR | legend header 44px, crime-unavailable note visible when legend collapsed, screen-space merge of crime badges + pill separation, native no-lines fallback, parity minors | DONE (+ pill/badge obstacle and exhaustive separation after round 3) |
| F27 | Gate2 R6 | MAJOR (follow-up, pre-existing structure) | SafetyPanel renders inside RouteCard's outer Pressable so screen readers may not reach the breakdown: needs on-device check and layout change | tracked follow-up |
| F13 | Final R1 | policy/handler | MAJOR: area check runs before out-of-range check => far trips get AREA_TOO_LARGE instead of DESTINATION_OUT_OF_RANGE (client upsell path broken). Fix: order | done (BE2): distance check runs first in GET and stream, area check after it; far trips return DESTINATION_OUT_OF_RANGE |
| F14 | Final R1 | safetyGraph | MAJOR: Math.max(...indexes) RangeError >125k crimes; use loop | fixed (BE1): crimesToWeightedCounts uses a loop, 200k-row tests |
| F15 | Final R1 | ranking | MAJOR: pure exposure ranks a 22/100 short route over 70/100 route: LENGTH_EXPOSURE_EXPONENT=0.5 | BE3 running |
| F16 | Final R1 | misc | minor: origin==dest 400; departure_hour floor; crimeStatus in cache key + fail-closed defaults; reason wording single alternative (BE3); zero-length edge disconnect; shared A* budget (return found routes) | partial: BE1 fixed zero-length edge disconnect (0.5 m floor), shared A* budget returns found routes, graph and formatter crimeStatus fail closed; rest open (BE2/BE3) |
| F17 | Final R3 | cacheStore | MAJOR(pre-existing): crime cache maxEntries not enforced (evict oldest); minor: aStarDistance cancel, POI_CAP NaN guard, route cache key precision 1e-5, straight-line check ordering | partly done (BE2): cache maxEntries and byte budget enforced, POI_CAP NaN guard, route key 1e-5, straight-line order; aStarDistance cancel still open (BE1) |
| F18 | Final R4 | structure | MAJOR: delete v1 + flag; extract buildGraphV2 into stage modules; constants into config; web/native shared inline modules (FX2-R); duplicate debugLog/STATUS consts; __resetForTests; TRACKER statuses | partial: BE1 deleted v1 and the SAFETY_MODEL flag, split buildGraph into services/graph/ stage modules, moved constants to scoring/config.js, merged debugLog in graph/; open: web/native shared inline modules (FX2-R), __resetForTests, debugLog copies outside graph/, safeRoutes.js still imports the deprecated isScoringV2Enabled shim (BE2) |
| F19 | Final R6 | UX | MAJOR: text AA, single encoding, 44px targets, crime clutter cap 12, discrete legend swatches, confidence tier, callout on path | FX2-L/FX2-R running |
| F20 | Final R5 | tests | frontend survivors T07, LY21, LY22, BD07, N07; backend mutation results pending (agent still running background batch); frontend coverage config measures only 5 files | open |
| F12 | EV | lightingInference/config | Backtest (Plymouth, 15,478 tagged ways, 5-fold spatial): inference does NOT beat road-class baseline (Brier .205 vs .121; AUC .785 vs .82). Observed lit rate: residential .97, primary/secondary/tertiary .98, service .68, footway .54, cycleway .81, steps .55, path .19. Priors too low; PATH bucket wrongly includes footway/cycleway/steps (sidewalks); ABSENCE rule points the wrong way (no lamp within 30 m => still 82% lit, lamps sparsely mapped); lampCount30m counts neighbouring lit=yes vertices as lamps. Plan LI: split PATH, raise priors conservatively (labelled set is biased toward tagged ways), disable absence penalty (factor 1.0), separate lit-vertex evidence; re-run EV; keep ordering property | open (LI after CAL) |
| F8 (done: ACTIVITY_FLOOR 0.4) | I1 | safetyGraph | activity safety must not drop to 0 when activity data exists but none nearby: ACTIVITY_FLOOR=0.3 in config: activity = floor + (1-floor)*(1-exp(-x)) | open (P1) |
| F9 | I1 | safetyGraph | hazard rule: with proper units 40 mph roads w/o sidewalk tag become hazards (sidewalk tag absent on 95% of ways). Set HAZARD_SPEED_KMH=80 (50 mph) in config; absent sidewalk is unknown | open (P1) |
| F10 | I1 | tests | safetyGraph coverage 77/64%: raise (opening-hours parse, heuristics); buildDistanceOnlyGraph untouched | open (P1) |
| F11 | I1 | env | intermittent whole-suite flakes under load (socket hang-up ECONNRESET, auth, contacts): unrelated HTTP suites; monitor, consider --maxWorkers | watch |
| F1 | R1r2 | routeAggregate | buildReason 'Safest and shortest' must compare routeRisk not rounded score; assert/document best==rank1 precondition | open (polish P1) |
| F2 | R1r2 | routeAggregate/edgeRisk | validate g, poorThreshold, exposure() args, rankRoutes routeRisk range; guard huge-length overflow and weights overflow | open (P1) |
| F3 | R1r2 | crimeRisk | bad monthsAgo rows are silently dropped (counts as zero harm): decide fallback (count at 0 months) | open (P1) |
| F4 | R1r2 | spec | reconcile: score is split-invariant (worstStretch reported, not scored); config MAJOR pLit .85 vs spec .9 | open (P1) |
| F5 | R4r2 | routeLayers.ts | riskBucket(NaN) returns NaN; crime severity default 1 vs backend 0.4; LatLng name clash with src/types/geo.ts; freeze ramp; exact union check for litEstimate; use DEG_TO_RAD | open (P1) |
| F6 | R4r2 | backend | safetyGraph crime.severity||0.4 dup; unused CRIME_SEVERITY re-export in crimeClient; MAX_LENGTH_RATIO into config; shared evidenceStrength helper; lamp radius 30 m into config; FACTOR_NAMES derive from BASE_WEIGHTS; rename safetyGraph getWeights vs scoring getWeights; crime month->monthsAgo adapter; rename cryptic config names (G,N0,EPS) | open (P1, after I1/I2 land) |
| F7 | R5r2 | tests | 21 surviving mutants (79.4% killed; need >=90%): cluster lon scale, MAX_LENGTH_RATIO 1.6x case, stretch tie, weight-scale invariance, callout midpoint precision, undefined factor, areaWayKm boundary 0.3, literal pins of EPS/CAUSE_MIN_RISK, reason-text mile rounding/ties, dominantCause/worstStretch ties, default cell 120 m, cell boundary | open (P1) |

## Change log

- 2026-10-19 created.
