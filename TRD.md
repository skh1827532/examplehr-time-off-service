# Technical Requirements Document — Time-Off Microservice

**Project:** ExampleHR Time-Off Microservice
**Author:** Engineering
**Status:** Approved for Implementation
**Last Updated:** 2026-04-25

---

## 1. Executive Summary

ExampleHR ships a Time-Off module that lets employees request leave and lets managers approve it. The Human Capital Management system (HCM — Workday, SAP, etc.) is the **Source of Truth** for balances and the system that legally records leave. ExampleHR must (a) give employees an instant, accurate view of their balance, (b) prevent invalid requests, (c) reliably push approved requests to HCM, and (d) reconcile when HCM changes balances independently (anniversary refresh, year-start grants, manual HR adjustments).

This TRD specifies the **Time-Off Microservice** that owns this lifecycle and integration. The headline architectural choices are: **Outbox pattern** for reliable HCM writes, **optimistic concurrency** on local balance rows, an explicit **request state machine** that distinguishes "approved by manager" from "confirmed by HCM," and **dual reconciliation paths** (realtime webhook + periodic batch) so we never silently diverge.

---

## 2. Goals & Non-Goals

### 2.1 Goals
- G1. Employees see an accurate, near-real-time balance per (employee, location).
- G2. Pre-flight rejection of invalid requests (insufficient balance, unknown location) without round-tripping HCM in the common case.
- G3. Every approved request is durably persisted in HCM exactly once, even across HCM downtime, network failures, or service restarts.
- G4. When HCM changes balances independently, ExampleHR converges to the new balance within seconds (webhook) or minutes (batch fallback) — and any in-flight requests are re-validated.
- G5. Defensive against silent HCM bugs: we never assume HCM accepted a write because it returned 200; we verify.
- G6. Test coverage ≥ 85 % on services and ≥ 75 % overall, with all eight named challenge scenarios covered by integration tests.

### 2.2 Non-Goals
- Multi-tenancy. Single tenant per service instance.
- Real authentication. A header-based stub (`x-employee-id`, `x-role`) is sufficient — production will sit behind ExampleHR's gateway.
- UI. Backend service only.
- Notifications (email/Slack/push) on approval.
- Carry-over policy, accrual computation, partial-day leave, time-off types other than a single generic balance per (employee, location). These belong in HCM and/or a future policy module.
- Historical analytics or reporting endpoints.

---

## 3. Personas & Primary User Journeys

| Persona | Need | Endpoint(s) used |
|---|---|---|
| Employee | See accurate balance; submit a request; see status update | `GET /balances`, `POST /time-off-requests`, `GET /time-off-requests/:id` |
| Manager | Review pending requests; approve / reject knowing data is valid | `GET /time-off-requests?status=PENDING_APPROVAL`, `POST /…/approve`, `POST /…/reject` |
| HCM | Push a balance change to ExampleHR; deliver a full batch dump nightly | `POST /webhooks/hcm/balance-updated`, `POST /sync/hcm/batch` |
| HR / Ops | Inspect sync log, replay failed outbox events | `GET /admin/sync-log`, `POST /admin/outbox/:id/replay` |

---

## 4. Domain Model

### 4.1 Entities

```
Employee (employeeId PK, name, defaultLocationId, createdAt)
Location (locationId PK, name, country, createdAt)
Balance  (id PK, employeeId FK, locationId FK, balanceDays DECIMAL(8,2),
          version INT, hcmUpdatedAt TIMESTAMP, lastSyncedAt TIMESTAMP,
          UNIQUE(employeeId, locationId))
TimeOffRequest (id UUID PK, employeeId FK, locationId FK,
                startDate DATE, endDate DATE, days DECIMAL(8,2),
                reason VARCHAR(500),
                status ENUM, decidedBy VARCHAR, decidedAt TIMESTAMP,
                hcmTransactionId VARCHAR, hcmConfirmedAt TIMESTAMP,
                rejectionReason VARCHAR(500),
                createdAt, updatedAt, version INT)
OutboxEvent  (id UUID PK, aggregateType, aggregateId, eventType,
              payload JSON, status ENUM, attempts INT,
              nextAttemptAt TIMESTAMP, lastError TEXT,
              createdAt, updatedAt)
HcmSyncLog   (id PK, direction ENUM(INBOUND,OUTBOUND), kind ENUM(REALTIME,BATCH,WEBHOOK),
              employeeId, locationId, payload JSON, result ENUM(OK,DRIFT,ERROR),
              detail TEXT, createdAt)
IdempotencyKey (key PK, scope, response JSON, createdAt) -- 24h TTL
```

### 4.2 TimeOffRequest State Machine

```
                   ┌────────────────────┐
                   │  PENDING_APPROVAL  │  (created by employee)
                   └──────┬─────────────┘
                          │ manager approves
                          ▼
                   ┌────────────────────┐
                   │   APPROVED         │  (locally approved, not yet in HCM)
                   └──────┬─────────────┘
                          │ outbox worker calls HCM
                  ┌───────┴──────────┐
              200 OK                 4xx / drift detected
                  │                       │
                  ▼                       ▼
        ┌──────────────────┐   ┌──────────────────┐
        │  HCM_CONFIRMED   │   │  HCM_REJECTED    │ (terminal — balance refunded)
        └──────────────────┘   └──────────────────┘

  Side branches from any non-terminal state:
   PENDING_APPROVAL ──manager rejects──▶ REJECTED (terminal)
   PENDING_APPROVAL ──employee cancels──▶ CANCELLED (terminal)
   APPROVED         ──employee cancels──▶ CANCELLED (terminal, refund pushed to HCM)
```

**Why two terminal "success" states are wrong** — we considered collapsing `APPROVED` and `HCM_CONFIRMED` into one, but then a manager UI cannot distinguish "I approved it 3s ago, HCM hasn't acked yet" from "HCM acked, this is final." That distinction matters when HCM rejects after manager approval.

**Refund semantics.** When a request transitions to `HCM_REJECTED` or `CANCELLED` after balance was decremented, the decrement is reversed in the same transaction that writes the new state. The refund itself is also outboxed if HCM had already accepted the original write.

---

## 5. API Surface

All responses are JSON. All write endpoints accept an `Idempotency-Key` header (required for `POST /time-off-requests`, optional elsewhere).

### 5.1 Employee / Manager APIs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/employees/:employeeId/balances` | List balances for all locations the employee has |
| `GET` | `/employees/:employeeId/balances/:locationId?refresh=true` | Single balance; `refresh=true` forces a realtime HCM pull and updates local cache |
| `POST` | `/time-off-requests` | Create a request. Body: `{employeeId, locationId, startDate, endDate, days, reason}`. Returns 201 with the request, or 422 with validation error (insufficient balance, unknown location, overlapping request) |
| `GET` | `/time-off-requests/:id` | Read one |
| `GET` | `/time-off-requests?employeeId=&status=` | List with filters |
| `POST` | `/time-off-requests/:id/approve` | Manager approves. Body: `{managerId}` |
| `POST` | `/time-off-requests/:id/reject` | Manager rejects. Body: `{managerId, reason}` |
| `POST` | `/time-off-requests/:id/cancel` | Employee or manager cancels |

### 5.2 HCM-Facing APIs (Inbound)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/webhooks/hcm/balance-updated` | Single balance change push from HCM. Body: `{employeeId, locationId, balanceDays, hcmUpdatedAt, source}` |
| `POST` | `/sync/hcm/batch` | Full corpus dump. Body: `{generatedAt, balances: [{employeeId, locationId, balanceDays, hcmUpdatedAt}]}`. Triggers reconciliation. |

### 5.3 Admin / Ops APIs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/sync-log?since=&kind=` | Recent sync events |
| `GET` | `/admin/outbox?status=FAILED` | Failed outbox events |
| `POST` | `/admin/outbox/:id/replay` | Force-retry a failed outbox event |
| `POST` | `/admin/sync/full-pull` | Trigger an on-demand full pull from HCM (uses HCM's batch endpoint as a source) |

### 5.4 Error Contract

All errors follow:
```json
{ "statusCode": 422, "code": "INSUFFICIENT_BALANCE",
  "message": "Requested 5 days, available 3", "details": {...} }
```

Domain error codes: `INSUFFICIENT_BALANCE`, `UNKNOWN_LOCATION`, `OVERLAPPING_REQUEST`, `INVALID_TRANSITION`, `HCM_REJECTED`, `HCM_UNAVAILABLE`, `STALE_BALANCE` (optimistic-lock retry hint), `IDEMPOTENCY_CONFLICT`.

---

## 6. The Five Hard Problems & How We Solve Them

### 6.1 Source-of-Truth Conflicts (HCM changes balances out-of-band)

**Problem.** HCM grants 5 anniversary days at midnight. ExampleHR shows the old balance for hours until someone notices.

**Solution.** Two-track convergence:
1. **Webhook (realtime).** HCM posts to `/webhooks/hcm/balance-updated` whenever it mutates a balance. We update the local row, log to `HcmSyncLog`, and re-validate any `PENDING_APPROVAL` requests for that (employee, location).
2. **Batch (safety net).** HCM (or our scheduler) calls `/sync/hcm/batch` nightly with the full corpus. Reconciliation:
   - For each row, if `hcm.balanceDays != local.balanceDays`, we accept HCM's value, write a `DRIFT` entry to `HcmSyncLog`, and re-validate dependent in-flight requests.
   - For balances present locally but missing from HCM, we mark them `STALE` and stop allowing requests.
   - For balances present in HCM but missing locally, we create them.

**Why both?** Webhooks are fast but unreliable (lost messages, customer firewalls). Batch is slow but exhaustive. Together they give us low latency in the happy path and guaranteed correctness within the batch interval in the worst case.

### 6.2 Defensive Validation (HCM may silently accept invalid requests)

**Problem.** The brief explicitly warns that HCM does not always reject invalid combinations. We cannot trust a 200.

**Solution.** Three layers:
1. **Local pre-flight.** Validate location exists, days > 0, dates are sane, employee has sufficient local balance, no overlapping accepted request.
2. **Realtime HCM check on approval.** Before transitioning to `APPROVED`, optionally re-pull the balance via HCM realtime API (configurable, default on for requests > 5 days).
3. **Post-write verification.** After HCM ack, the next batch reconciliation acts as a tripwire: if HCM's reported balance does not equal `previous - approved_days`, we log `DRIFT` and page Ops.

We **do not** auto-roll-back on detected drift — HCM is still the source of truth, and the drift may be from another legitimate event. We expose drift via the admin API and let humans investigate.

### 6.3 Reliable HCM Writes (network flakes, HCM downtime, restarts)

**Problem.** A request is `APPROVED` locally; we crash mid-call to HCM. On restart, did HCM record it? Did we double-write?

**Solution.** **Transactional Outbox.**
- Approving a request writes the new request status **and** an `OutboxEvent(type=HCM_SUBMIT_REQUEST, payload={…, idempotencyKey})` in the **same SQLite transaction**.
- A background worker drains `OutboxEvent` rows (`status=PENDING`), POSTs to HCM with the idempotency key, and updates the event to `SENT` or `FAILED` with retry backoff (exponential, jittered, max 8 attempts over ~6 hours).
- On worker restart, the outbox is replayed automatically — no work is ever lost.
- Idempotency keys are generated server-side (`requestId + ":submit"` for the initial submit, `requestId + ":refund"` for cancellation). HCM is responsible for de-duping; our mock does this in-memory.

### 6.4 Concurrent Requests Racing the Same Balance

**Problem.** Employee submits two requests in quick succession; both pass the pre-flight check against the same balance row.

**Solution.** **Optimistic concurrency control** on `Balance.version`. Every read returns the version; every write asserts the version. On conflict, we retry up to 3 times with a fresh read; on persistent conflict the second request fails with `STALE_BALANCE` and the client retries.

We chose optimistic over pessimistic locking because (a) SQLite's locking is database-wide rather than row-wise, (b) the conflict window is tiny in practice, and (c) it keeps the read path lock-free.

### 6.5 In-Flight Requests During HCM Balance Refresh

**Problem.** Employee has 2 days, requests 2 days (status `PENDING_APPROVAL`). Overnight HCM resets them to 0 (correction). Manager approves the next morning — should not succeed.

**Solution.** Whenever a `Balance` row is updated from HCM (webhook or batch), we re-evaluate every `PENDING_APPROVAL` and `APPROVED` request for that (employee, location):
- If the new balance is now insufficient, `PENDING_APPROVAL` → `HCM_REJECTED` with `reason=balance_revoked`.
- `APPROVED` requests already outboxed are left to HCM's authoritative response — HCM will reject them, our outbox worker will mark them `HCM_REJECTED`.

---

## 7. Architecture

```
                    ┌─────────────────────────────────────────┐
                    │     Time-Off Microservice (NestJS)      │
                    │                                         │
   Employee ───────▶│  Controllers ─▶ Services ─▶ Repositories│
   Manager  ───────▶│       │             │           │       │
                    │       │             ▼           ▼       │
                    │       │       State Machine   SQLite    │
                    │       │             │           ▲       │
                    │       │             ▼           │       │
                    │       │         Outbox ─────────┘       │
                    │       │             │                   │
                    │       │             ▼                   │
                    │       │      Outbox Worker (cron)       │
                    │       │             │                   │
                    │       ▼             ▼                   │
                    │   HCM Client (axios + retry + circuit)  │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │       Mock HCM (NestJS)                 │
                    │  /balances, /balances/batch,            │
                    │  /transactions (idempotent),            │
                    │  /admin/* (failure-mode toggles)        │
                    └─────────────────────────────────────────┘
```

### 7.1 Technology Choices

| Area | Choice | Why |
|---|---|---|
| Framework | NestJS 10 | Required by brief; strong DI, clear module boundaries |
| Persistence | SQLite via TypeORM | Required by brief; TypeORM gives migrations, optimistic locking via `@VersionColumn`, and a clean swap to Postgres later |
| Validation | class-validator + class-transformer | Idiomatic Nest |
| HTTP client | axios + axios-retry | Mature retry semantics; pluggable |
| Scheduling | @nestjs/schedule | Cron syntax, in-process — fine for single-instance assumption |
| Testing | Jest + Supertest + sqlite-memory | Idiomatic Nest; in-memory DB for fast e2e |
| Mock HCM | Second NestJS app in same monorepo | Same toolchain, easy to deploy; programmable failure modes |

### 7.2 Modules

```
apps/
  time-off-service/src/
    employees/        — read-only employee directory
    locations/        — read-only location directory
    balances/         — Balance entity, repository, service, controller
    time-off-requests/— Request entity, state machine, service, controller
    hcm/              — HcmClient, DTOs, error mapping
    outbox/           — Entity, worker, replay endpoint
    sync/             — Webhook + batch reconciliation
    admin/            — Ops endpoints
    common/           — guards, filters, idempotency middleware, errors
  mock-hcm/src/
    balances/, transactions/, admin/
```

---

## 8. Alternatives Considered

### 8.1 Event Sourcing for the Balance
**Considered:** Store every balance mutation as an event; project current balance.
**Rejected because:** SQLite + assessment scope; HCM is already the source of truth so we'd be duplicating its event log; complexity not justified.

### 8.2 Pessimistic Row Locks (SELECT … FOR UPDATE)
**Considered:** Lock the balance row when validating a request.
**Rejected because:** SQLite locks the entire database; conflict probability is low; optimistic locking has fewer failure modes and better read throughput.

### 8.3 Synchronous HCM Calls in the Request Path
**Considered:** Skip the outbox; call HCM inside `POST /time-off-requests/:id/approve`.
**Rejected because:** HCM downtime would block managers. The outbox decouples user-facing latency from HCM availability and gives us automatic retry for free.

### 8.4 Polling HCM Instead of Webhooks
**Considered:** Drop webhooks; poll the realtime API every N minutes.
**Rejected because:** Polling at scale is expensive (employees × locations × frequency); webhook-or-batch covers both speed and reliability without the polling cost.

### 8.5 Single Terminal "Success" State
**Considered:** Collapse `APPROVED` and `HCM_CONFIRMED`.
**Rejected because:** The manager UI needs to surface "HCM hasn't confirmed yet" and the system needs a state to distinguish the windowing where a refund may still be needed.

### 8.6 Kafka / Outbox-via-CDC
**Considered:** Use Debezium or similar to stream the outbox table.
**Rejected because:** Massive overkill for SQLite + single-tenant; in-process worker is correct for this scope.

### 8.7 GraphQL vs REST
**Considered:** GraphQL surface (the brief allows it).
**Rejected because:** REST is simpler to test against, simpler to document, and the access patterns are not obviously graph-shaped. No clients to optimize.

---

## 9. Failure Modes & Operational Concerns

| Failure | Detection | Response |
|---|---|---|
| HCM 5xx on submit | Outbox worker | Exponential backoff retry; circuit-breaks after 5 consecutive failures |
| HCM 4xx on submit (validation) | Outbox worker | Mark request `HCM_REJECTED`, refund balance, mark outbox `FAILED_PERMANENT` |
| HCM webhook lost | Next batch reconciliation | `DRIFT` log entry + balance corrected |
| HCM batch missing rows | Reconciler | Local row marked `STALE`, requests blocked, alert |
| Service crash mid-approval | Restart | Outbox replays pending events; idempotency key prevents double-write |
| SQLite locked / write contention | Optimistic lock | Retry up to 3x, then surface `STALE_BALANCE` to client |
| Idempotency key reused with different payload | Middleware | 409 `IDEMPOTENCY_CONFLICT` |
| Clock drift between ExampleHR and HCM | `hcmUpdatedAt` comparison | Always trust HCM's timestamp; never our `updatedAt` for source-of-truth comparisons |

---

## 10. Test Strategy

The test suite is structured as a pyramid plus a scenario layer dedicated to the five hard problems above.

### 10.1 Unit (Jest)
- Pure logic: state-machine transitions, balance arithmetic, date-range overlap, outbox backoff calculation.
- Service-level with mocked repositories.

### 10.2 Integration (Jest + Supertest + in-memory SQLite + in-process Mock HCM)
- Controller → Service → Real SQLite → Real Mock HCM, all in one process.
- Each test gets a fresh DB and a fresh Mock HCM instance.

### 10.3 Scenario / Acceptance tests (named after Section 6)

| # | Scenario | Pass criterion |
|---|---|---|
| S1 | Insufficient balance pre-flight | `POST /time-off-requests` with days > balance returns 422; no DB row written |
| S2 | Happy path → HCM ack | Request transitions PENDING → APPROVED → HCM_CONFIRMED; balance decremented exactly once |
| S3 | HCM rejects after approval | Outbox marks `HCM_REJECTED`; balance refunded; second submit attempt blocked |
| S4 | HCM silently accepts invalid | Drift detected by next batch; `HcmSyncLog.result=DRIFT` recorded |
| S5 | Anniversary refresh during pending | Webhook updates balance; pending request is re-validated; if now insufficient, transitions to `HCM_REJECTED` with `reason=balance_revoked` |
| S6 | Concurrent requests race | Two `POST` in parallel for same employee with sum > balance: one succeeds, one fails `STALE_BALANCE` |
| S7 | HCM down during approval | Worker keeps retrying; request stays `APPROVED`; once HCM recovers, ack arrives, transitions to `HCM_CONFIRMED` |
| S8 | Idempotent submit | Same `Idempotency-Key` returns the same response and creates only one request |
| S9 | Cancellation refund | Cancel an `HCM_CONFIRMED` request; refund event outboxed; balance restored on HCM ack |
| S10 | Batch reconciliation creates missing local row | HCM batch contains (emp, loc) we don't have; local row created |

### 10.4 Coverage targets
- Statements ≥ 85 %, branches ≥ 80 % on `apps/time-off-service/src/**/*.service.ts` and `**/state-machine.ts`.
- Statements ≥ 75 % overall.
- A `COVERAGE.md` is generated alongside the lcov report summarizing per-module numbers and any deliberately uncovered lines (e.g., NestJS bootstrap).

---

## 11. Out-of-Scope Risks & Future Work

- **Horizontal scaling.** The outbox worker is in-process. To run > 1 instance, we'd need either a leader-election lock around the worker or a `SELECT … FOR UPDATE SKIP LOCKED` claim pattern on the outbox (Postgres-only).
- **Partial-day leave & multiple leave types.** Today the model is `decimal balanceDays` per (employee, location). Production should add a `leaveType` dimension and a fractional-days policy.
- **Audit immutability.** `HcmSyncLog` is append-only by convention but nothing enforces that. Production should write to a separate audit store.
- **Tenant isolation.** The current design assumes one tenant per service.

---

## 12. Implementation Sequence

1. Scaffold monorepo, both apps boot.
2. Entities + migrations + seed.
3. Mock HCM with happy-path endpoints.
4. HCM client + outbox skeleton.
5. Balance read/refresh.
6. Request creation + state machine + manager endpoints.
7. Outbox worker + idempotency.
8. Webhook + batch reconciliation.
9. Admin endpoints.
10. Test suite (unit → integration → scenario).
11. Coverage report + README.
