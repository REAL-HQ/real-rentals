# FLEET / AIVA: Hand A Person To Staff (bots pause)

When a renter or applicant complains, reports an injury or accident, disputes
a payment, raises anything legal, or staff say they are handling someone, the
bot stops and a person takes over.

`POST https://drivereal.com/api/public/fleet/handoff` (Bearer `FLEET_API_KEY`, JSON)

```json
{ "action": "handoff", "lead_id": "…", "reason": "complaint",
  "note": "Says the car pulls left; wants a call.", "source": "fleet",
  "idempotency_key": "handoff-<lead_id>-<quo message id>" }
```

- `lead_id` or `rental_id` (resolved to its application).
- `reason`: `complaint`, `injury`, `accident`, `payment_dispute`, `legal`,
  `staff_handling` or `other`. `note` (5-600 characters) is required.
- `source`: `fleet` (default) or `aiva`; recorded as who decided.

What happens:

1. An open Needs Staff flag is opened in `public.fleet_review_decisions`
   (already installed) with reason `Handoff (<Reason>): <note>` and the
   escalation code `handoff:<reason>`. If the person already has an open flag,
   the code is added to it (one open flag per person).
2. Audited as `application.bot_handoff`.
3. While the flag is open the bots are paused for that person:
   `/fleet/status` reports `next.owner = "staff"`, step `staff_handling`, and
   FLEET's renter-messaging actions (`/fleet/resend-link`) refuse with 423.
   FLEET should also stop its own Quo replies to that person.
4. Only staff clear it: the red banner on the driver profile reads
   "Handoff · Bots Paused, Staff Must Handle", and a Manager or Owner clicks
   **Mark Handled**. There is no FLEET action to clear a handoff.

Reply `201` (new flag) or `200` (added to an open flag, or an idempotent
replay): `{ ok, lead_id, decision_id, bots_paused: true, added_to_open_flag, staff_alert }`.

`{ "action": "status", "lead_id"|"rental_id": "…" }` →
`{ ok, lead_id, bots_paused, handoff: { decision_id, reason, codes, since } | null }`.

## Staff text (off by default)

With `app_settings.fleet_handoff = {"alert_sms": true}`
(`proposed/fleet-handoff-alerts-on.sql`) a new handoff texts the pickup alert
line(s) from the Pickup Schedule defaults (the field rep), from the 888 line:
"REAL RENTALS staff alert: Ana T. was handed off to staff (Injury). Bots are
paused for them until someone marks it handled. <admin link>". It names the
person by first name and last initial and never includes a renter's phone
number. Injuries and accidents text at any hour; everything else only 8 AM to
9 PM ET (otherwise `staff_alert: "quiet_hours"` and the flag waits for
morning). `staff_alert` is `sent`, `off`, `quiet_hours`, `failed` or `not_new`.
