# Refundable $50 Reservation Fee

Dolmar, Nov 17 2026 (t405u / t406u). The Reservation Fee is refunded in full
only for the six reasons below. It is never called a deposit. Copy never names
the insurance broker or carrier.

Needs `proposed/reservation-fee-refunds-v1.sql` (not applied). The Automations
switch **Auto-Refund Reservation On Insurance Decline**
(`auto_refund_reservation_on_insurance_decline`) is **Off** until an Owner
turns it on.

## When it is refunded

1. **Insurance declined** (`insurance_declined`) — we cannot set up the Renter Policy.
2. **No car on the start date** (`no_vehicle`) — and no similar car offered within 1–2 days.
3. **Failed pickup inspection** (`failed_inspection`) — the car cannot be swapped.
4. **We changed the confirmed terms** (`terms_changed`) — weekly rate, start date, or car, and the driver declines.
5. **Denied by a check after payment** (`post_payment_denial`) — including a background check or income review.
6. **Duplicate or mistaken charge** (`duplicate_or_mistaken_charge`).

## When it is not refunded

A no-show, a change of mind, a missed pickup without notice, or information
the driver provided that was false or did not match. A fee already kept for a
late pickup is refused.

## What happens

One idempotent path (`refundReservationFee` in
`src/lib/reservation-fee-refund.server.ts`):

- Issues a Stripe refund on the original Reservation Fee charge (idempotency
  key `reservation-fee-refund:<payment id>`). One refund per payment.
- Writes `reservation_fee_refunds` (who, reason, Stripe refund id, time) and
  an `audit_log` row (`payment.reservation_fee_refunded`).
- Marks the payment refunded and the reservation `reservation_deposit_status`
  `refunded`. Payments and Next Step show **Refunded - &lt;reason&gt;**.
- If the fee was already credited to week 1, the credit is reversed first.
- Enqueues FLEET webhook `reservation_refunded`
  `{ lead_id, application_id, amount, reason, stripe_refund_id }`.

Staff: Payments → **Refund Reservation** on a paid Reservation Fee
(manager/owner). A reason from the list is required; the policy is shown if
none is chosen. A fee not charged through Stripe cannot be refunded here.

FLEET: `POST /api/public/fleet/refund-reservation` (Bearer `FLEET_API_KEY`).
Accepts only the six reason codes. Not gated by the auto-refund switch.

```json
{
  "lead_id": "<application id>",
  "reason": "no_vehicle",
  "note": "optional",
  "idempotency_key": "optional"
}
```

`lead_id` / `application_id`, `rental_id` or `payment_id` is required.
`201` on a new refund, `200 {"already":true}` if it was already refunded.

Auto: when a manager or owner marks the Renter Policy declined (Screening →
Renter Policy), and the switch is On, the same path runs with
`insurance_declined`. Off or unreadable: nothing is refunded automatically.

## Before turning the switch on

1. Apply `proposed/reservation-fee-refunds-v1.sql` (audit table, renter policy
   status column, webhook event name).
2. New agreement sends should use the updated v1.14 Reservation Fee clause.
3. Tell FLEET about the endpoint and the `reservation_refunded` event.
