# Phase 2C.1 — reservation schema and transaction contract (review only)

Base: `fdef408e948edb75fc62441bcc267f7427579cb0`. Nothing in this directory is in migration discovery. No journal entry/number, server handler, UI, hosted reservation, scheduler, reminder, payment call or fee is activated. The SQL is a design prototype for review and disposable rehearsal, not a sealed production installer.

## Existing architecture and proposed additions

Bookings currently reads actual rentals; applications.pickup_date is applicant intent and applications.vehicle_id is not an inventory allocation. Existing rental dates are date-only, including nullable end_date. Existing markets has no timezone column. Keep existing tables, lifecycle RPCs, role helpers, Safe Release checks, payments and eSign intact.

- `reservations`: application FK, optional draft vehicle FK, state, pickup instant and IANA timezone snapshot, optional agreed end, explicit turnaround snapshot and occupied-until instant, hold deadline, unique converted rental FK, optimistic version, actor UUIDs, timestamps and terminal reason. References RESTRICT deletion. Actor UUIDs intentionally survive account deletion without cascading audit loss.
- `reservation_market_rules`: existing market FK, valid timezone and explicit nonnegative turnaround minutes. No seeded defaults; only Owner can configure via an audited function. Rules apply prospectively; staff editing a schedule refreshes its snapshot. Review treatment of existing commitments before changing rules.
- `reservation_history`: append-only attributed before/after transition records, timestamp and reservation FK. No destructive deletion or history rewrite. Conversion preserves the last confirmed before-image and writes one final conversion event.

No active rental exists until conversion. Reservation state never changes the vehicle's current physical status. No money/identity/document contents are copied into this model.

## State and RPC contract

All mutators derive identity from `auth.uid()` and current database roles (admin/team), require READ COMMITTED, then acquire `pg_advisory_xact_lock(710026,2)` before reservation/application/vehicle row locks. They are authenticated-user RPCs, not service-role calls with a caller-supplied actor. The future server adapter must forward the authenticated request context securely; missing identity fails Forbidden. Private functions are not executable by app roles. Direct writes to all three tables are revoked, including service_role; RLS is enabled with no permissive base-table policy.

- `reservation_configure(market, timezone, turnaround)`: Owner-only, existing audit_log, no default turnaround.
- `reservation_create(application, vehicle?, pickup, agreed_end?)`: creates draft only. Date/time must be future and aligned to 15 local minutes. Missing vehicle uses application market for provisional timezone; assignment revalidates vehicle market.
- `reservation_change(id, version, action, vehicle?, pickup?, end?, reason?)`: reserve, confirm, edit, cancel, expire. Versions are required, including null rejection. Use `SELECT * FROM reservation_change(...)`, not `(reservation_change(...)).*`, which PostgreSQL can expand into repeated calls.
- Draft → Reserved: approved applicant, configured/ready vehicle, completed nonempty pre-delivery evidence, no active rental, no allocation conflict; 24 elapsed-hour hold.
- Reserved → Confirmed: repeat checks, refuse expired hold. Confirmation does not assert agreement signing, payment or handover readiness.
- Edit: full replacement schedule/vehicle, atomic conflict checks. Confirmed → Reserved requires fresh confirmation and gives a new 24-hour hold. Editing a Reserved hold does not renew its deadline. Failure retains the entire original allocation/history.
- Draft/Reserved/Confirmed → Cancelled: attributed reason mandatory. No refund or communication.
- Reserved → Expired: only after its deadline. A confirmed no-show cannot expire; Manager must cancel/reschedule. No automatic expiry job is installed. Until the explicit expiry transaction succeeds, an elapsed hold remains a conservative inventory blocker; it cannot confirm or convert. Future UI must expose this distinction and offer the authorized expiry action.
- `reservation_convert(id, version, weekly_rate, deposit, deposit_held, pickup_miles?)`: Confirmed only, pickup due, current approved application and existing linked Driver-only portal identity (staff-linked identities denied; no account or role provisioning), rechecked safety. Retires its own hold and calls existing `activate_rental_tx` in one transaction, then links its rental. A deferred constraint refuses partial conversion at commit. Audit failure rolls back rental, vehicle, application and reservation writes. Same-version races yield one success; a retry must reload current version, after which Converted returns its existing rental ID. No charges or Stripe calls; financial inputs are explicit existing activation terms, not provider payment evidence.
- `reservation_list(after_timestamp, after_id, limit)`: current Owner/Manager/Coordinator, bounded to 100, stable keyset pagination; returns only reservation/application/vehicle IDs, state, schedule, timezone, hold deadline and version. Driver/anonymous denied; no joined identity or financial fields. Future name display must reuse the existing authorized operational projection.

Terminal states cannot be reopened. A new reservation is a distinct audited decision. Agreement policy and customer acceptance UX remain separate.

## Allocation and concurrency

An exclusion constraint (`btree_gist`) prevents overlapping Reserved/Confirmed vehicle ranges `[pickup_at, occupied_until)`. Missing agreed end is infinite. Turnaround extends the end, never invents one. One live reservation per application prevents duplicate applicant holds. The shared outer lifecycle lock serializes cross-table checks with actual activation, closure, status/evidence and corrected Stripe transactions.

Currently active rentals block new holds regardless of a planned return; expected return does not establish availability. Direct activation and active-rental vehicle/start/end changes must check reservations. Open-ended activation conflicts with all later holds. Because rentals have date precision, finite activation blocks through the **entire final local calendar day plus turnaround**, not the reservation's precise end time. Distinct finite future holds may exist, but conversion can fail if that coarser rental interval conflicts. Do not promise same-day turnover; surface this conservative compatibility limitation in the next UI. Extending an active rental to open-ended cannot bypass a later reservation. Existing active-rental uniqueness and safety guards remain authoritative.

Incident/maintenance changes retain a reservation but block confirmation/conversion; they do not silently cancel the commitment. No new vehicle swap workflow is added: any future swap must share this lock and activation-allocation guard. Arbitrary administrative writes/disabled triggers are outside this supported contract.

## Time, business rules and remaining decisions

Inputs must be explicit instants (ISO timestamps with offset) in the future server adapter. The database validates 15-minute alignment in the vehicle market timezone and retains the instant across DST. The adapter must reject nonexistent local times and ask which offset is intended for repeated local times; PostgreSQL alone cannot tell whether an offset-less input was ambiguous before it was converted to timestamptz. Hold duration is 24 elapsed hours, not a local calendar-day calculation.

The proposed finite end must be on a later local date, matching existing activation constraints. No return date is required for weekly rentals. Needed decisions before UI release: actual turnaround per market, review of conservative whole-final-day occupancy, and whether past-deadline holds should later receive a separately approved expiry worker. No new confirmed-no-show automation, fees, reminders or agreement requirement is proposed.

## Dependencies and release gates

1. Review actual catalog, pending journal set, extension availability/permissions, FK ownership and grants. The synthetic fixture is not a full production schema clone.
2. Preserve the coordinated revised 0033 → Safe Vehicle Release release plan from PR #38. Reservation allocation requires Safe Vehicle Release and its shared lock. No Stripe activation is required; if 0033 is present, its lock-compatible revision is required. Never replay installed 0033.
3. Allocate and seal a new later reservation migration only after review; preserve all existing receipts. 0031 is independently controlled, not executed here. Future application projections must remain compatible with its restrictions.
4. Full-schema staging rehearsal, current-role permission checks, provider transaction guarantees, and separately approved installation/publication are required. No app fallback may pretend reservations are active on a missing schema.
5. Closed-rental safety/inspection clearance limitations from PR #38 remain: a new reservation cannot override them. No legal/template approval is implied.

## Disposable verification

Run `node scripts/reservations/database.test.mjs` from repository root with local PostgreSQL 17 at Unix socket `/private/tmp/rr-stripe-pg/socket`, port 55439. No configurable hosted URL. Each run creates/drops its own synthetic database. Fixture reuses actual reviewed activation/closure, lifecycle guards, Rental Ready helper and proposed Safe Release SQL; the unchanged mileage helper is stubbed. The fixture also supplies auth.uid/current-role context; no real sessions or external calls.

35 checks: atomic install rollback/replay refusal, Owner configuration, Manager mutations, Coordinator operational projection/pagination, Driver/anonymous denials, direct table denial, overlap/turnaround/unbounded ranges, active rental conflict, direct activation guard, racing holds/activation, stale/null versions, expiry-versus-confirmation/conversion, no-show refusal, maintenance races, reassignment rollback, reschedule reconfirmation, duplicate conversion, deferred partial-conversion refusal, audit rollback, immutable history, quarter-hour/DST boundaries, missing configuration/inspection evidence, staff-linked identity denial and a negative control that removes the activation guard and requires the security assertion to fail.

No application code changes: TypeScript/build and unrelated accepted suites are not repeated. No hosted verification is claimed.


## Phase 2C.3 — conversion interface (review only)

Development base: `204b1d4bf970f4e93b5a9196db57112f43e3cd4f`.
Supplemental SQL: `scripts/reservations/conversion.proposed.sql`.
SHA-256: `69c7f2efb4a4af2fbc1d9087b17cb192c8f5705e5615acb72d86c753987cc08b`.

The original PR39 SQL and all automatic migration directories/journals are unchanged. The supplemental SQL is not an install-ready production package. It requires a separately reviewed atomic installer, actual catalog/privilege preflight and full-schema staging rehearsal. The private helper and preview use CREATE FUNCTION, so replay fails; execute the entire package in one transaction, never piecemeal.

The existing `RESERVATIONS_ENABLED` server gate remains disabled by default. Owner/Manager requests use the authenticated caller's Supabase client. Coordinator/Driver requests are denied before conversion evidence or mutation RPCs. Missing supplemental preview RPC, missing tables and denied execution yield controlled unavailable responses; there is no activation fallback. No provisioning, Stripe, email, reminder or background job is introduced.

The existing `reservation_convert` remains the only reservation activation transaction and calls existing `activate_rental_tx`. Its added Driver check requires an existing Auth user, matching normalized applicant/account email, Driver membership and no staff membership. No identity is supplied by the caller. The existing global lifecycle advisory lock `(710026,2)` precedes reservation/application/vehicle row locks. Conversion rechecks safety and allocations inside that transaction, creates the rental and links it with one attributed final conversion-history event. Audit/activation failures roll everything back. Stale retries are refused; a current-version replay returns only the existing rental ID. Confirmed reservations have no hold deadline; no-show cancellation remains an explicit Manager decision.

The preview is informational and does not reserve or write records. It acquires the same lifecycle lock while inspecting readiness. Conversion repeats the checks. Finite rentals conservatively occupy the whole final calendar day plus turnaround; open-ended rentals remain unbounded. Draft/expired/cancelled reservations and future pickups cannot activate. Existing Safe Vehicle Release restrictions remain authoritative.

UI reviews the applicant, vehicle, pickup timezone, blockers and terms, then opens the existing Bookings rental detail on success. An ambiguous response is never retried automatically: staff must reload evidence; if committed, the existing rental link is shown. Deposit-held is explicit staff attestation, not verified provider settlement.

Existing activation does not enforce a signed agreement or verified payment. This phase does not invent either requirement: it displays matching signed-agreement metadata when recorded, always describes unverified payment/deposit evidence truthfully, and does not collect money or start billing. Business approval of stricter agreement/payment prerequisites is separate. Existing Driver accounts must be linked through the separately authorized workflow before conversion.

Installation order remains revised lock-compatible 0033 (if reconciliation is installed), Safe Vehicle Release, PR39 reservation contract, PR40 read projections, then this supplemental conversion package; never replay installed migrations. 0031 remains independently controlled and untouched. Approved migration installation, full-schema staging, publication and explicit reservation-gate activation are still required before hosted use.

Local verification for this phase: 44 disposable database checks, 34 mocked real-handler checks, six responsive browser role/workflow scenarios at 390/1440px (including success navigation, missing schema, readiness denial and ambiguous-result recovery), Bookings action/detail/list regressions, 30 Closeout Readiness checks, targeted lint, TypeScript and production build. Fixtures reuse the actual activation/lifecycle/Safe Release functions; they are not a full production catalog clone. No hosted or live Stripe tests were performed.
