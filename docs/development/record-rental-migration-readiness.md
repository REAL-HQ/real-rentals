# Record Rental — migration readiness

2026-10-23. Read-only against production; tests local. **No production SQL run.**

## 1. Where the packet is

The M2 packet and its install runbook are **not on the release lineage**. They
live at commit **`29d47ee3`**, on `origin/cursor/m2-packet-grants-ba3d` and
`origin/handoff/wip-M2-2026-10-22`.

| | |
|---|---|
| Packet | `proposed/m2-packet/` — **24 files** |
| Install runbook | `proposed/HOSTED-INSTALL.md` — **2,673 lines, 29 ordered steps** |
| Record Rental core | step **5** = `03.sql` (207 lines) |
| Vehicle Swap | step **26** = `20.sql` |
| Rollback | **one file per step**, e.g. `proposed/rollback/03-record-rental.sql` |

**Requirement 8 is already met and does not need rewriting.** `HOSTED-INSTALL.md`
carries the deploy order, the window, pre-checks, a read-only preflight
(`proposed/m2-preflight.sql`, `scripts/m2-hosted-preflight.ts`), a per-step
verification query, and a per-step rollback file.

## 2. Production preconditions — checked today

**Nothing of M2 is installed** (a clean install, not a resume):

| Object | Present |
|---|---|
| `rr_record_executor` role | no |
| `public.booking_vehicle_assignments` | no |
| `private.record_operations` | no |
| `private.assignment_closures` | no |
| `public.record_existing_rental_tx` | no |
| `private.approval_lock()` / `approval_actor()` | no |

**The constraints the packet asserts before installing already exist:**

| Index | Present |
|---|---|
| `rentals` one active per vehicle | **yes** |
| `rentals` one active per driver | **yes** |
| unique `payments.stripe_invoice_id` | **yes** |
| unique `rentals.stripe_subscription_id` | **yes** |

So step 5's precondition checks should pass. The packet also asserts them itself
and refuses otherwise.

## 3. Your eight requirements, against the actual code

| # | Requirement | Status |
|---|---|---|
| 1 | Verify the packet and dependencies | **done** — §1, §2 |
| 2 | Record a real rental with **no new Stripe charge or subscription** | **holds.** The app's Record Rental path contains **no Stripe reference at all**; `03.sql` only *records* an existing `cus_…`/`sub_…` from server-verified evidence, and `private.record_subscription_evidence` is a **deny-by-default stub** that raises `subscription_contract_unverified` until a reviewed implementation is installed |
| 3 | Verified historical start dates and assignments | **holds.** `_started_at` is a parameter, resolved in `America/New_York`; odometer sanity is checked against readings *on or before* that date |
| 4 | Preserve driver, vehicle, period, financial history | **holds.** History tables are immutable — `record_immutable()` raises `record_history_immutable` (42501) on any update or delete across the five record tables |
| 5 | Prevent duplicate active vehicle assignments | **holds, three ways.** `vehicle_unavailable` (vehicle must be `available`, locked `FOR UPDATE NOWAIT`); `allocation_conflict` (no active rental for that application, driver **or vehicle**); `duplicate_rental` (same application + vehicle + start date). Backed by the two production indexes above, and `record_one_original` allows one original assignment per rental |
| 6 | Rentals separate from payment collection | **holds.** No payment is written. A test asserts it by name: *"disabled UI and no Stripe/payment import path"* |
| 7 | Coordinator stays restricted | **holds.** `manager_required` (42501) in the function; `RECORD_RENTAL_CONTRACT_ENABLED` is a hard `false` in source |
| 8 | Install order, rollback, post-install checks | **already exist** — §1 |

Also enforced: application must be `approved` and not deleted, driver account
required, positive identity required, agreement evidence required, read-committed
isolation, an advisory lock with `record_contention` (40001), actor re-checked
mid-transaction, and idempotency via `operation_conflict`.

### On your business caution

The function never infers a handover date: `_started_at` is supplied by staff,
and subscription details are only accepted from verified evidence. **It cannot
derive a rental from a Stripe subscription date**, which is what you asked for.

## 4. Tests

| Suite | Result |
|---|---|
| 9 × `scripts/record-rental-*.test.cjs` | **9/9 suites pass** |

Including: no Stripe/payment import path · voided evidence rejected · missing
authoritative document hash fails closed · existing conflict reviews are not
positive licence verification · consumption token sent once.

## 5. Blocked / needs approval

1. **The packet is not on the release lineage.** Before installation it should be
   brought onto a reviewable branch at `29d47ee3`, unchanged. Not done — that is
   an integration decision.
2. **Owner approval for the 29-step hosted install.** Step 3 has its own hold
   conditions (flag-on builds deployed, document hash backfill clean) documented
   in the runbook.
3. **`RECORD_RENTAL_CONTRACT_ENABLED` stays `false`** until after installation and
   your separate approval.
4. `private.record_subscription_evidence` and `record_agreement_evidence` are
   deny-by-default stubs in `03.sql`; the real contracts arrive in later steps.

## 6. Order this unblocks

1. Install M2 → rentals can be recorded.
2. Staff record the three actual rentals (dates and vehicles verified by them).
3. **Link to Rental** attaches the three Stripe payments — already cherry-picked,
   22/22, dark, no migration needed.
4. Verify Payments and Revenue.
5. Review Stripe Reconciliation **0033** separately for ongoing use.
6. Vehicle Swap (step 26), which depends on this.
