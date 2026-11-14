# Pickup Durable Contract — Review Only

## Installed Now
Only the ten-stage presentation, navigation and pure fixture rules/forms. No SQL is generated, no new table installed, no packet sent and no customer action performed. Evidence saving, pickup plans, packet sending and handoff extensions remain disabled. Existing approval, payment, eSign and rental writers are unchanged.

## Proposed Tables And Constraints — Not SQL
All IDs are UUIDs. Staff actor UUIDs have no cascading managed-auth foreign key. All history is immutable and retained; ordinary deletion must not cascade it. Grants and RLS are part of the future reviewed install, not implied by these fields.

### application_checklist_events
`id`, `application_id`, `field`, `revision`, `supersedes_id`, `state`, `source`, `note`, `actor_id`, `occurred_at`, `idempotency_key`, `request_fingerprint`.
- Field: license_front/license_back/insurance/agreement/gig_profile. State: collected/not_collected.
- Collected source: email/text/paper/other; Not Collected source null. Trimmed note 3–1000 characters.
- Unique application/field/revision; unique actor/operation retry key. Contiguous predecessor chain. No UPDATE/DELETE; restricted append function derives actor/time and checks caller scope.
- On-file and upload-due projection comes from current, matching, non-rejected saved private documents plus this history. Green collection is independent of validity/verification. Signed Agreement still needs canonical signing or audited paper review.

### application_pickup_plans
`application_id`, `revision`, `appointment_at` (timestamptz), `time_zone`, `location_snapshot`, `vehicle_id`, `actor_id`, `confirmed_at`.
- One current plan per application. Requested application pickup date/time is not confirmation.
- Staff confirm appointments; no renter self-scheduling. Location choices include 3500 E. Hillsborough Ave., Tampa, FL 33610 and 6411 E County Line Rd., Tampa, FL 33647, plus editable custom locations; neither address is selected or confirmed automatically.
- Valid IANA zone, confirmed real location and existing eligible car; no defaults for unknown facts. Current plan updated only through the reviewed transaction, not direct browser writes.

### application_pickup_plan_events
`id`, `application_id`, `revision`, `previous_revision`, `appointment_at`, `time_zone`, `location_snapshot`, `vehicle_id`, `previous_vehicle_id`, `reason`, `actor_id`, `occurred_at`, `idempotency_key`, `request_fingerprint`.
- Append immutable before/after assignment and appointment snapshot. Reason 5–500 characters. Unique application/revision and retry identity. Vehicle reassignment is pre-activation only; no reservation guarantee, permanent numbering or post-activation swaps.

### application_pickup_packet_deliveries
`id`, `application_id`, `plan_revision`, `reviewed_fingerprint`, `reviewed_snapshot`, `recipient_reference`, `actor_id`, `claimed_at`, `completed_at`, `state`, `provider_reference`, `failure_code`, `idempotency_key`, `request_fingerprint`.
- States: claimed/sent/failed/uncertain. Store recipient reference and reviewed safe facts, no password or raw bearer token. Snapshot references existing authorized expiring photo packages, never exposes private bucket paths. No automatic renewal or resend.
- Retry of uncertain provider outcome requires reconciliation; new key cannot blindly duplicate a prior claim. Prefer existing provider-delivery records for detailed delivery events rather than another competing tracking path.

## Argument/Result Contracts
All calls authenticated and caller scoped; strict validation rejects extra actor/time/status/verification fields. Browser references are selectors, not evidence.

- **appendChecklistEvidence:** applicationId, field, expectedRevision, idempotencyKey, state, source, note. Returns server-issued immutable event and projection, or stale/retry-key conflict without writes.
- **readChecklistEvidence:** applicationId → available/capabilities plus scoped field revisions, latest events and collection/review facts. Until installed, existing unavailable result is retained; never return invented empty saved history.
- **savePickupPlan:** applicationId, expectedRevision, idempotencyKey, vehicleId, appointmentAt, timeZone, location, reason. Returns saved revision/actor/confirmed time plus re-review requirements. Same key + same normalized payload returns prior result; changed payload refuses.
- **readPickupPlan:** own renter or authorized staff scope → current confirmed plan and approved safe vehicle projection. Pre-rental reads require reviewed own-application access; active-rental portal reads must not be widened blindly.
- **claimPickupPacket:** applicationId, expectedPlanRevision, reviewedFingerprint, idempotencyKey, recipientReference. Server re-derives facts/recipient and hashes the exact snapshot. Returns existing/claimed delivery identity only for matching review.
- **finalizePickupPacket:** internal provider result for the claimed identity → sent/failed/uncertain with existing delivery reference. Claim before send; never wrap outbound delivery in the rental database transaction. No approval retry used as email retry.
- **checked handoff extension:** applicationId, expectedPlanRevision, expectedVehicleId, operationId, actual pickup/date/mileage inputs, agreement/inspection/payment references, selected field revisions, supported soft exceptions and reason. Returns rentalId/final vehicle/plan revision and immutable handoff/audit references, or typed blockers without partial writes.

### Isolated Payment Draft (Not A Write Contract)
`pickup-payment.ts` validates applicationId, vehicleId, obligationId, method, otherMethod, exact positive amountCents, paidAt with offset, payer, reference, evidenceReference and note. All values are selectors/proposed facts; no verifier, paid state or actor can be injected. Existing canonical payment/evidence authority supplies the verified source account, evidence ownership, amount, date and staff attribution at installation. Duplicate checks must span authorized identities, not just one renter: same evidence or same source-account/reference is review-required even if the method label changes or the prior payment is refunded/voided. Different provider accounts with coincident references are not automatically identical. Cash requires an authoritative unique receipt identity, not a reused word such as “cash.” No new receipt/charge store is created here. The form only prepares entry and keeps Save Verification/Activate disabled.

`pickupWelcomeIntent` is pure outbound planning: Approve & Invite can plan login access without pickup confirmation; Approve Only does not imply an invitation; account conflict/missing access blocks the intent. It has no provider, credentials, account creation, retry execution or send authorization. Existing account links remain protected integration work.

## Permission Matrix
- Owner/Manager: authorized application reads, receipt entry, confirmed plan/final car change, reviewed packet claim and checked handoff. Existing approval authority stays unchanged.
- Coordinator: current operational reads and existing upload/call behavior only. Any new receipt-entry grant needs explicit role acceptance; never approve, assign final car, send new packet or activate through the new seams.
- Driver: own confirmed plan/safe vehicle/readiness projection and existing own uploads; no staff attestations or staff actions. Staff preview can read only through the existing audited scope and must refuse all renter writes.
- Signed out/other renter: denied, including private media. Owner-only finance/title numbers/GPS/key locations never enter the safe packet.
- Future table install: explicit authenticated SELECT grants where allowed, RLS, no anon grants, service-role privileges only for reviewed privileged operations; write authority via restricted functions, not direct mutable history. Do not modify managed auth/storage schemas.

## Transaction And Retry Requirements
1. Lock application; verify current staff authority/access, application stage and no existing activation. Lock plan/current revision; lock final vehicle in consistent order with canonical rental start. A plan change racing activation refuses stale state.
2. Re-read current license/identity/access gates and saved document/attestation revisions. Validate selected operational exceptions and 5–500 character reason; preserve unresolved Yellow/Red and follow-up. No exception creates a file or verification. Existing Owner insurance policy is separate.
3. Re-read final-car Rental Ready/availability, matching accepted inspection, actual insurance applicability, canonical signed nonvoid agreement or audited paper evidence, applicable real payment/obligation. Old-VIN agreement/inspection cannot pass. Held deposit alone, unrelated or pending/failed/refunded charges, unknown amounts and UI flags cannot pass. Acquisition/title data are never needed.
4. Call canonical activate_rental_tx only through its reviewed checked wrapper; rental start, vehicle/application transitions, agreement linkage, operation receipt, exception/handoff evidence and required immutable audit commit together. Audit failure rolls back. End-rental unchanged.
5. Unique operation identity + normalized request hash: same request returns prior outcome; changed request under same key refuses. Concurrent different requests for one car yield at most one rental. A new exception/handoff request never reaches existing unchecked fallback.
6. Avoid a read-then-write race on payment/void/refund evidence; agree shared locking or version guards with those canonical writers during protected integration review. “Checked once” is not sufficient.

## Dependencies And Blockers
1. Approval/account ownership review: current approval provisions accounts, invites newly created accounts only, and defaults to agreement send. User chose secure login/account setup first, even without a confirmed appointment/car; pickup details follow confirmation. Preserve an approval-only option and safe existing-account sign-in handling, not duplicate invites. Exact retry semantics require protected compatibility approval; no new auth writer or silent agreement send.
2. Durable attestations + scoped readers and immutable audit; then plan revision/history. Final-vehicle reassignment must invalidate packet review and recheck inspection/insurance/agreement applicability.
3. Accepted atomic checked activation wrapper and retry receipts; only then handoff extension. Existing required-file/identity gates must be reviewed together without weakening actual validity/access.
4. Packet claim/outcome receipts, existing approved private share package and existing sender; then own-renter pre-pickup reads. Email provider is unchanged, delivery and retries unverified until capture-only acceptance.
5. Pickup verification must support Stripe, Zelle/bank transfer, Cash App/Venmo, cash and Other. A method choice is not payment proof. Non-Stripe evidence needs staff verifier/time, exact amount/date, payer/reference/source evidence, applicable obligation and deduplication through an approved canonical path; never auto-post. Existing balance link creates no charge and may need a real rental. No pre-rental payment obligation is invented; separately review Record Rental/payment linkage before enabling payment access. Other requires the actual method name, never guessed from this answer.
6. Install ordering and journal must be reconciled with pending proposals first. Security 0031 and Record Rental remain independent held dependencies; no migration number is assigned, historical receipts edited, SQL copied/generated or execution route re-investigated here.
7. Protected auth/Identity Review and eSign changes require separate scope approval. Post-activation swap/numbering/C2 are excluded.

## Required Disposable Acceptance (Not Yet Run)
RLS/cross-renter/role matrix; staff-preview denial; real durable reload/readback; source Text; same-key retry and changed-payload refusal; stale/forked revision; matching-only files; rejected/superseded/wrong-renter files; license both sides; unsigned/voided/consumed or old-VIN agreement; expired insurance; competing final-car assignment/start; required-file exceptions with distinct identity validity; uncertain delivery/reconciliation; approval partial-account failure; applicable obligation and refund races; audit failure rollback; atomic rental/readback. eSign checks only in the established disposable harness. Nothing is claimed to pass against the shared backend.