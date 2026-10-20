# Safety Scoring v2 and Route Map Redesign: Design Spec

Branch: `feat/safety-scoring-v2` (worktree `SafeNight-worktrees/safety-v2`). Nothing merges to `main` until every gate in the Tracker is green.
Status: **v0.2, owner has delegated full autonomy; approval gate waived by the owner.** Living document; revisions are logged at the bottom.

## 1. Goals

1. A scoring algorithm that finds and ranks the genuinely safer walking route, using mainly local OSM data plus free extra data.
2. A route map that shows the minimum needed to choose a route, with detail available on demand.

Scope limit: only route drawing and route data on the map change. Search, modals, sheets, pricing and the rest are untouched.

## 2. Findings from the current system (code audit)

| # | Weakness | Evidence |
|---|----------|----------|
| W1 | Unknown lighting is scored as dark (0). Unmapped streets get "Use Caution". | `safetyGraph.js:237-243, 413`; `applyLightingOverride` |
| W2 | Crime outage returns `[]`, so crimeScore = 1.0 (best). Outages make routes look safer. | `crimeClient.js:141-205` |
| W3 | Score is a per-metre mean, so extra distance is free. A 2.0 mi route scores 67 over a 1.4 mi route scoring 62 with no trade-off shown. | `routeSafetyBreakdown` |
| W4 | Road type is counted twice (roadScore, and 0.7× in trafficScore). Lighting is stacked from four sources. | `safetyGraph.js:407-486` |
| W5 | Ranking uses `avgSafety` (includes penalties) but the displayed score excludes them, so `isSafest` can disagree with the shown numbers. | `safetyGraph.js:731` vs `757-822` |
| W6 | Mean hides the weak link: one 300 m dark alley is averaged away. | `routeSafetyBreakdown` |
| W7 | Crime is a raw count: no exposure normalisation, no time window, no recency, latest month only. | `crimeClient.js` |
| W8 | Confidence penalty is inert on the first A* pass (`edgeConfidences = []`). Result depends on whether verification fired. | `safetyGraph.js:551` |
| W9 | Time of day: weights use the hour but never check whether it is actually dark (sunset). Open/closed heuristic uses server clock. | `getBaseWeights`, `:312-357` |
| W10 | Dead-end detection is wrong at walkable-graph boundaries. | `:379-388` |
| W11 | Zero unit tests for edge scoring, weights, aggregation, A*. | test audit |
| M1 | Up to 500 unclustered light dots; uncertainty boxes are 4 stacked polylines that overlap into purple blobs; category filter does not apply to segments. | `RouteMap.web.tsx:653`, `useHomeScreen.ts:586-599` |
| M2 | Native has no highlight emphasis; web and native diverge. | audit |

## 3. What "safe" means

For a pedestrian at a given time, a route is safer when it minimises **expected exposure to harm per walk**, accounting for **how sure we are**. We model four things:

- **Visibility:** can I be seen and can I see? (lighting while it is dark, natural surveillance from buildings and active places.)
- **Hazard:** has harm happened here? (recent, severity-weighted, exposure-normalised crime.)
- **Isolation and escape:** can I get help or leave? (road class, footpath isolation, dead ends, nearby open places and transit.)
- **Exposure:** how long am I out in it? (route length and time.)

And one meta-dimension: **Certainty**. Missing data is never silently good or bad; it widens uncertainty.

## 4. Scoring model

### 4.1 Per-edge risk (0 to 1, lower is safer), with confidence

`risk = 1 - safety`. Each factor is a **Beta-style estimate**: mean `m` and strength `n` (evidence weight). Unknown ⇒ prior mean with small `n`.

**Lighting `P(lit)`**, the key innovation, built from layered evidence:
1. Hard evidence: `lit=yes/no/limited`, mapped lamps (existing intensity grid). Strong `n`.
2. **UK legal inference:** under UK law a 30 mph limit with no signs and lamps ≤200 yd apart implies lit. So `maxspeed=30 mph` or `GB:urban`/`living_street` ⇒ prior ≈ 0.85.
3. **Context prior** from OSM: residential/retail landuse, building density within 40 m, sidewalk tags, road class (residential road with buildings both sides ≈ 0.8; `path`/`track`/`bridleway`/footway through `forest|park|meadow|grass` ≈ 0.15; rural unclassified with no buildings ≈ 0.1).
4. **Local mapping-completeness estimate:** lamps per hectare of nearby roads. If neighbouring streets have mapped lamps but this one has none, "no lamp" is informative (⇒ likely unlit). If no lamps are mapped within ~300 m of anything, mapping is absent and we trust priors, not absence.
5. OS NGD verification (existing) and user reports update the estimate (hard evidence).
Output: `P(lit)` and `n`. Score uses the expectation; uncertainty uses the variance.

**Darkness gate `d(t)`:** sun elevation at departure time and location (pure function, `suncalc`-style). Lighting weight scales with `d` (0 in full daylight, 1 after civil dusk), so daytime routes are not lighting-dominated and the 22:00 case is stricter. Replaces the hour-bucket weights.

**Hazard:** crimes over the last 12 months (several monthly Police API calls, cached), severity-weighted, with recency decay (half-life ≈ 4 months) and night-relevance multiplier. Density is **Bayesian-smoothed** against the area mean (empirical Bayes) and normalised for footfall proxy (transit/places/road class), so a busy high street is not unfairly damned. Outage ⇒ **unknown**, not safe.

**Visibility/activity:** CCTV, open places (open-state computed from the departure time, not server clock), buildings fronting the street, sidewalk presence.

**Isolation:** road class (non-double-counted: appears once), segment isolation (distance to nearest building/active place), dead-end only at true graph degree (using the full road graph), nearby transit.

**Combination:** `risk_edge = 1 - Π(factor safeties^w)` style weighted geometric blend, so one very bad factor (pitch-dark and isolated) cannot be averaged away by good ones. Weights are named constants in one `weights.js`, explained, and sum-checked by a test.

### 4.2 Route aggregation (fixing W3, W5, W6)

- `meanRisk`: length-weighted mean of edge risk.
- `weakLinkRisk`: length-weighted power mean (p=3) of edge risk plus a penalty for the **longest contiguous stretch** above the "poor" threshold (a 300 m dark alley matters more than five scattered 20 m gaps).
- `routeRisk = 0.6·meanRisk + 0.4·weakLinkRisk` (tunable, tested).
- `score = round(100·(1 − routeRisk))`, always from this single function. Displayed score, label and ranking all use the same value (fixes W5).
- **Certainty** `0-1` from the average evidence strength; surfaced as "Verified / Mostly mapped / Estimated". Never folded silently into the score, but it also never makes unknown territory score better than known-bad.

### 4.3 Ranking and trade-offs

- Rank by `utility = score − λ·max(0, detourRatio − 1.15)·100` (tunable), so a modest detour is free but long ones must pay for themselves.
- Recommended route returns a one-line **reason** generated from data: "+5 safer than fastest · 0.6 mi longer · avoids a 240 m unlit path".
- Each route also reports `worstStretch {start,end,lengthM,cause}` for the map and the card.

### 4.4 Routing (A\*)

Edge cost = `length / max(floor, 1 − risk_edge)` using the same edge risk the score uses. Confidence is baked into the edge (prior-based), so the first pass is no longer inert (fixes W8). Candidate diversity and dedup retained.

### 4.5 Data

Mainly local OSM (existing ingestion). Additions, all free:
- OSM landuse/natural/building polygons (extend ingestion filter) for context priors.
- Police API multi-month history (existing client, extended, cached).
- Optional (feature-flagged, evaluated for value before adoption): English Indices of Deprivation crime-domain LSOA scores (gov.uk open data) as a crime prior where the Police API is sparse.
- Sun position: pure computation, no external call.

## 5. Map redesign (route layer only)

Principle: **default shows the decision; tap reveals the detail.**

Default (selected route):
1. **Route line coloured by safety** on a continuous, colour-blind-safe sequential ramp (cased line for contrast), replacing the 5-bucket plus overlay mess.
2. **Certainty as line style, not extra layers:** solid = verified or well-supported; dashed = estimated lighting. Removes the purple boxes entirely.
3. **One callout for the worst stretch** ("Dark path · 240 m"), a single labelled pin.
4. **Crime as clustered badges** (count) only, not individual dots; **lights are not dots by default**: a thin lit/unlit/unknown band along the route. Individual light dots appear only when the user taps "Lights" or zooms ≥ 17.
5. Unselected routes: thin grey, tap to select.
6. A small legend chip (colour ramp, dashed = estimated) that can collapse.

On demand: the existing stat cards (Crimes/Lights/CCTV/Open) and "Showing X only · tap to view all" banner keep working; the filter now also applies to the route overlays consistently on web and native. The analysing animation box during loading stays as is.

Shared logic (`routeLayers` builder: pure function from API payload to a layer spec, tested) feeds both Leaflet (web) and MapLibre (native), so they cannot diverge.

## 6. API contract changes (backward compatible)

Additive per route: `safety.certainty`, `safety.reason`, `safety.worstStretch`, per-segment `risk`, `certainty`, `litEstimate`. `crimes` POI clustered server-side to ≤ ~40 markers. Existing fields remain so older app builds keep working.

## 7. Testing strategy

- Unit tests for every new module (lighting inference, darkness gate, hazard smoothing, edge combiner, aggregation, ranking, reason generator, layer builder).
- **Property tests:** adding a lamp never lowers a score; adding a crime never raises it; unknown ≠ better than known-dark; score monotone in each factor; score independent of segment splitting.
- **Golden scenarios** (fixtures): lit high street vs dark path vs unmapped residential; the Frogmore → Thurlestone Walk 3-route case; outage cases.
- Integration tests on `/safe-routes`; frontend tests for the layer builder; browser verification on `localhost:8084`.
- Baseline: record the current score for fixture routes first so each change is shown as a deliberate diff.

## 8. Review gates (all must approve before merge)

| Reviewer | Focus |
|----------|-------|
| R1 Correctness | Model logic, edge cases, property tests, fixture sanity |
| R2 Performance | Request latency, memory, cache hits; budget: p95 not worse than current + 15% |
| R3 Security | Input validation, external fetch limits, no secret leakage, SSRF, DoS via data fan-out |
| R4 Code quality | Readability, naming, modularity, no dead code (use `phase-reviewer`) |
| R5 Test adequacy | Coverage of every module, property tests present |
| R6 UX/Design | Minimal clutter, colour-blind safety, accessibility (use `design-critic`) |
| R7 Cross-platform | Web and native parity |

Rules: a change passes only with **multiple approvals** from the relevant reviewers; any rejection returns it to the builder with findings, then it is re-reviewed. Subagents run on Haiku 5.5; escalate a task to Sonnet 5.5 only when it is heavy and the Haiku output fails the gate.

## 9. Out of scope

Non-route UI, auth, billing, SEO, deploy. No push to `main` until the Tracker shows all gates green and the owner has seen the result.


## 10. Revisions from review round 1 (R2 perf, R3 security, R6 UX)

**Crime data pipeline (replaces request-time fan-out).** The Police API takes one month per call (`date=YYYY-MM`), so 12 months per request would be 12 upstream calls with 20 s timeouts, against ~15 req/s. Instead:
- `osm-ingestion` gets a scheduled **crime aggregation job**: ~500 m grid cells over served areas, 12 months fetched at ≤5 req/s, stored as `(cell, month, category, count)` plus `asOfMonth`; poll `crimes-street-dates` daily.
- Route requests read aggregates only: zero Police calls on the hot path. Dev fallback: the existing live client for a single month, behind a flag.
- **Outage contract:** the crime source returns `status: "unavailable"`, never `[]`. Unavailable ⇒ crime factor is unknown (prior mean, low evidence), the route gets a `dataQuality.crime = "unavailable"` flag, and the UI shows a data-confidence chip. Empty 200 or missing month is never cached as zero.
- Police street data has month only, no hour: **no night multiplier**; category weighting only.
- Crime count in the UI comes from the aggregate, not the capped POI array.

**Security acceptance criteria (R3).** Validate `max_distance` and `poi_cap` (NaN and Infinity clamped; `origin_lat=` empty rejected); `isFinite` range checks on parsed Police coordinates; per-user compute rate limit; pin MapLibre to an exact version with SRI or bundle it; explicit postMessage target origin (not `'*'`); no network in tests (golden fixtures from recorded responses).

**Map UX changes (R6).**
- Show all routes' scores in a **comparison strip** under the map: score, time, delta vs fastest, reason, worst stretch. Optionally per-route **risk strips** (distance-axis) for side-by-side comparison.
- Colour only the selected route; others stay thin grey with a wide invisible hit line (≥44 pt).
- Palette: single-hue/luminance-stepped, colour-blind-simulated check; dashed vs solid as a second channel; theme-aware casing for light/dark. Drop the separate lit/unlit band (redundant encoding); keep one encoding per property.
- Callouts ≥13 px.
- Shared builder emits a **JSON layer spec** (data, not code) consumed by both renderers; zoom/pixel concerns (dash scaling, radius by zoom) stay in each renderer.

**Rollout.** Baseline cold and warm p95 separately; crime v2 behind a flag; golden tests on recorded responses. Baseline route fixture captured from the local backend (Frogmore Ave to Thurlestone Walk, 22:00): routes score 67/60/58, safest is 4.4 km vs 3.4 km alternatives, so the length issue (W3) reproduces.


## 11. Model decisions v0.3 (R1 correctness review; supersedes conflicting text in section 4)

Corrections to the audit: W6 is wrong as stated; `riskVector` exists but is built from `safetyScore`, so `max` is the best edge and `p95` a safety percentile (names inverted, caution flag reads them inverted). Extra defects to fix: `maxspeed` parsed with `parseInt` ignoring units ("40 mph" compared to a km/h threshold); sidewalk absent (95% of ways) is treated as "no sidewalk" (unknown-as-bad); dead-end penalty scales with lighting (double count); the local dataset strips `tunnel`, so local and Overpass paths score differently; `[]` on 503 reads as safe.

### 11.1 Units
Expected exposure (harm per walk): `H = routeRisk * L_km^p`, with `p = LENGTH_EXPOSURE_EXPONENT = 0.5` (config.js). Displayed score is the intensive street-quality `100*(1-routeRisk)`. **Ranking uses `H`** among candidates with `L <= MAX_LENGTH_RATIO * L_shortest`, where `MAX_LENGTH_RATIO = 2.0` (raised from 1.5: at 1.5 a 650 m route at score 70 could not be recommended against a 383 m route at score 22; a 2x route still needs about 29% lower risk to win, since `1 - 1/2^0.5 = 29%`). No lambda, no detour threshold. The exponent sets how length counts: `p = 1` would make risk add per metre, so a 383 m route at risk 0.775 (H 0.48) would beat a 650 m route at risk 0.301 (H 0.24); `p = 0` ignores length. At `p = 0.5`, a route 1.4x longer wins only when its risk is more than 15.5% lower (1 - 1/1.4^0.5 = 15.48%). The reason compares the best route with the runner-up only (the lowest-exposure alternative): its length, its score and any poor stretch it carries, so a reason never mixes routes. The reason string explains the trade ("Route 2 scores 5 higher but is 0.9 mi longer").

### 11.2 Edge combination
Factors (5, no double counting): `lighting`, `crime`, `road` (class only), `activity` (open places + CCTV + transit, merged), `isolation` (dead ends at true degree, footpath through nothing). Each factor is `{safety in [0,1] | null, n}`; null = unavailable.
`risk = 1 - prod_i( max(eps, s_i) ^ w~_i )`, `eps = 0.05`, `w~` = weights over available factors, renormalised to sum 1. Lighting weight is multiplied by darkness `d(t)` before renormalising (so sums stay 1). No separate veto in v1; revisit if backtest demands.

### 11.3 Lighting
`inferLighting` returns `{pLit, n, source}`. Inputs beyond tags and area stats are two optional flags from the caller: `nearRoad` (a trunk..service road within 25 m of the segment midpoint, from `scoring/roadProximity.js`; omitted when unknown) and `litNeighbour` (a `lit=yes` way vertex within 30 m). Explicit tags win: `lit=yes` and `24/7` 0.95/n20, `lit=no` 0.05/n20, `limited` and `automatic` 0.5/n10. Otherwise evidence is applied in this order:
- Lamps within `LAMP_RADIUS_M` (30 m, counted by the caller; lamps only): one lamp gives at least 0.85, three or more at least 0.92, n rises by 6 (`source: lamp`).
- A neighbouring `lit=yes` vertex is a mapper's tag, not a lamp, so it is weaker evidence and never counted as one: pLit at least 0.85, n rises by 3 (`source: neighbour-lit`). A real lamp takes precedence.
- Otherwise the tag prior (config `LIGHTING.PRIOR`), checked in this order:
  - `path`, `track`, `bridleway`: 0.12/n3.
  - `footway`, `cycleway`, `steps`, `pedestrian` (checked before speed): road within 25 m (sidewalk-like) 0.72/n3; no road within 25 m (isolated) 0.33/n3; geometry unknown 0.5/n2.
  - `trunk`, `primary`, `secondary`: 0.90/n4. Urban speed (`maxspeed` at most 50 km/h after mph conversion, or `gb:urban`): 0.90/n4. `residential`/`living_street` with a `sidewalk` tag 0.90/n4, without 0.88/n3. `tertiary` 0.90/n3. `service` 0.62/n3. `unclassified` and unknown 0.72/n3.
- Absence: only for isolated paths (path classes, and footway-like ways with no road within 25 m), only where lamp density in the area exceeds 2 per km with at least 0.3 km of mapped road: `pLit` times 0.6, n + 3 (`source: absence`). It never applies to road classes: lamps are sparsely mapped and a road with no mapped lamp within 30 m is still about 82% lit in the Plymouth data.

Data context (Plymouth, 15,478 `lit=yes/no` ways): residential .97, primary/secondary/tertiary .98, trunk .89, unclassified .77, service .68, pedestrian .97, cycleway .81, footway .54, steps .55, path .19, track .02. Near a road footway .65, steps .61, cycleway .87; with no road within 25 m footway .36, steps .43, cycleway .64. Tagged ways are a biased sample (42% of walkable ways, 80% lit), so road priors are the observed rates shrunk towards 0.5 (about observed*0.9+0.05) with n of 3 or 4; sidewalk-like (0.72) is held below the pooled .68-.87 near-road rates only slightly, and isolated (0.33) below the pooled .41 because untagged park paths are likely darker.
`effectiveLit = (pLit*n + 0.5*c)/(n + c)` with `c = 1` (config `LIGHTING.SHRINK_PSEUDO_COUNT`). The priors are already shrunk, so the older shrink by `n0 = 4` double-counted the caution (backtest Brier .139 against .121 for the road-class rate); certainty keeps `n/(n+n0)` with `n0 = 4` (`EVIDENCE_PSEUDO_COUNT`), shared with edge risk through `evidence.js`; uncertainty is `1 - n/(n+n0)`. **Property:** known-dark <= any inferred <= known-lit, and more lamps never lower the estimate.
Isolation (graph level, `safetyGraph.js`): a footway-like way within 25 m of a road is a sidewalk and takes no unlit-path penalty; dead-end penalty 0.5 and unlit isolated path penalty 0.95.
Phase 2 (optional, only if backtest shows value): per-way pre-aggregated `buildingCount40m`, landuse class (~60 B/way, ~0.5 GB, second osmium pass; ~400-600 LOC plus re-ingest). Not required for v1.

### 11.4 Crime
Aggregate cell (500 m) severity-weighted counts over 12 months, recency half-life chosen by held-out Poisson deviance from {1,2,4,8,inf} (default 4). `lambda = (count + k*mu) / (exposureKm + k)` empirical-Bayes toward area mean `mu`; `risk = 1 - exp(-lambda_scaled)`. Locations are anonymised, so no sub-cell kernels. `status: unavailable` returns the area prior with `n = 0` and flags dataQuality. A crime row whose `monthsAgo` is unusable (non-finite or negative) still happened, so it is counted at full recency weight, never as zero harm. Null rows are skipped.

### 11.5 Aggregation
`routeRisk = (1-g)*mean + g*M3`, `M3 = (sum(L_i r_i^3)/sum(L_i))^(1/3)`, `g = CUBE_MEAN_BLEND = 0.4`, length-weighted; invariant to splitting a segment.
The score is contiguity-blind by design. It depends only on the length-weighted mean and cube-mean over all edges, so the same poor edges give the same score whether they form one run or are spread along the route. The score is not meant to capture a single dark stretch.
`worstStretch` = longest merged run of consecutive edges with `r >= 0.6` (`RISK_POOR_THRESHOLD`). It is reported alongside the score and drives the "avoids a N m dark stretch" clause in the reason, but it does not change the score. Where two runs tie in length, the first one along the route is reported.
`certainty` = length-weighted mean of per-edge evidence strength.

### 11.6 Constants and acceptance
All tunables live in one `scoring/config.js` with the rationale; a test asserts weights sum to 1 after renormalisation. Route-ranking constants: `LENGTH_EXPOSURE_EXPONENT = 0.5` (length damping in exposure, 11.1) and `MAX_LENGTH_RATIO = 2.0` (candidate cap, 11.1); `config.test.js` pins both. **Acceptance criteria (measurable):**
- Ranking (routeAggregate tests): the 383 m / 650 m pair (routeRisk 0.775 and 0.301) ranks the 650 m route first and it is not excluded; equal risk ranks the shorter route first; a 1.4x longer route wins only at more than 15.5% lower risk; a route at 2.1x is excluded and one at 2.0x is kept.
- Lighting leave-out (1 km spatial blocks): beats global-rate and road-class baselines on Brier and AUC with lamps visible. Measured after LI (Plymouth, 5 folds): Brier .119 against .121 for the road-class rate, AUC .847 against .820; lamps hidden Brier .128 (worse than .121), AUC .840. ECE .076 against .012 does not beat the class rate (known gap: road priors are deliberately shrunk below the observed .97).
- Lamp thinning (remove 50% of lamps on lit streets): route score never rises. Roads never rise; the only rises are isolated paths whose absence penalty switches off when area density falls below 2 per km (0.2% of ways with the tag hidden).
- Calibration archetypes (`tests/unit/safety/scoring/calibration.test.js`, 23:00): A 68-85, B 75-92, C 55-72, D 55-75, E (isolated unlit park path) 12-35, F 22-42, G 38-58, H1 (dead-end service lane, lighting unknown) 38-58, H2 (same lane, `lit=no`) 15-35, K 65-85; an all-E route reads Use Caution. Base weights after joint tuning: lighting .28, crime .25, road .15, activity .20, isolation .12.
- Property tests: more crime never raises score; known-dark <= unknown <= known-lit; score invariant to segment splitting; `eps` bounded risk.
- Crime temporal backtest: top-decile segments show lift over uniform and raw-count baselines (tool in `backend/scripts/eval`, runs when data is available; not a CI gate).
- Placebo: shuffled lamps give baseline skill.
- Frogmore to Thurlestone fixture: scores and ordering recorded before and after, differences explained in the PR.

### 11.7 Module interfaces (pure functions, CommonJS, `backend/src/safety/scoring/`)
- `darkness.js`: `sunElevationDeg({lat,lng,date})`; `darknessFactor({lat,lng,date})` smoothstep from 0 at elevation +6 deg to 1 at -6 deg; `darknessForHour({lat,lng,hour,now})`.
- `config.js`: constants. `weights.js`: `getWeights({darkness, safetyLevel})` renormalised. `evidence.js`: `evidenceStrength(n)` = `n/(n+EVIDENCE_PSEUDO_COUNT)`, shared by `lightingInference` and `edgeRisk`.
- `lightingInference.js`: `inferLighting({tags,lampCount30m,areaLampDensityPerKm,areaWayKm,nearRoad?,litNeighbour?})` -> `{pLit,n,source}`; `roadProximity.js`: `buildRoadProximityIndex(segments)`, `isNearRoad(index,lat,lng)`; `effectiveLit({pLit,n})`; `lightingCertainty`.
- `crimeRisk.js`: `crimeRisk({weightedCount,exposureKm,priorRate,priorStrength,status})` -> `{risk,lambda,n,status}`.
- `edgeRisk.js`: `edgeRisk({factors,weights,eps})` -> `{risk,certainty,dominantCause}`.
- `routeAggregate.js`: `aggregateRoute(edges,{g})` -> `{routeRisk,mean,m3,score,certainty,worstStretch}`; `exposure`; `rankRoutes(routes)`; `buildReason(best,all)`.
- API (additive): `safety.certainty`, `safety.reason`, `safety.worstStretch {start,end,lengthM,cause}`, `safety.dataQuality {crime,lighting}`, segment `risk`, `litEstimate`, `certainty`.
- Frontend `routeLayers(route, opts)` -> `{lines:[{coords,risk,dashed}],callouts:[{lat,lng,text}],crimeClusters:[{lat,lng,count}],lights:[...on demand]}`.

### 11.8 Owner-feedback additions (v0.4)
- **Prudent uncertainty load:** `risk' = risk + UNCERTAINTY_RISK_LOAD * (1 - certainty) * (1 - risk)` (0.23): what we do not know is priced in, so estimated-lighting streets always score below verified ones with the same estimate.
- **Crossing structures:** motorway/trunk classes are not sidewalk context. Sidewalk-vs-isolated is decided per OSM way (alongside a qualifying street for >= 60% of the length and roughly parallel), and a way that crosses a barrier road is a crossing structure (prior 0.30, isolated-path penalty applies unless tagged `lit=yes` or a lamp is within 60 m).
- **Avoidance candidates:** after the k normal candidates, up to 2 extra searches block the best route's weak stretches (risk >= 0.6, >= 60 m) with cost x25; results go through the normal exposure ranking.
- **Known limit:** an explicit `lit=yes` tag is ground truth, so a mis-tagged dark bridge still scores as lit (see TRACKER F28).


- 2026-10-19 v0.1 initial draft.
- 2026-10-19 v0.2 folded in R2/R3/R6 review (crime precompute, outage contract, security criteria, map comparison strip).
- 2026-10-19 v0.3 R1 review: units fixed (H ranking), blend eps, unknown ordering, crime EB, acceptance criteria, module interfaces.
- 2026-10-19 v0.3.1 P1a polish: 11.3 priors and urban-speed rule, 11.4 unusable crime dates counted at full weight, 11.5 contiguity-blind score with `worstStretch` reported, `evidence.js` added to 11.7. Spec now matches `scoring/config.js`.

## 12. Time, presence and remoteness (v0.5, owner feedback after first review)

Owner asks: (1) leave-at / arrive-by input and time-of-day danger; (2) town/city size matters (a town street is empty late, a city street is not); (3) more crimes is not less safe: a busy centre with lights/CCTV beats a quiet route; (4) a well-lit but remote park path is Moderate at night.
Design (four analyst memos synthesised):
- **Time:** API `leave_at` | `arrive_by` (ISO-8601 with offset; 400 if both or no offset; horizon [-5 min, +24 h]); legacy `departure_hour` kept as alias. Instant `t0` (arrive_by: t0 = arrive - ETA, re-search once if ETA error > 120 s). v1 evaluates the graph at the mid-walk instant `t0 + ETA/2` and reports start/arrival darkness in `meta.time` and per-route `timeline`; route cache key gets a 15-minute bucket. Walking speed constant unified (1.35 m/s). POI "open now" uses the chosen instant in London time, not the server clock. Implementation notes (backend/src/safety/routes/safeRoutesTime.js): arrive_by second pass rebuilds the graph once (darkness is baked into edges) using the safest raw route's duration as D; the cache key is `mode:floor(mid/15min)` (leave-now has no bucket, the 5 min TTL bounds it), so a cache hit within a bucket carries the first requester's exact timeline/meta.time instants; POI open-now is evaluated at the mid-walk instant.
- **Settlement class:** shipped gazetteer `backend/src/safety/data/settlements.json` (~1,000 cities/towns with population from OSM place nodes; ODbL attribution) with loader `scoring/settlements.js` `settlementClassAt(lat,lng)`; class from the settlement whose own radius of influence covers the point, `radiusKm = clamp(0.6*sqrt(population/1000), 0.8, 12)` (a fixed 5 km would not reach Brixton from London, 5.35 km); larger settlements win overlaps; suburbs only classify when no city/town covers the point (metropolis >= 1M, city >= 100k, largeTown >= 30k, town >= 5k, village, rural). Data path: `backend/src/safety/data/settlements.json` (ODbL, attribution in NOTICE.md).
- **Presence index** `P(hour, x) = clamp01(B(class) * (0.35 + 0.65*L(x)) * H(hour, type(x)) + LATE(x,hour))` with L = log10(1 + food/drink venues within 1 km)/log10(201); H curves for centre / residential / park types; LATE for venues open late within 80 m. Replaces the global NIGHT_DISCOUNT in the activity factor; hour-dependent activity floor.
- **Remoteness** `R0 = 0.40*ramp(distance to nearest non-path road; 25..150 m) + 0.30*(1 - ramp(non-path ways within 100 m; 0..10)) + 0.10*(1 - ramp(open places within 100 m; 0..10))`; hazard `H = R*(1-P)`, lit reduces it `H_eff = H*(1-0.35*L)`, edge safety multiplied by `(1 - HAZARD_STRENGTH*H_eff)`. **Implemented values (supersede the first draft):** `HAZARD_STRENGTH = 0.4` (0.6 put a lit interior park path at 36, below the Moderate band; 0.4 gives 42-49 at 23:00); remoteness has a dead zone: effective R ramps from 0 at `REMOTENESS.FREE = 0.3` to full at 0.8, so ordinary suburban streets (raw R 0.17-0.30) take no penalty; daylight makes the hazard zero. Pedestrian road-class scores were raised (footway 0.70, cycleway 0.66, pedestrian 0.72) so a lit park path is Safe by day (>= 60) and Moderate at night.
- **Crime:** pedestrian-relevance weights per category; non-violent pool divided by `(1 + k*P)^beta` (k 2, beta 0.5); violent/robbery/sexual never discounted; capped guardian bonus from CCTV/open venues.
- **Weak tags:** `lit=yes` on an isolated crossing structure with no lamp within 60 m counts as weak evidence; keep `bridge/layer/tunnel` in the ingestion keep-list (takes effect at next ingestion run).
- **Deferred:** land-use/building second ingestion pass, ONS polygons, user-report overrides.
