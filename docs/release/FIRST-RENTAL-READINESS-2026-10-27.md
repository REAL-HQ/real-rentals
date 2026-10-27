# First rental: consolidated launch readiness (2026-10-27)

| | |
|---|---|
| Live | `5e492a87`: A.2 + PR 2, deployment `4ad9e141` |
| Database | Activation setting and insurance authority installed. Insurance exception **OFF**. |
| This review | Read-only against production. One new review branch. No charges, subscriptions, refunds, publishes, SQL or Stripe changes. |

## Verdict

**Not yet GO for the first rental.**

Three things remain, all small:
1. Publish the billing-safety branch (one app-only release).
2. The Owner confirms the Stripe live configuration.
3. The Owner accepts manual weekly billing for launch.

After that the first rental can be accepted, attended, using the checklist in `MVP-LAUNCH-GO-NO-GO-2026-10-26.md` §3.

## PR 2: DEPLOYED and installation-verified (no further work)

| Item | Value |
|---|---|
| App | `5e492a87`, deployment `4ad9e141`, live SHA confirmed by the Owner |
| Activation-setting SQL | Request `b80babcc275bea4682bc9b69ba3ce11d5f2833ced848c9682b00979311765505`, txid 107299, verify-after 15/15 |
| Insurance-authority SQL | Request `eb7710d7fc3ff58adc0c1d0424245b205dda98f9f319ad29f24adf5363e68950`, txid 107840, verify-after 8/8 |
| Rollback refs | IVA `69d5dcef91d46b2529f70d2783a68289095d998f55937d252f1ae116b729d082`, then app `rollback/pr2-to-a2` = `8ea838c2` (tree identical to A.2), then AIS `57498a8277f66d23ca6b2a18800bed243295cb9a6979c8063e75945dbc384893`. Each needs approval. |
| Pending operational acceptance (natural use only) | First real insurance Verify gives one `insurance.verified` audit row. First real activation gives `rental.activated` with `checked_in_transaction: true`. |

## Payment and rental-lifecycle findings

### Confirmed defects (live code `5e492a87`)

| # | Defect | Evidence | Status |
|---|---|---|---|
| D1 | **Weekly autopay start is rejected by Stripe.** `startRentalAutopay` sends `items[].price_data.product_data`. | Stripe's official OpenAPI spec (`2026-09-30.endive`): `POST /v1/subscriptions` `items[].price_data` **requires `product`** (an existing Product id) and has **no `product_data`**. Only `POST /v1/prices` and Checkout accept `product_data`. SDK 22.0.2 types agree; the code needs an `as any` cast to compile. The dormant coordination path has the same request shape. | **Excluded from launch.** Start is switched off (branch below). |
| D2 | **Duplicate subscriptions possible.** Check-then-create on `rentals.stripe_subscription_id`, no lock, no idempotency key on `subscriptions.create` or `customers.update`. | Code `rental-payments.functions.ts:223-266` | Excluded: start is off |
| D3 | **Autopay could start on a closed rental.** The button loads the latest rental of any status; the server has no status check. | Code `DriversPanel.tsx` `AutopayActions`; `startRentalAutopay` | **Fixed on branch** |
| D4 | **Stop Autopay hides failures.** It swallows any cancel error, then clears the subscription id. Stripe can keep billing while the app shows autopay off. | Code `rental-payments.functions.ts:288-294` | **Fixed on branch** |
| D5 | **End Rental does not cancel the subscription.** `end_rental_tx` only clears `autopay_active`; the id remains and Stripe keeps billing. The webhook then records rent on a closed rental. | Code `rentals.functions.ts` `endRental`; `end_rental_tx` | **Fixed on branch** (refuses until autopay is stopped) |
| D6 | Autopay failure emails are not claimed via `notified_status`, so a redelivered `invoice.payment_failed` resends the email | Code `webhook.ts:356-433` | Autopay only. Deferred while autopay is off. |

Today's production exposure is **none**: 0 rentals, 0 subscriptions, 0 payments.

### Suspected issues (not proven; handled by operating rules)

| # | Issue | Rule for launch |
|---|---|---|
| S1 | A Charge Card that ends in an *ambiguous* error (network or timeout, not a card decline) is marked failed. Retrying uses a new idempotency key, so a charge Stripe actually completed could be repeated. | After any non-decline error, check the Stripe Dashboard (or wait for the webhook) before retrying |
| S2 | Two simultaneous Charge Card submissions (two tabs) create two charges. One tab is protected by the busy button. | One person charges, from one tab |
| S3 | The live/sandbox mode is chosen by the browser and trusted by the server. Risky only if sandbox credentials and a sandbox webhook point at production. | Owner confirms no sandbox webhook targets drivereal.com |
| S4 | Driver "Pay Now" can refuse ("Your balance changed") when balances include statuses the portal doesn't sum | Staff charge with Charge Card |

### Checked and safe for manual weekly billing

- **Charge Card** (`chargeCardOnRental`, Owner only):
  - writes the payment row **before** collection;
  - charges one off-session PaymentIntent with an idempotency key (`payments:<id>:attempt:<n>`);
  - marks `paid` only on `succeeded` and `failed` otherwise.
- **Webhook:**
  - never un-pays;
  - a `payment_intent.succeeded` for a charge marked failed after a timeout still settles it as paid;
  - refunds go only through `apply_payment_refund` (refund in the Stripe Dashboard).
- **Late fees:** policy is `enabled: false` in production, so the daily job adds nothing.
- **Automations:** the 5-minute automations job sends messages only; nothing else charges or writes payments.

## Review branch: `fix/billing-launch-safety` @ `7629c44a` (base: live `5e492a87`)

**App only:** 7 files, no SQL, no new Stripe calls, no flag turned on.

| Change | Effect |
|---|---|
| `src/lib/rental-autopay-flag.ts`: `RENTAL_AUTOPAY_START_ENABLED = false` | Start Autopay refused before any Stripe call or role lookup (both paths). With the switch on, a non-active rental is still refused. |
| `src/lib/subscription-cancel.server.ts` | Stop clears the id only when Stripe reports `canceled` or `incomplete_expired`. Anything else, including "no such subscription", returns an error and leaves autopay on. |
| `endRental` (published path) | Refuses while `stripe_subscription_id` or `autopay_active` is set |
| `DriversPanel` `AutopayActions` | No Start on closed rentals or while off ("Autopay Off · Charge Weekly"). Stop shown whenever a subscription exists. |
| `scripts/billing-launch-safety.test.mjs` (in `npm test`) | 15 checks, running the real handlers against fakes. **9 fail on live `5e492a87`, all pass on the branch.** |

Results:
- tsc, build and full `npm test` pass;
- agreement-evidence 11/0;
- PR 2 behaviour is untouched (`rentals.functions.ts` gains one guard after the existing status check).

**Deferred (not needed for launch):** a corrected autopay start. It would follow `stripe-operations.server.ts`:
1. `prices.create` with `product_data`;
2. `subscriptions.create` with `price`;
3. idempotency keys and an atomic claim on the rental.

It must then be verified in Stripe **test mode** (needs Owner approval) before the switch is turned on.

## Live Stripe configuration (Owner confirms; no secret values shared)

| # | Check | Why |
|---|---|---|
| C1 | Lovable payments go-live complete for **live** mode; the published site's publishable key starts with `pk_live_` | The site picks live or sandbox from that prefix |
| C2 | Secrets present: `STRIPE_LIVE_API_KEY`, `PAYMENTS_LIVE_WEBHOOK_SECRET`, `LOVABLE_API_KEY`; `SITE_URL` = `https://drivereal.com` | Stripe calls, signature check, card-setup return links |
| C3 | Stripe live webhook endpoint = **`https://drivereal.com/api/public/payments/webhook?env=live`** | Without `?env=live`, every event gets a 200 response and is silently ignored |
| C4 | Webhook events at least: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `customer.subscription.deleted`, `customer.subscription.updated` | Card on file, charge result, refunds. The two subscription events let a Dashboard cancel clear any stray subscription (the End Rental guard relies on it). |
| C5 | No sandbox webhook points at drivereal.com | Prevents sandbox events writing live rows (S3) |
| C6 | Stripe live has no pre-existing subscriptions billing these drivers (Dashboard or back-office Stripe Collections) | App records show 0; anything there was made outside the app |

## What remains before the first rental

| # | Item | Type | Approval |
|---|---|---|---|
| 1 | Review `fix/billing-launch-safety` (`7629c44a`) | Non-production | — |
| 2 | Preview → `7629c44a`, publish once, Owner confirms live SHA | **Production (app only)** | Separate approval |
| 3 | Stripe live configuration C1–C6 | Owner action | Owner |
| 4 | Business decision: **manual weekly billing** (Owner presses Charge Card each week); autopay off | Owner decision | Owner |
| 5 | Operating rules S1–S2 for Charge Card | Owner decision | Owner |
| 6 | First rental attended with the §3 checklist; read-only checks after each step | Operations | — |

Rollback for item 2: Preview to `5e492a87` (the current live code; republish needs approval).

## Update: PR #284 reviewed, Preview plan (2026-10-27)

**Draft PR:** https://github.com/REAL-HQ/real-rentals/pull/284. Head **`4268c667`** (tree `2018f3c9`); base `release/pr2-live` = `5e492a87`. Same 7 files.

**Independent review:**
- All subscription-creation paths are blocked or unreachable.
- Cancellation state is accurate in every outcome.
- Manual charges are untouched.
- No Stripe call on End Rental without a subscription. Production has 0 rentals with a subscription or autopay flag.

Review fixes are in `4268c667`:
- End Rental now points to the Stripe Dashboard, because the back office renders **no** autopay control;
- Stop reports a failed database clear;
- tests grew to 19 (11 fail on live).

tsc, build, full `npm test` and agreement-evidence 11/0 pass.

**Remaining gaps (not blockers; handled by `MANUAL-WEEKLY-BILLING-PROCEDURE.md`):**

| # | Gap | Handling now |
|---|---|---|
| G1 | Charge Card always creates a new row, so a retry after a decline leaves the declined row owed | Preferred: driver Pay Now. Otherwise charge once more and Waive the declined row with a note. |
| G2 | Charge Card says "Charged" even when Stripe returns the payment as pending | Staff confirm the row shows **Paid**. A one-line UI fix can follow on approval. |
| G3 | The `closeoutV2` path skips the subscription guard | Unreachable (flag off, SQL absent). Move the guard before enabling it. |
| G4 | No working autopay | Off. A corrected start needs Stripe test-mode verification and approval. |
| G5 | The payments screen allows deleting payment rows | Pre-existing. Procedure: never delete; Waive with a note. |

**Preview and publish plan** (each step needs its own approval):
1. Read-only watch (0031, S1, journals, scheduled jobs, rentals with a subscription = 0).
2. Fast-forward Preview `integration/grok-baseline-2026-10-22` from `5e492a87` to `4268c667`. One push, no force. Confirm Lovable `latest_commit_sha`, then run the read-only watch again.
3. Owner look-only check on Preview: Charge Card dialog opens. Do not charge.
4. Publish once. The switch is watched through `x-deployment-id`. Owner confirms the live `data-commit-sha` = `4268c667…`.
5. Rollback: fast-forward Preview to **`rollback/billing-to-pr2` = `9271787f`** (tree identical to `5e492a87`) and republish. No SQL involved.
