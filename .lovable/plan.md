# Simple Approval-To-Pickup Flow

## Result
Keep one checklist and one progress rail above the profile tabs:

**Applied → Contacted → Screening → Documents → Insurance → Approved → Inspection → Agreement → Pickup → Active**

One **Add** button per document field; the license modal contains Front/Back. No duplicate document requests or second checklist. Keep **Call Complete** and optional **Interview Script**.

## Staff And Renter Experience
1. **Quick Completion:** File-backed circles open **Collected / Not Collected**. Receipt by Email, Text, Paper or Other is Yellow until uploaded; Not Collected is Red. Save attributed history and keep follow-up open. Matching current staff/renter uploads turn collection Green; license needs both sides. Unrelated, rejected or superseded files do not count.
2. **Separate Truths:** Green Documents/Insurance means files are on file, not identity/license validity or insurance verification. Show any outstanding review beside the same row—not in another section. Agreement completion requires canonical signed eSign evidence or the existing audited paper-agreement review; uploading an unsigned PDF cannot complete it. Inspection completion comes from the matching vehicle inspection, not a generic checkbox.
3. **Approval And Welcome:** Keep one authorized approval path and preserve an explicit approval-only option. The main **Approve & Invite** path provides secure account setup/sign-in access and a reviewed pickup packet. Do not email passwords, relink identities, resend automatically on refresh, or silently issue an agreement. Existing account/access conflicts remain blocking; account setup changes that belong to Codex need separate authorization.
4. **Pickup Packet:** Review confirmed appointment/timezone/location, car, authorized photos, real VIN/plate/registration, agreement and payment access together. Requested pickup date is not a confirmed appointment. Missing facts stay Not Set; require saved values before sending. Existing email/portal paths show the reviewed snapshot/current plan. Failures remain visible with safe retry, not re-approval.
5. **Vehicle Change Before Pickup:** Manager/Owner uses the thumbnail picker for another eligible available car. Preserve assignment history; recheck availability, inspection, insurance, agreement and packet for the new VIN. Refuse stale confirmation; never overwrite signed history or imply insurance transfers. Post-activation changes remain the separately gated swap workflow.
6. **Key Handoff:** One **Activate** confirmation reviews final car, actual applicable payment, signed agreement and pickup. Checkmarks, unrelated charges, held deposit alone and legacy defaults are not payment evidence. Reuse existing collection/refund paths without duplicate charges/subscriptions. Pickup/Active turn Green only after successful atomic rental start.
7. **Exceptions:** Manager/Owner selects supported Yellow/Red gaps and supplies one written reason. Unresolved colors/follow-up remain. No fabricated identity/license, insurance verification, inspection, payment or signatures. Actual signed agreement/payment remain required at handoff; preserve separate insurance policy, identity/access and vehicle safeguards.

## Delivery Sequence And Current Holds
### 1. Presentation And Pure Rules
Add Inspection/Agreement stages and navigation, consolidate color semantics and prepare the compact forms and pickup packet with invented fixtures. Keep saved-evidence and handoff activation additions disabled until their durable transaction support is accepted. A visible checkbox must never claim an unsaved completion.

### 2. Durable Evidence And Handoff Package — Review Before Installation
Prepare exact proposed tables/functions and compatibility tests; do not generate or execute SQL under the current hold. Review caller permissions, approval compatibility, existing migration ordering and atomic lifecycle integration. Do not retry or revise Security 0031 or alter unrelated pending migrations.

### 3. Portal, Packet And Pre-Pickup Assignment
Build on accepted durable support. Reuse the existing account, private-document, eSign, payment and photo-sharing paths. Enable only after the role/ownership checks, retries and final-car consistency pass. No provider migration or authentication redesign is included.

### 4. Acceptance And Separate Publication
Use approved disposable fixtures for saves, emails, payments and activation; eSign only in its existing disposable harness. Verify staff/renter readback without changing live customers. Publication and live actions need separate approval.

**Plan approval does not lift the existing no-SQL, no-production-record, no-publication, no-auth/Identity Review changes or protected eSign-work holds.** Before live support is enabled, obtain explicit approval for the exact installation and any protected integration changes.

## Technical Design
### Reuse And Files
- `DriversPanel.tsx`, `NextStepCard.tsx`, `ActivationRequirementList.tsx`, `ui.tsx`: single checklist, rail, navigation. Existing evidence modules/controls are prepared but disabled; add Text as a receipt source and separate collection from verification.
- Existing upload dialog/hook, `documents.functions.ts`, `required-docs.ts`: private vault, Front/Back, shared saved facts.
- `activation-readiness.ts`, `rentals.functions.ts`, `ActivateRentalDialog.tsx`: canonical checked transaction and rental start; keep rental end unchanged.
- `applications.functions.ts`, `approval-rpc.server.ts`, existing account/email helpers: one approval path currently provisions access, invites new accounts only and defaults to agreement send. Review explicit retry/send semantics; no parallel approval writer.
- `portal.functions.ts`, `portal.tsx`, `portal-access.functions.ts`, `portal-pickup-checklist.functions.ts`: authorized own-renter reads and navigation. Active-rental vehicle reads do not cover a pre-pickup car; do not enable both existing disabled pickup widgets.
- `portal-pay-link.ts`: existing `https://drivereal.com/portal?pay=balance` link creates no charge. Pay Now requires a real rental/obligation; show unavailable when absent rather than inventing charges. Pre-rental collection requires separate compatibility approval.
- Canonical `prepareAgreement`/eSign, audited paper review, `inspections.functions.ts`, reviewed vehicle-sharing snapshots/private media. No parallel signing or public private-photo exposure.

### Proposed Durable Changes (Contract Only; No SQL In This Plan)
- `application_checklist_events`: append-only application/field attestations with revision, previous event, Collected/Not Collected, source, note, server actor/time, idempotency key and request fingerprint. No anonymous access, direct overwrite/delete or client-issued actor facts.
- `application_pickup_plans`: confirmed appointment timestamp/timezone, pickup location snapshot, current vehicle assignment, revision and staff attribution; separate from applicant-requested `pickup_date`/`pickup_time`.
- `application_pickup_plan_events`: immutable appointment/assignment history with previous/next revision, car, actor and reason. This supplies pre-pickup history without enabling permanent numbering or post-activation swaps.
- `application_pickup_packet_deliveries`: reviewed packet fingerprint, plan revision, recipient identity reference, retry key and claimed/result state/provider reference. Store no passwords or raw bearer tokens. Reuse existing provider delivery tracking, with visible uncertain delivery rather than duplicate retry.
- Field follow-up is derived from latest attestation plus current saved document; completion/exception history is retained. Add a separate task table only if a durable follow-up action cannot be represented by these existing facts.
- Restricted authenticated mutation functions for attestation append, pickup-plan save/change and packet claim/finalize; explicit grants, RLS and append-only validation. Permission comes from existing role authority and caller-scoped application access; only Manager/Owner approval, final assignment and activation.
- Extend the existing checked activation transaction to lock/re-read role, application, current pickup-plan revision, final vehicle, scoped evidence, applicable payment and signed-agreement binding; validate selected operational exceptions/reason; call canonical activation and write immutable audit/follow-up/handoff evidence in the same transaction. Missing support or audit failure refuses, with no legacy bypass.

### Focused New Modules
Create pure `driver-lifecycle.ts` and `pickup-plan.ts` with tests; scoped `pickup-plan.functions.ts` / `pickup-plan.server.ts` and `pickup-packet.functions.ts` / `pickup-packet.server.ts` only after the durable contract is authorized. Use small `PickupPlanDialog.tsx`, `PickupHandoffDialog.tsx` and a single `PortalPickupPlan.tsx` rather than expanding the profile with extra panels. Preserve existing exported interfaces and routes.

## Acceptance
- Exact ten-stage order; one document/insurance row; one license Add with Front/Back; desktop/phone and keyboard checks.
- Yellow receipt survives reload/session; explicit Not Collected is Red; matching staff/renter upload is Green. Wrong renter/category, rejected, superseded or unsaved files cannot resolve it. No false verification/signature.
- Existing role matrix and staff-preview write refusals; cross-renter reads/private media denied. No passwords, GPS/key locations, Owner finance/title identifiers.
- Stale revisions, retries, double-clicks and email failure after account creation never duplicate accounts, packets, contracts, charges or rentals.
- Vehicle change rechecks inspection/insurance/agreement applicability, preserves signed originals and prevents competing activation.
- Payment/signature evidence belongs to this handoff; pending/failed/refunded/unrelated payments never pass by checkbox. Written exceptions preserve separate identity/license/access controls and unresolved follow-up; audit failure rolls back; Active requires successful canonical transaction/readback.

## Recommendation
**GO for the simple presentation and isolated rules once this plan is approved. NO-GO for live manual check-offs, automatic pickup packets, new payment obligations or revised handoff activation until the exact durable package, protected integrations and disposable acceptance are explicitly approved.** Keep the existing sender unchanged; Lovable’s email-status check does not cover the app’s existing Resend setup, so verify that provider without introducing a replacement email system.