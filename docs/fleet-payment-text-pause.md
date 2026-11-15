# FLEET: Pause A Renter's Payment Texts

When a renter makes a payment deal, FLEET can pause the app's automatic payment
notices to that renter until a date. That covers rent reminders (heads-up, due,
overdue, daily), the Payment Failed Text and the Stripe failed-payment email.

A pause changes nothing else. Nothing owed changes, no late fee is waived,
Stripe is untouched, and staff texts, receipts and team alerts still go out.
Notices start again after `pause_until`.

## Endpoint

`POST https://drivereal.com/api/public/fleet/payment-text-pause`

Headers: `Authorization: Bearer <FLEET_API_KEY>`, `Content-Type: application/json`

### Pause

```json
{ "action": "pause", "phone": "+18135550142", "pause_until": "2026-11-21",
  "reason": "Deal: $1,050 by 11/21, late fees waived if paid in full",
  "requested_by": "Dolmar", "idempotency_key": "deal-2026-11-15-damon" }
```

- Identify the renter with exactly one of `rental_id`, `lead_id` or `phone`. It must match one active rental, or the request is refused with 404 or 409.
- `pause_until`: `YYYY-MM-DD` means 11:59:59 PM Eastern that day. A full timestamp must include its zone. It must be in the future and at most 45 days out.
- `reason` is required, 5 to 500 characters.
- `idempotency_key` is optional. A repeat with the same key returns the first pause (`duplicate: true`) and creates nothing new.
- Reply `201`: `{ ok, pause_id, rental_id, lead_id, pause_until, pause_until_et }`.

### Status

`{ "action": "status", "phone": "+18135550142" }` replies with `{ ok, rental_id, lead_id, paused, pause_id?, pause_until?, reason? }`.

### Cancel (lift early)

`{ "action": "cancel", "pause_id": "…", "reason": "Paid in full" }` replies with `{ ok, pause_id, cancelled_at }`.

### Errors

| Status | Meaning |
|---|---|
| 400 | Bad input |
| 401 | Wrong key |
| 404 | No match |
| 409 | Ambiguous renter, or the idempotency key was used for another rental |
| 503 | Not configured, or the database is unavailable |

Every create and cancel is written to the audit log as done by "FLEET (automated)".

## Storage

Table `public.payment_text_pauses`, with columns `rental_id`, `application_id`,
`starts_at`, `pause_until`, `reason`, `source` (`staff` | `fleet`),
`created_by`, `idempotency_key`, `cancelled_at`, `cancelled_by` and
`cancel_reason`. Only the server writes to it, and staff can read it.
FLEET uses the endpoint, not the table.
