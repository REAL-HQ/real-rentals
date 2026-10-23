# Regina — billing day change: reported complete, independently unverified

Updated 2026-10-23 by Claude Code.

## Status

**Grok reports the live change was made.** Per your instruction I did **not**
modify the subscription, did not retry anything, and did not request credentials.

Reported outcome:

| | |
|---|---|
| Sat Oct 24 | no charge |
| Mon Oct 26 | first $350, ~11:41 AM ET |
| Every Monday after | $350 weekly |
| Proration | none |
| Invoice created | $0 |
| Customer notified | no |

## Verification: not possible from here

No Stripe credential exists in this container — only
`VITE_PAYMENTS_CLIENT_TOKEN`, a browser publishable token. There is no secret or
restricted key in the environment or any tracked file, and I did not ask for
one. So this is marked **reported complete, independently unverified.**

## What I can corroborate without Stripe access

The reported outcome **matches the schedule I computed independently** before
the change was made, which is meaningful corroboration even though it is not
verification:

| | Computed in advance | Grok reports |
|---|---|---|
| First Monday renewal | **Mon 2026-10-26, 11:41 ET** (`trial_end = 1793029260`) | Mon Oct 26, ~11:41 AM ET |
| Saturday Oct 24 | no invoice created — 2 unbilled days | no charge |
| Proration | `proration_behavior = none` | none |
| Subsequent | every Monday | every Monday |

The $0 invoice is the expected artifact of a trial boundary with proration
suppressed. Nothing in the report contradicts the plan.

One detail worth knowing: because Stripe recurs on exact 7×24-hour intervals and
Nov 1 ends daylight time, the Nov 2 renewal lands at **10:41 ET**, not 11:41.
**The weekday does not drift** — every subsequent renewal is a Monday.

## Read-only confirmation, when convenient

Not urgent, and nothing is pending on it. In the Stripe Dashboard, **Live mode**:

1. **Billing → Subscriptions →** her subscription: *Next invoice* should read
   **Mon Oct 26**, status `trialing` until then, then `active`.
2. **Billing → Invoices**, filtered to her customer: a **$0** invoice dated
   Oct 23–24, and **no** $350 invoice with a period starting Sat Oct 24.
3. Inspector JSON (Workbench): `billing_cycle_anchor` should now be the Oct 26
   timestamp — that is what makes Mondays permanent rather than one-off.

Item 3 is the one that confirms the anchor truly moved. If it still points at a
Saturday, the subscription will revert after one cycle and should be raised.

## Open

Nothing. No action is pending on this item and no approval is being requested.
