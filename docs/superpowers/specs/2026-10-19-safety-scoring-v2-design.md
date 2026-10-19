# Safety Scoring v2 and Route Map Redesign: Design Spec

Branch: `feat/safety-scoring-v2` (worktree `SafeNight-worktrees/safety-v2`). Nothing merges to `main` until every gate in the Tracker is green.
Status: **DRAFT, awaiting owner approval.** Living document; revisions are logged at the bottom.

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

## Revision log

- 2026-10-19 v0.1 initial draft.
