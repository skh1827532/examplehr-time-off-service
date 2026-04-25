# ExampleHR Time-Off Microservice

A NestJS microservice that owns the lifecycle of time-off requests for ExampleHR while keeping a faithful, eventually-consistent view of balances held in the customer's HCM (Workday, SAP, etc.).

**Repository:** https://github.com/skh1827532/examplehr-time-off-service

> **Documents:** [TRD.md](TRD.md) — full design rationale and alternatives considered. [COVERAGE.md](COVERAGE.md) — test coverage report.

---

## What's in here

```
apps/
  time-off-service/   The microservice (NestJS + SQLite)
  mock-hcm/           A second NestJS app that simulates the HCM with programmable failure modes
test/
  scenarios/          11 end-to-end scenario suites covering S1–S11 from the TRD
  unit/               Unit tests for services, client, admin endpoints
TRD.md                Engineering specification
COVERAGE.md           Generated coverage report
```

---

## Getting started

### Prerequisites
- **Node.js 20+** (check with `node --version`) — the only thing you need installed
- macOS / Linux / Windows (WSL) — pure Node, no native build tools required beyond what `npm install` handles

### If you received a zip
```bash
unzip examplehr-time-off-submission.zip
cd ASSESSMENT-WIZDAA
```

### If you cloned from GitHub
```bash
git clone git@github.com:skh1827532/examplehr-time-off-service.git
cd examplehr-time-off-service
```

### Then — same for both
```bash
npm install              # ~30s, installs dependencies into node_modules/
npm test                 # ~6s, runs all 93 tests — should print "Tests: 93 passed, 93 total"
npm run test:cov         # optional — generates HTML coverage report under coverage/
```

If `npm test` prints **`Tests: 93 passed, 93 total`** you're done verifying. The rest is for trying the running service.

---

## Quick start (run the live service)

```bash
cp .env.example .env

# Run both services together (Mock HCM on :4000, Time-Off on :3000)
npm run start:all

# In another terminal — seed and try it:
curl -X POST localhost:4000/admin/seed/balances \
  -H 'content-type: application/json' \
  -d '{"balances":[{"employeeId":"E1","locationId":"NYC","balanceDays":10}]}'
curl -X POST localhost:3000/locations \
  -H 'content-type: application/json' \
  -d '{"locationId":"NYC","name":"New York","country":"US"}'
curl -X POST localhost:3000/employees \
  -H 'content-type: application/json' \
  -d '{"employeeId":"E1","name":"Alice","defaultLocationId":"NYC"}'
curl -X POST localhost:3000/admin/sync/full-pull   # warm local cache from HCM

# Submit a time-off request
curl -X POST localhost:3000/time-off-requests \
  -H 'content-type: application/json' \
  -H 'idempotency-key: req-001' \
  -d '{"employeeId":"E1","locationId":"NYC","startDate":"2026-05-01","endDate":"2026-05-02","days":2}'
```

---

## Tests

```bash
npm test                      # all 93 tests
npm run test:scenarios        # only the S1–S11 acceptance scenarios
npm run test:cov              # with coverage
```

Current totals (see [COVERAGE.md](COVERAGE.md) for details):

| Statements | Lines | Functions | Branches |
|---|---|---|---|
| 89.05% | 91.69% | 86.14% | 62.38% |

The 11 scenario suites correspond exactly to the **named hard problems** in the TRD:

| File | Scenario |
|---|---|
| `s1-insufficient-balance.spec.ts` | Pre-flight rejection of bad requests |
| `s2-happy-path.spec.ts` | Full PENDING → APPROVED → HCM_CONFIRMED lifecycle |
| `s3-hcm-rejects.spec.ts` | HCM 4xx after manager approval — local rollback + balance refund |
| `s4-hcm-silent-accept.spec.ts` | HCM "lies" with 200 — drift detected by next batch |
| `s5-anniversary-refresh.spec.ts` | HCM webhook revokes balance — pending requests re-validated |
| `s6-concurrent-requests.spec.ts` | Race two requests; one wins, one fails INSUFFICIENT_BALANCE |
| `s7-hcm-down-recovery.spec.ts` | HCM 503 → outbox retries → eventual HCM_CONFIRMED |
| `s8-idempotency.spec.ts` | Idempotency-Key header, both for our API and our HCM client |
| `s9-cancellation.spec.ts` | Cancel a confirmed request → CREDIT outboxed to HCM |
| `s10-batch-reconciliation.spec.ts` | Batch creates, drifts, and stales |
| `s11-balance-refresh-endpoint.spec.ts` | `?refresh=true` realtime pull |

---

## Architecture (one-paragraph version)

The service writes locally first inside a single SQLite transaction (state change + balance debit + an **OutboxEvent** row). A background worker drains the outbox and POSTs to HCM with a server-generated **idempotency key**, then transitions the request to `HCM_CONFIRMED` (success) or `HCM_REJECTED` + balance refund (4xx). Outbound retries use **exponential backoff with jitter** capped at 5 minutes; the client has a small **circuit breaker** to avoid hammering a sick HCM. Inbound updates from HCM arrive via a **realtime webhook** (`POST /webhooks/hcm/balance-updated`) and a **nightly batch** (`POST /sync/hcm/batch`); the batch is the safety net for missed webhooks and is the only path that can mark a local row `STALE` (when HCM stops reporting it). After every balance change we **re-validate non-terminal requests** for that (employee, location) and revoke any whose projected balance went negative. **Optimistic concurrency** (`@VersionColumn`) guards the balance row.

Full rationale and alternatives in [TRD.md](TRD.md).

---

## Mock HCM

The mock is a real second Nest app with a small in-memory store and **programmable failure modes**:

| Mode | Behavior |
|---|---|
| `NORMAL` | Validates, persists, returns 200 |
| `DOWN` | 503 on every endpoint |
| `SILENT_ACCEPT` | Returns 200 but does **not** mutate the balance — the brief's "may not always reject" case |
| `REJECT_ALL` | 422 `HCM_REJECTED` on every write |
| `INSUFFICIENT_BALANCE` | 422 `INSUFFICIENT_BALANCE` on every write |
| `FLAKY` | First attempt of each idempotency key 502s, retries succeed |

Toggle with `POST /admin/failure-mode`:

```bash
curl -X POST localhost:4000/admin/failure-mode \
  -H 'content-type: application/json' \
  -d '{"mode":"FLAKY"}'
```

---

## REST API (Time-Off Service)

| Method | Path |
|---|---|
| `GET` | `/employees/:employeeId/balances` |
| `GET` | `/employees/:employeeId/balances/:locationId?refresh=true` |
| `POST` | `/time-off-requests` (Idempotency-Key header) |
| `GET` | `/time-off-requests/:id` |
| `GET` | `/time-off-requests?employeeId=&status=` |
| `POST` | `/time-off-requests/:id/approve` |
| `POST` | `/time-off-requests/:id/reject` |
| `POST` | `/time-off-requests/:id/cancel` |
| `POST` | `/webhooks/hcm/balance-updated` |
| `POST` | `/sync/hcm/batch` |
| `GET` | `/admin/sync-log?kind=&result=` |
| `GET` | `/admin/outbox?status=` |
| `POST` | `/admin/outbox/:id/replay` |
| `POST` | `/admin/outbox/drain` |
| `POST` | `/admin/sync/full-pull` |

Domain error codes returned in the body's `code` field:
`INSUFFICIENT_BALANCE`, `UNKNOWN_LOCATION`, `UNKNOWN_EMPLOYEE`, `OVERLAPPING_REQUEST`, `INVALID_TRANSITION`, `INVALID_DATE_RANGE`, `HCM_REJECTED`, `HCM_UNAVAILABLE`, `STALE_BALANCE`, `BALANCE_STALE_BLOCKED`, `IDEMPOTENCY_CONFLICT`, `NOT_FOUND`.

---

## Configuration

See [.env.example](.env.example).

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Time-Off service port |
| `MOCK_HCM_PORT` | 4000 | Mock HCM port |
| `DATABASE_PATH` | `./data/time-off.sqlite` | SQLite file (use `:memory:` in tests) |
| `HCM_BASE_URL` | `http://localhost:4000` | Where the HCM client points |
| `HCM_REQUEST_TIMEOUT_MS` | 5000 | Per-request timeout |
| `HCM_MAX_RETRIES` | 3 | axios-retry retries on 5xx |
| `OUTBOX_WORKER_INTERVAL_MS` | 2000 | Drain frequency |
| `OUTBOX_MAX_ATTEMPTS` | 8 | Permanent-fail threshold |
| `OUTBOX_AUTO_START` | (auto) | Set to `false` to disable scheduler (set automatically in tests) |

---

## Docker

```bash
docker compose up --build
```

Brings up both services and exposes 3000 (Time-Off) and 4000 (Mock HCM).
