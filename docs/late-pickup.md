# Late Pickup Release

Dolmar's decision (Nov 16 2026, SOP D25): a renter 15+ minutes late to pickup
loses the reservation; the $50 Reservation Fee is kept.

Switch: "Late Pickup Release" (`late_pickup_release`) in Back Office →
Automations, OFF by default. Runs every 5 minutes inside
`/api/public/cron/renter-reminders` (needs `proposed/renter-reminders-v1.sql` and
`proposed/team-alerts-v1.sql`; without the team alert table nothing is released).

## Rule

For each Reserved rental with pickup today (Eastern) whose pickup time was
15 minutes to 6 hours ago and with **no pickup checklist started**:

1. Claimed once (`renter_reminder_sends` key `late_release:<rental>`).
2. Rental → cancelled; car → Available if nothing else holds it; the
   applicant's car assignment is cleared so FLEET can offer it to the next person.
3. A paid Reservation Fee stays paid and is marked kept.
4. Staff: one team alert (email team@drivereal.com and a text to the field rep).
   "Pickup Released: <name> was 15+ minutes late (10:00 AM ET)".
5. Renter: one text from the main line, 8 AM–9 PM ET only (pickups are always
   inside that window); email when they cannot get texts.

The field rep stops a release by starting the pickup checklist before the 15
minutes are up.

## Renter text (DRAFT, needs Dolmar's OK)

> Real Rentals: We held your car until 15 minutes after your 10:00 AM ET pickup, and it has now been released. Your $50 Reservation Fee is non-refundable for a missed pickup. To rebook, reply here or call (888) 833-8280. Reply STOP to opt out.

(Without a paid fee the fee sentence is left out.)

Email subject: "Your REAL RENTALS Pickup Was Released", same wording.

## Also

With the Reservation Fee switch on, the same job marks a reservation held once
a fee that was still processing at signing has been paid.
