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

1. **No Stripe credential exists in this container.** The only payment value
   present is `VITE_PAYMENTS_CLIENT_TOKEN` in `.env.development` /
   `.env.production`, a browser publishable token; there is no secret or
   restricted key in the environment or in any tracked file. So the instruction
   to "verify the actual current state through authorized read-only Stripe
   access" could not be carried out here. Every subscription-specific number
   below is therefore **unverified** and marked as such.
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

## Pre-flight reads required (read-only, need a Stripe key)

1. The subscription's `status`, `current_period_end`, `billing_cycle_anchor`.
2. `trial_settings.end_behavior.billing_cycle_anchor` (see above).
3. That **no** invoice already exists whose period starts at the new
   `trial_end`, and no Saturday renewal invoice has been created yet.
4. `items` — confirm exactly one weekly $350 item, and that item-level
   `current_period_end` agrees with the subscription's. `subscriptionAnchorUnix`
   (`src/lib/billing-controls.ts:327`) returns `null` when they disagree, which
   is the signal that this subscription is not shaped the way this change
   assumes.
5. A default payment method is attached and not expired, or the Monday renewal
   fails.

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

**Unverified — and deliberately not acted on.** With no Stripe read access I
cannot see whether that charge already succeeded, is still scheduled, or failed.
The instruction was explicit: do not create a second charge and do not retry an
existing payment automatically. So nothing was sent, retried, or scheduled.
Verifying this needs the same read-only Stripe key as above.

## Decision needed

- [ ] Approve the `trial_end` change for Regina, **after** the five pre-flight
      reads pass, accepting the 2 unbilled days — or reject it.
- [ ] Provide read-only Stripe access (a restricted key with read scopes) so the
      pre-flight reads and Adam's charge state can actually be checked.

Until both are answered nothing here will be executed. Silence is not approval.
