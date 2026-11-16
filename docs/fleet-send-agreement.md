# FLEET: Send The Rental Agreement

After the phone call, once the applicant has confirmed the terms, FLEET asks the
site to send the rental agreement. Same key and contract as the other FLEET
endpoints (`Authorization: Bearer <FLEET_API_KEY>`, JSON, POST).

`POST https://drivereal.com/api/public/fleet/send-agreement`

```json
{
  "lead_id": "…",
  "idempotency_key": "agreement-<lead_id>-1",
  "terms_confirmation": {
    "confirmed_at": "2026-11-16T15:04:00-05:00",
    "channel": "call",
    "call_id": "AC…",
    "message_id": null,
    "summary": "Confirmed $325/week, no deposit, pickup Wed 11/18, 2021 Camry, weekly autopay.",
    "weekly_rate": 325,
    "deposit": 0,
    "start_date": "2026-11-18",
    "vehicle_id": "…"
  }
}
```

- `lead_id` (or `rental_id`, which resolves to its application).
- `channel` is `call` (needs `call_id`, the Quo call id) or `sms` (needs
  `message_id`, the Quo message id). `confirmed_at` must include a time zone,
  not be in the future, and be at most 7 days old.
- `weekly_rate`, `deposit` (0 if none), `start_date` (YYYY-MM-DD) and
  `vehicle_id` must match exactly what the agreement will print, which comes
  from the applicant's record (weekly rent, or the vehicle's rate; deposit;
  contract start date; assigned vehicle).

What happens, in order (each step must pass):

1. The applicant must be Approved, with no agreement already out or signed.
2. The agreement must have a vehicle, a weekly rate and no other missing
   details (start date, VIN, address, approved template, ...).
3. The confirmed terms must match the agreement. On a mismatch nothing is sent;
   the reply lists `mismatches` and the `agreement_terms` the site would print.
4. The confirmation is stored.
5. The agreement is sent through the same function staff use, by email and
   text, with the company signer from Settings (currently Rosa DeJesus,
   Authorized Representative; FLEET does not change it).

Reply `201`: `{ ok, lead_id, agreement_id, confirmation_id, delivery {email,
sms, delivered}, terms }`. The signing link is never returned. A repeat with the
same `idempotency_key` returns `duplicate: true`; if the first try stored the
confirmation but the send failed, the repeat retries the send.

Errors: `400` bad input, `401` wrong key, `404` not found, `409` refused (not
approved, already out, missing details, mismatch, send failed), `503` not set up
or the database is unavailable.

When the renter signs, FLEET gets `agreement_signed_by_renter` as today.

Storage: `public.agreement_terms_confirmations`
(`proposed/agreement-terms-confirmations-v1.sql`). Audit actions:
`agreement.fleet_sent`, `agreement.fleet_send_failed`, labelled
"FLEET (automated)".

## Confirming by text (YES reply, Dolmar t298s1611)

A YES text reply is enough to send the agreement. FLEET texts the terms from
the line the applicant uses (888 by default), only to applicants with text
consent, using this template (needs Dolmar's OK before first use):

> Real Rentals: Your quote is ready: {vehicle} at ${weekly_rate}/week, {no security deposit | ${deposit} security deposit}, starting {Wed, Nov 18} with pickup at 3500 E Hillsborough Ave, Tampa, FL 33610. Rent is paid weekly.{ After you sign, you'll pay a $50 Reservation Fee by card to hold the car. It is applied to your first week, and that card is saved on file for your rental balance.} Reply YES to accept and we'll send your rental agreement to sign. Reply STOP to opt out.

The weekly rate includes `(includes ${surcharge}/week for your insurance quote)` when the insurance quote is over $350/month (docs/fleet-assign-vehicle.md), and the Reservation Fee sentence appears only while `reservation_fee_auto` is on (docs/reservation-fee.md). The Reservation Fee is never called a deposit; "security deposit" is only the per-car deposit. `/fleet/assign-vehicle` returns the exact text as `quote_text`.

When the YES arrives (FLEET gets it as `quo_message_received`), call
send-agreement with `channel: "sms"`, `message_id` = the Quo message id of the
YES (`quo.resource_id` in the event), `confirmed_at` = when it arrived, and
`summary` = the terms text it answered. The site checks, before anything is
stored or sent:

- the id is an inbound `message.received` text logged on our lines (`quo_events`);
- it came from this applicant's phone number (last 10 digits);
- it reads as a plain YES (yes, y, yep, ok, confirmed, I agree, ...) with no
  question mark or "no / not / wait / change / stop / how / what" in it;
- it arrived within the last 7 days and within 10 minutes of `confirmed_at`.

Anything else is refused (`409`, or `400` for the time) and nothing is sent:
ask again, or hand it to staff. A call confirmation works as before.
