# Record Rental runtime — status

2026-10-24. Branch `feature/record-rental-runtime`, based on Release A
(`release/m2-app-flags-off`). Every flag is still off:
`RECORD_RENTAL_CONTRACT_ENABLED`, `HISTORICAL_AGREEMENTS_V1_ENABLED`,
`SIGNED_RENTAL_TERMS_V1_ENABLED` and `SIGNED_ARCHIVE_V1_ENABLED`. Nothing here
changes production until each one is approved. No production SQL was run, no
credentials were provisioned, and nothing touched Stripe.

## What is built

### Historical (paper/PDF) agreements — Option A

The SQL is in `proposed/record-rental-historical/`:
- `01` installs it;
- `02` rolls it back;
- `03` is an eSign patch, described under Gap 2.

The app side is `src/lib/record-rental-historical.server.ts` plus a reader in
`record-rental-readers.server.ts`. It reuses `proposed/paper-agreements-v1.sql`:
the original is uploaded through `register_paper_agreement`, unchanged.

**What a registration records.**
- The uploaded original is preserved: copied write-once to
  `rental-agreements/immutable-v1/<doc>/<sha256>.pdf` and bound. The `paper/`
  upload is kept.
- The signing date written on the document (`signed_on`) and the verified rental
  start instant (`rental_start`) are stored separately.
- Staff confirm the vehicle, weekly rate, deposit and a summary of the terms.
- Who registered it, their role and when.
- Audit rows `historical_agreement.registered`, `.recorded` and `.voided`.

**How it stays distinct from eSign.**
- It is labelled `staff_verified`, and its evidence is kind `paper`,
  verification `paper-registered`.
- It never creates or backdates an eSign row or event.
- Its `signedAt` is the start of the signing day in America/New_York. The
  database requires exactly that value: a date, never an invented time.

**Contradictions are refused, never resolved.** Registration is refused when:
- the document is dated after the start;
- the date differs from the upload's own attestation;
- the upload is not an `original`;
- an eSign agreement is pending for the driver;
- a second registration is opened for the same driver;
- the document is not a bound paper original of this driver;
- the start is in the future.

At recording, a start time, rate, deposit, currency, document or driver that
differs from the registration is refused.

**Immutability.**
- A registration is linked to exactly one rental, in the same transaction that
  records it.
- After that it cannot be voided.
- Registrations cannot be deleted or truncated.
- Rollback refuses once any registration exists.

**Duplicates.** A second active rental for a driver or a vehicle is refused by
the existing core and by the unique indexes.

**Missing contracts.** A rental with no signed original is not handled. That
remains a separate, unbuilt business decision.

### Gap 1 — licence image binding and positive review

`record-rental-archive.server.ts`, `previewPositiveLicenseV1` and
`verifyPositiveLicenseV1`:
- Preview requires exactly one current front and one current back image, each
  already reviewed. It copies each write-once to
  `driver-docs/immutable-v1/...`, re-hashes it and binds it.
- Preview then returns the database's licence snapshot and its SHA-256
  fingerprint.
- Verify recomputes the snapshot and refuses if the fingerprint changed. It then
  records `verify_license_v1` as `rr_approval_executor`, and the database audits
  it.
- The transport login now holds `rr_approval_executor` as well, SET only and
  never inherited. The proposal and its test were updated.

### Gap 2 — immutable signed-agreement archival

`archiveSignedAgreementV1` verifies a signed, archived and unvoided eSign PDF
against `agreements.sha256` and binds it in place.

**The eSign change is held back for approval.** M2 step 19 forbids moving a
finalized eSign document, so new eSign archives must be written straight to
`immutable-v1/` at signing. That change belongs in `esign.server.ts`, behind
`SIGNED_ARCHIVE_V1_ENABLED`. But `agreement-evidence.test.cjs` pins
`esign.server.ts` to the published branch, so the change is kept as
`proposed/record-rental-historical/03-esign-immutable-v1-archive.patch`:
- It applies cleanly.
- With it applied, the two eSign archive suites pass (36/36).
- It needs explicit approval, with that pin updated in the same change.

### Gap 3 — signed-terms evidence for new eSign agreements

`signed-rental-terms.ts` builds a block from the same values the contract
prints, and refuses if they disagree:
`{startDate, timeZone: America/New_York, weeklyCents, currency}`.
- `issueAgreement` stores it as `merge_data.record_rental_terms_v1`, behind
  `SIGNED_RENTAL_TERMS_V1_ENABLED`.
- The contract signs a start date, not a time. The reader therefore accepts the
  staff-entered instant only if it falls on that date in New York; another day is
  refused.

### Hosted connectivity, and the evidence gateway

The probe was run on a disposable Lovable project, published on Workers, with no
credentials. It has since been deleted. Results:

| Path from a Lovable Worker | Result |
|---|---|
| TCP and the TLS reply, direct host and all 14 pooler hosts | ok |
| TLS handshake, then startup message | the server closes; no reply (all 15) |
| Same startup in plaintext (fake role) | full SCRAM exchange, `28P01` |
| Postgres.js `ssl: require` | times out |
| Supabase Edge Function | refused by Lovable: new Edge Functions are not allowed |

**Conclusion.** Lovable Cloud cannot run the TCP transport with TLS.
- The most likely cause: Supabase Postgres certificates chain to Supabase's own
  root CA, and `cloudflare:sockets` verifies only against public roots, with no
  way to supply a CA.
- Plaintext would expose evidence and PII, so it is not an option.

**The alternative: the signed evidence gateway.** Proposed in
`proposed/record-rental-gateway/` (`01` install, `02` key, `03` rollback). It
uses only PostgREST over the platform's own HTTPS.
- Two RPCs with a fixed operation list:
  - `record_evidence_gateway_v1`, owned by `rr_evidence_issuer`;
  - `record_license_gateway_v1`, owned by `rr_approval_executor`.
- No statement text, and no other function or table can be named. It is not a
  generic SQL endpoint.
- The staff member's own JWT carries each call, so the M2 trust checks run
  unchanged.
- Every request is MAC-signed with a server-only key
  (`RECORD_RENTAL_EVIDENCE_GATEWAY_KEY`). The MAC covers the operation, the exact
  arguments, the actor, the session, the time and a single-use nonce.
- Stale, replayed, altered, cross-session, Coordinator and anonymous calls are
  refused.
- The HMAC is built on Postgres's built-in `sha256()`, so no extension grant is
  needed.
- On hosted PG 17 the installer cannot transfer ownership without SET ROLE. The
  install therefore lends SET for the two ownership statements and revokes it.
  That pattern was verified on the rehearsal project in a block that rolled
  itself back.
- `trustedIssuer` takes either transport; the server config picks one
  (`record-rental-resources.server.ts`).

## Tests

Two stacks:
- the **local harness**: the production-order baseline, M2 with the hosted
  amendments, paper v1, historical SQL and the gateway, with real PostgREST;
- the **hosted rehearsal project**: the probes above.

| Test | Result |
|---|---|
| `test:record-rental-acceptance`: historical SQL round-trip (4), then acceptance over the TCP transport | **33 passed** |
| `test:record-rental-gateway`: gateway security (14), then the same acceptance over the gateway | **33 passed** |
| `test:record-rental-e2e`: the earlier e2e (22) and transport login (5) | pass |
| `test:m2-window1-drill` | 13 passed |
| `npm test` chain | 50 of 51 steps pass, see below |
| Record Rental and archive unit suites | all pass |
| `tsc`, build, client-chunk guard, dark-flag coverage | pass |

The failing `npm test` step is `agreement-evidence.test.cjs`:
- Its source checks pass, including "esign.server.ts is unchanged".
- Its own Postgres setup cannot run here: `initdb` refuses root. It fails the
  same way at HEAD.
- The chain uses `tsx`, which is not installed here, so that step was run with
  `npx tsx`.

**The acceptance suite covers three synthetic drivers,** each approved through
the real approval RPCs.
- **Paige, an existing renter with a paper original:**
  - licence review by a Manager, including a stale-fingerprint refusal;
  - paper upload, then registration, including refusals for: signed after
    start, an attestation conflict, a future start, a second open registration
    and a Coordinator;
  - recording, including refusals for a wrong start, rate or deposit, and a
    Coordinator;
  - historical start, terms and vehicle assignment preserved;
  - the existing subscription linked, with Stripe only read;
  - registration linked to the rental, evidence labelled `paper`, and both
    audit rows;
  - same-operation recovery;
  - the duplicate refused;
  - void refused after recording;
  - closeout with safe release, billing unchanged, the agreement still linked.
- **Dana, on Paige's rented vehicle:** her registration is genuine, but recording
  is refused (duplicate vehicle). Void needs a reason; it is audited and keeps
  the original.
- **Nate, a new renter on eSign:**
  - licence review by the Owner;
  - the signed PDF verified and bound with its terms block;
  - a contradicting paper copy refused;
  - a start on the wrong day refused;
  - his attempt on Paige's car refused;
  - recorded with no Stripe customer, labelled `esign-verified`.
- No payment rows and no scheduled jobs are created. The Stripe double throws on
  any write.

## Remaining limitations

1. **Any unlinked agreement row blocks a driver**, including a voided one. M2's
   snapshot loop (`legacy_agreement_conflict`) and the historical registration
   both refuse it.
2. **Old eSign agreements cannot become evidence.** Renters who signed through the
   old eSign flow have no terms block and a non-immutable archive. Their pending
   agreement also blocks the paper route.
3. **No UI yet.** The licence review, archive, register and void server functions
   exist in `record-rental-evidence.functions.ts` but have no screens. Paper
   upload also needs `PAPER_RELEASE.registration`.
4. **The CI guard's hash pins predate this branch** (`scripts/ci/record-rental`).
   It already fails at HEAD. The pins need refreshing, with justifications, when
   this lands on a release line.
5. **Storage write-once is enforced only by database metadata**
   (`storage_integrity_v1`). Service-key HTTP behaviour is as M2 step 19 states.

Limitations 1 and 2 need a business decision.
