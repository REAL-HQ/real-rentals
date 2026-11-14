# Simple Approval-To-Pickup Flow

## Result
Keep one checklist and one progress rail above the profile tabs:

**Applied → Contacted → Screening → Documents → Insurance → Approved → Inspection → Agreement → Pickup → Active**

One **Add** button per document field; the license modal contains Front/Back. No duplicate document requests or second checklist. Keep **Call Complete** and optional **Interview Script**.

## Staff And Renter Experience
1. **Quick Completion:** File-backed circles open **Collected / Not Collected**. Receipt by Email, Text, Paper or Other is Yellow until uploaded; Not Collected is Red. Save attributed history and keep follow-up open. Matching current staff/renter uploads turn collection Green; license needs both sides. Unrelated, rejected or superseded files do not count.
2. **Separate Truths:** Green Documents/Insurance means files are on file, not identity/license validity or insurance verification. Show any outstanding review beside the same row—not in another section. Agreement completion requires canonical signed eSign evidence or the existing audited paper-agreement review; uploading an unsigned PDF cannot complete it. Inspection completion comes from the matching vehicle inspection, not a generic checkbox.
3. **Login First:** **Approve & Invite** sends secure account access before car/appointment confirmation; pickup details follow. Keep one approval path and Approve Only. No passwords, identity relinking, refresh resends or silent agreements; access conflicts block. Codex-owned account changes need separate approval.
4. **Team-Confirmed Pickup:** Staff confirm appointment/timezone/car. Offer **3500 E. Hillsborough Ave., Tampa, FL 33610**, **6411 E County Line Rd., Tampa, FL 33647**, or **Other Location**; no auto-selected address, and all addresses remain editable per renter. Review real VIN/plate/registration, approved photos, agreement and payment access together. Requested date is not confirmation; missing facts stay Not Set. Login-first need not wait; pickup details require saved facts and a reviewed snapshot, with visible failures/safe retry.
5. **Vehicle Change Before Pickup:** Manager/Owner uses the thumbnail picker for another eligible available car. Preserve assignment history; recheck availability, inspection, insurance, agreement and packet for the new VIN. Refuse stale confirmation; never overwrite signed history or imply insurance transfers. Post-activation changes remain the separately gated swap workflow.
6. **Key Handoff:** One **Activate** confirmation reviews final car, signed agreement, pickup and actual applicable payment. Support **Stripe, Zelle / Bank Transfer, Cash App / Venmo, Cash and Other** (actual method name required). Verify exact amount/date, payer/reference/source evidence and staff attribution against the obligation, deduplicated. Checkmarks, unrelated charges, held deposits alone and legacy defaults are not proof. Reuse approved collection/refund/ledger paths; no duplicates/auto-posting. Pickup/Active become Green only after atomic rental start.
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
- `DriversPanel.tsx`, `NextStepCard.tsx`, `ActivationRequirementList.tsx`, `ui.tsx`: one checklist/rail; evidence remains disabled, collection separate from verification.
- Existing upload hook/dialog, `documents.functions.ts`, `required-docs.ts`: shared private vault/Front-Back facts.
- `activation-readiness.ts`, `rentals.functions.ts`, `ActivateRentalDialog.tsx`: checked canonical start, unchanged rental end.
- `applications.functions.ts`, `approval-rpc.server.ts`, account/email helpers: existing approval provisions access, invites new accounts only and defaults to agreement send. Review retry/explicit-send compatibility; no parallel writer.
- Portal/access/pickup functions and `portal.tsx`: scoped own-renter reads; active-rental reads cannot cover pre-pickup blindly. Never enable both disabled widgets.
- `portal-pay-link.ts`: existing balance link creates no charge; real obligation required. Pre-rental collection needs separate approval.
- Reuse canonical eSign/prepareAgreement, audited paper review, inspections and private vehicle-share snapshots; no parallel signing/public private photos.

### Proposed Durable Changes (Contract Only; No SQL In This Plan)
- `application_checklist_events`: append-only field receipt state, revision/correction, source/note, server actor/time and retry fingerprint; no direct overwrite/delete or forged actors.
- `application_pickup_plans`: team-confirmed timestamp/timezone, editable suggested/custom location snapshot, final vehicle, revision/actor; distinct from requested pickup date/time. Suggested locations are not confirmation.
- `application_pickup_plan_events`: immutable appointment/assignment revisions, car, actor/reason; no numbering or post-activation swap changes.
- `application_pickup_packet_deliveries`: reviewed fingerprint, plan revision, recipient reference, retry key, claim/result/provider reference; no passwords/raw tokens. Reuse delivery tracking and show uncertain outcomes.
- Derive field follow-up from latest receipt/current file; retain history. Add a task table only if those facts cannot represent required follow-up.
- Restricted authenticated append/plan/packet functions: explicit grants/RLS, caller-scoped access, immutable attribution and existing role authority. Manager/Owner only for approval, final assignment and activation.
- Extend checked activation to lock/re-read role, application, plan revision, final car, evidence, payment and agreement binding. Validate selected exceptions/reason; canonical rental start plus audit/handoff commit together. Missing support/audit failure refuses; no legacy bypass.

### Focused New Modules
Pure lifecycle/pickup modules with tests; scoped server helpers only after durable authorization. Compact plan/handoff dialogs and one portal pickup view; no duplicate panels or changed public interfaces.

### Current Review Status
Preview steps are verified; location choices/custom editing are prepared and tested. Login-first sending, durable check-offs, payment verification and handoff still need exact-package/protected integration approval. No live emails, records, SQL or publication.

## Acceptance
- Exact ten-stage order; one document/insurance row; one license Add with Front/Back; desktop/phone and keyboard checks.
- Staff confirm appointments; both specified Tampa locations work and allow edits/custom addresses. Login-first is independent of pickup confirmation; neither email repeats on refresh/reapproval. Each payment method uses actual applicable verified evidence, not a method choice/checkmark.
- Yellow receipt survives reload/session; explicit Not Collected is Red; matching staff/renter upload is Green. Wrong renter/category, rejected, superseded or unsaved files cannot resolve it. No false verification/signature.
- Existing role matrix and staff-preview write refusals; cross-renter reads/private media denied. No passwords, GPS/key locations, Owner finance/title identifiers.
- Stale revisions, retries, double-clicks and email failure after account creation never duplicate accounts, packets, contracts, charges or rentals.
- Vehicle change rechecks inspection/insurance/agreement applicability, preserves signed originals and prevents competing activation.
- Payment/signature evidence belongs to this handoff; pending/failed/refunded/unrelated payments never pass by checkbox. Written exceptions preserve separate identity/license/access controls and unresolved follow-up; audit failure rolls back; Active requires successful canonical transaction/readback.

## Recommendation
**GO for tested presentation/preparation. Live check-offs, emails, payment obligations and handoff remain blocked pending exact-package/protected integration approval and disposable acceptance.** Preserve the existing sender/provider; no publication.