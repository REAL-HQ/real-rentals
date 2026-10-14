# Bookings Phase 2B — Safe Vehicle Release (review only)

Base: development main `681a00c0423bd3ecf64c9521662cfb0f9e0889d9`. No hosted operations or live Stripe calls.

## Behavior

End Rental remains the single `end_rental_tx` path, Manager/Owner-authorized in both the server handler and proposed SQL. Rental closure, vehicle disposition, application closure, automation cancellation and an attributed `rental.ended` audit entry commit together. Audit failure rolls back all changes. Existing mileage checks and canonical reading helper are preserved. Replay reports already closed without an additional audit entry.

Available is a requested disposition, not a promise. Missing/incomplete/failed return evidence, empty checklists, critical return findings, a failed/critical latest vehicle inspection, open incidents, incomplete Rental Ready profile or unresolved/due maintenance cause **Maintenance**, an existing non-rentable status. A passed latest return inspection must belong to this vehicle and rental, have a non-future completion time and a fully answered nonempty checklist. Existing non-critical failed items on an otherwise passed checklist remain informational. A newer passed inspection supersedes earlier inspection evidence; independent incidents/maintenance still require resolution. Unknown maintenance timing is held; explicitly future upcoming service is not itself a blocker. Staff can also request Maintenance despite passing evidence.

Clearing evidence never automatically releases a held vehicle: a human uses the existing authorized status workflow. Adverse evidence added to an idle Available/Reserved vehicle withdraws it to Maintenance. Active rented vehicles are not forcibly changed by evidence writes. New activation checks the current status and safety evidence; Maintenance cannot be bypassed by directly invoking activation. Existing Rental Ready identity/VIN/rate checks still apply. No new vehicle status, RLS change or staff grant.

Local `autopay_active`, subscription identifiers, deposits and charges are preserved by closure. No provider calls occur. Both End Rental entry points explain actual vehicle disposition and that closure does not verify Stripe cancellation. PR #22 and Phase 2A remain separate; no billing enforcement or refund controls are added.

## Transaction design and operational tradeoff

A fleet-wide transaction advisory lock serializes relevant vehicle/rental/evidence writes before statement row locks; activation and closure acquire it before their own row locks. Evidence tables are inspections, inspection_items, incidents and maintenance_records. Row triggers enforce direct status and active rental writes. READ COMMITTED is required; higher isolation is refused so evidence cannot be checked against a stale transaction snapshot. This favors safety over fleet-wide write throughput and needs staging/load review. No network I/O occurs inside the DB routines. Other legacy multi-statement callers that already hold row locks can still encounter a deadlock and must retry the whole operation after verifying outcome; an aborted transaction cannot partially release a vehicle.

The existing public Rental Ready profile helper is reused; this proposal does not redefine its profile-only UI meaning. Maintenance schedules are not a new clearance system: the safety gate uses existing maintenance_records and their due-date/mileage state. Service schedule-only alerts remain advisory unless represented by a due/open service record; review this limitation with operations before release.

## Migration / publication requirements

`migration.proposed.sql` is deliberately outside all automatic migration folders. No migration number or receipt is allocated. Existing 0031, 0033, Resume and eSign packages/journals are untouched.

This is NOT a sealed production installer. Before installation, inspect the actual deployed catalog, compare existing lifecycle function definitions/privileges/triggers and constraints, allocate a nonconflicting journal entry, review the complete pending set, and rehearse using a full schema clone and supported provider transaction semantics. Apply the entire package atomically with its single runner receipt. No historical data backfill occurs. Existing already-available vehicles are not bulk reclassified; activation/status writes check current evidence, and future evidence writes apply holds. Privileged TRUNCATE/disabled triggers are outside supported application workflows and must not be used.

The new `end_rental_tx` signature adds `_release_contract` and returns JSONB. New server code sends `safe-release-v1`; an old schema rejects this call before mutation. The new function refuses an old caller without that contract. Therefore coordinate a short End Rental availability interruption with the database/application rollout. Do not publish this UI alone expecting the feature to work. Do not roll back to the old unsafe transaction to restore availability; use reviewed forward repair while retaining holds and audit records.

Installation, publication and hosted acceptance need separate approval. No dependency on activating Stripe reconciliation or installing 0033. Security 0031 remains independently controlled.

## Verification

- 27 disposable PostgreSQL checks, using the actual existing activation/closure and lifecycle guards plus the actual Rental Ready helper against synthetic tables. Includes passed/missing/failed/critical inspection, maintenance/incident holds, Owner/Manager success, Coordinator/Driver/null actor denial, direct authenticated RPC denial, rollback, audit attribution, replay, concurrent closure/incident/assignment and split-write rejection.
- Mileage helper is a stub in the disposable fixture; its unchanged implementation is reused, not re-certified by this test. Full production-schema privileges and trigger interactions require staging acceptance.
- Updated existing Bookings action tests: real server functions, current role checks, versioned contract, truthful disposition, missing/legacy schema response rejection. Existing full Bookings browser expectations updated but that full suite was not run (its environment-specific Playwright import is unavailable here).
- 12 focused real-browser scenarios at 390/1440px: Owner/Manager actual outcome messages, no inferred release on a hold, billing distinction, Coordinator action absence. No hosted requests.
- Existing 30 Closeout Readiness checks and 10 browser checks, 46 Stripe safety checks and 29 provider/authorization checks pass.
- TypeScript and production build pass. No package/dependency changes.

Run local database tests only with a disposable PostgreSQL 17 server on Unix socket `/private/tmp/rr-stripe-pg/socket`, port 55439. The harness creates and drops its own database; no hosted URL is accepted. Run `node scripts/safe-vehicle-release/database.test.mjs`, `node scripts/safe-vehicle-release/ui.test.mjs`, and the existing Bookings/closeout/Stripe suites.
