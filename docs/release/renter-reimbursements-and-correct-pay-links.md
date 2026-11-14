# Renter Reimbursements And Correct Pay Links: Release Plan

Branch `feat/renter-reimbursements-correct-pay-links`. Nothing here is applied, enabled or sent by merging the code alone, except the failed-payment email's link fix (step 1 below).

## What Changes

| Piece | Effect On Deploy | Switch |
| --- | --- | --- |
| Expenses → Renter Reimbursements view | Shows an error/empty list until the migration is applied | None (Manager-only) |
| `renter_reimbursements` table | Not created until the migration is applied | n/a |
| Failed-payment email | Main button becomes the failed invoice's own Stripe page (`invoice.stripe.com`) when Stripe provides it; falls back to today's email otherwise | Existing `payment_failed` switch (On today) |
| Payment Failed Text (SMS) | Nothing until turned on | `payment_failed_text`, **Off by default** |
| Subscription Matching + duplicate alert | Nothing until turned on | `stripe_subscription_link`, **Off by default** |

No change creates, edits or cancels anything in Stripe. A generic Payment Link (`buy.stripe.com`) is never sent by the app.

## Migration

- File: `supabase/migrations/20261109190000_renter_reimbursements.sql`
- SHA256: see the PR description (recompute with `sha256sum` before applying; it must match).
- Creates `public.renter_reimbursements`, RLS `private.is_manager()`, grants to `authenticated`/`service_role`, nothing to `anon`, a touch trigger. No notifications, no triggers that send.
- Re-runnable (`IF NOT EXISTS` / `DROP ... IF EXISTS`). Verified on a scratch Postgres: applies twice cleanly.
- Rollback (only while the table is empty or after exporting it): `DROP TABLE public.renter_reimbursements; DROP FUNCTION public.touch_renter_reimbursement();`

## Release Steps (Each Needs Dolmar's Approval)

1. Merge and publish the code. Check: the Expenses page loads; Back Office → Automations shows Payment Failed Text and Subscription Matching as Off.
2. Apply the migration. Check: `select count(*) from public.renter_reimbursements` returns 0; the Renter Reimbursements view loads empty.
3. Run `proposed/renter-reimbursements-catalog-2026-11-09.sql`. Expect `INSERT 0 3`, `DELETE 3`, three rows totalling $150.00, and Damon's $35 Uber expense (`df388dd5…`) still in `vehicle_expenses`. Re-running does nothing.
4. Link the three active rentals to their live subscriptions: `proposed/stripe-subscription-links-2026-11-09.sql` (or turn on Subscription Matching and let the next invoice link them). After this the webhook records their weekly rent and sends the existing receipt/failed emails for them.
5. Stripe webhook endpoint `we_1TwE5mGsNNO50lXb8MDauwW3` (`…/api/public/payments/webhook?env=live`): add `invoice.paid` and `invoice.payment_succeeded` (keep `invoice.payment_failed`, `customer.subscription.updated/deleted`). Without `invoice.paid`, paid weeks never reach the board.
6. Turn on Subscription Matching (Automations). Duplicate subscriptions then raise one in-app notification and one team@ email each.
7. Optional: set `PAYMENT_FAILED_SMS_FROM=PNcX8a0PLJ` to send from the 813 line (default is the 888 line, `PNrZULvFMn`). Must be on the Quo allowlist.
8. Turn on Payment Failed Text (Automations). Texts go 8 AM to 9 PM ET only, once per Stripe attempt, skip anyone who replied STOP, and only ever contain the invoice's own page.
9. Deactivate the generic Stripe Payment Link `plink_1UP3DaGsNNO50lXbPp1KXJ73` (or limit it to brand-new renters with no subscription), so an old text can no longer start a second subscription.
