# Pickup Checklist And Auto-Activation

Page: `/pickup/<reservation id>` (staff sign-in; linked from the staff
"pickup confirmed" text and email). Built for the field rep's phone.

Checklist (all required to submit):

1. Photo of the renter holding their license (stored as a check-out
   condition photo captioned "Renter holding license").
2. Odometer.
3. Fuel level (E, 1/8 ... F).
4. Renter signature: the renter ticks "I am picking up this vehicle with the
   odometer and fuel level shown above" and types their full name (IP and
   device recorded).

Submitting saves one `pickup_handovers` row per reservation and writes the
audit entry `rental.pickup_checklist_completed`.

## Auto-activation (OFF by default)

`app_settings.pickup_auto_activate` (`proposed/pickup-auto-activate-on.sql`).
When `enabled` is true and a **Manager or Owner** submits the checklist, the
rental starts, with billing, through `activateRentalCore`, the same code as
the Activate Rental button (`activate_rental_checked_tx`), only if:

- the checklist is complete,
- the rental agreement is signed (e-sign, verified paper, or staff check-off,
  the same as the button),
- a card is on file,
- the reservation fee is paid, applied or waived (or none was required),
- no other activation blocker is left. Hard blockers (vehicle not rental-ready,
  no license, not approved, etc.) always stop it. The soft blockers "interview
  not recorded" and "no passed pre-delivery inspection" are covered by the
  checklist only when `override_no_interview` / `override_no_passed_inspection`
  are true. Each one is recorded as an override with the reason "Pickup checklist
  completed by <rep> ..." in the rental.activated audit entry.

Activation uses the reservation's weekly rate (falling back to the
application's weekly rent, then the car's listed rate), its deposit amount,
today's Eastern date and the checklist odometer. Insurance is handled exactly as
the button handles it: it never blocks, and its real status is recorded. Nothing
marks anyone insured or verified.

A Coordinator can fill in the checklist, but a Manager or Owner starts the
rental. If anything is missing, the page says so and staff activate as today.
