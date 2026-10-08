# Driver Status & Manual Payments — Root Cause & Phased Plan

This was a read-only audit. Nothing was changed. No migration was applied and no real record was touched. Application Resume, Identity Review, sign-in and the release branches were not read for editing or modified.

## 1. Root cause: why 8 people show as Active

"Active" comes only from one field on the application, `applications.status = 'active'`.
- The Drivers list filter, status badge and the profile's "Active" stage all read that field (DriversPanel.tsx, FILTER_LABEL and the lifecycle flags around lines 1130–1155).
- No rental, car or payment is checked.

What the 8 records actually have:

| Driver | Applied | Status last changed | Rentals | Active rentals | Payments | Paid | Audit entries |
|---|---|---|---|---|---|---|---|
| K. | Jul 13 | Jul 23 | 0 | 0 | 0 | 0 | none |
| T. | Jul 15 | Jul 23 | 0 | 0 | 0 | 0 | none |
| L. | Jul 19 | Jul 23 | 0 | 0 | 0 | 0 | none |
| A. | Jul 21 | Jul 23 | 0 | 0 | 0 | 0 | none |
| T. | Jul 22 | Sep 26 | 0 | 0 | 0 | 0 | none |
| A. | Jul 22 | Jul 23 | 0 | 0 | 0 | 0 | none |
| T. | Jul 23 | Jul 23 | 0 | 0 | 0 | 0 | none |
| L. | Jul 23 | Oct 8* | 0 | 0 | 0 | 0 | none |

\*"Status last changed" is the record's last-updated date. It can move for edits other than status, such as the Oct 8 date.

- Six of the eight were last changed on Jul 23. That points to a one-time bulk or manual status change made before the activity log existed.
- None has a rental, an assigned car or a payment. The label is simply wrong.

Paths that can still set Active without a rental today:
- **Profile status edit.** It writes `status` straight to the application, and nothing in the database stops it. This is the likely original cause.
- **After rental activation.** It also writes `status: "active"` from the browser (DriversPanel.tsx line 2071). The atomic rental start already happened, so this one is redundant, not harmful.
- **Screening pipeline.** It has its own separate "active_renter" stage (DriverScreening.tsx), a second, parallel meaning of Active.

## 2. Target lifecycle: five separate facts

| Fact | Source of truth | Values |
|---|---|---|
| Application stage | applications.status | New, Reviewing, Approved, Declined, Closed (and Suspended) |
| Waitlist | application_waitlist_holds | On Waitlist / not |
| Rental status | rentals, changed only through activate_rental_tx / end_rental_tx | None, Active, Ended |
| Payment status | payments, via computePayCells | Current, Due, Overdue, Paid |
| Deposit status | rentals deposit fields + deposit_deductions | Not Set, Held, Partially Applied, Returned |

Rule: **Active Renter = has a rental with status 'active'.** Nothing else. The Active filter and badge, the profile "Active" stage and "active_renter" in screening all derive from that. The application stage stops using `'active'` as a value it can be set to.

Existing rental-start rules are kept unchanged. That includes the activate_rental_tx / end_rental_tx transactions, the guard_rental_lifecycle and guard_vehicle_rented_status checks, and the override-with-reason audit.

## 3. Payments: what exists vs what's missing

Already in place (reused, not duplicated):
- **Payment records.** A `payments` row is a charge written before collection. It has `payment_method`, `amount`, `balance_due`, `net_collected`, `refunded_amount`, `paid_date` and `notes`.
- **Collection status.** payment-collection.server.ts is the only place that moves a payment's status.
- **Card payments.** The Stripe webhook never un-pays a payment. apply_payment_refund is the only refund path.
- **Manual payments.** PaymentsPanel already lets staff create and edit them. But `payment_method` is free text ("Card, ACH"), and edits go straight from the browser to the table with no verification step.
- **Deposits.** deposit_deductions and DepositDialog. Step C1 ledger rows for deposit received, applied and returned.
- **Step C1 ledger.** Proposed → confirmed → posted entries, reversal and correction, fin_settle to match a payment to a charge, an evidence table, and Owner-only privacy.

Missing:
- A fixed list of methods: Cash App, Venmo, Zelle, Cash, Bank Transfer, Check, Money Order, Other.
- A separate "collection" record. One charge can be paid in several pieces, each with its own method, date, reference and receipt.
- Pending Verification / Verified / Rejected states, recording who verified and when.
- Receipt files: none stored today.
- Duplicate protection on method plus reference number.
- Manual edits run through a server check, not straight from the browser.

## 4. Record Payment workflow (proposed)

Staff choose **Record Payment** on a driver or rental and enter:
- Driver and rental (pre-filled)
- Purpose: Rent, Deposit, Fee or Toll (linked to the open charge)
- Amount
- Method
- Date received
- Reference number
- Receipt upload, through the shared file uploader into private storage

The payment is saved as **Pending Verification**. The rental balance doesn't change yet.

A Manager or Owner then chooses **Verify** or **Reject**, with a note for rejections. Verification runs as one database transaction that:
- Marks the collection Verified.
- Applies it to the charge: reduces balance_due, adds to net_collected, sets Paid when the balance reaches 0.
- Proposes the matching Step C1 cash entry, which still needs separate posting.
- Writes an audit entry.

Stripe is never called. Rejected entries stay in history as evidence.

## 5. Financial integrity

- **Duplicates:** unique on method + normalized reference (ignored for Cash), plus an idempotency key per submission, plus a warning for the same amount, driver and date.
- **Partial payments:** many collections per charge. The charge is Paid only at a zero balance. An amount above the balance is refused unless staff record it as a credit.
- **Refunds and reversals:** a verified collection is never edited or deleted. "Reverse" writes a reversal row and restores the balance. Refunds on Stripe payments still go only through apply_payment_refund.
- **Deposits:** a deposit collection marks the deposit Held. Applying or returning it keeps using the existing deduction and C1 deposit rules.
- **Cash vs accrual:** the charge is the accrual side. A verified collection is the cash side, dated by the date received. This matches C1's rules for which entries count in each view.
- **Permissions:**
  - Coordinator+ can record.
  - Only Manager and Owner can verify, reject or reverse. Enforced in the database and on the server, not only by hiding buttons.
  - Owner-only finance data stays Owner-only.
- **Revenue:** still counted as net_collected, so nothing is counted twice.

## 6. Scale (1,000+ drivers and cars)

- Indexes on rentals(application_id, status), payments(driver_id, status, due_date) and collections(payment_id, status, received_on).
- The "Active Renter" list filter and counts are computed by the database, not the browser.
- The Drivers list moves to server-side pages, search and filters. Payment and deposit cells are fetched only for the visible page, reusing getDriverPayStatuses with driverIds.

## 7. Phases (each needs your approval)

- **Phase A — Status truth.** Preview only, no data change.
  - Derive Active from active rentals in the Drivers filter and badge, the profile stage and the screening stage.
  - Remove the browser-side `status: "active"` write and the option to pick Active by hand.
  - Show a staff-only "Marked Active, no rental" flag on the 8 records.
- **Phase B — Database guard.** One migration, applied only with your approval.
  - A trigger refuses application status 'active' unless an active rental exists.
  - Existing rows are flagged, not altered.
  - You decide separately what the 8 records should become, for example Approved.
- **Phase C — Record Payment.** One migration plus server functions and UI.
  - Adds the collections table, method list, receipt link and verify/reject/reverse functions.
  - Locks manual payment edits behind the server.
  - Hooks into C1 proposals only, with no automatic posting.
- **Phase D — Scale.** Indexes, server-side pagination and database-side counts.

## Technical details

- **Affected files:**
  - DriversPanel.tsx and DriverScreening.tsx (status display)
  - PaymentsPanel.tsx (manual-payment form)
  - DepositDialog.tsx
  - rentals.functions.ts (the activation result shown to the screen)
  - driver-payment-status.ts / .functions.ts (cells)
  - payment-collection.server.ts (collections update balances)
  - financial-ledger.functions.ts (proposals)
  - New files: payments-manual.functions.ts / .server.ts and a RecordPaymentDialog using FileUploader
- **Proposed migrations (not written or applied):**
  - Application status guard trigger.
  - `payment_collections`: id, payment_id, rental_id, driver_id, method enum, amount, received_on, reference_raw, reference_norm, receipt_document_id, status, verified_by, verified_at, rejection_note, reverses_id, idempotency_key, created_by. Grants, row-level security for staff reads, and writes only through security-definer functions (`collection_verify`, `collection_reject`, `collection_reverse`).
  - Unique index on (method, reference_norm) where the reference is not null and the method is not cash.
  - Scale indexes.
- **Tests:**
  - Rolled-back database tests for the guard, verification math, partial payments, overpayment refusal, duplicate refusal, reversal and role denial (Coordinator can't verify; Driver and signed-out users get nothing).
  - Unit tests for status derivation and the payment cells.
  - Browser tests with temporary fixtures only, cleaned up afterwards, with before and after record counts.
- **Release dependencies:**
  - Kept separate from the Application Resume hotfix, the sticky header, Driver Deletion and Waitlist.
  - Phases A–D touch none of the Resume or Identity Review files.
  - Phase C builds on C1 (already in the database) but does not start Step C2.
