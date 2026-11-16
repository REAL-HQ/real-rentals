# GPS Alerts To A Person (Dolmar, t299s1618; SOP D18)

Three alerts reach a person (one email to team@drivereal.com and one text to
the field rep, +18134768508):

| Alert | Rule (src/lib/gps-alerts.ts) |
| --- | --- |
| Outside service area | The car is more than 100 miles from Tampa (measured from the shop, 3500 E Hillsborough Ave), Dolmar t311u. A reading with only an address counts as outside when its state is not Florida. |
| Tracker offline | No report for 24 hours, or the tracker says no power / not reporting. |
| No movement for 48 hours | A car on an active rental has been stopped 48 hours or more. |

One alert per car, rule and Eastern day. The alert says what the tracker
showed and that nothing was done to the car.

## What exists today

- The app has tracker fields on each car (`vehicles.gps_provider`,
  `gps_device_id`, `gps_last_ping_at`, `gps_last_location`, `gps_status`, ...),
  but they are all empty (Nov 16, 2026: 0 of 11 cars), and nothing in the app
  talks to the tracker provider.
- The tracker data comes from FLEET's twice-daily tracker check (read-only,
  through the provider's web map).

## How readings get in (built, dry run until switched on)

`POST /api/public/fleet/gps-readings` (Bearer `FLEET_API_KEY`):

```json
{ "collected_at": "2026-11-15T20:11:00-05:00",
  "readings": [{ "device": "CZ06DA - ...", "last_report_at": "2026-11-14T12:05:55-05:00",
                 "stopped_since": "2026-11-14T12:05:55-05:00", "moving": false,
                 "address": "1 Davis Islands Brg, Tampa, FL 33606", "lat": 27.93, "lng": -82.45,
                 "status_text": "Stopped 1 d 8 h" }] }
```

- A reading is matched to a car by `vehicle_id`, then `vehicles.gps_device_id`,
  then the plate at the start of the tracker label (letter O and zero are
  treated the same: the app has `CZO6DA`, the tracker shows `CZ06DA`).
  Labels with no plate (`#1`, `8/26 #2`) come back in `unmatched`.
- Switch: `app_settings.team_alerts.gps` (**off**). While off the call is a dry
  run: it returns `findings` and writes or sends nothing. On: it stores the
  latest reading on the car (never the tracker label, which can carry a
  renter's name) and sends the alerts.

## What is needed to turn it on

1. FLEET's tracker check posts each reading to the endpoint above (a change to
   that routine's instructions; no new access).
2. Staff label the two unlabelled trackers (`#1`, `8/26 #2`) with the plate, or
   fill `gps_device_id` on those cars.
3. Done: Dolmar confirmed the service area (100-mile radius of Tampa, t311u),
   the offline window (24 hours with no signal) and that FLEET posts the readings (card t310s1681).
4. `proposed/team-alerts-v1.sql`, then the `gps` line in `proposed/team-alerts-on.sql`.

Better later: the tracker provider's API (an API key from the account owner)
so the site can poll every 15 minutes instead of twice a day. Not built.
