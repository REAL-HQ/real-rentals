# Record Rental — read-only walkthrough of the six-step screen

Branch `feature/record-rental-integration`. Every screen below is the real
`src/components/admin/RecordRentalDialog.tsx` with the app's own `src/styles.css`, rendered by
`scripts/record-rental-walkthrough/` (run `node scripts/record-rental-walkthrough/shoot.mjs`).
All data is synthetic. Every server function is a local fixture, and every save action in the
harness refuses ("Walkthrough is read-only: nothing is saved"). The flag is switched on only
inside the harness alias (`contract-preview.ts`); `RECORD_RENTAL_CONTRACT_ENABLED` in the source
stays `false`.

## Why this is not a Lovable Preview link

The production Lovable project previews `integration/grok-baseline-2026-10-22` against the
production backend.
- Showing this branch there means merging it into that branch: a production-branch change
  that needs your approval.
- Even then, the dialog cannot open while the flag is `false`. Staff would see only the
  existing disabled button, "Record Rental — pending acceptance".
- Turning the flag on in Preview would run these screens against real driver records.
- A remix of the project would copy the production backend settings, so it is not safe
  either.

The harness is therefore the read-only walkthrough. If you later approve the merge (no
publish), Preview will show no visible change, and that is the intended result.

## Steps

| Step | What staff see | Screens |
|---|---|---|
| Step bar | Six steps, each showing ✓ or its number of unmet requirements; Review totals them | all |
| 1 · Driver & Vehicle | Driver, portal login, record state; vehicle select (fixed when a registered agreement names the vehicle) | `esign-1-driver`, `blocked-1-driver`, `esign-mobile-1-driver` |
| 2 · Licence | Image review states, licence details, then **Run Licence Check**, which preserves the images and shows the snapshot; **Confirm Licence Verified** sends that snapshot's fingerprint | `esign-2-licence-check`, `esign-2-licence-confirmed`, `blocked-2-licence` |
| 3 · Signed Agreement | Provenance (eSign Verified / Staff-Verified Paper Original / Staff-Verified Legacy eSign), each agreement's status, archive state, signed terms and SHA-256. Actions appear only where the database would accept them: Archive, Register Signed Original (no open agreement), Register As Legacy Agreement (signed, archived, no signed terms), Void Historical Agreement (reason required) | `esign-3-agreement`, `historical-3-agreement`, `historical-3-void-reason`, `legacy-3-agreement`, `blocked-3-agreement` |
| 4 · Rental Details | Pickup time with UTC offset, mileage, weekly rate, deposit (blank means unknown), reason. Values fixed by a registered agreement are locked | `esign-4-details`, `historical-4-details` |
| 5 · Billing | **Check Existing Stripe Link** retrieves only the existing customer and subscription; staff tick that it is the driver's billing. No charge, subscription or invoice is created | `esign-5-billing` |
| 6 · Review | Every fact on one page, all unmet requirements explained, "Type RECORD RENTAL To Confirm"; Save stays disabled until nothing is unmet | `esign-6-review`, `blocked-6-review` |

Screens are in `docs/record-rental/walkthrough/`.

## Scenarios

- `esign`: a driver with a signed, archived eSign agreement carrying signed terms. All steps
  pass once the licence check, details and billing check are done.
- `blocked`: no portal login, an unverified licence image, and an agreement still waiting
  for signature. Each step names the problem and the next action, and no registration is
  offered.
- `historical`: a registered staff-verified paper original. Vehicle, start, rate and deposit
  come from the registration and are locked. Void needs a written reason, and the original
  stays preserved.
- `legacy`: an eSign agreement signed before rental terms existed. Only the legacy
  registration route is offered; the server copies the archived PDF byte for byte.
