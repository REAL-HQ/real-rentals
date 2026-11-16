# FLEET: Assign A Car

After approval, FLEET puts an available car on the applicant at that car's
listed rate, earliest available first (Dolmar, t298s1611). The agreement and
the pickup booking both use the assigned car.

`POST https://drivereal.com/api/public/fleet/assign-vehicle` (Bearer `FLEET_API_KEY`, JSON)

List: `{ "action": "list" }` → `{ ok, vehicles: [{ vehicle_id, vehicle, color,
unit_number, weekly_rate, deposit, available_since }] }`, earliest available
first (the car whose last rental ended longest ago; never rented first; then
oldest in the fleet).

Assign:

```json
{ "action": "assign", "lead_id": "…", "vehicle_id": "optional (default: first in the list)",
  "start_date": "2026-11-18", "idempotency_key": "optional" }
```

- Approved applicants only. Sets `vehicle_id`, `weekly_rent` (the car's listed
  weekly rate), `deposit_amount` (the car's listed deposit, $0 when none is
  listed) and, when sent, `contract_start_date`.
- `start_date` is the pickup day and the agreement's start date. It must be a
  day with an open pickup slot in the next 30 days (weekday, not a holiday or
  blocked date). Book the pickup on that same day.
- One car, one person: Available, not archived, a listed weekly rate, no
  Reserved or Active rental, and not assigned to another Approved applicant.
  The write only happens while the applicant has no car, is re-checked, and
  `proposed/fleet-assign-vehicle-v1.sql` adds a unique index.
- An applicant who already has this car: `200 duplicate: true` (a new
  `start_date` updates the start date). A different car: `409` (staff change it).

Reply `201 { ok, lead_id, vehicle_id, vehicle, weekly_rate, deposit, start_date, next }`.
Errors `400`, `401`, `404`, `409` (not approved, no free car, car taken, closed
day, already has another car), `503`.

Nothing here reserves the car, sends anything, or touches insurance,
screening or verification. Audit: `application.fleet_vehicle_assigned`.

## Order FLEET follows

1. `applicant-decision` approve.
2. `license-facts` (date of birth, expiry, license number, state) if not done.
3. `assign-vehicle` assign with `start_date` = the pickup day.
4. Text the terms; on YES, `send-agreement` with `channel: "sms"`.
5. `pickup-slots` book a slot on `start_date`.
