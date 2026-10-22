# Unrecorded Stripe Payments

Read-only note for the owner. Written October 22, 2026 from the code and docs on this branch (`6d437064`, draft #260). No Stripe call, no database query, and no change that records money. `STRIPE_UNMATCHED_PAYMENTS_ENABLED` and `STRIPE_PAYOUT_RECON_ENABLED` stay false. Nothing here is a payout instruction to the bank.

The subject is the three Stripe payments the owner identified, **$1,050 total**, arriving with the owner on October 23, 2026. This note does not list invoice ids, customer names, or how that total splits. Those details stay in Stripe. The screens below are how the owner would read them after a later, separate enablement. They are not on the live site while the flags are false, and draft #260 is not published.

## Why the app has no payment row

A paid Stripe invoice becomes a `payments` row only inside the payments webhook, and only when the invoice's subscription is already stored on a rental (`rentals.stripe_subscription_id`). The insert is one rent row for that invoice: amount, driver, vehicle, `stripe_invoice_id`, and `stripe_subscription_id`, then status Paid and a paid date.

When the subscription is missing, or no rental has that subscription, the webhook returns without inserting a row. If the customer is also absent from every rental and every application, it writes a server log (`stripe_unmatched_payment`) with the invoice id, the subscription id, the last four characters of the customer id, and the amount. A customer that is already on a rental or an application suppresses that log. Either way, no payment row is created. A payment-intent event does not add a second log. The webhook does not replay an invoice that already happened.

So these three can be paid in Stripe, and absent from Payments, for as long as no rental carries their subscription. Linking a rental later does not, by itself, create rows for invoices Stripe has already sent.

## How Unmatched Stripe Payments would show them

This is the #255 view, `UnmatchedStripePayments`, on the Payments screen. It is mounted only while `STRIPE_UNMATCHED_PAYMENTS_ENABLED` is true. While the constant is false the section is absent, and the server returns before auth and before any rental, application, or Stripe read. An environment variable cannot turn it on.

After a reviewed build with the constant set to true is what the owner is signed into:

1. Sign in as an Owner or a Manager. A Coordinator is refused.
2. Open **Payments**.
3. Read the section **Unmatched Stripe Payments**. The line under the title is: "Live paid invoices from the last 60 days whose subscription and customer are not on a rental or an application."

The table columns are **Invoice**, **Subscription**, **Customer**, **Paid On**, and **Amount**.

- **Invoice** is the Stripe invoice id.
- **Subscription** is the subscription id, or a dash when the invoice has none.
- **Customer** is the last four characters of the Stripe customer id. The full id is not shown. Two customers can share those four characters, so the invoice id is the match key.
- **Paid On** is the Eastern Time calendar day (`America/New_York`) of Stripe's paid time, or the invoice's created time when paid time is absent. A missing stamp shows **Unknown**.
- **Amount** is that invoice's amount paid, in dollars. A value the reader cannot trust shows **Unknown**.

The window is 60 Eastern Time days, including today. On October 22, 2026 that window still contains October 15, 16, and 17, 2026. The code's own check places those three days inside the window when "today" is October 21, 2026.

A row is included when the invoice is paid, its created time is inside that window, its subscription is on no rental, and its customer is on no rental and no application. Each of the three appears there when it meets that test. The amounts on the three rows are what the owner adds up and compares with $1,050.

A paid invoice whose customer is already on an application or a rental is left off this list even when Payments has no row for it. An empty list is "No Unmatched Invoices" only when the read finished and found none. "This Read Is Truncated", "Stripe Could Not Be Read", "The Rental Read Did Not Complete", and "The Application Read Did Not Complete" each mean the list is not the full set. A truncated directory shows no rows on purpose.

The section does not insert a payment, attach a driver name, move a payout, or send a receipt.

## What the owner does with the manual payment flow

**Payments → Manual Payments** is the manual payment flow in the product today. Open it and read the banner before typing anything:

> Practice Mode — Nothing Is Saved. Manual payments are not active yet; they wait on the database foundation approval. Actions here stay on this screen, never change real charges, never charge a card and disappear when you close this window.

`MANUAL_PAYMENTS_LIVE` is false. The comment on that constant says it flips only after the database foundation is approved and applied. The proposed `payment_collections` script is marked not applied. The receipt control says the file is checked and not uploaded. The toast after **Record Pending** says "Recorded as Pending Verification (practice only)." Closing the window drops the entry. The role switcher is labeled "Simulation only — your real access is unchanged."

The clicks, if the owner opens it anyway:

1. **Payments**, then **Manual Payments**.
2. On **Open Charges**, choose **Record Payment** on a charge. While the flag is false the list includes a practice-only **Sample Charge (Practice)** for $350, plus any real charge that is not Paid, Refunded, Waived, or Void.
3. The **Record Payment** form asks for Method, Amount, Date Received, Transaction Reference, Notes, and a Receipt. Methods are Cash App, Venmo, Zelle, Cash, Bank Transfer, Check, Money Order, and Other. There is no Stripe or card method. Cash requires a note and who received it. Cash App, Venmo, Zelle, Bank Transfer, and Money Order require a receipt or a reference. Check requires an image or a deposit confirmation. The date cannot be in the future. The amount cannot exceed the charge's open balance.
4. **Record Pending** keeps it on the **Pending Verification** tab for 48 hours in memory. A Manager or Owner would then **Verify**, **Reject**, or, after verification, **Reverse**. Verify asks for confirmation that the money arrived and a note of how it was checked. Cash verification is Owner-only. Verifying one's own entry needs an Owner exception reason. Pending and rejected entries do not change a balance. Only a verified entry is designed to reduce the charge.

That designed verify step is not live. The screen subtitle is "Record, verify, reject and reverse payments received outside card checkout." These three payments were collected by Stripe on an invoice. The flow also needs an open charge to attach to, and the webhook never created one. Recording them here tomorrow, including against the sample charge, leaves no ledger row.

**Add Payment**, the other button on Payments, inserts a `payments` row from the browser. Its fields are Driver, Vehicle, Type, Status, Amount, Due date, and a free-text payment method. The form has no Stripe invoice id, subscription id, or payment intent. **Mark as Paid** writes status Paid and a paid date of the day the button is clicked, and it leaves those Stripe ids empty.

Overview's income for a date range counts paid and refunded rows of type rent, late fee, or other whose paid date falls in the range. A paid row with no Stripe payment intent and no Stripe invoice id is the non-Stripe portion. Overview adds that portion to live Stripe collections. **Mark as Paid** on a new row would put the $1,050 in the non-Stripe portion for the click's date and leave the original Stripe charge in collections. The shape the app uses when staff have already marked a Stripe invoice paid is a row that still carries `stripe_invoice_id`, so the money stays in the Stripe portion. **Add Payment** cannot store that id. A status other than Paid would also sit on Payments as money still owed. Leave both **Manual Payments** and **Add Payment** unused for these three.

Tomorrow the record of the $1,050 is the Stripe payout and the three invoices in Stripe. When the unmatched section is on, use **Invoice**, **Paid On**, and **Amount** to tie each invoice to that payout. Leave Payments without a second charge.

## Payout Reconciliation, once the payout has arrived

`STRIPE_PAYOUT_RECON_ENABLED` is a separate constant, also false, also not an environment variable. While it is false the **Payout Reconciliation** item is omitted and a direct link opens Overview. The gate returns before auth and before any payment or Stripe read.

With the constant true, an Owner or a Manager opens **Payout Reconciliation**. The screen reads payouts whose arrival date is in the last 60 Eastern Time days. An arrival on October 23, 2026 stays on that screen while that date is still inside the 60-day window. For each payout it shows gross, fees, refunds, and net from the payout's balance transactions. The invoice amounts and the payout net are different figures: fees sit in their own column. This note does not decide which of those figures is the $1,050.

A charge matches an app payment when `payments.stripe_payment_intent_id` or `payments.stripe_invoice_id` is the charge's payment intent or invoice id. These three have no such row, so they list under that payout's unmatched charges: charge id, payment intent, amount, and **Fleet Link**. **Fleet Link** is **Linked** when the invoice's subscription is on a rental, or its customer is on a rental or an application. Otherwise it is **Not Linked**. The same rule is used for **Paid In Stripe, Not In A Payout**, which lists app payments that already have a payment intent and are on no payout in the window. It does not list an invoice that was never written into Payments.

"Stripe check unavailable" and "Stripe check hit the page cap" each withhold the rows. "Driver records were incomplete" does the same. A blank withheld screen is not a statement that the payout matched. **Download CSV** appears only when both the Stripe read and the driver directory finished. The screen does not create a payout, cancel one, or refund.

## Enabling the two flags later

Do this only as its own reviewed change, after draft #260 is accepted and the build the owner uses contains these screens. Flipping a constant on an unpublished branch does not show either screen. Both constants are hard-false. Set the one you intend to true in source, review that diff, and publish that build. Leave the other false if only one screen is wanted. Leave `STRIPE_COLLECTIONS_ENABLED` as it is: it is already the live collections flag and is independent of these two.

### Prerequisites

- The published build is the one that contains `stripe-unmatched.ts` and `stripe-payout-recon.ts`, including the gate in front of auth.
- The existing live Stripe client is the reader. Both screens call `createReadOnlyStripe("live")` with the short query cache on. The client exposes list and retrieve only. Checkout, subscription, and payment collection stay the write paths.
- An Owner or a Manager is signed in. Unmatched Payments reads rentals and applications as that person. Payout Reconciliation checks the manager role, then reads the payment directory through the service client.
- The owner has the three invoice ids from Stripe in hand, so a row on screen can be tied to the $1,050 without typing a new payment.

### Risks

- The screens read live Stripe. They are built to stop at list and retrieve. They still depend on a correct deploy. A bad deploy is rolled back by publishing the previous build, as below.
- Unmatched Payments hides an invoice whose customer is already on an application, even when no payment row exists. Confirm each of the three by invoice id.
- The customer column is four characters. Match on the invoice id.
- A directory or Stripe read that stops early withholds rows or says the read is truncated. Do not treat that as "all caught up."
- The query cache is 60 seconds. A row written during that minute can still look unmatched until the cache expires.
- Turning the screens on does not insert the three payments and does not move the October 23 payout. The webhook log for a future unmatched invoice is part of the webhook code on this branch. Setting the screen flags back to false does not remove that log. The log writes no payment.
- Payout Reconciliation's service-client read is still limited to a manager, and it is off entirely while the flag is false.
- Entering the $1,050 through **Add Payment** after the screens are on still creates a second, non-Stripe income row. The screens do not gain an invoice-id field.

### Rollback

Set the constant that was turned on back to false and publish that build. Unmatched Payments disappears from Payments, and its server function returns disabled before auth, the database, and Stripe. **Payout Reconciliation** drops out of the menu, and a direct link opens Overview, with the same before-auth return. Neither screen writes a row, so rollback does not delete payments, refunds, or payouts. Do not restore an older database snapshot to undo a screen that only reads.

The webhook's "no rental, no insert" behavior stays until a build without that webhook code is published. Turning the two screen flags off is the rollback for the screens. It is not a switch that starts or stops recording these three invoices.
