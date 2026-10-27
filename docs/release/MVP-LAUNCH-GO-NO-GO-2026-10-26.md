# MVP launch: GO / NO-GO checklist (2026-10-26)

> **Update 2026-10-27:**
> - **PR 2 is DEPLOYED and installation-verified.** App `5e492a87` (deployment `4ad9e141`), activation setting (txid 107299) and insurance authority (txid 107840). Evidence is in `PR2-CUTOVER-SAFETY-2026-10-26.md`.
> - The current launch status is in **`FIRST-RENTAL-READINESS-2026-10-27.md`**.

**Verdict: CONDITIONAL GO.** Rental operations can launch with *manual* weekly charges, under all of these conditions:
- PR 2 is deployed;
- Stripe's live configuration is confirmed;
- the first rental is attended.

**Weekly autopay: NO-GO** in the current code (§2).

How this was checked:
- Live code `5d442808` (A.2) was read.
- Production was queried **read-only, with aggregate results only**.
- Nothing was published, written, charged or changed in Stripe.

## 1. Required production deployments

| # | Deployment | State | Rollback |
|---|---|---|---|
| 1 | **Release A.2** `5d442808` | **LIVE**: deployment `7c20aff8`, confirmed by the Owner's page-source check on 2026-10-26. | Republish `a3df8545` |
| 2a | **SQL** `activation-insurance-setting` (request `b80babcc…5505`) | Ready. Production preflight 2026-10-26: **all gates ok**. Harmless to the live app. | Request `57498a82…` |
| 2b | **Publish PR 2** = `feature/driver-activation-readiness` @ **`5e492a87`** (PR #275, now based on A.2) | Merged onto A.2 cleanly. Tests below. | Republish `5d442808`, only *after* the 2c rollback |
| 2c | **SQL** `insurance-verification-authority` (request `eb7710d7…e950`), within about 10 minutes of the confirmed 2b SHA | Ready. Production preflight: **all gates ok** | Request `69d5dcef…`, then republish A.2 |

Notes:
- Before 2b, Preview must be fast-forwarded to `5e492a87`, because Publish ships the Preview head.
- No ledger migrations. No changes to Security 0031, S1, M2, Record Rental or Stripe.
- Ops reminders (daily job 3) stay deferred.

**PR 2 on A.2 test results:**

| Check | Result |
|---|---|
| tsc, build, full `npm test` | Pass |
| activation-readiness | 77/0 |
| agreement-evidence | 11/0 |
| Database package tests (S1, 0031 and M2 install orders and rollbacks C1–C4) | 61/0 |
| eSign harness | 50/50 |
| SQL request files | Byte-identical to the reviewed packages |

**What PR 2 preserves:**
- Only Managers and Owners can verify insurance (`requireManager` plus `private.is_manager()`).
- The exception defaults to **OFF**: the seeded value is `allow_activation_without_insurance_verification: false`, and only the Owner can change it.
- Activation fails closed. An exception needs the setting plus an acknowledgement.
- The interview stays optional; overriding it needs a written reason, which is audited.
- Signed-agreement immutability (#278) is unchanged.
- Coordinators remain contained and Security 0031 is untouched.

## 2. Stripe readiness findings

### Database and Stripe reconciliation (read-only, aggregates)

**Application database: no payment activity has ever been recorded.**

| Item | Count |
|---|---|
| `applications.stripe_customer_id` / `stripe_payment_method_id` | 0 / 0 |
| `rentals` | 0 (so 0 customer, subscription and payment-method links) |
| `payments` (0 payment intent, 0 invoice, 0 subscription links) | 0 |
| `payment_refunds` | 0 |
| `financial_transaction_events` | 0 |
| `toll_charges` | 0 |
| Payment-related audit rows | 0 |
| Payment emails in `outbound_messages` | 0 |

**Stripe account itself: unknown.** It cannot be read without credentials. The Owner can see it without handling secrets in either place:
- the Stripe Dashboard (live mode);
- back office → Stripe Collections. This reads Stripe live, is strictly read-only and is visible to Managers and above. It shows active subscriptions and charge counts, but not a total customer count.

Anything found there was **not created by this app**. The webhook ignores invoices for subscriptions it doesn't know: it logs a warning, writes no row and returns 200. So those amounts won't appear in app revenue, but they cause no harm.

### Configuration (Owner to confirm; names only, never values)

- **Stripe connection:** the app reaches Stripe through Lovable's Stripe connector gateway (`connector-gateway.lovable.dev/stripe`). Lovable's payment go-live must be complete for **live** mode.
- **Live mode on the published site:** the build chooses live or sandbox from the publishable key prefix (`pk_live_` or `pk_test_`). Without a valid key, checkout shows "Payments are not configured for this build".
- **Secrets present:**
  - `STRIPE_LIVE_API_KEY`, `PAYMENTS_LIVE_WEBHOOK_SECRET` and `LOVABLE_API_KEY`;
  - `SITE_URL` = `https://drivereal.com`, used for card-setup return links.
- **Webhook destination (Stripe live):** `https://drivereal.com/api/public/payments/webhook?env=live`.
  - **The `?env=live` is required.** Without it, every event gets a 200 response and is silently ignored.
  - Minimum events for a manual-charge launch: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.
  - The autopay events (`invoice.*` and `customer.subscription.*`) can be added later.
- **No sandbox webhook pointed at drivereal.com.** The webhook does not check `livemode`, and sandbox and live share the same database rows.

### Idempotency and safety

| Path | Finding | Launch impact |
|---|---|---|
| Card on file: Manager issues link → Stripe Checkout (setup mode) → webhook saves the card on the application | Customer creation uses an idempotency key. Valid Stripe call. **Never run live.** | OK; verify on the first driver |
| Manual charge: **Charge Card**, Owner only | A payment row is written *before* collection (as AGENTS.md requires). The PaymentIntent carries an idempotency key (`payments:<ids>:attempt:<n>`). The button is disabled while busy. Unique indexes on the payment intent and invoice ids. | OK. A double charge needs two simultaneous submissions; avoid two open tabs. |
| Webhook | Signature verified, 300-second tolerance. Never "un-pays": every write guards against paid and refunded. Refunds go only through `apply_payment_refund`, so refund in the Stripe Dashboard. No stored event ids; replays are handled by state guards and unique indexes. | OK for manual charges |
| **Autopay start** | **Expected to fail every time.** It sends `items[].price_data.product_data`. Stripe's API definition (installed SDK 22.0.2) requires `price_data.product`, an existing Product id, and has no `product_data`. The code needs an `as any` cast to compile. The unused `stripe-operations.server.ts` does it correctly (`prices.create`, then `price: id`). Also: no idempotency key, and two simultaneous starts can create two subscriptions. | **NO-GO** |
| **End Rental** | Does **not** cancel the Stripe subscription. `end_rental_tx` only sets `autopay_active=false`, and the autopay control disappears with the active rental. | **NO-GO** for autopay. If a subscription ever exists, staff must Stop Autopay first and confirm the cancellation in Stripe. |
| **Stop Autopay** | Swallows a failed cancellation, then clears the subscription id anyway. Stripe can keep billing while the app shows autopay off. | Same as above |
| Autopay invoice emails | Not claimed through `notified_status`. A redelivered `invoice.payment_failed` re-sends the email (an AGENTS.md deviation). | Deferred with autopay |
| Driver "Pay Now" (portal) | The client total (pending, failed, past_due amounts) can differ from the server total (balance due across 8 statuses). Example: a late fee. The result is "Your balance changed", every time. | Fallback: the Owner charges the card |
| Environment selection | The browser sends `live` or `sandbox`, and the server trusts it. On a `pk_live_` build the UI always sends `live`. Risk exists only if sandbox credentials and a sandbox webhook point at production. | Owner confirms no sandbox webhook |
| Attribution | Charges carry `rentalId` and `paymentIds` in their metadata. Rows are linked by `rental_id` and `driver_id` (the application id). Autopay invoices are attributed through `rentals.stripe_subscription_id`. Record Rental's payment attribution gateway is deferred. | OK for new rentals |

## 3. First-live-rental acceptance checklist

Run this on the **first real customer**. **No test applications, rentals or charges.**
- An Owner is present.
- One read-only aggregate check after each step.
- **If any check fails, stop.** Do not move to the next step.

| # | Step (who) | Pass condition (read-only check) | Proven live? |
|---|---|---|---|
| 1 | Application approved (Manager+) | Status `approved`. One `application.approved` audit row. No duplicate approval. | No approval since S1 (watch item 11) |
| 2 | Documents verified (staff) | Licence and insurance documents current and reviewed. 0 uploads without a stored file. | Yes |
| 3 | **Insurance verified** (Manager or Owner) | `insurance.verified` audit row. Exception setting OFF. | **Only after PR 2** |
| 4 | Agreement prepared, sent and signed | Send accepted. If refused, regenerate the preview. Agreement `signed` and archive `archived`. | Yes (1 signed and archived) |
| 5 | Card on file (driver uses the Manager's link) | `applications.stripe_customer_id` and `payment_method_id` are set. Stripe shows a 200 delivery for `checkout.session.completed`. | **No: first live run** |
| 6 | Vehicle chosen | Rental Ready and `available` (5 of 10 qualify) | Yes (data) |
| 7 | **Activation** (Manager+) | Rental `active`; vehicle `rented`; application `active`; agreement linked to the rental; `rental.activated` with `atomic: true` | **No.** Ran once on 2026-10-06 under an older build. |
| 8 | **First week's charge**: Charge Card, Owner, reason Rent | Payment row `pending`, then `paid`. Stripe shows the PaymentIntent succeeded. One receipt email. | **No: first live run** |
| 9 | Webhook processed | Stripe shows a 200 for `payment_intent.succeeded`. Row stays `paid`. No "unmatched" warning. | **No** |
| 10 | Following weeks | Owner charges weekly by hand. **No autopay.** | — |
| 11 | **Closeout**: End Rental (Manager+), with return mileage and vehicle status `available` | Rental `closed`; vehicle `available`; application `closed` (by design today); automations cancelled; `rental.ended` | **No.** Ran once on 2026-10-06 under an older build. |

**Cannot be verified end to end before the first customer:**
- live card setup (5);
- live charge (8);
- webhook delivery and receipt email (9);
- refund (Stripe Dashboard → `charge.refunded`);
- activation and closeout on the current build (7, 11).

These need real live activity. The attended first rental *is* the acceptance test.

## 4. Unresolved business and safety items

| # | Item | Severity | Proposed resolution |
|---|---|---|---|
| B1 | PR 2 not deployed: insurance is not enforced at activation | **Blocker** | Deployments 2a, 2b and 2c |
| B2 | Stripe live connection, webhook URL (`?env=live`) and secrets unconfirmed | **Blocker** | Owner confirmation (§2) |
| B3 | Autopay broken and unsafe at closeout | **Blocker for autopay only** | Launch with manual weekly charges. A narrow autopay fix would be new development and needs separate approval: correct Price creation, idempotency, End Rental refusing while a subscription is active, and Stop surfacing failures. |
| B4 | Only the Owner can charge cards (`assertAdmin` = admin = Owner) | Operational | Accept, or decide later whether Managers may charge |
| B5 | End Rental closes the application. Returning drivers need it reopened. | Business | Accept for launch. `END_RENTAL_PRESERVES_APPLICATION` is deferred. |
| B6 | Driver Pay Now can refuse when late fees exist | Minor | The Owner charges the card instead |
| B7 | Managers can delete *closed* rental rows (RLS "Managers manage rentals"; the guard blocks only active ones). The two 2026-10-06 test rentals were removed this way or similarly. | History integrity | Procedure: never delete rentals. A fix is deferred. |
| B8 | First live run of steps 5, 7, 8, 9 and 11 | Risk | Attended first rental, stop rule |

## 5. Minimum Owner approvals

1. **Confirm A.2 is live:** a screenshot of the live `data-commit-sha` reading `5d442808…`.
2. **PR 2, one window approval:**
   - Fast-forward Preview to `5e492a87`.
   - Submit `activation-insurance-setting` once.
   - Publish once (rollback `5d442808`), with a live-SHA screenshot.
   - Submit `insurance-verification-authority` once.

   Each SQL step re-runs its read-only preflight first and stops on any false gate.
3. **Stripe confirmations (Owner actions, no secrets shared):**
   - Lovable payment go-live is complete for live mode.
   - The live webhook is `https://drivereal.com/api/public/payments/webhook?env=live` with at least the four events listed in §2.
   - No sandbox webhook points at drivereal.com.
   - Report the Stripe live counts of customers and active subscriptions (Dashboard or Stripe Collections).
4. **Business decisions:**
   - (a) **Launch with manual weekly charges and no autopay** (recommended).
   - (b) The insurance exception stays OFF.
   - (c) Owner-only charging and End Rental closing the application are accepted for launch.
   - (d) The first rental is run as the attended acceptance test above.
