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
| S2 | OSM context (landuse/buildings) = PHASE 2 optional; v1 fixes: keep tunnel tag, unit-aware maxspeed | P0.4 | H | deferred |
| S3 | `lightingInference.js` + tests (tags only, v1) | none | H | review done: CHANGES (fix pass B) |
| S4a | `crimeRisk.js` pure EB model + tests | none | H | review done: CHANGES (fix pass B) |
| S4b | Crime aggregation job (osm-ingestion, 500 m cells, 12 months) + outage contract + client | S4a | H/S | todo |
| S5 | `config.js`, `weights.js`, `edgeRisk.js` + property tests | none | H | review done: CHANGES (fix pass B) |
| S6/S7 | `routeAggregate.js` (aggregate, exposure rank, reason) + tests | none | H | review done: CHANGES (fix pass A) |
| S7b | Integration: wire modules into safetyGraph/formatter; fix riskVector inversion, maxspeed units, sidewalk unknown, dead-end double count | S1,S3,S4a,S5,S6 | S | todo |
| S8 | A* uses edgeRisk; fix dead-end, open-state clock | S5 | H | todo |
| S9 | Formatter/API additive fields, crime clustering + contract tests | S6,S7 | H | todo |
| S10 | Integration tests `/safe-routes` | S8,S9 | H | todo |

## Phase 2: Map (frontend)

| ID | Task | Depends | Model | Status |
|----|------|---------|-------|--------|
| M1 | `routeLayers` pure builder + tests | S9 contract | H | todo |
| M2 | Web (Leaflet) renders layers; remove purple boxes/dots | M1 | H | todo |
| M3 | Native (MapLibre) parity | M1 | H | todo |
| M4 | Legend chip, worst-stretch callout, filter consistency | M2 | H | todo |
| M5 | Route card shows reason/certainty (route data only) | S9 | H | todo |
| M6 | Browser verification on :8084 + screenshots | M2-M5 | H | todo |

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

## Review log (round Phase-1a, commit 4515237)

- R1 a188c: CHANGES: NaN/range validation, null-factor-as-good (decision: neutral prior n=0), rankRoutes shortest kept, tag normalisation, maxspeed list.
- R4 a4997: CHANGES: duplicated constants (G, N0, severity table), config 'all tunables' claim, shared validation.
- R5 a4450: CHANGES: mutation survivors (certainty weights, smoothstep, rounding, thresholds), uncovered buildReason branches.
- Fix pass A ab9f3 (routeAggregate), fix pass B a00a1 (other modules) running. M1 adcb1 (frontend routeLayers) running.
- Note: one unreproduced full-suite failure seen once (likely concurrent writes); watch for flake.

## Findings queue (changes requested by reviewers)

| # | From | Task | Finding | Status |
|---|------|------|---------|--------|

## Change log

- 2026-10-19 created.
