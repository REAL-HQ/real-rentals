# Pickup Schedule, FLEET Booking And Confirmed Reservation Alerts

## Schedule (Settings → Rental Terms → Pickup Schedule)

Stored in `app_settings` under `pickup_schedule`. Without a saved row the
defaults apply:

| Setting | Default |
| --- | --- |
| Days | Monday to Friday |
| Start times (Eastern) | 9:30, 10:30, 11:30 AM |
| Slot length | 60 minutes (start times must be at least this far apart) |
| Minimum notice | 120 minutes |
| Booking window | 14 days |
| Default pickup location | none (staff type it; FLEET must send one until it is set) |
| Field rep | Dolmar Cross |
| Confirmed reservation alerts | **Off** |
| Text to | +18134768508 |
| Email to | DolmarCross@gmail.com, Team@DriveReal.com |
| Require a signed agreement | On |

One booking per slot: a slot is taken by any rental with status Reserved
on that date and pickup time. The app checks before saving, and
`proposed/pickup-schedule-v1.sql` adds a unique index
(`rentals_one_reserved_per_pickup_slot`) so two saves at the same moment
cannot both win. A cancelled reservation frees its slot.

Reserved dialog (Bookings → Booked, and Next Step): shows the open slots,
earliest first, preselects the earliest, shows the field rep, and fills the
default location. Staff can still type any date and time.

## FLEET: `POST /api/public/fleet/pickup-slots`

Same contract as the other FLEET endpoints (`Authorization: Bearer <FLEET_API_KEY>`).

List:

```json
{ "action": "list", "days": 14, "limit": 20 }
```

`200 { ok, schedule { timezone, days, start_times, slot_minutes, min_notice_minutes, field_rep { name } }, slots: [{ date, time, start_at, end_at, label }] }`

Book:

```json
{ "action": "book", "lead_id": "…", "start_at": "2026-11-18T09:30:00-05:00",
  "vehicle_id": "… (optional, defaults to the applicant's assigned vehicle)",
  "pickup_location": "… (optional, defaults to Settings)", "note": "optional",
  "idempotency_key": "optional" }
```

`201 { ok, rental_id, lead_id, vehicle_id, pickup { date, time, start_at, label, location, field_rep }, login_email }`.
Booking uses the same code as staff Reserved (`createReservationCore`):
Approved or Active only, the car must be free, one reservation per person,
the deposit follows Settings → Deposits, and the Booking Login Email follows
its automation switch. FLEET may book only a slot on the schedule that is
still open. Repeating the same booking returns `duplicate: true`.
Errors: `400` bad input, `401`, `404` unknown lead, `409` not approved / not a
slot / taken or too soon (with `next_open`) / no vehicle / other reserve
refusals, `503`.

## Fully confirmed (`reservation_confirmed`)

A reservation is fully confirmed when all are true:

1. the rental is Reserved (`rentals.status = 'reserved'`);
2. the applicant is Approved or Active;
3. a pickup date, time and location are set;
4. the reservation deposit is not pending (not required, paid, waived or applied);
5. the rental agreement is signed and not voided (setting; On by default).

It is checked after a reservation is saved (staff or FLEET), after a
reservation deposit is recorded, after the renter signs, and every minute by
the fleet-webhooks cron as a safety net.

On the first confirmation of a rental:

- FLEET gets `reservation_confirmed` (dedupe `reservation_confirmed:<rental id>`):
  `{ event, lead_id, rental_id, renter_name, vehicle { id, label, plate, unit_number },
  pickup { date, time, start_at, timezone, label, location }, field_rep { name },
  deposit { required, amount, status }, agreement { id, signed_at }, admin_url }`.
- A `reservation_confirmations` row is written. Only if the alerts setting is
  On: a text from the main business line to each "Text to" number and one
  email to the "Email to" list, with the renter, vehicle, pickup date and time,
  location and an admin link. A confirmation reached while alerts are Off is
  recorded as `off` and never sent later.

Migration: `proposed/pickup-schedule-v1.sql` (index, `reservation_confirmations`,
event allowed). Until it runs, the event is refused by the database check
(logged, nothing sent) and no alert is sent.
