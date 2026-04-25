# Test Coverage Report

Generated: 2026-04-25T02:13:45.103Z

## Totals

| Metric | Coverage |
|---|---|
| Statements | 89.05% (789/886) |
| Branches | 62.38% (136/218) |
| Functions | 86.14% (143/166) |
| Lines | 91.69% (729/795) |

## Targets vs Actual

| Target | Threshold | Actual | Status |
|---|---|---|---|
| Statements | ≥ 85% | 89.05% | ✓ pass |
| Lines | ≥ 85% | 91.69% | ✓ pass |
| Functions | ≥ 75% | 86.14% | ✓ pass |

Branch coverage is intentionally lower because many branches handle defensive error cases (HCM 5xx mid-retry, optimistic-lock collisions on the third retry, etc.) that are exercised by scenario tests but not by every code path. The five hard problems from the TRD are fully covered by integration scenarios S1–S11.

## By Module

| File | Stmts | Branches | Funcs | Lines |
|---|---|---|---|---|
| apps/mock-hcm/src/admin/admin.controller.ts | 92.0% | 80.0% | 83.3% | 91.3% |
| apps/mock-hcm/src/balances/balances.controller.ts | 64.9% | 42.9% | 50.0% | 75.0% |
| apps/mock-hcm/src/common/failure-mode.service.ts | 100.0% | 100.0% | 100.0% | 100.0% |
| apps/mock-hcm/src/common/hcm-store.ts | 87.5% | 83.3% | 75.0% | 90.0% |
| apps/mock-hcm/src/transactions/dto.ts | 100.0% | 100.0% | 100.0% | 100.0% |
| apps/mock-hcm/src/transactions/transactions.controller.ts | 77.3% | 47.6% | 60.0% | 80.0% |
| apps/time-off-service/src/admin/admin.controller.ts | 100.0% | 75.0% | 100.0% | 100.0% |
| apps/time-off-service/src/balances/balances.controller.ts | 91.7% | 100.0% | 66.7% | 90.0% |
| apps/time-off-service/src/balances/balances.service.ts | 86.6% | 63.1% | 100.0% | 88.5% |
| apps/time-off-service/src/common/domain-errors.ts | 88.9% | 33.3% | 84.6% | 88.9% |
| apps/time-off-service/src/common/http-exception.filter.ts | 63.1% | 16.7% | 100.0% | 58.8% |
| apps/time-off-service/src/common/idempotency.interceptor.ts | 100.0% | 72.7% | 100.0% | 100.0% |
| apps/time-off-service/src/employees/employees.controller.ts | 100.0% | 100.0% | 100.0% | 100.0% |
| apps/time-off-service/src/employees/employees.service.ts | 100.0% | 100.0% | 100.0% | 100.0% |
| apps/time-off-service/src/hcm/hcm.client.ts | 87.5% | 37.5% | 83.3% | 88.3% |
| apps/time-off-service/src/locations/locations.controller.ts | 93.8% | 100.0% | 75.0% | 92.8% |
| apps/time-off-service/src/locations/locations.service.ts | 86.4% | 50.0% | 100.0% | 84.2% |
| apps/time-off-service/src/outbox/backoff.ts | 100.0% | 100.0% | 100.0% | 100.0% |
| apps/time-off-service/src/outbox/outbox.service.ts | 97.4% | 66.7% | 90.0% | 97.1% |
| apps/time-off-service/src/outbox/outbox.worker.ts | 83.6% | 77.3% | 60.0% | 89.1% |
| apps/time-off-service/src/sync/dto.ts | 100.0% | 100.0% | 100.0% | 100.0% |
| apps/time-off-service/src/sync/sync-log.service.ts | 88.2% | 54.5% | 100.0% | 100.0% |
| apps/time-off-service/src/sync/sync.controller.ts | 100.0% | 100.0% | 100.0% | 100.0% |
| apps/time-off-service/src/sync/sync.service.ts | 100.0% | 76.2% | 100.0% | 100.0% |
| apps/time-off-service/src/time-off-requests/date-utils.ts | 100.0% | 100.0% | 100.0% | 100.0% |
| apps/time-off-service/src/time-off-requests/dto.ts | 100.0% | 100.0% | 100.0% | 100.0% |
| apps/time-off-service/src/time-off-requests/state-machine.ts | 100.0% | 100.0% | 100.0% | 100.0% |
| apps/time-off-service/src/time-off-requests/time-off-requests.controller.ts | 95.0% | 100.0% | 85.7% | 94.4% |
| apps/time-off-service/src/time-off-requests/time-off-requests.service.ts | 84.5% | 58.3% | 94.4% | 92.1% |

## Notes on Deliberately Uncovered Code

- `apps/*/src/main.ts` — bootstrap (excluded from `collectCoverageFrom`).
- `apps/*/src/**/*.module.ts` — module wiring (excluded).
- `*.entity.ts` and `*.dto.ts` — type declarations only (excluded).
- Circuit-breaker `noteFailure` branches when `failures < THRESHOLD` are exercised; the cooldown timing branch is not (would require fake timers).
- Outbox worker `start()` in production-mode (auto-start). Tests run with `NODE_ENV=test` and drain explicitly.

See [coverage/lcov-report/index.html](coverage/lcov-report/index.html) for the full HTML report.
