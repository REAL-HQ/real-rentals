# RC3 and RC4 release

Morning release of RC3, then RC4, onto the live branch. Publish once, after Lovable has the RC4 merge. This runbook does not include RC5.

Live RC2, and the republish target, is `7e3e6eb61a65aac641a000aa2335a3f3169158f7`.

| Release | PR | Branch | Pin |
| --- | --- | --- | --- |
| RC3 | #81 | `release/rc3-ops-visibility` | `e2d63191bef68c74304297a7a0a7b9c36523cb5d` |
| RC4 | #85 | `release/rc4-collections` | `a53f837f02a760899d33a089fc978bf6eae942df` |

Do not merge or publish `release/rc5-ops-finance`. Do not merge #91. Do not merge a Shared Stripe Reader pull request in this release.

## Order

1. Confirm `release/rc3-ops-visibility` is exactly `e2d63191bef68c74304297a7a0a7b9c36523cb5d`. If it is not, stop.
2. Mark #81 ready for review. Do not push to that branch.
3. Merge #81 into `codex/revenue-publication` with a merge commit. Do not squash. The merge commit's second parent must be `e2d63191bef68c74304297a7a0a7b9c36523cb5d`.
4. Confirm `release/rc4-collections` is exactly `a53f837f02a760899d33a089fc978bf6eae942df`. If it is not, stop. Do not merge RC4 onto any other RC3.
5. Mark #85 ready for review. Do not push to that branch.
6. Merge #85 into `codex/revenue-publication` with a merge commit. Do not squash. The merge commit's second parent must be `a53f837f02a760899d33a089fc978bf6eae942df`.
7. The final SHA is that RC4 merge commit. Confirm Lovable has synced that SHA. It must not still be on `7e3e6eb61a65aac641a000aa2335a3f3169158f7`, on the RC3 merge, or on `a53f837f02a760899d33a089fc978bf6eae942df` alone.
8. Publish the synced SHA.
9. Run the public smoke script and the checklist below against the published site.

`supabase/migrations` does not change in either pull request. Do not apply anything under `proposed/`.

## Smoke checklist

### Owner and manager

- Open Driver Issues. The roadside row is pinned, with a red Roadside badge and an age timer.
- Open Active Rentals. With no recorded rentals the board is empty.
- Open Payments, then Stripe Match. The panel says Stripe Match Is Off. Unified Finance is not on the rail. Vehicle Profit is not on the rail.
- Open a booking and start End Rental. The dialog is still the return date, mileage, and vehicle status, with no checklist.
- Open Drivers and choose Documents Expiring. With no active rentals, the list is on Approved Drivers and shows Driver License, Insurance, Rideshare Platform, and Days Left. A missing date reads Unknown. No document-expiring email or SMS is sent. The Overview chip is present.
- Open Drivers and choose Approved, Not Yet Renting. Approved people with no active rental are listed, longest wait first, and a missing approval date reads Unknown. Mark Contacted on one row sets the contact status to Contacted and does not send email or SMS.
- Open Payments, then Collections Watch. The panel says Collections Watch Is Off. It is not on the rail. The screen does not retry a charge or send a notice.
- Open Payments, then Deposits & Refunds. The panel says Deposits & Refunds Ledger Is Off. It is not on the rail. The screen does not settle a deposit or issue a refund.
- Open Vehicles. Maintenance Due is absent.
- Open a driver and the Payments tab. The panel says Driver Statement Is Off. It does not charge or refund.

### Coordinator

- Active Rentals is absent.
- The Documents Expiring chip is absent, and Approved, Not Yet Renting is absent.
- Collections Watch, Deposits & Refunds, and Stripe Match are absent.
- Maintenance Due is absent.
- Driver Statement is absent.

### Driver portal

- Need Roadside Help shows the company phone. Submit a Flat report with a location and Not Drivable. It is that driver's issue, and no email or SMS is sent.
- An approved driver who is not renting does not see Your Next Steps.
- An applicant does not see the Application Status Timeline. An approved driver does not see it either.

### Public

- Open `/apply` with no token. Step 1 is the contact form.
- Open `/apply?t=x`. It lands on `/thank-you?t=x`, then the recovery screen that says Get A New Secure Link. On `/thank-you` the address bar no longer shows `t`.
- Open `/thank-you` with no token. It says Get A Secure Link To Your Application and asks for an email. That screen does not say the link expired.
- Run the no-login script. It opens a headless browser, waits for the client route to settle, and reads the page. It does not submit a form or send its own POST:

```
BASE_URL=https://drivereal.com bun scripts/smoke-public.ts
```

The line marked `[after RC4]` stays red until this publish. On the current RC2 site, `/apply?t=x` fails as well. Install the script's browser library once with `npm install --prefix scripts`, and have Chrome available or set `CHROME_PATH`. The library stays under `scripts/` and is not an application dependency.

## What must stay hidden or off

| Flag | Default |
| --- | --- |
| `DRIVER_ISSUE_ALERTS_ENABLED` | Off unless the environment value is exactly `true` |
| `ROADSIDE_SMS_ALERTS_ENABLED` | Off unless the environment value is exactly `true` |
| `STRIPE_MATCH_REPORT_ENABLED` | Off unless the environment value is exactly `true` |
| `UNIFIED_FINANCE_ENDPOINT_ENABLED` | `false`. The finance panel and its Stripe reader stay out of the client bundle. |
| `RETURN_CHECKLIST_ENABLED` | `false` |
| `STRIPE_RECONCILIATION_ENABLED` | Off unless the environment value is exactly `true` |
| `DOCUMENT_EXPIRY_NOTICES_ENABLED` | Off unless the environment value is exactly `true`. Unknown dates are not enrolled. |
| `VEHICLE_PROFITABILITY_ENABLED` | `false` |
| `COLLECTIONS_WATCH_ENABLED` | Off unless the environment value is exactly `true` |
| `DEPOSITS_LEDGER_ENABLED` | Off unless the environment value is exactly `true` |
| `NEXT_STEPS_CARD_ENABLED` | `false` |
| `MAINTENANCE_DUE_ENABLED` | `false` |
| `APPLICATION_TIMELINE_ENABLED` | `false` |
| `DRIVER_STATEMENT_ENABLED` | Off unless the environment value is exactly `true` |
| `STRIPE_COLLECTIONS_ENABLED` | `true`, unchanged from RC2. Leave it on. |

These files are in the tree and must not be applied:

- `proposed/return-checklist-v1.sql`
- `proposed/jv-splits-v1.sql`
- `proposed/maintenance-due-v1.sql`

Stripe Match, Collections Watch, and Deposits & Refunds may show their off panels under Payments for an owner or manager. They are not rail entries, and a coordinator does not see them. Unified Finance, Vehicle Profit, Maintenance Due, Your Next Steps, and the Application Status Timeline stay hidden.

## Rollback

1. Revert the RC4 merge. That returns `codex/revenue-publication` to the RC3 merge.
2. Revert the RC3 merge. That returns the branch to `7e3e6eb61a65aac641a000aa2335a3f3169158f7`.
3. Confirm Lovable has synced `7e3e6eb61a65aac641a000aa2335a3f3169158f7`, then republish that SHA.
