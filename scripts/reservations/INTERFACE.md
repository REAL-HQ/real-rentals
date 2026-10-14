# Phase 2C.2 — disabled staff reservation interface

Base: development main `2ca7b45a93f51418f5358b70133b68fcbd3fa195`. Development only; no hosted reads/writes, Auth changes, payments, migrations, deployment or publication performed.

## Behavior and boundaries

Bookings preserves its existing rental component, URL filters and rental detail IDs. A separate Advance Reservations view has Upcoming, Drafts and Reservation History tabs. Reservations never enter the rental-detail component. Applicant navigation reuses the Drivers URL. List paging is bounded keyset pagination; applicant search returns 25 results and vehicle search 50. History shows the latest 50 operational transitions without financial or identity payloads.

Owner/Manager can create a draft against an existing approved applicant, review schedule/vehicle warnings, reserve for the existing 24-hour hold, confirm, edit/reschedule/reassign, cancel with a reason and manually expire elapsed holds. Confirmed no-shows remain a Manager cancellation/reschedule decision. The UI offers no conversion, fees, charges, signing requests, account creation or reminders.

Schedule entry is market-local with an explicit UTC offset. IANA round-trip validation rejects nonexistent DST times, wrong offsets and non-quarter-hour times; an explicit offset resolves repeated local times. End is optional, never inferred from weekly billing. Existing finite rental date precision and manual expiration limitations remain visible. Availability is advisory: no-overlap in a read snapshot is not a guarantee. The unchanged transaction contract performs final allocation checks.

## Feature gate and schema absence

`RESERVATIONS_ENABLED` is server-only and must equal `true`; it is **not set in any configuration by this PR**. Default is disabled. Authorization runs even when disabled, then returns an unavailable state without reservation RPC calls. No background tasks or automatic activation exist. Existing rentals remain independent.

The future authenticated adapter uses `context.supabase`, preserving the caller's token and `auth.uid()`; it never substitutes service-role identity. Current-role Owner/Manager checks precede every mutation/options query. Coordinator reads return explicit operational fields only. Driver/anonymous are denied. Zod output allow-lists strip unexpected fields. Missing RPC/table/permission, malformed response and transport failures cannot become success. Composite mutation responses accept one object or exactly one returned row, never zero/multiple rows. No automatic mutation retries or unsafe rental/table fallback.

## Additional review-only read package

PR39's approved `migration.proposed.sql` remains byte-for-byte unchanged:
`ee50dd593912c25e0df1701e5bd6593c28948554cfd0a7648e2dc813a8ad5734`.

`interface-reads.proposed.sql` is a separate, uninstalled proposal outside migration discovery. It adds only three bounded authenticated read RPCs for list/name projection, operational transition history and Manager-only candidate/availability information. Fixed search paths, current database role checks and PUBLIC/anon/service-role execute revocation apply. It does not loosen base-table grants, RLS or mutation permissions. A prerequisite check refuses the absent base contract.

Future installation order: preserve revised 0033 → Safe Vehicle Release coordination; install reviewed reservation base, then separately reviewed read projections; deploy the interface with gate still off; enable only after catalog/pending-set review, full-schema rehearsal, market configuration and separately approved hosted acceptance. No migration number, journal update or installer is created here. 0031 stays independently controlled. Use only the revised 0033 lock contract; do not replay an installed older package.

## Verification

- 24 server/model checks: gate-off zero RPCs, current-role enforcement, mutation RPC routing, read projections, missing-schema/permission errors, transport/malformed responses, composite response handling, state actions and DST validation.
- 12 disposable PostgreSQL read-package checks: prerequisite refusal, Owner/Manager/Coordinator projections, Driver/anonymous denial, Manager-only options, unknown/conflict indicators, maintenance evidence, no history changes on reads and replay refusal. Uses PR39's synthetic fixture and actual prior lifecycle sources; mileage helper remains stubbed.
- 6 real-Chrome scenarios: Owner/Manager/Coordinator at 390/1440px with compiled application CSS and all nonlocal requests blocked. Detail/history, applicant links, reserve/confirm/create, manual expire, reschedule, cancel, conflict retention and unavailable states tested. No hosted acceptance claimed.
- Existing Bookings list/details/actions and Closeout Readiness (30 server checks, 10 browser checks) pass. Targeted lint, TypeScript and production build pass. Base reservation SQL/tests were not changed or unnecessarily repeated.

Synthetic screenshot: `/private/tmp/rr-reservation-ui-evidence/manager.png` (not committed).

## Release gaps

No migrations are installed. Provider transaction/extension permissions, full-catalog compatibility, actual per-market timezone/turnaround configuration and hosted caller-context/response validation remain separate approval gates. The draft interface assumes an approved applicant for creation; it does not implement identity provisioning or rental conversion. Reservation view state is local; existing rental URL navigation is preserved. Automatic expiration and reminders remain absent. No new legal/agreement or payment policy is implied.

Read-projection SQL SHA-256: `f5a1c28077809c5294eb4320dd9226c36ceae958e975b21829a3042998ebbfb5`.
