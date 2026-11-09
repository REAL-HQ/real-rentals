# Yellow/Red Checklist And Audited Activation Exceptions

## Confirmed Behavior
- Each file-backed checklist field gets a **Collected** checkbox and an explicit **Not Collected** option. These record what staff actually have, not whether identity, insurance or signatures are verified.
- **Yellow — Upload Due:** collected elsewhere, matching file not yet uploaded. Keep the upload reminder visible until that specific file is added.
- **Red — Not Collected:** not collected, including a correction to a previously checked item. Preserve the earlier entry in history.
- Both Yellow and Red operational checklist gaps may be explicitly overridden by a **Manager or Owner** during activation with a required written reason. Red does not automatically prevent activation; it does not become Green after an override.
- Adding a matching file clears its upload reminder; review/signature requirements remain separately truthful. A signed canonical eSign agreement continues to appear automatically.
- Screening and other progress markers use their applicable checklist items: Red takes precedence over Yellow; actual complete items are Green. Actual application status and Active status are unchanged by these colors.
- **Interview Script** remains optional; **Call Complete** remains available for a real qualification call completed without clicking through the script.

## Staff Experience
1. Staff check Collected when a file was received by email, on paper or another real source. Use a compact source/note dialog rather than a new large upload area.
2. Staff can switch to Not Collected without deleting earlier evidence history. Current uploaded or reviewed evidence is not silently discarded by this correction; show any disagreement for review.
3. Existing per-field Add dialogs continue handling private uploads.
4. Activate Rental lists each outstanding operational item and its current Yellow/Red state. Manager/Owner explicitly select which items to override and enter the reason; the same reason may cover the selected items without requiring repeated entry.
5. After activation, missing items and in-app follow-ups remain visible. No automatic emails/texts, invented deadlines, cancellation or financial activity is added.

## Safety Boundaries
- An override grants an exception to an operational requirement; it never says an unreceived file exists, an unsigned agreement is signed, insurance is verified or interview answers were provided.
- Separate identity/account-conflict, valid-license, vehicle readiness/availability, dates, mileage and access safeguards remain enforced. Staff cannot override another renter's identity or assign a busy vehicle.
- Coordinators keep their current operational staff access but cannot approve or activate rentals. Receipt entry must not expand roles.
- Preserve permanent files, paper-agreement review and the canonical eSign path. No changes to Codex-owned Identity Review, authentication or Application Resume.
- Rental activation, the selected exception states and the reason must commit atomically through the existing checked rental transaction. Missing support or an audit failure must refuse activation, not fall back to an unsafe write.

## Technical Implementation
### Durable Evidence State
Introduce a dedicated append-only application checklist attestation history, with application, exact field/category, Collected/Not Collected, source, note, superseded event, current version, actor, time and idempotency key. Existing documents remain file authority; attestation history is not an identity verdict. Store category-linked open/resolved follow-ups without deleting earlier events.

Server-side staff checks use existing role authority and caller-scoped access. Include explicit table grants, RLS and restricted mutation functions in the separately authorized database package; no anonymous access or direct browser overwrite of audit history.

### Readiness And Activation
Keep document presence, staff attestation and verification/signature facts separate in one shared readiness projection. Extend `activate_rental_checked_tx` to lock and re-read the exact application/vehicle/evidence states, validate the current actor and selected exception reasons, call `activate_rental_tx` and append the activation audit in the same transaction. Retain `end_rental_tx` unchanged. Never make a required-document exception succeed via the legacy fallback.

Review the existing approval gate alongside activation: evidence exceptions must not be blocked unexpectedly upstream or achieved by directly changing application status. Preserve all actual identity/license checks and existing Manager/Owner approval authority. Changes that require Codex-owned identity logic are blockers, not implicit authorization to edit it.

### Files
- New shared pure checklist-evidence rules and focused tests.
- New authenticated attestation read/write functions and server implementation following existing patterns.
- `src/lib/activation-readiness.ts`, `src/lib/rentals.functions.ts` and their tests.
- `src/components/admin/DriversPanel.tsx`, `NextStepCard.tsx`, `ActivationRequirementList.tsx`, `ActivateRentalDialog.tsx` and the existing lifecycle rail.
- Existing document-upload callbacks, only to refresh the matching saved state and follow-up; keep storage and review flows unchanged.
- Existing approval functions, only where the reviewed exception contract requires compatibility; no direct status bypass or identity edits.
- A separately reviewed database package for attestation/history/follow-up and checked-transaction support. Do not alter or retry Security 0031.

## Sequence And Authorization
1. Prepare the code-only rules, UI and synthetic checks with persistence/activation exceptions disabled until matching database support exists.
2. Review the exact database and approval/activation package, including migration ordering. **Separate authorization is required to generate or execute SQL; approving this plan alone does not lift that hold.**
3. After explicit authorization and compatibility acceptance, enable saved attestations and atomic exceptions together—never a UI-only bypass.
4. Verify the actual saved state and activation flow in an approved disposable environment before any real renter test or publication.

## Acceptance Tests
- Checked with no upload is Yellow; Not Collected is Red, including Yellow-to-Red correction; unrelated uploads cannot clear the item.
- File arrival clears the matching upload reminder without inventing review, insurance verification, platform verification or signatures.
- Both Yellow and Red require explicit exception selection and a written reason; Owner/Manager may proceed only with all separate safeguards satisfied.
- Coordinator/Driver/signed-out activation denied; forged actors, wrong applications, stale versions and duplicate submissions refused or safely idempotent.
- Audit failure rolls back activation and exception records; simultaneous vehicle allocation permits at most one rental; absent checked support refuses overrides.
- Activation leaves missing items Yellow/Red, reminders open and all files/history intact.
- Optional script and quick completion, desktop/phone layout, existing authorized roles, payment/eSign workflows and record numbering remain unchanged.

## Current Limit
No customer edits, actual rental activation, SQL generation/execution, Stripe changes, messages, publication or branch changes are included now. The policy is settled; implementing the live exception requires the explicitly authorized durable-storage/atomic-transaction package.