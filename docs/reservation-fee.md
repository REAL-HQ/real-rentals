# $50 Reservation Fee

Dolmar's decision (Nov 16 2026, SOP D6 and D31): after the renter signs, a $50
Reservation Fee is charged automatically to the card on file. It is applied in
full to week 1, and the car is held only once the fee is paid.

Switch: `app_settings.reservation_fee_auto = {"enabled": true, "amount": 50}`.
OFF with no row. Turn on with `proposed/reservation-fee-auto-on.sql` (not applied).

## What happens when it is on

| Step | Where | What |
| --- | --- | --- |
| Quote | `fleet-assign.server.ts` | FLEET's quote text adds: "A $50 Reservation Fee is charged to your card on file when you sign and applied to your first week." |
| Agreement | `fleet-agreement.server.ts` | FLEET's agreement records a Required $50 Reservation Fee (`merge_data._prep`). |
| Signing | `agreements.functions.ts` → `chargeReservationFeeAfterSigning` | Charged only if the signed text prints a Reservation Fee. Charge row first (`payments` type `fee`, reason `reservation_fee`, one per agreement), one off-session charge, idempotency key per attempt. The pay link email is skipped when the fee path handled the signing. |
| Hold | `holdReservationForFee` | A paid fee marks the reservation `reservation_deposit_status = applied` (never a security deposit) and runs the pickup confirmation. |
| Booking | `fleet-pickup.server.ts`, `createReservationCore` | FLEET cannot book a pickup until the fee is paid. A staff reservation shows the fee as pending until paid. |
| Activation | `rentals.functions.ts` → `applyReservationFeeCredit` | One −$50 Stripe customer balance credit, which Stripe applies to the renter's week 1 invoice. Once per fee. |
| Missed pickup | `late-pickup.server.ts` | Fee kept (marked `kept:late_pickup:<rental>`), never credited or reused. |

## Renter-facing copy (Agreement Signed email)

- Paid: "Your $50.00 Reservation Fee was charged to your card ending in 4242 and is applied in full to your first week. Your car is now held for your pickup."
- Processing: "Your $50.00 Reservation Fee is processing on your card. It is applied in full to your first week, and your car is held as soon as it goes through."
- No card or declined: the usual pay-link email (the fee is not charged; staff see the unpaid row).

## Before turning it on

1. The agreement template in use must print the Reservation Fee. Today there is
   no saved template and the built-in text has no Reservation Fee line, so
   nothing would ever be charged.
2. Approved renters need a saved card. Today none has one.
3. Rent reminders and late fees ignore type `fee`, so the fee never triggers them.
