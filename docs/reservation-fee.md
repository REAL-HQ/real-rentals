# $50 Reservation Fee

Dolmar's decisions (Nov 16 2026, SOP D6 and D31; t309u):

- The Reservation Fee is **never called a deposit**, anywhere. It is applied to
  rent (week 1). A deposit is a different thing: the per-car **security
  deposit**, refundable at the end of the rental (when one is collected) and
  used to deduct fees during it. The two are kept and labeled separately.
- The card is collected **only after the agreement is signed**. Stripe collects
  the $50 and saves that card on file for the balance owed on the rental.
  Nothing asks for a card before the agreement is sent.
- The car is held only once the fee is paid. It is kept if the renter is
  **30+ minutes** late to pickup (docs/late-pickup.md).

Switch: `app_settings.reservation_fee_auto = {"enabled": true, "amount": 50}`.
OFF with no row. Turn on with `proposed/reservation-fee-auto-on.sql` (not applied).

## What happens when it is on

| Step | Where | What |
| --- | --- | --- |
| Quote | `insurance-rate.ts` `fleetQuoteText` | FLEET's quote text adds: "After you sign, you'll pay a $50 Reservation Fee by card to hold the car. It is applied to your first week, and that card is saved on file for your rental balance." The per-car deposit reads "no security deposit" / "$250 security deposit". |
| Agreement | `fleet-agreement.server.ts` | FLEET's agreement records a Required $50 Reservation Fee (`merge_data._prep`). No card is needed to send it. |
| Signing | `agreements.functions.ts` → `chargeReservationFeeAfterSigning` | Only if the signed text prints a Reservation Fee. The charge row is written first (`payments` type `fee`, reason `reservation_fee`, one per agreement). **Always the Stripe link (card t315s1710):** a per-renter Stripe Checkout (24 hours) for the $50 with `setup_future_usage: off_session`, sent as a "Pay $50.00 Reservation Fee" button in the Agreement Signed email (heading "One Last Step: Reserve Your Car"). A returning renter with a saved card gets the same link; the saved card is never charged automatically for the fee. No other pay link is sent when the fee path handled the signing. |
| Card saved | `payments/webhook.ts` `checkout.session.completed` | The card used for the fee is saved on the application (`stripe_payment_method_id`, brand, last 4, expiry) for the rental balance. |
| Paid / hold | `payments/webhook.ts` `payment_intent.succeeded` → `holdReservationForFee` | The row is marked paid (metadata.paymentIds) and an open reservation is marked held right away; the 5-minute job also catches it on pickup day. |
| Booking | `fleet-pickup.server.ts`, `createReservationCore` | FLEET cannot book a pickup until the fee is paid. A staff reservation shows the fee as pending until paid. |
| Activation | `rentals.functions.ts` → `applyReservationFeeCredit` | One −$50 Stripe customer balance credit, which Stripe applies to the renter's week 1 invoice. Once per fee. |
| Missed pickup | `late-pickup.server.ts` | 30+ minutes late: fee kept (marked `kept:late_pickup:<rental>`), never credited or reused. |

Storage: the reservation keeps the fee in the existing
`rentals.reservation_deposit_*` columns (renaming them needs a migration). Those
columns hold the Reservation Fee (status `applied` = credited to week 1), never
the security deposit (`rentals.deposit_*`), and staff screens label them
"Reservation Fee" while the fee switch is on.

## Renter-facing copy (Agreement Signed email)

- Pay now (no card on file): "Next step: pay your $50.00 Reservation Fee by card with the button below. It is applied in full to your first week, and the card you use is saved on file for your rental balance. Your car is held as soon as it is paid. This link is for your rental and expires within 24 hours." Button: "Pay $50.00 Reservation Fee".
- Heading while the fee is unpaid: "One Last Step: Reserve Your Car" (otherwise "Agreement Signed — You're All Set").
- The old "charged to your card ending in …" and "processing" lines are no longer reached by signing: there is no automatic charge.
- Card payments not configured or a decline: the usual pay-link email (the fee is not charged; staff see the unpaid row).

## Before turning it on

1. The agreement template in use must print the Reservation Fee. The built-in
   v1.14 (Insurance Included) text prints it, with the approved 30-minute hold
   line, unlimited miles within 100 miles of Tampa (10.1) and the Service Area
   "100-mile radius of Tampa, FL".
2. Rent reminders and late fees ignore type `fee`, so the fee never triggers them.
3. The Checkout link expires after 24 hours. If the renter does not pay, staff
   see the unpaid fee row; a resend is not automated yet (an automatic resend
   after 24 hours needs a new job inside 8 AM–9 PM ET; not built).

## Manual payment (Bookings → Record Reservation Fee)

Staff can record a fee paid outside Stripe (Cash App, Venmo, Zelle, cash). It
is saved as type `fee`, reason `reservation_fee`, so it is credited to week 1
like the card one. An open Stripe fee row for that renter is settled instead of
adding a second, and the renter's open Stripe link is closed (expired) first;
if Stripe shows it already paid, nothing is recorded.

## Old "Reservation Deposit" setting: retired

Retired Nov 16 2026 (card t315s1710). Settings → Deposits no longer shows it,
the booking dialog has no Deposit Required/Amount fields, and nothing carries a
reservation payment into the security deposit any more. The `app_settings`
key `reservation_deposit` (Off) and the `rentals.reservation_deposit_*`
columns stay; no database change.

## Refunds (Nov 17 2026, t406u)

The fee is refunded in full only for the six approved reasons (insurance
declined; no car on the start date; failed pickup inspection; we change
confirmed terms and the driver declines; a check we run after payment
denies them; or a duplicate or mistaken charge). It is not refunded for a
no-show, a change of mind, a missed pickup without notice, or false or
mismatched information from the driver.

See [reservation-fee-refunds.md](reservation-fee-refunds.md). The
Automations switch is Off until turned on. Needs
`proposed/reservation-fee-refunds-v1.sql`.
