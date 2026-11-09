# Simple Pickup Flow — Phase 1 Acceptance

## Completed
- Inspection and Agreement immediately follow Approved in the ten-stage rail. Buttons open Assigned Vehicle and existing Agreements; the rail remains above profile tabs.
- Insurance stage collection uses the existing scoped vault file facts, independent of actual insurance verification. Inspection and signature completion use authorized readiness only, never a legacy timestamp/upload/status guess. Pickup/Active require the actual active-rental flag.
- Text receipt added to the disabled evidence input/form. Scoped pure collection projection keeps matching uploaded license/insurance Green without declaring verification; wrong renter/category, rejected, noncurrent and unsaved documents cannot resolve collection. Agreement remains signature/review-gated.
- Unmounted PickupPlanDialog, PickupHandoffDialog and PortalPickupPlan prepared with fixture-only visual acceptance. No save/send/activate callbacks or live loaders exist for them.
- Exact proposed durable table/function, permission, retry and atomic dependency contract in pickup-durable-contract-review.md. No SQL generated or installed.

## Verified
- 76 focused Vitest checks passed across lifecycle, pickup contract, collection evidence, existing evidence, quick call, checklist actions and activation-submit issues.
- 15 existing pickup/portal Node tests passed with their own runner. Initial Vitest invocation of Node test files reported no Vitest suite; corrected runner passed, no source changes needed.
- Upload guard and white dropdown regression passed. Latest preview build OK.
- Signed-in current renter profile: ten stages rendered, Inspection opened Assigned Vehicle, Agreement opened existing Agreements, phone page had no horizontal overflow, no runtime errors.
- Invented browser fixtures only: desktop/phone plan, handoff and packet render; Save Plan/Activate disabled; field entry and Cancel work. No live writes/sends/rentals/charges.

## Still Blocked
Durable external receipt saving/reload, confirmed pickup plans/history, approval packet delivery, pre-pickup assignment consistency, applicable pre-rental payment binding and revised atomic handoff require separate exact-package installation/protected integration approval. Existing unavailable evidence server seams and all preparation flags stay disabled. No auth, Identity Review, canonical eSign/payment/rental writer or provider changes; no publication, migration or production-record changes.

The complete live workflow and hosted RLS/concurrency/rollback/provider acceptance are not claimed to be verified. Read the durable contract before authorizing installation; approving the presentation plan did not lift those holds.