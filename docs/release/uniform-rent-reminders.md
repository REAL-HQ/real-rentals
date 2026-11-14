# Uniform Rent Reminders

One reminder schedule for every active rental, autopay (Stripe) and manual
payers alike. **Everything ships OFF.** Nothing sends until an Owner turns a
stage on in Settings → Automations.

## Schedule (all times ET)

| Stage | When | Autopay (Stripe) | Manual payer |
|---|---|---|---|
| Due Tomorrow | Day before due, from 10 AM | "Your card on file will be charged $X tomorrow" + own card-update link when one can be made | Amount, due date, payment instructions |
| Due Today | Due day from 8 AM, only if unpaid | Not sent (card is charged that day) | Amount + payment instructions |
| Overdue | Stripe charge failed, or manual payer still unpaid at 6 PM on the due day | Own failed-invoice link only + $50/day late fee | Late fee + payment instructions |
| Daily Past Due | Every day after, from 10 AM, until paid | Running balance incl. late fees + own invoice link | Running balance + instructions |

- Texts only 8 AM–9 PM ET (email can go any hour). STOP always wins (sendSms).
  Billing notices do not need marketing consent (same as Payment Failed Text).
- Idempotent: `rent_reminder_log` UNIQUE (rental, due date, stage, channel).
  The claim is written before sending, so overlapping runs or a Stripe replay
  never send twice. A missed day sends only the latest stage owed.
- Stripe is the truth for Stripe renters (the rental's own dates can be stale):
  owing = an open invoice Stripe already tried to charge; due date = the ET date
  that invoice was created; otherwise the next charge = subscription period end.
- Stripe renters only ever get their own hosted invoice page or a Stripe
  billing-portal card-update page. Templates that mention Cash App, Venmo,
  Zelle, PayPal, Apple Pay, buy.stripe.com, $cashtags or
  `{{payment_instructions}}` cannot be saved for Stripe renters. No safe link →
  no message.

## Late fees

$50 per day from the day after the due date, computed (never charged by Stripe
automatically). Shown on Active Rentals (Late Fee column) and in Overdue/Daily
notices. Staff can **Waive Late Fee** (whole week or through today) with a
reason; who and when are recorded and audited.

## Manual payers

Active Rentals → ⋮ → **Record Payment** (amount, Cash App/Venmo/Zelle/Cash/
Other, reference, date). Refused for Stripe renters. When the week is covered,
`next_payment_due` moves forward 7 days, which stops that week's reminders.

## One schedule with Payment Failed Text

The Stripe webhook's failed-payment text and email claim the same ledger slot
(Overdue, then one Daily per day). With Rent Reminder: Overdue on, they use the
editable Overdue template (with the late fee). Before the migration is applied
they behave exactly as today.

When any Rent Reminder stage is on, the older `payment_past_due` and
`payment_due_tomorrow` emails in ops-reminders stand down (they link the
generic portal pay page). The team alert and Collections Plan are unchanged.

## Ship order (each step needs Dolmar's approval)

1. Apply `supabase/migrations/20261109210000_rent_reminders.sql`.
2. Merge + publish.
3. Optional: `proposed/regina-late-fee-waiver-2026-11-09.sql`.
4. Optional: `proposed/stripe-paid-weeks-backfill-2026-11-09.sql`.
5. Edit templates (set "How Manual Payers Pay").
6. `proposed/rent-reminders-cron-v1.sql` (hourly at :05).
7. Turn on stages one at a time.

Rollback: turn the stages off (instant). The cron can be unscheduled with
`select cron.unschedule('rent-reminders-hourly')`.
