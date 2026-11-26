# Late Fees ($50/day)

Policy (Dolmar, D33-D36 and t298s1611): $50 for each day rent stays unpaid,
starting the day after the due date. It keeps applying during the 48-hour
grace period (the grace period delays the disable, not the fee). It stops
once the car is returned to the shop. Rent only.

How it runs: the daily sweep (`/api/public/cron/late-fees`, pg_cron
`late-fees-daily` at 6:30 AM ET) adds the day's fee to the unpaid rent row
(`payments.late_fees` and `balance_due`). It computes the total that should be
owed and adds the difference, so a repeat run adds nothing and a missed day
catches up. The setting is `app_settings.late_fee_policy`
(`proposed/late-fees-50-daily-on.sql` turns it on).

Never charged:

- while the renter is in an approved payment deal (an open
  `payment_text_pauses` row, or the older deal pause recorded as
  `rent_reminder_log` outcome `skipped:paused_deal` with "Paused through
  YYYY-MM-DD"). Days inside a deal are not charged later either;
- days staff waived (`rent_late_fee_waivers`: a whole week when
  `waived_through` is empty, otherwise through that date);
- after the car is returned (a return checklist, or the rental is no longer
  Active: counted up to its end date);
- tolls, damage and other charges.

Days are Eastern calendar days. The texts already state "$50/day"
(src/lib/rent-reminders.ts uses the same count).

## Manage Late Fees (forgiving)

Bookings > Active: click the Overdue cell (also Payments > Late Fees, the
driver profile's Payments tab, and a booking's Payments tab). Managers and
Owners only. The dialog lists every late fee, one line per late day, with its
date, amount and status (Unpaid, Paid, Forgiven, No Fee (Payment Deal)).

- Forgive Selected, Forgive An Amount (applied oldest first; part of a fee is
  allowed), or Forgive All. A reason is required; a note is optional (required
  for Other).
- Paid late fees can't be forgiven here.
- Forgiving records a credit per day (`late_fee_forgiveness`), lowers the open
  rent row's `late_fees` and `balance_due` by what had been recorded, and
  writes `late_fee.forgiven` to the audit log (amounts, fee ids, reason, note,
  who). The daily sweep subtracts forgiven dollars from its target, so a
  forgiven fee is never added back. The texts quote fees through the same
  ledger, so a forgiven fee is never quoted.
- Owner can Undo a forgiveness; it puts back exactly what came off the row.
- Nothing is sent to the renter and no Stripe charge is touched.

Before `proposed/late-fee-forgiveness-table.sql` is applied (needs Dolmar's
approval), Forgive All and whole days from the oldest are saved as a staff
waiver (`rent_late_fee_waivers`); part of a fee, a later day on its own, and
Undo say they need the update and change nothing.
