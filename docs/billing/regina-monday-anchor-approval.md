# Billing day change: Saturday → permanent Monday — owner approval packet

Prepared 2026-10-23 by Claude Code. **Nothing has been executed.** This is the
exact change, its prerequisites and its failure modes, for the owner to approve
or reject.

## What was asked

Renter B (Regina): a $350 weekly subscription currently renewing **Saturday**.
Wanted: permanent **Monday** billing from **Oct 26 2026**, then Nov 2 and every
following Monday.

## Status: BLOCKED on read access, not on analysis

Two separate blocks:

1. **No Stripe credential exists in this container, and none is being asked
   for.** The only payment value present is `VITE_PAYMENTS_CLIENT_TOKEN` in
   `.env.development` / `.env.production`, a browser publishable token; there is
   no secret or restricted key in the environment or in any tracked file. A live
   secret key must not be put in this repository, this chat, logs or local
   source — so verification is done **by the owner in the Stripe Dashboard**,
   read-only, with the steps in "How to verify" below. Every
   subscription-specific number here is **unverified** until those steps are
   run.
2. **The in-app billing-day change cannot touch live Stripe.** It is in the
   baseline but refuses live by construction — see "Why the in-app path will
   not do this" below. Flipping flags does not change that.

## Timing

Her renewal is **tomorrow, Sat Oct 24**. The change only works if it is applied
**before** that renewal invoice exists. Applied after, it double-bills: she pays
Saturday and again Monday. `runApplyBillingDay` refuses in that case
(`RENEWAL_INVOICE_EXISTS`), but a change made by hand in the Stripe Dashboard
has no such guard.

## The change

Set `trial_end` on her subscription to the **next Monday at the same Eastern
time**, with proration suppressed:

```
POST /v1/subscriptions/{subscription_id}
  trial_end           = 1793029260      # Mon 2026-10-26 11:41 ET (15:41 UTC)
  proration_behavior  = none
```

`1793029260` assumes her current anchor is **Sat 2026-10-24 11:41:00 ET**, which
is the value hardcoded as a test fixture in `saturdayBillingAnchorUnix()`
(`src/lib/billing-controls.ts:174`). **That is a source fixture, not a verified
reading of her subscription.** Re-derive `trial_end` from the subscription's
real `current_period_end` before applying: next Monday, same hour, minute and
second, Eastern Time.

### Resulting schedule

| | Date (ET) | Amount |
|---|---|---|
| trial ends / first Monday renewal | Mon 2026-10-26 11:41 | $350 |
| | Mon 2026-11-02 10:41 | $350 |
| | Mon 2026-11-09 10:41 | $350 |
| | Mon 2026-11-16 10:41 | $350 |

The hour moves 11:41 → 10:41 ET on Nov 2 because Stripe recurs on exact
7×24-hour intervals and Nov 1 2026 ends daylight time. **The weekday does not
drift** — every renewal above is a Monday. Computed, not assumed.

### What it costs her

The Saturday Oct 24 invoice is **not** created, so Oct 24–26 is **2 unbilled
days**. With `proration_behavior = none` she is not charged for them and not
credited. That is a $100 (2/7 × $350) revenue concession in exchange for the
billing day she asked for. If that is not intended, say so — the alternative is
to let Saturday bill normally and move the anchor the following week, which
delays Monday billing to Nov 2.

## The risk Grok's mocked tests could not catch

Stripe has two trial mechanisms, and they do not behave the same way:

- **Legacy `trial_end`** — the billing cycle anchor moves to the trial end date.
  Permanent Monday billing. This is what the proposal assumes.
- **Trial offers** (`trial_settings.end_behavior.billing_cycle_anchor`) — if that
  field is `unchanged`, the anchor stays on **Saturday**. Stripe bills a
  proration for the gap and the subscription returns to Saturday renewals. The
  change would appear to work for one cycle and then silently revert.

**Before applying, read `trial_settings.end_behavior.billing_cycle_anchor` on
her subscription.** It must be `now`, or absent (legacy semantics). If it is
`unchanged`, this change does not deliver what was asked and the anchor must be
moved a different way. A mocked `subscriptions.update` cannot distinguish these
two cases, which is why passing tests are not evidence here.

## How to verify — read-only Stripe Dashboard steps

No key, no API call, nothing written. Stay in **Live mode** throughout: the
mode switch is in the Dashboard header, and Test/Sandbox data will not answer
these questions.

### Step 1 — open the subscription

1. Sign in at `dashboard.stripe.com` and confirm the header does **not** say
   Test mode or Sandbox.
2. **Billing → Subscriptions**, search for Regina by name, email or phone.
   (Or **Customers → ** her record → the **Subscriptions** section.)
3. Open the active **$350 / week** subscription.
4. Write down, from this page: the subscription id (`sub_…`), the **status**, and
   the **Next invoice** date *and time*.

### Step 2 — the trial setting that decides whether this works

This is the one that matters, and the subscription page has no labeled field for
it. Use the Inspector:

1. On the subscription page, click the **Inspector** icon — or open
   **Workbench → Inspector** and paste the `sub_…` id.
2. The **Overview** tab shows the object's raw JSON, read-only.
3. Find `trial_settings` → `end_behavior` → `billing_cycle_anchor` and read it:

   | Value | What it means |
   |---|---|
   | `now` | The anchor **moves to Monday permanently.** Proceed. |
   | absent / no `trial_settings` | Legacy `trial_end` semantics — anchor moves to Monday. Proceed. |
   | `unchanged` | **Stop.** The anchor stays on **Saturday**; Stripe bills a proration for the gap and she reverts to Saturday after one cycle. This change would not do what you asked, and must be reworked before it is applied. |

   If Workbench is not visible, enable it from the Dashboard's Developer
   settings / Beta features.
4. While in the JSON, also read `current_period_end` (a Unix timestamp) and
   confirm it is the Saturday shown on the page — this is the value the real
   `trial_end` must be derived from, rather than the `11:41 ET` fixture above.
5. In the same JSON, check `items.data` holds exactly **one** weekly $350 item,
   and that its `current_period_end` equals the subscription's. If they differ,
   stop: `subscriptionAnchorUnix` returns `null` for that shape, which is the
   signal this subscription is not built the way this change assumes.

### Step 3 — has the Saturday renewal already been created?

1. **Billing → Invoices**, filter by her customer.
2. Look for any invoice — **draft, open, or paid** — whose billing period starts
   on **Sat Oct 24**. The subscription page's **Next invoice** line says the same
   thing from the other direction.
3. If such an invoice exists, the Monday move is **off the table for this week**:
   applying it now double-bills her. Say so and the plan shifts to Nov 2.
4. Also confirm no invoice already covers a period starting **Mon Oct 26**.

### Step 4 — can she actually pay on Monday?

On the subscription (or the customer's **Payment methods**), confirm a default
payment method is attached and not expired. Otherwise the Monday renewal simply
fails.

### What to send back

The `sub_…` id, `status`, `current_period_end`, the
`trial_settings.end_behavior.billing_cycle_anchor` value, and whether a
Saturday-period invoice exists. That is enough to finalise `trial_end` and
confirm the schedule — and nothing in that list is a credential.

## Why the in-app path will not do this

`src/lib/billing-controls.server.ts` has the logic and it is correct, but it is
walled off from live Stripe three ways:

- `assertBillingStripeMode(environment)` throws `LIVE_STRIPE_REFUSED` unless
  `environment === "sandbox"` (`billing-controls.ts:73`).
- `runApplyBillingDay` *then* re-checks `if (input.environment === "live") throw`
  (`billing-controls.server.ts:281`).
- Both `BILLING_DAY_CHANGE_ENABLED` and `BILLING_DAY_APPLY_ENABLED` are hard
  `false` constants with no environment variable, and apply additionally needs
  `proposed/billing-controls-v1.sql` installed for the operation journal.

So this change, if approved, is a **direct Stripe action** (Dashboard or API),
not an in-app one. Using the app for it would need: the SQL migration, two flag
flips, and removal of the live refusal — four changes, each needing approval,
none of which can be done before tomorrow's renewal.

## Renter A (Adam) — card ending 8542

Reported: a new Visa debit ending 8542, an owner-approved collection pause, and
a one-time $350 invoice charge scheduled Oct 23 12:15 AM ET.

**Unverified — and deliberately not acted on.** I cannot see whether that charge
already succeeded, is still scheduled, or failed. The instruction was explicit:
do not create a second charge and do not retry an existing payment
automatically. So nothing was sent, retried, or scheduled.

To check it in the Dashboard, read-only: **Payments**, filter to his customer,
and look for a $350 charge dated **Oct 23**. Its state answers it —
`Succeeded` means done, `Failed` means a retry decision is yours to make, and
nothing listed means the scheduled charge has not run. Then **Billing →
Subscriptions →** his subscription: if collection is paused, the page says so
(`pause_collection` in the Inspector JSON gives the exact `behavior` and
`resumes_at`). Confirm the Visa debit ending **8542** is the default payment
method before anything is resumed.

## Decision needed

- [ ] Approve the `trial_end` change for Regina, **after** the five pre-flight
      reads pass, accepting the 2 unbilled days — or reject it.
- [ ] Run the four Dashboard steps above and send back the five values. No key
      leaves the Dashboard.

Until both are answered nothing here will be executed. Silence is not approval.
