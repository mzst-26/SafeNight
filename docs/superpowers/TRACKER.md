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
| P0.4 | Owner approves spec | owner | n/a | todo | **gate** |
| P0.5 | Baseline: golden fixtures + current scores recorded | TBD | H | todo | before any change |
| P0.6 | Live-app baseline on localhost:8084 (3 routes, screenshots) | TBD | H | todo | browser, read-only |

## Phase 1: Scoring engine (backend/src/safety)

| ID | Task | Depends | Model | Status |
|----|------|---------|-------|--------|
| S1 | `darkness.js` sun elevation gate + tests | P0.4 | H | todo |
| S2 | OSM context extraction (landuse, buildings, maxspeed) in ingestion + tests | P0.4 | H→S? | todo |
| S3 | `lightingInference.js` P(lit)+n, mapping-completeness + tests | S1,S2 | S likely | todo |
| S4 | Crime: multi-month, recency, smoothing, outage=unknown + tests | P0.4 | H | todo |
| S5 | `edgeRisk.js` combiner + `weights.js` + property tests | S3,S4 | H | todo |
| S6 | Route aggregation (mean+weak link+longest stretch) + tests | S5 | H | todo |
| S7 | Ranking utility + reason generator + tests | S6 | H | todo |
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

## Findings queue (changes requested by reviewers)

| # | From | Task | Finding | Status |
|---|------|------|---------|--------|

## Change log

- 2026-10-19 created.
