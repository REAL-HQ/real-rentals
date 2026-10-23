# Record Rental runtime — status

2026-10-23. Branch `feature/record-rental-runtime`, based on Release A
(`release/m2-app-flags-off`). `RECORD_RENTAL_CONTRACT_ENABLED` is still
`false`, so none of this ships while it stays off: the bundler drops the handler
body.

## What is connected

| Piece | Where |
|---|---|
| Evidence issuer transport | `src/lib/record-rental-issuer-sql.server.ts` |
| Server-only bootstrap | `src/lib/record-rental-resources.server.ts` |
| Wiring into `recordExistingRentalV3` | `src/lib/record-rental.functions.ts` |
| Transport login, proposed | `proposed/record-rental-transport/01-transport-login.sql`, `scripts/record-rental-transport-scram.mjs` |

**Evidence issuer transport.**
- One short-lived Postgres connection per issuer call, because a Workers socket
  cannot outlive its request.
- It connects only as `rr_evidence_transport` and runs
  `SET LOCAL ROLE rr_evidence_issuer` in every transaction.
- It refuses any other login, and refuses plaintext to a non-local host.
- In the Workers build it uses `cloudflare:sockets`.

**Server-only bootstrap.** It runs on first use, after the flag and Manager
checks. It reads two request-time secrets, `RECORD_RENTAL_ISSUER_DATABASE_URL`
and `RECORD_RENTAL_STRIPE_ENVIRONMENT`. It builds:
- **Stripe:** the existing read-only facade. Only `accounts.retrieve`,
  `subscriptions.list` and `subscriptions.retrieve` are used.
- **Linkage:** read with the staff member's own RLS-scoped client. A driver with
  no portal login is refused, and so is a renter with more than one active
  subscription.
- **Download reader:** limited to `rental-agreements/immutable-v1/*`.

**Transport login.**
- Created without a password, with issuer membership only (SET, never
  inherited), and `CONNECT` on the current database.
- The password is set from a SCRAM verifier made on the Owner's machine, so no
  password passes through SQL.

## Tested

Two stacks were used:
- the **local harness** (`scripts/record-rental-harness/`): the production-order
  baseline, the M2 packet with the hosted amendments, real PostgREST, a real
  SCRAM login and simulated Stripe;
- the **hosted rehearsal** from the previous milestone.

| Test | Result |
|---|---|
| `scripts/record-rental-e2e.test.ts` (harness) | **22 passed** |
| `scripts/m2-window1-drill.test.ts` (harness) | **13 passed** |
| `scripts/record-rental-transport.test.mjs` (harness) | **5 passed** |
| `scripts/record-rental-resources.test.ts` | passed |
| Existing Record Rental unit tests | all pass |
| Dark-flag coverage, client-chunk guard, typecheck, build | pass |

**`record-rental-e2e` covers:**
- archive and bind of the signed agreement through `finalizeRecordArchiveV2`;
- the recording itself:
  - historical start date preserved, with staff-entered rate, deposit and
    mileage;
  - vehicle assigned, and the existing Stripe subscription linked;
- **Stripe only read**: no charge, subscription or payment row;
- one audit row; same-operation recovery;
- refusals:
  - a Coordinator;
  - a rate, start date or subscription amount that differs from the signed
    terms;
  - client-supplied evidence;
  - a session switch;
  - an ambiguous subscription;
  - a duplicate active rental, refused by the app and by the database's unique
    indexes;
- closeout:
  - Coordinator refused;
  - safe release keeps the vehicle out with stated reasons;
  - replay recovers.

**`m2-window1-drill` covers:**
- the real backfill script, both as a dry run and with `--write`;
- the gate report at 0/0;
- the stale PostgREST cache reproduced after step 3. The Release A gate refuses
  with the reload message and makes no legacy write.

**`record-rental-transport` covers:**
- the proposed SQL's login shape;
- a password-less login refused;
- the SCRAM verifier authenticates;
- a wrong password refused;
- no approval-executor membership and no table access.

**Defect found and fixed.** The runtime passes JSON as `JSON.stringify` into
`$n::jsonb`. The driver then serialized it a second time. The transport now
sends string parameters as `text`.

## Not verified

| Item | Why |
|---|---|
| A Lovable-hosted Worker reaching the Supabase pooler over TCP | This sandbox has no TCP or DNS route to Supabase. The Workers build is correct, but the platform path is unproven. |
| The pooler host and region for the production project | Needed for the secret. Lovable Cloud may not show it. |
| Real Stripe responses | Simulated. The read-only facade is the one already used in production. |

## Gaps in the existing implementation

The contract is not weakened in any of these.

1. **No agreement satisfies the evidence contract today.** The installed M2 SQL
   accepts only an eSign agreement that meets all of these:
   - archived immutably;
   - signed **before** the rental start;
   - whose archive carries `record_rental_terms_v1`, the exact start, weekly
     rate and currency.

   No code anywhere writes that terms block. Step 10 also closed the paper
   route. So existing renters with paper or older agreements cannot be recorded,
   and re-signing now cannot satisfy "signed before start".
2. **No app flow binds license images immutably or records the positive-license
   review** (`verify_license_v1`). The test seeds those steps the way the M2 SQL
   proof does.
3. **No app flow copies agreement bytes** into `immutable-v1/` before binding. A
   finalizer exists, but nothing calls it.
