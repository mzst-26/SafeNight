# Backend Test Layout

This backend uses three top-level test layers:

- `tests/unit`: fast tests for a single function behavior.
- `tests/integration`: endpoint and module interaction tests.
- `tests/system`: cross-service workflow checks.

## Rules

- One test should check one operation.
- Keep test names behavior-focused.
- Keep fixtures small and local to each test file.
- Prefer pure-function unit tests before integration tests.

## Directory Convention

- `tests/unit/<domain>/<module>/<behavior>.test.js`
- `tests/integration/<service>/<endpoint>.<behavior>.integration.test.js`
- `tests/system/<workflow-or-area>/<service>.<behavior>.system.test.js`

## Single-Operation Examples

- Unit: one validator function result for one input.
- Integration: one endpoint response for one invalid or valid request.
- System: one service-level contract check per test case.

## Current Unit Structure

- `tests/unit/shared/validation/*`
- `tests/unit/shared/middleware/*`
- `tests/unit/safety/geo/*`
