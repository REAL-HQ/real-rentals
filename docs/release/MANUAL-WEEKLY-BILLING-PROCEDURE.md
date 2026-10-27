# Manual weekly billing procedure (launch)

**Applies while weekly autopay is OFF** (`RENTAL_AUTOPAY_START_ENABLED = false`, PR #284). Autopay stays off until separately reviewed and approved.

**Who:** the Owner. Charge Card is Owner-only.
**Where:** Drivers → driver → Charge Card.
**Stripe:** the Stripe Dashboard in **live** mode.

## The one rule

**Never press Charge Card again for a week that already has an attempt, until Stripe shows that week's charge did not go through.**

Each Charge Card press creates a **new** payment row and a **new** Stripe idempotency key. A second press is therefore never treated by Stripe as a duplicate: it can charge the driver twice.

## Each week, per active rental

1. **Before charging**, open the driver's payments and check there is no charge for this week already (`paid`, `pending` or `failed`).
2. **Charge Card:**
   - Amount = the agreed weekly rate. Reason = **Rent**. Note = the week, for example "Rent Nov 2–8".
   - Press **once**, from **one** browser tab, by **one** person.
3. **Read the result, then confirm the row:**

| What you see | What it means | What to do |
|---|---|---|
| "Charged $X to card" **and** the new row shows **Paid** | Collected | Done |
| "Charged $X to card" but the row shows **Pending** | Stripe has not finished, for example the card needs the driver's authentication. The message is misleading here (known gap G2). | Do **not** charge again. Check the payment in Stripe (below). The row updates by webhook when Stripe settles it. |
| An error that names the **card** ("declined", "insufficient funds", "expired", "incorrect number", "authentication required") | A clear decline; nothing was charged | Go to **After a decline** |
| **Any other error**: connection, timeout, "Stripe request failed", a blank message, or the page froze | **Uncertain.** Stripe may have charged. | Go to **After an uncertain result**. Do not retry. |

## After an uncertain result (never retry first)

1. In Stripe (live) → **Payments**, search the driver's email.
2. Find the PaymentIntent for this amount and time. Its metadata `paymentIds` holds the app's payment row id.

| Stripe shows | Do |
|---|---|
| **Succeeded** | Do not charge again. The webhook marks the row Paid within minutes. If it is still not Paid after 30 minutes, report a webhook problem. **Mark as Paid** only with the Owner's note naming the PaymentIntent id. |
| **Requires action / processing** | Do not charge again. Wait, or ask the driver to complete the authentication. |
| **Failed / declined** | Treat as a decline (below) |
| **No PaymentIntent at all** | Nothing was charged. Treat as a decline (below). |

## After a decline

The declined row stays **failed** (still owed).

| Option | How |
|---|---|
| **Preferred** | Ask the driver to update their card, then pay from the portal (**Pay Now**). Pay Now collects the **existing** rows, so no new row is created. |
| **If the driver can't** | After the card is updated:<br>1. Charge Card once for the same amount, with the note "Retry of <date> rent".<br>2. Then **Waive** the original declined row, with a note naming the retry.<br>This leaves one owed rent row per week. Do this only after the retry shows **Paid**. |

Never retry the same card more than once a day.

## Ending a rental

1. **Record the return first:**
   - complete the return inspection and odometer;
   - **End Rental** with the return mileage and where the car goes next.
2. With autopay off, rentals have no subscription, so End Rental does not depend on Stripe.
3. Final charges (tolls, damage, cleaning) are separate Charge Card presses with the matching **Reason**, following the same rule.
4. Refunds happen only in the Stripe Dashboard. The webhook records them through `apply_payment_refund`.

## If Stripe is down when a car comes back

With autopay off, End Rental makes **no Stripe call**, so a Stripe outage cannot stop staff recording a return. On 2026-10-27, **0** rentals had a subscription or autopay flag.

If a rental ever shows "This rental still has a weekly Stripe subscription":
1. Record the return inspection and odometer now. Leave the rental open; the car stays marked rented, which is safe.
2. When Stripe is back, cancel the subscription in the Stripe Dashboard. The `customer.subscription.deleted` webhook clears it in the app.
3. Then press End Rental, with the actual return date.

Never clear the subscription field by hand.

## Never
- Start autopay. It is switched off, and the back office has no autopay control. If Stripe ever shows a subscription for a driver, cancel it in the Stripe Dashboard.
- Charge from two tabs or two people at once.
- Retry after an uncertain result before checking Stripe.
- Delete payment rows. Use Waive with a note.
