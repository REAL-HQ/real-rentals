# FLEET: Get The $50 Reservation Fee Link

`POST https://drivereal.com/api/public/fleet/reservation-fee-link` (Bearer `FLEET_API_KEY`, JSON)

```json
{ "lead_id": "<application uuid>", "reason": "optional note for the audit log" }
```

Same action as the staff **Copy Reservation Fee Link** menu item. Needs a signed
agreement (not an amendment) that prints the Reservation Fee. Returns the Stripe
Checkout link; **sends nothing** (`send: true` is refused with 400 for now).

Idempotent: while the Checkout is open (under 23 hours) the same link and
session are returned (`reused: true`); a new one is created only after expiry,
on the same unpaid fee row. A paid fee is never charged twice.

Success: `{ ok, url, session_id, expires_at, amount, reused, agreement_id, lead_id, sent:false }`
Refused: `409` (no signed agreement with a fee, already paid, processing, fee turned off), `502` (Stripe could not create it), `400`, `401`, `503`.
Audit: `payment.reservation_fee_link_fleet` (FLEET automated, session id, reused).
The link is a payment secret: send it only to that renter through the approved email/text path.
