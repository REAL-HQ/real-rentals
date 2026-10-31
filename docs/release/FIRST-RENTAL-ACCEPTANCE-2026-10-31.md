# First real rental: security baseline, Stripe checks and acceptance checklist (2026-10-31)

No SQL, publishing, Stripe or customer-data actions were taken to prepare this document.

## 1. Final security baseline

Source: the read-only production snapshot of 2026-10-31 02:27:29 UTC, taken after both payment guards. This request allowed no SQL, so nothing was re-queried. Installation evidence, checksums and rollbacks are in [`PAYMENT-GUARDS-INSTALL-PACKET.md`](PAYMENT-GUARDS-INSTALL-PACKET.md).

| Item | State | Evidence |
|---|---|---|
| Release 2 live | **Yes**: `4fdf5a78`, deployment `psr2.7f1b6a2b` | Owner `data-commit-sha` check (2026-10-28); `x-deployment-id` on every cron response through 02:25 |
| Payment DELETE guard | **Installation-complete** | Evidence `payments_delete_guard_v1` (txid 120057); verify-after 6/6; trigger `zz_payments_delete_guard` (tgtype 11); rollback `9759df5d…7929` |
| Payment write guard | **Installation-complete** | Evidence `payments_write_guard_v1` (txid 120077); verify-after 6/6; trigger `zz_payments_write_guard` (tgtype 23); rollback `2ab7d318…a896a015` |
| Security 0031 | Intact | Policies md5 `d33877618a9f40924d14e49b6653d7fa` (5 policies, 173 total) |
| S1 | Intact | `zz_application_write_guard` present. Full verify at 02:18: `all_gates: true`. The catalog has been fingerprint-identical since. |
| Insurance verification authority | Intact | Verify-after 8/8 (02:25); setter `603cc13a`; `zz_insurance_decision_guard` present |
| Insurance exception | **OFF** | `allow_activation_without_insurance_verification: false`; 0 audited changes |
| Weekly autopay | **Disabled** | `RENTAL_AUTOPAY_START_ENABLED = false` and `RENTAL_SUBSCRIPTION_COORDINATION_ENABLED = false` in `4fdf5a78`; 0 rentals with a subscription or autopay flag |
| Migration journals | Unchanged | drizzle 23 (`5cfa7e88…`); supabase 105 (`c092289b`) |
| Scheduled jobs | Unchanged | Cron 2–6 active, command md5s `478d975e`, `7a659464`, `454777d5`, `269d0f4c`, `cf4fedd9` |
| Customer data | Unchanged by the guard work | applications 187, rentals 0, payments 0; vehicles `2b0b7a57`, user_roles `1a2d9611`, app_settings `b9aae8d4`, applications `3eab79ac` |

## 2. Stripe live configuration

**What the agent verified (read-only, from the live code `4fdf5a78`):**
- **Live mode in the app:** `.env.production` holds a `pk_live_` publishable key (prefix checked only). So the production build sends `live` to Charge Card, Pay Now and card setup.
- **Server credentials:** live calls use `STRIPE_LIVE_API_KEY` through Lovable's connector gateway. The webhook verifies signatures with `PAYMENTS_LIVE_WEBHOOK_SECRET`. Values were not read.
- **Webhook route:** `/api/public/payments/webhook?env=live`. It verifies the signature, and an invalid signature returns 400.
- **Webhook events handled:**

  | Event | Purpose |
  |---|---|
  | `checkout.session.completed` | Card on file; setup mode with `metadata.applicationId` only |
  | `payment_intent.succeeded` | Charge recorded as Paid |
  | `payment_intent.payment_failed` | Charge recorded as Failed |
  | `charge.refunded` | Refunds |
  | `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` | Subscription billing; not needed while autopay is off |

- **External billing is kept apart:**
  - App charges carry `paymentIds` and `rentalId` in their PaymentIntent metadata.
  - The webhook only logs PaymentIntents without that metadata, invoices not linked to a rental, and checkouts without `applicationId`.
  - The Payments page therefore lists only app charges.
- **Stripe Collections (`STRIPE_COLLECTIONS_ENABLED = true`):** reads the whole Stripe account (charges, invoices, subscriptions, payouts), so external billing appears there and not on Payments.

**Not reachable by the agent:**
- the Stripe account;
- the live site (the network proxy refuses `drivereal.com`);
- webhook delivery history, which the app does not store.

**Owner dashboard checklist (the smallest set; change nothing):**

| # | Where (Stripe, **Live** mode unless noted) | Pass |
|---|---|---|
| D1 | Developers → Webhooks | One enabled endpoint `https://drivereal.com/api/public/payments/webhook?env=live` subscribed to at least `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed` and `charge.refunded` |
| D2 | That endpoint → Event deliveries, last 7 days | No 4xx or 5xx responses. Regina's and Damon's events return 200 and are ignored by design. A 400 means a signing-secret mismatch: stop and report. |
| D3 | Developers → Webhooks in **Test** mode | No endpoint points at `drivereal.com` (sandbox events must never reach production) |
| D4 | drivereal.com → Overview → Stripe Collections → **Live**, last 30 days | Loads without an error, and gross collections match Dashboard → Payments for the same range. This proves the live key works. |
| D5 | Customers → Regina, Damon | Note only how each is billed (subscription, invoice or payment link) and their next charge date |

D2 passing also proves that the webhook signing secret matches, so the secret names do not need checking separately.

## 3. Existing external billing (Regina, Damon)

Their Stripe billing is not touched. The app cannot bill them on its own: no job creates rent charges, autopay is off, and their payments are ignored by the webhook.

If either is entered as a rental in REAL RENTALS:
1. Keep them billed only in Stripe. **Do not** use Charge Card, Add Payment rent rows, or ask them to use Pay Now.
2. To move one into app billing, first stop their Stripe subscription or invoices at a week boundary (Owner, in the Stripe Dashboard). Confirm in Stripe that nothing further is scheduled. Only then start the weekly Charge Card for the following week.
3. Note the switch week in the rental's notes, so no week is billed twice or skipped.

Entering either of them is not part of the first-rental test. Use a new driver.

## 4. First-rental acceptance checklist

The rental must be **attended**: one Owner, one browser tab, and a new driver who is not billed outside the app. **Stop rule:** if any pass condition fails, stop and report. Do not retry a charge.

Legend:
- **RO**: the Owner or agent checks state only (the app screen, Stripe Dashboard or an approved read-only query).
- **TX**: a real customer transaction or record change.

| # | Step (who) | Type | Pass condition |
|---|---|---|---|
| 1 | Application approved (Manager+) | TX (record change) | Status Approved; one `application.approved` audit row |
| 1a | Check | RO | No duplicate approval; S1 refused nothing legitimate |
| 2 | Licence and insurance documents verified (staff) | TX (record change) | Documents current and reviewed |
| 3 | **Insurance verified** (Manager or Owner, through the insurance verification control) | TX (record change) | `insurance.verified` audit row; exception still OFF |
| 4 | Agreement previewed, sent, signed (driver signs) | TX (customer) | Send accepted with the preview fingerprint; agreement Signed; archive `archived` with SHA-256 |
| 5 | Card on file: Manager issues the link, driver completes the Stripe setup page | TX (customer, Stripe) | Stripe shows a SetupIntent succeeded and a 200 delivery of `checkout.session.completed`; the app shows a card on file for the driver |
| 6 | Vehicle chosen | RO | Vehicle Rental Ready and Available; real VIN; positive rate |
| 7 | **Activate Rental** (Manager+) | TX (record change) | Rental Active; vehicle Rented; agreement linked; `rental.activated` audit row. **Any** blocker override needs a written reason. |
| 8 | **First weekly charge**: Owner, Drivers → driver → Charge Card, amount = weekly rate, reason Rent, pressed **once** | TX (customer, Stripe charge) | Message "Paid: $X collected" or "Processing" (never press again while Processing); Stripe shows the PaymentIntent Succeeded, with `paymentIds` metadata |
| 9 | Stripe webhook confirmation | RO | Stripe shows a 200 delivery of `payment_intent.succeeded` for that PaymentIntent |
| 10 | Payment recorded as Paid | RO | Payments shows the row Paid, balance 0. One row for the week, not two. |
| 11 | Receipt delivered | RO (ask the driver) | Driver received exactly one receipt email. Its notice is claimed once (`notified_status = paid`). |
| 12 | Following weeks | TX (weekly) | [Manual weekly billing procedure](MANUAL-WEEKLY-BILLING-PROCEDURE.md); no autopay |
| 13 | **Vehicle return and End Rental** (Manager+): return inspection and odometer, then End Rental with the return mileage and next vehicle status | TX (record change) | Rental Closed; vehicle Available (or the chosen status); `rental.ended` audit row; no Stripe call needed (no subscription) |
| 13a | Final charges (tolls, damage), if any | TX (customer, Stripe charge) | Separate Charge Card presses with the matching reason, same rule as step 8 |

**Read-only verification during the rental:** after steps 5, 7, 8–11 and 13, one approved read-only query per step can confirm the database side. It returns aggregates and that driver's rows by id only, never card data.

## 5. Remaining blockers and risks

| # | Item | Type | Resolution |
|---|---|---|---|
| R1 | Stripe-side configuration not yet confirmed (D1–D4) | **Blocker** (Owner check, no approval needed) | Owner completes D1–D4 |
| R2 | First live run of card on file, activation, charge, webhook, receipt and End Rental under Release 2 | Risk | Attended first rental with the stop rule (§4) |
| R3 | Regina and Damon double-billing risk | Procedure | §3: never bill them in the app while their Stripe billing is active |
| R4 | Only the Owner can Charge Card | Operational | Accepted |
| R5 | End Rental closes the application; a returning driver needs it reopened | Business | Accepted for launch |
| R6 | Managers could delete *closed* rental rows | History integrity | Procedure: never delete rentals. A fix is deferred. |
| R7 | The guards don't cover the database owner or the Lovable platform role `sandbox_exec` | Trust boundary | Keep Lovable workspace edit access to trusted staff |

## 6. Next approval

After D1–D4 pass, the Owner approves the attended first rental:

> I approve the attended first live rental in project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6` for driver <name / application id> with vehicle <unit / VIN>:
> - steps 1–13 of the first-rental checklist, performed by staff in the live app;
> - including one Charge Card of $<weekly rate> (reason Rent), pressed once;
> - with one read-only verification query after steps 5, 7, 8–11 and 13.
>
> No autopay, no retries, stop on any failed pass condition.
