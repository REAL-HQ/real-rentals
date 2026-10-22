# Billing controls plan

Built on `cursor/billing-controls-dark` after merging `integration/grok-baseline-2026-10-22`. The three product flags and the two install gates are hard-false constants. No live Stripe call. No hosted SQL. Apply and extension recording throw before auth until `proposed/billing-controls-v1.sql` is installed.

## What this pass added

- `src/lib/billing-controls-flag.ts` declares `BILLING_PM_UPDATE_LINK_ENABLED`, `BILLING_DAY_CHANGE_ENABLED`, `BILLING_ONE_TIME_EXTENSION_ENABLED`, `BILLING_DAY_APPLY_ENABLED`, and `BILLING_EXTENSION_RECORD_ENABLED`. Each is literal `false`. Handlers throw that flag before `requireSupabaseAuth` and before `requireManager` or `requireOwner`.
- Payment method update creates a Billing Portal session with `flow_data.type = payment_method_update` for the rental's existing customer. Copy Link returns the URL and does not email. Send Link is a separate staff action. A missing portal configuration returns `Portal not configured.` The server does not create a portal configuration. Verify reads the subscription default, the customer invoice default, and the attached methods. An Owner can set an attached method that is not the subscription default, with idempotency key `rr:pm-default:{subscription}:{payment method}`.
- Billing day preview calls `invoices.createPreview` with `subscription_details.trial_end` at the next target weekday and the same Eastern Time clock, and `proration_behavior = none`. The local schedule shows the anchor as a $0 trial invoice, then the weekly amount on the new weekday and one week later. Stripe credits and proration lines are shown when the preview returns them. Apply calls `subscriptions.update` with the same trial end, `proration_behavior = none`, and idempotency key `rr:{operation}:billing-day`. It refuses when an invoice for that renewal instant already exists, and it refuses when Stripe returns a different subscription id. The apply handler throws `BILLING_DAY_APPLY_OFF` before auth because the journal is not installed.
- A payment extension sets `auto_advance = false` on that one invoice. It does not change `trial_end` or `billing_cycle_anchor`, and it does not call `invoice.pay` or `paid_out_of_band`. The durable row is `private.billing_exceptions_v1` through `billing_operation_finish_v1`. `logAudit` is not used. The grant handler throws before auth because `BILLING_EXTENSION_RECORD_ENABLED` is false. Flag-off Stripe Collections returns the same report object and does not query the table. The flag-on shape labels an unpaid extension Outstanding / Extended.
- Staff UI is `BillingControls` on the Payments panel. It renders only when one of the three product flags is true. Apply renders only when `BILLING_DAY_APPLY_ENABLED` is true. Grant renders only when `BILLING_EXTENSION_RECORD_ENABLED` is true.
- Tests use mocked Stripe. `scripts/billing-controls.test.ts` covers the Saturday 11:41 ET to Monday schedule, role gates, flag order, portal configuration, verify, idempotency, the existing-renewal refusal, and the outstanding extension. `scripts/dark-flag-gates.test.ts` calls each handler with no auth header.

## Still required before any flag is turned on

- An owner creates the Customer Portal configuration in the Stripe Dashboard for the sandbox mode. This code will not create it.
- An owner reviews and installs `proposed/billing-controls-v1.sql`. The rollback in that file drops only the new objects. It does not drop `rental_subscription_begin_v1`.
- Apply and extension recording stay disabled until that SQL is installed and the two install gates are changed in source. Preview can run once `BILLING_DAY_CHANGE_ENABLED` is on, because it does not write the journal.
- No live key. The handlers accept only `sandbox`.

The notes below are the original stop record. The owner later asked for this bounded build with apply and the exception write kept off.

## What already exists

- `createReadOnlyStripe` (`src/lib/stripe-reader.server.ts`) exposes `list` and `retrieve` only. Portal sessions, `invoices.createPreview`, and `subscriptions.update` are writes. They cannot go through the reader.
- `coordinateRentalSubscription` (`src/lib/rental-subscription-coordination.server.ts`) calls `rental_subscription_begin_v1` / `rental_subscription_finish_v1`. Those functions are in `proposed/subscription-coordination-v1.sql` and are not installed. `RENTAL_SUBSCRIPTION_COORDINATION_ENABLED` is hard false in `src/lib/record-rental-live-path.ts`. While it is false, autopay still uses `createStripeClient` directly (`src/lib/rental-payments.functions.ts`).
- The proposed journal allows only `action IN ('start','stop')`. Finish writes `rentals.stripe_subscription_id` and `autopay_active`. A billing-day change must keep the same subscription id. An extension must not write a paid state. Neither fits this journal.
- `stripe_claim_creation` / `stripe_finish_creation` / `stripe_cancel_state` (`scripts/stripe-reconciliation/0033_stripe_reconciliation.proposed.sql`) reserve create and cancel only. A failed create tells staff to retry the same operation. An unknown cancel keeps the mapping. There is no update or defer reservation.
- `logAudit` (`src/lib/audit.server.ts`) inserts `audit_log` and swallows its own errors. A failed audit write still returns success. Collections does not read `audit_log`.
- Stripe Collections (`src/lib/stripe-collections.ts`, `STRIPE_COLLECTIONS_ENABLED` is true) aggregates charges, refunds, subscriptions, invoice payments, and payouts. It has no extended-invoice row. An open invoice that never becomes a charge is not an "extended" balance today, and a missing charge is not the same thing as an approved deferral.

## Why this stops

1. New SQL. A recoverable apply needs a pending operation row, a 23-hour idempotency window, and a finish that does not replace the subscription id. That is a new proposed journal (or a widening of `rental_subscription_operations_v1`), plus rollback. It does not belong in `supabase/migrations` until an owner installs it.
2. Provider cutover. Billing Customer Portal sessions require a portal configuration in the Stripe Dashboard. `billingPortal.sessions.create` with `flow_data.type = payment_method_update` fails when that configuration is missing. The app can surface that error; it cannot create the Dashboard configuration from here.
3. One-invoice deferral is not a due-date edit on these subscriptions. Autopay subscriptions are `charge_automatically`. Stripe `due_date` applies to `send_invoice`. Deferring one invoice means stopping that invoice's automatic collection (`auto_advance = false` on that invoice only) and collecting it later, without `trial_end` on the subscription and without `invoice.pay`, `paid_out_of_band`, or a manufactured paid charge. Nothing in the app collects a single invoice on a later date. That collector is the cutover.

## Flags

Each action gets its own hard-false constant, no `process.env`. The handler throws the off message before `requireStaff` / `requireManager` and before any read or Stripe call, matching Billing Health and the Incident Board.

- `BILLING_PM_UPDATE_LINK_ENABLED`
- `BILLING_DAY_CHANGE_ENABLED`
- `BILLING_ONE_TIME_EXTENSION_ENABLED`

Owner and Manager only, checked on the server after the flag. The Payments admin surface is the place (`nav-config` tab `payments`). The screen stays hidden while the flag is false.

## Action 1 — Payment method update link

Staff sends the link. The app does not email it.

1. Flag, then Owner/Manager.
2. Load the rental's existing `stripe_customer_id` and `stripe_subscription_id`. Refuse when either is missing.
3. `billingPortal.sessions.create` on the writer client (`createStripeClient`), not the reader: `customer`, `flow_data: { type: 'payment_method_update' }`, and a return URL on this app. No card number, CVC, or PAN in our request or response.
4. Return the session URL to the staff screen.
5. If Stripe says the portal is not configured, return a fixed sentence: the Billing Portal configuration is missing. Do not fall back to a SetupIntent or a card form.
6. `logAudit` action `billing.payment_method_link_created` with customer id and subscription id. Do not store the URL in the audit metadata if it contains a one-time token; store that a link was created.

Prerequisite before anyone turns the flag on: an owner creates the Customer Portal configuration in the Stripe Dashboard for the same mode the server uses. Tests mock the writer. They never call live Stripe and never create a live portal session.

## Action 2 — Change weekly billing day

Preview first. Apply only after a second confirmation. Same subscription id.

Weekday math (America/New_York). "Next target weekday" is the next calendar date whose weekday is the target, strictly after the subscription's current period end. Saturday to Monday is two gap days when the current period ends Saturday and the next anchor is Monday. The preview shows those gap days as uncovered rent, not as a proration.

Preview call, writer client, no idempotency key that would reserve an invoice:

`POST /v1/invoices/create_preview` with `subscription`, `subscription_details.trial_end` set to that next weekday at the same time of day as the current anchor, and `subscription_details.proration_behavior = none`.

Show the preview lines: date, amount, and whether the line is the next weekly invoice or the gap. The gap is not charged unless staff checks an explicit one-time charge. That charge is a separate invoice item for `gap days × weekly amount / 7`, integer cents, remainder not rounded into a second invoice. Unreadable amounts stay null.

Apply, only after confirmation, through the subscription writer once the new journal exists:

- Begin a `billing_day` operation. Pending row stores actor, session, account, environment, subscription id, target weekday, `trial_end` unix time, and whether the gap charge was chosen.
- `subscriptions.update(subscriptionId, { trial_end, proration_behavior: 'none' }, { idempotencyKey: 'rr:' + operationId + ':billing-day' })`.
- Do not call `subscriptions.create`. If the returned id differs, finish as mismatch and do not write a new id onto the rental.
- Gap charge, only when chosen: one `invoiceItems.create` plus one invoice, idempotency key `rr:` + operationId + `:gap`. A retry uses the same operation id. Do not start a second operation while one is pending.
- Ambiguous provider errors stay pending for staff reconciliation. Do not automatically retry after the provider's idempotency window (the existing journal uses 23 hours).

`proration_behavior: none` plus a future `trial_end` is what keeps the shift from invoicing the gap by itself. The optional gap charge is the only extra invoice, and only when staff confirmed it.

## Action 3 — One-time payment extension

Does not change the weekly cycle. Does not mark anything paid.

Durable record, not only `audit_log`: actor, reason (required text), original due date, new date, invoice id, subscription id, rental id. `logAudit` action `billing.extension_granted` is a copy of that record. Collections must be able to read the durable row even when the audit insert is swallowed.

Provider effect, one invoice:

- Retrieve the invoice. Refuse unless it belongs to this subscription and customer, is open, and is not paid.
- Set `auto_advance = false` on that invoice only, with idempotency key `rr:` + operationId + `:extend`.
- Do not call `invoice.pay`, do not set `paid_out_of_band`, do not void, do not mark uncollectible, and do not change `trial_end` or `billing_cycle_anchor`.

Collections change, behind the same flag so flag-off reporting stays the current report: an extended open invoice is an outstanding row (invoice id, original date, new date, amount still due). It is not a successful charge, not a failed charge, and not omitted. When the invoice later pays, it becomes a normal collection and the extension row says it was collected. Until a collector exists, staff collect that invoice manually in Stripe on the new date. This plan does not add that collector.

## Tests to write when this is built

Mock the Stripe writer. No live keys.

- Flag off throws before the role check and before a Stripe call, for each flag.
- A coordinator is refused. Owner and Manager pass the role check.
- Saturday period end to Monday anchor reports 2 gap days and does not add a charge unless the one-time option is set.
- Repeating apply with the same operation id sends one `subscriptions.update` idempotency key and does not create a subscription.
- Extension does not set a paid status and does not call `invoice.pay`.
- Collections with an extended open invoice still shows that amount outstanding.

Then the usual gates: `tsc`, `npm test`, dummy-env 4GB build with no `supabase.co` outside `.output/server/_libs`, `node scripts/ci/record-rental/guard.mjs --rc`, workerd `GET /` and `GET /admin`.

## SQL shape, when an owner asks for it

Put it in `proposed/`, with a rollback that drops only the new objects. Do not add a file under `supabase/migrations`. Do not run it on a hosted database from this work.

- New action values `billing_day` and `extend_invoice`, or a separate table so start/stop stays unchanged.
- Pending unique on rental id, same 23-hour reconciliation rule.
- Finish for `billing_day` checks the subscription id is unchanged.
- Finish for `extend_invoice` inserts the exception row and does not update `autopay_active` or `stripe_subscription_id`.
- Rollback drops the new action check, the exception table, and any new functions. It does not drop `rental_subscription_begin_v1`.

## Out of scope

Live subscriptions, live portal sessions, publishing, merging to `codex/revenue-publication` or `main`, and turning any of the three flags on.
