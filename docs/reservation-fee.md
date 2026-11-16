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
| Signing | `agreements.functions.ts` → `chargeReservationFeeAfterSigning` | Only if the signed text prints a Reservation Fee. The charge row is written first (`payments` type `fee`, reason `reservation_fee`, one per agreement). **No card on file (the normal case):** a per-renter Stripe Checkout (24 hours) for the $50 with `setup_future_usage: off_session`, sent as a "Pay $50.00 Reservation Fee" button in the Agreement Signed email. **A card already on file (a returning renter):** one off-session charge, idempotency key per attempt. No other pay link is sent when the fee path handled the signing. |
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
- Paid (card on file): "Your $50.00 Reservation Fee was charged to your card ending in 4242 and is applied in full to your first week. Your car is now held for your pickup."
- Processing: "Your $50.00 Reservation Fee is processing on your card. It is applied in full to your first week, and your car is held as soon as it goes through."
- Card payments not configured or a decline: the usual pay-link email (the fee is not charged; staff see the unpaid row).

## Before turning it on

1. The agreement template in use must print the Reservation Fee (and the
   30-minute late-pickup clause). Today there is no saved template and the
   built-in text has no Reservation Fee line, so nothing would ever be charged.
2. Rent reminders and late fees ignore type `fee`, so the fee never triggers them.
3. The Checkout link expires after 24 hours. If the renter does not pay, staff
   see the unpaid fee row; a resend is not automated yet.
