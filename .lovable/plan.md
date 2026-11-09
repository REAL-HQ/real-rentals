# Simple Approval-To-Pickup Flow

## Result
Keep one checklist and one progress rail above the profile tabs:

**Applied → Contacted → Screening → Documents → Insurance → Approved → Inspection → Agreement → Pickup → Active**

One **Add** button per document field; the license modal contains Front/Back. No duplicate document requests or second checklist. Keep **Call Complete** and optional **Interview Script**.

## Staff And Renter Experience
1. **Quick Completion:** Clicking a file-backed circle opens compact **Collected / Not Collected** choices. Collected by Email, Text, Paper or Other is Yellow until the matching file is saved. Explicitly Not Collected is Red. Preserve the note, actor and previous choices; follow-up stays open. Current matching uploads make the file-collection indicator Green whether uploaded by staff or renter. License Front and Back must both be present; unrelated, rejected or superseded files do not count.
2. **Separate Truths:** Green Documents/Insurance means files are on file, not identity/license validity or insurance verification. Show any outstanding review beside the same row—not in another section. Agreement completion requires canonical signed eSign evidence or the existing audited paper-agreement review; uploading an unsigned PDF cannot complete it. Inspection completion comes from the matching vehicle inspection, not a generic checkbox.
3. **Approval And Welcome:** Keep one authorized approval path and preserve an explicit approval-only option. The main **Approve & Invite** path provides secure account setup/sign-in access and a reviewed pickup packet. Do not email passwords, relink identities, resend automatically on refresh, or silently issue an agreement. Existing account/access conflicts remain blocking; account setup changes that belong to Codex need separate authorization.
4. **Pickup Packet:** Review confirmed date, time, timezone and location, assigned vehicle, authorized photos, real VIN/plate/registration details, reviewed agreement and payment access together. An application’s requested pickup date is not a confirmed appointment. Require real saved values before sending a complete packet; missing values remain Not Set. Use the existing secure portal and canonical email sender. The live portal shows the current plan; email carries its reviewed snapshot and portal links. Delivery failures remain visible and can be retried without re-approval or duplicate sends.
5. **Vehicle Change Before Pickup:** Managers/Owners choose another eligible available vehicle from the shared thumbnail picker. Save an attributed assignment history, recheck availability and discard stale confirmation. Re-evaluate the inspection, insurance applicability, agreement and packet against the new car. Never overwrite signed agreement history or imply insurance covers a different VIN. Vehicle changes after activation remain the separately gated swap workflow, not this action.
6. **Key Handoff:** One **Activate** action opens a compact confirmation for the final car, payment evidence, signed agreement and pickup details. Verify the actual applicable payment/obligation—not a checked circle, unrelated past charge, held deposit alone or the application’s legacy payment default. Reuse existing collection/refund paths; never create a second charge or subscription. On successful atomic rental start, Pickup and Active turn Green. Failure leaves them unchanged.
7. **Exceptions:** Manager/Owner may override supported Yellow/Red operational evidence gaps with one written reason covering explicitly selected items. Keep the unresolved items Yellow/Red and follow-up open afterward. This never fabricates identity, valid license, insurance verification, inspection results, payment or signatures. At key handoff, actual signed-agreement and applicable payment confirmation remain required as requested. Preserve the independent insurance exception setting and all identity/access/vehicle safeguards.

## Delivery Sequence And Current Holds
### 1. Presentation And Pure Rules
Add Inspection/Agreement stages and navigation, consolidate color semantics and prepare the compact forms and pickup packet with invented fixtures. Keep saved-evidence and handoff activation additions disabled until their durable transaction support is accepted. A visible checkbox must never claim an unsaved completion.

### 2. Durable Evidence And Handoff Package — Review Before Installation
Prepare exact proposed tables/functions and compatibility tests; do not generate or execute SQL under the current hold. Review caller permissions, approval compatibility, existing migration ordering and atomic lifecycle integration. Do not retry or revise Security 0031 or alter unrelated pending migrations.

### 3. Portal, Packet And Pre-Pickup Assignment
Build on accepted durable support. Reuse the existing account, private-document, eSign, payment and photo-sharing paths. Enable only after the role/ownership checks, retries and final-car consistency pass. No provider migration or authentication redesign is included.

### 4. Acceptance And Separate Publication
Use approved disposable fixtures for saves, emails, payment-state changes and activation. eSign tests run only in the existing disposable eSign harness. Test real readback through staff/renter views without changing Adam, Damon, Regina, Schrita or other live customers. Publication and live customer actions require separate authorization.

**Plan approval does not lift the existing no-SQL, no-production-record, no-publication, no-auth/Identity Review changes or protected eSign-work holds.** Before live support is enabled, obtain explicit approval for the exact installation and any protected integration changes.

## Technical Design
### Reuse
- `DriversPanel.tsx`, `NextStepCard.tsx`, `ActivationRequirementList.tsx`, `ui.tsx`: one checklist, progress rail and existing navigation.
- `checklist-evidence.ts`, `ChecklistEvidenceControl.tsx`, `ChecklistExceptionFields.tsx`: existing disabled proposal for scoped attestations and exception presentation. Add Text as a real receipt source and keep collection separate from verified completion.
- `DriverDocumentUploadDialog.tsx`, `use-driver-document-upload.ts`, `documents.functions.ts`, `required-docs.ts`: private vault upload, Front/Back categories and shared presence facts. Both staff and portal uploads refresh the same state.
- `activation-readiness.ts`, `rentals.functions.ts`, `ActivateRentalDialog.tsx`: authoritative checks and canonical `activate_rental_checked_tx` / `activate_rental_tx`. `end_rental_tx` remains unchanged.
- `applications.functions.ts`, `approval-rpc.server.ts`, `driver-account.server.ts`, `email.server.ts`: existing approval, account conflict protection and canonical sender. Current approval already provisions access; it only attempts invite email for newly created accounts and defaults to agreement sending unless explicitly disabled. Correct those side-effect semantics through reviewed wrappers, never a second approval path or silent contract send.
- `portal.functions.ts`, `portal.tsx`, `portal-access.functions.ts`, `portal-pickup-checklist.functions.ts`: owned renter reads and existing Documents/Payments navigation. Existing active-rental vehicle reads do not cover the proposed pre-pickup car; two prepared pickup widgets remain disabled and must not be enabled together as duplicate checklists.
- `portal-pay-link.ts`: existing `https://drivereal.com/portal?pay=balance` access link. It does not create a charge. Current Pay Now depends on an actual rental/charge; if no approved pre-rental obligation exists, show unavailable rather than invent a payment link or charge. Review that dependency separately.
- Existing `prepareAgreement` / canonical eSign and audited paper evidence; `inspections.functions.ts`; existing reviewed vehicle-sharing snapshots/private media routes. Never expose staff-only vehicle fields or Owner finance/title data.

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
- Exact ten-stage order; one document requirement/insurance row; one Add for license with Front/Back inside; desktop/phone and keyboard checks.
- Staff receipt without file stays Yellow across reload/session; explicit Not Collected becomes Red; correct staff/renter upload becomes Green; wrong driver/category, rejected/noncurrent/unsaved upload never resolves it. No false verification or signature.
- Same role boundaries: Coordinators retain permitted receipt/review work but cannot approve, reassign final car or activate; Driver/staff-preview cannot perform staff or renter writes improperly.
- Stale revisions, duplicate retries, email failure after account creation and double-click approval/activation handled without duplicate accounts, packets, contracts, charges or rentals.
- Packet contains only real authorized facts; cross-renter reads/private media denied; no plaintext passwords, staff GPS/key locations, Owner finance or title identifiers.
- Changed vehicle invalidates inspection/insurance/agreement applicability; signed originals preserved; concurrent allocation permits one final activation.
- Payment and agreement evidence are for this renter/final handoff; pending/failed/refunded/unrelated payment never becomes a passed handoff by checkbox.
- Written reason required for each selected operational exception; identity/license/access safeguards remain; audit failure rolls back; Active only after canonical transaction and successful UI readback.

## Recommendation
**GO for the simple presentation and isolated rules once this plan is approved. NO-GO for live manual check-offs, automatic pickup packets, new payment obligations or revised handoff activation until the exact durable package, protected integrations and disposable acceptance are explicitly approved.** Keep the existing sender unchanged; Lovable’s email-status check does not cover the app’s existing Resend setup, so verify that provider without introducing a replacement email system.