# Manual Payments — Phase C Architecture & Implementation Plan

Planning only. No migration applied, no real payment created, nothing published. Application Resume, Identity Review, sign-in, GitHub release branches and deployment settings are untouched.

## 1. What already exists (reused, not duplicated)

| Piece | Today | Phase C use |
|---|---|---|
| `payments` row | A charge (rent, deposit, late fee, toll, damage, fee) written before collection; has `balance_due`, `net_collected`, `refunded_amount`, `paid_date`, `status` | Stays the single charge record. Manual payments reduce its balance only when verified |
| `payment-collection.server.ts` | Only place allowed to move a charge's status | Extended with one manual-collection entry point |
| Stripe paths (`rental-payments.functions.ts`, webhook, `apply_payment_refund`) | Card charges, autopay, refunds | Untouched. Manual payments never call Stripe |
| Deposits (`rentals.deposit_*`, `deposit_deductions`, `DepositDialog`, C1 deposit rows) | Held / applied / returned | A verified deposit collection marks the deposit Held; it never counts as revenue |
| Step C1 ledger (`financial_transactions`, `financial_settlements`, evidence, `fin_propose`, `fin_settle`, reverse/correct) | Immutable cash/accrual ledger, proposal-only | Each verified collection proposes one C1 cash entry. Nothing is posted automatically |
| `FileUploader` + `documents` (private storage) | Shared upload path | Receipts and screenshots go here as a new `payment_receipt` category |
| `audit_log`, `requireTier`, `private.is_owner()` | Permanent history and roles | Every record/verify/reject/reverse is audited |

Gaps found:
- **Staff can edit or delete charges straight from the browser.** PaymentsPanel lines 92 and 98 do this, and the row-level rules allow it. Any staff member can mark a charge Paid with no proof.
- **No fixed method list.** `payment_method` is free text.
- **No verification step.** There is no record of who checked a payment.
- **No receipts are stored.**
- **No duplicate protection** on reference numbers.

## 2. Proposed design

One new table, `payment_collections`. Each row is money received against one charge. A charge can have many collections, which covers partial payments.

```text
payments (charge, accrual)  1 ──< payment_collections (cash received)
                                     │ on Verify
                                     ├─> payments.balance_due / net_collected / status
                                     ├─> C1 proposal (cash entry, linked to the charge)
                                     └─> audit_log
```

### Record Payment flow
1. Staff choose **Record Payment** from:
   - Driver Profile (Payments section)
   - Payments page (per charge, plus a toolbar button)
   - The rental card
2. **Form fields:**
   - **Pre-filled:** driver and rental.
   - **Charge:** the open charge, which also sets the purpose (Rent, Deposit, Late Fee, Toll, Damage, Fee).
   - **Payment details:** amount, method, date received, reference number, notes.
   - **Receipt:** uploaded through `FileUploader`. Required for every method except Cash; Cash needs a note.
3. The payment is saved as **Pending Verification**. Balances do not change.
4. A Manager or Owner opens the pending item, views the receipt and chooses one of three actions:
   - **Verify:** one database transaction applies the money to the charge, proposes the C1 entry and writes history.
   - **Reject:** a reason is required. The payment stays in history and the balance is unchanged.
   - **Reverse:** used after verifying, for a bounced check or a mistake. It adds a reversal row, restores the balance and reverses the C1 entry. Nothing is edited or deleted.
5. **Corrections** reverse the payment and record a new one, so the original and the fix both stay visible.

Recording a payment never starts a rental, approves a driver or changes the driver's status. Activation stays only in `activate_rental_tx`.

## 3. Financial rules

- **Only Verified counts.** Pending and Rejected never touch `balance_due`, `net_collected`, revenue or C1.
- **Partial payments:** a charge becomes Paid only when its balance reaches 0. Until then it shows Partially Paid.
- **Overpayment:** amounts above the open balance are refused. A future credit feature would handle extra money; it is not in this phase.
- **Duplicates:**
  - The same method plus the same normalized reference number is refused, except for Cash.
  - Every submission carries a one-time key, so double-clicking can't save twice.
  - The form warns when the same driver, amount and date already exist.
- **No double counting:**
  - A charge that Stripe has already collected can't take a manual payment for the same balance.
  - Revenue stays `net_collected`, as today.
- **No accidental card charges:** manual payments use no Stripe code at all.
- **Deposits:**
  - A deposit payment raises "deposit held" and is tagged as a refundable liability, not revenue.
  - Applying or returning a deposit keeps the existing deduction and C1 deposit rules.
- **Cash vs accrual:** the charge is the accrual side, dated by its due date. A verified payment is the cash side, dated by the date received. This matches C1.
- **Immutable history:**
  - A verified row is never edited or deleted. A database trigger blocks it.
  - Every state change writes to `audit_log` with the person and the time.

## 4. Role permissions (enforced in the database and on the server)

| Action | Owner | Manager | Coordinator | Driver / signed out |
|---|---|---|---|---|
| View payments and receipts | Yes | Yes | Yes (no Owner-only finance data) | No |
| Record Payment (Pending) | Yes | Yes | Yes | No |
| Verify / Reject | Yes | Yes | No | No |
| Reverse a verified payment | Yes | Yes, reason required | No | No |
| Verify own recorded payment | Yes | No (another person must verify) | — | — |
| Edit or delete a charge from the browser | Removed | Removed | Removed | No |

Should a Manager be able to verify their own entries? The table above says no. That is my recommendation, but it's your call.

## 5. Scale (1,000+ drivers and vehicles)

- **Indexes:**
  - `payment_collections (payment_id, status)`
  - `(driver_id, received_on)`
  - `(status, created_at)`, for the review queue
  - a unique index on `(method, reference_norm)`
- **Pending Verification queue:** loads in pages from the server, not all at once.
- **Balances:** recalculated inside the verify transaction, not in the browser.

## 6. Migration requirements (one migration, applied only with your approval)

1. Create a fixed method list: Cash App, Venmo, Zelle, Cash, Bank Transfer, Check, Money Order, Other.
2. Create `payment_collections`, with these columns:
   - links: `payment_id`, `rental_id`, `driver_id`
   - payment details: `method`, `amount` (must be above 0), `received_on`, `reference_raw` / `reference_norm`, `receipt_document_id`, `notes`
   - status: `status` (pending / verified / rejected / reversed), `recorded_by`, `verified_by`, `verified_at`, `rejection_reason`
   - corrections: `reverses_id`, `ledger_txn_id`
   - safety: `idempotency_key` (unique)
3. Set access: staff can read; nobody can write directly from the browser.
4. Add server-side database functions, each running as one transaction:
   - `collection_record`
   - `collection_verify`, which re-checks the role, refuses self-verification by Managers, locks the charge row, re-checks the open balance, then applies the money and proposes C1
   - `collection_reject`
   - `collection_reverse`
5. Add a trigger that blocks edits to verified, rejected or reversed rows.
6. Allow `payment_receipt` as a document category.
7. Remove browser UPDATE/DELETE on `payments` for staff. All charge changes go through the server, and Stripe and webhook paths keep working through the service role.

The existing eight drivers, Test A/B and all real records are unaffected. There are 0 payments today.

## 7. Testing strategy

All tests use temporary records and are rolled back or cleaned up, with record counts compared before and after.
- **Database tests:**
  - record, verify, reject and reverse
  - partial payments up to Paid
  - overpayment refused, duplicate reference refused, double submission ignored
  - Pending doesn't change the balance
  - deposit payments are not counted as revenue
  - Stripe-paid charge blocked from manual payment
  - the C1 entry is proposed and not posted
  - a verified row can't be edited
  - no rental activation or driver status change
- **Role tests:**
  - Owner and Manager can verify
  - Manager self-verify is refused
  - Coordinator can record but not verify
  - Driver and signed-out users get nothing
  - Coordinator remains limited until a Coordinator account exists
- **Regression tests:** Stripe charge and refund, autopay, deposits, C1 ledger tests, payment status cells, Phase B active guard.
- **Browser checks on desktop and mobile:** Record Payment from all three places, receipt upload and view, the review queue, and that balances update only after Verify.
- **Communications:** no email or SMS is sent.

## 8. Release dependencies

- Kept separate from the Application Resume hotfix, Identity Review, sign-in, the sticky header, Driver Deletion, Waitlist and the date format change. Phase C touches none of their files.
- Builds on C1, which is already in the database. Does not start Step C2.
- The migration is additive, except for removing browser write access to charges. Once applied, it is live for the published site too, because the database is shared. I'd apply it only together with the server and screen changes that replace those browser writes, so payment editing keeps working.

## Technical details

- **New files:**
  - `src/lib/manual-payments.functions.ts` / `.server.ts`
  - `src/components/admin/RecordPaymentDialog.tsx`
  - `src/components/admin/PaymentReviewQueue.tsx`
- **Edited files:**
  - `PaymentsPanel.tsx`: server-only edits plus the Record Payment button
  - `DriversPanel.tsx`: Payments section and rental card
  - `payment-collection.server.ts`
  - `driver-payment-status.ts`: adds the Partially Paid and Pending Verification cells
  - `documents.functions.ts`: adds the `payment_receipt` category
- **Ledger hook:** verify calls `fin_propose` for a cash receipt linked to `payment_id`, with an idempotency key of `collection:<id>`. Reverse calls `fin_reverse` when the entry was already posted, or discards the proposal.
- **Test scripts:** `scripts/manual-payments.test.sql` (rolled back) and `scripts/manual-payments.test.ts`.

## Decisions needed from you

1. Can a Manager verify a payment they recorded themselves? The plan says no.
2. Should a receipt be required for every method except Cash? The plan says yes.
3. Should overpayments be refused for now, with credits handled later? The plan says refuse.
