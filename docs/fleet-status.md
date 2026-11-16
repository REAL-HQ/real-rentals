# FLEET: Status, Journey And Balance (read-only)

One endpoint for "where is everybody, and who has to act next?".
Same contract as the other FLEET endpoints: `POST`, JSON body,
`Authorization: Bearer <FLEET_API_KEY>`, `Cache-Control: no-store` replies.
It writes nothing, sends nothing and mints no links.

`POST https://drivereal.com/api/public/fleet/status`

## `{ "action": "digest" }`

The whole journey on one page (names and ids only, no phone numbers):

| field | what |
|---|---|
| `stages` | open applications by status (`partial`, `new`, `reviewing`, `complete`, `approved`, `active`) |
| `queues.ready_for_review` | applicants FLEET can review now (same rule as `/fleet/applicants`) |
| `queues.needs_staff` | open Needs Staff flags, oldest first (`lead_id, name, reason, since`) |
| `queues.approved_no_vehicle` | approved, no car yet → `/fleet/assign-vehicle` |
| `queues.approved_no_agreement` | approved with a car, no agreement → confirm terms, `/fleet/send-agreement` |
| `queues.agreements_unsigned` | sent/viewed agreements with `hours_since_sent` and email/text delivery status → `/fleet/resend-link` |
| `queues.signed_no_pickup` | signed, no reservation → `/fleet/pickup-slots` |
| `queues.pickups_next_2_days` | reserved pickups today through 2 days out (Eastern) |
| `rentals.active`, `rentals.autopay` | active rentals, how many on autopay |
| `rentals.past_due` | active rentals with overdue rent (`overdue_owed`, `late_fees_owed`, `oldest_due`) |
| `rentals.failed_payments_7d` | unpaid rows whose last attempt failed in the last 7 days |
| `rentals.open_balance_total` | everything still owed |
| `rentals.returned_with_balance` | closed rentals with a return balance |
| `webhooks_24h` | FLEET webhook deliveries by status |
| `staff_actions` | what a person has to do now: Needs Staff, pickup handovers, insurance verification, return balances |

Lists are capped at 25 rows; counts are exact.

## `{ "action": "lead", "lead_id": "…" }`

One renter's journey:

- `steps`: `applied`, `contacted`, `documents` (with `missing`), `approved`,
  `vehicle_assigned`, `agreement_sent`, `agreement_signed`, `reservation_fee`
  (`paid | waived | not_required | due | unknown`), `pickup_booked`,
  `card_on_file`, `insurance` (always `owner: "staff"`), `active`.
- `next`: `{ step, owner, detail, api }`. `owner` is `fleet` (an endpoint
  exists; `api` names it), `renter` (waiting on them), `staff` (a person must
  act) or `none` (declined, closed, duplicate, deleted). An open Needs Staff
  flag or a staff-handling pause always makes the owner `staff`.
- `agreement` (latest live one: status, sent/viewed/signed times, link expiry,
  email and text delivery status), `rental`, `balance` (as below),
  `needs_staff`, `bot_pause`, `last_inbound` (last Quo event), `last_outbound`.

## `{ "action": "balance", "rental_id": "…" }` (or `"lead_id"`)

With `lead_id` the active rental is used, else the newest one.
Reply: `rental_id, lead_id, rental_status, weekly_rate, autopay, card_last4,
payment_status, next_payment_due, total_owed, overdue_owed, late_fees_owed,
return_balance, oldest_overdue_due_date, failed_attempts, open_rows[]`
(`payment_id, type, due_date, status, amount, late_fees, owed, failure_reason,
attempts, invoice_url`). A row owes its `balance_due` when set, else
`amount + late_fees`; paid, void, refunded, cancelled and waived rows owe
nothing. Overdue means due before today's Eastern date.

Charging, waiving and payment deals stay with staff. A deal's text pause is
`/api/public/fleet/payment-text-pause`.

Errors: `400` (bad action or id), `401`, `404`, `405` (not POST), `503`
(key not configured or a read failed).
