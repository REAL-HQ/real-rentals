# FLEET: Send An Updated Agreement To An Active Rental

`send-agreement` is only for an Approved applicant who has never signed. For a
renter whose rental is already **active** (for example, a new weekly rate they
agreed to), FLEET uses this endpoint. Same key and contract as the other FLEET
endpoints (`Authorization: Bearer <FLEET_API_KEY>`, JSON, POST).

`POST https://drivereal.com/api/public/fleet/amend-agreement`

Off until an Owner turns on **Back Office → Automations → Updated Agreements
(FLEET)** (`rental_agreement_amendments`), and it needs
`proposed/rental-rate-amendments-v1.sql` applied. Until then it answers `409
switched_off` or `503 not_installed` and sends nothing.

## Send

```json
{
  "rental_id": "9108ea8c-…",
  "mode": "amendment",
  "new_weekly_rate": 375,
  "effective_date": "2026-11-20",
  "reason": "Weekly rate review; renter agreed to $375/week by text.",
  "renter_consent": {
    "channel": "sms",
    "received_at": "2026-11-16T09:24:00-05:00",
    "quote": "Yes that works for me",
    "message_id": "AC…"
  },
  "terms": {
    "damage_waiver": "declined",
    "payment_schedule": "weekly",
    "payment_method": "Card Autopay",
    "vehicle_owner": "REAL RENTALS LLC"
  },
  "idempotency_key": "amend-9108ea8c-375-1"
}
```

- `rental_id` (required): the active rental.
- `mode`: optional; `"amendment"` if sent.
- `new_weekly_rate` (required): dollars. Must differ from today's rate and be
  **$200–$1,000**. Anything outside that is refused (`409 needs_staff`): staff
  send it from the rental page.
- `effective_date` (optional, `YYYY-MM-DD`): today (Eastern) or later, at most
  90 days out. Never in the past. Omitted: the rental's next rent due date
  (`next_payment_due`), or today if that has passed.
- `reason` (required, 5–1000 characters): why the agreement is changing.
- `renter_consent`: **required for a rate increase** (optional for a decrease).
  - `channel`: `sms` or `call`.
  - `received_at`: when the renter said yes, ISO with a time zone, at most 14
    days old.
  - `quote`: the renter's own words.
  - `sms`: the site checks the text history (`quo_events`) for an inbound text
    on our lines **from the renter's phone**, within 15 minutes of
    `received_at`, **containing `quote`** (case and punctuation ignored). Pass
    `message_id` (the Quo message id) to match that exact text. No match:
    `409 consent_not_found`, nothing stored or sent. If the yes isn't in the
    text log, have staff send it from the rental page.
  - `call`: `call_id` (Quo call id) is required and stored with `quote`.
- `terms` (optional): the v1.14 choices the agreement prints. Each one left
  out is copied from the signed agreement being amended. If that agreement
  did not record it (an agreement older than v1.14), the send is refused
  (`409`, `blockers` names what's missing) until it is given. Nothing is guessed.
  - `damage_waiver`: `accepted` or `declined`.
  - `payment_schedule`: `weekly` or `every_4_weeks`.
  - `payment_method`: `Card Autopay`, `Zelle`, `Cash App`, `Venmo` or `Other`.
  - `vehicle_owner`: the owner name printed on the agreement.
  - There is no Reservation Fee or deposit field: an amendment never has one.
  Authorized drivers carry over from the signed agreement (none if it listed none).
- `idempotency_key` (optional, 1–120 characters): a repeat returns
  `duplicate: true` and sends nothing. If the first try stored the amendment
  but the send failed, the repeat retries the send on the same record.

### What happens, in order (each step must pass)

1. The switch is On, it is **8 AM–9 PM ET**, and the person is **not handed off
   to staff** (`423 staff_handling` while bots are paused).
2. The rental is active and has a current rate; the new rate and effective
   date pass the rules above; a rate increase has verified consent.
3. No other updated agreement is out unsigned for this rental, and no other
   unsigned agreement is out for this renter. (A voided or expired one no
   longer counts.)
4. The agreement the site would print has no missing details (same checks as
   every agreement) and prints the new rate.
5. The change is stored as **pending** (`rental_rate_amendments`, status
   `pending_signature`). The rental, the application, Stripe and billing are
   **not** changed.
6. The updated agreement goes out through the same e-sign flow as every
   agreement (email + text from the 888 line with consent and STOP checked):
   **v1.14** (Vehicle Rental Agreement — Insurance Included, the Owner's
   approved version; the send is refused while v1.14 is not approved), the new weekly rate, and an amendment box at
   the top that says what changed and from when. Title "Rental Agreement
   (Amended)". The previous signed agreement stays on file and is linked
   (`previous_agreement_id`).

Reply `201`:

```json
{
  "ok": true,
  "amendment_id": "…",
  "rental_id": "9108ea8c-…",
  "lead_id": "…",
  "agreement_id": "…",
  "previous_agreement_id": "…",
  "status": "pending_signature",
  "old_weekly_rate": 350,
  "new_weekly_rate": 375,
  "effective_date": "2026-11-20",
  "effective_date_defaulted": false,
  "next_payment_due": "2026-11-20",
  "stripe_update_required": false,
  "consent_verified": true,
  "delivery": { "email": "sent", "sms": "sent", "delivered": true }
}
```

The signing link is never returned. To resend the link, use `resend-link`
with `kind: "signing"` and the `agreement_id`.

### No Reservation Fee, no new deposit, no re-billing

An updated agreement is not a first rental, so (Dolmar, Nov 16 2026):

- It is generated from v1.14 in a no-fee mode: the Reservation Fee is always
  "not required" and the deposit "none", whatever the amended agreement had.
- It never charges or shows a $50 Reservation Fee: the Reservation Fee row
  prints "Not applicable (rental already active)", and the Reservation Fee
  automation and its Stripe Checkout link skip amended agreements entirely.
- It never asks for a new deposit: the deposit line prints "$0 (no new
  deposit; rental already active)". Any deposit already held stays as it is.
- Nothing is due at signing: "Balance Due" (when the template prints it) is
  "$0.00 (rental already active)", and no first-week payment link is sent.
- Already-paid weeks, week 1 included, are never re-priced or billed again.
  The new rate applies only to rent weeks billed after signing: if an earlier
  week is still open (renter behind) or the current week already has a rent
  payment against it, the change waits (`waiting_prior_weeks` /
  `week_in_progress`) and applies from the next unbilled week.
- A template that would still print a Reservation Fee amount blocks the send.

### When the renter signs

- The date the new rate starts (`apply_on`) is fixed: the `effective_date` if
  they signed on or before it; otherwise their next rent due date after
  signing (or the signing day). **Never retroactive**: rent for earlier weeks
  stays at the old rate.
- On `apply_on` (and only once earlier weeks are settled, see above),
  `rentals.weekly_rate` (and the application's weekly rent) change to the new
  rate, once (`apply_rental_rate_amendment`; the 5-minute
  automations job applies future dates). If the rental ended or its rate was
  changed by someone else meanwhile, nothing changes and it is marked
  `conflict` for staff.
- No Reservation Fee and no first-week payment link (it is not a first
  signing). The renter gets an "Updated Agreement Signed" email saying when the
  new rate starts; the team gets the usual signed-agreement email.
- A rental billed by a **Stripe subscription** is flagged
  `stripe_update_required` and audited for staff. The site never changes
  Stripe for an amendment.
- FLEET gets the webhook **`agreement_amendment_signed`** (not
  `agreement_signed_by_renter`, so nothing books a pickup):

```json
{
  "event": "agreement_amendment_signed",
  "amendment_id": "…", "agreement_id": "…", "previous_agreement_id": "…",
  "rental_id": "…", "lead_id": "…",
  "old_weekly_rate": 350, "new_weekly_rate": 375,
  "effective_date": "2026-11-20", "apply_on": "2026-11-20",
  "rate_status": "scheduled",
  "stripe_update_required": false,
  "signed_at": "2026-11-17T16:00:00.000Z"
}
```

`rate_status` is `applied` (in effect now), `scheduled` (starts on `apply_on`),
or `conflict` (staff must review).

## Status

```json
{ "action": "status", "rental_id": "9108ea8c-…" }
```

Reply `200`: `{ ok, rental_id, amendments: [ { id, status, old_weekly_rate,
new_weekly_rate, effective_date, apply_on, agreement_id, previous_agreement_id,
source, requested_by, stripe_update_required, signed_at, applied_at, note,
created_at } ] }`, newest first. `status` is `pending_signature`, `signed`,
`applied`, `conflict`, `voided` or `send_failed`.

## Errors

`400` bad input (rate, date, reason, consent shape), `401` wrong key, `404`
rental or renter not found, `409` refused (switch off, outside hours, not
active, outside $200–$1,000, consent not found, one already out, missing
details, send failed), `423` handed off to staff, `503` not set up or the
database is unavailable. Refusals store and send nothing.

## Staff: Send Updated Agreement

Bookings → an active rental → **Send Updated Agreement** (Manager or Owner).
Same rules and the same server path, with these differences: staff record the
renter's consent themselves (text, call, in person or email; required for an
increase), may send a rate outside $200–$1,000 after ticking a confirmation,
and are not limited by the Automations switch, bot hours or a handoff.

## Audit

`rental.rate_amendment_sent`, `rental.rate_amendment_send_failed`,
`rental.rate_amendment_signed`, `rental.rate_amendment_applied`,
`rental.rate_amendment_conflict`, `rental.rate_amendment_stripe_review`
(entity: the rental), plus the usual `document.created` / `document.sent` /
`document.signed` on the agreement. FLEET's are labelled "FLEET (automated)".

Storage: `public.rental_rate_amendments` and
`public.apply_rental_rate_amendment()` (`proposed/rental-rate-amendments-v1.sql`).
