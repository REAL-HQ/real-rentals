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
