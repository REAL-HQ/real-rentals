# FLEET API: Every Endpoint

All endpoints: `POST`, JSON body, `Authorization: Bearer <FLEET_API_KEY>`
(compared in constant time; under 24 characters means "not configured", `503`),
`Cache-Control: no-store` JSON replies. Every write is audited as
"FLEET (automated)". FLEET may decline (`applicant-decision`, reason required;
the decline email and text send unless `skip_notify` is true) and may append
profile notes (`profile-note`, or `note` on a decision). FLEET never marks
anyone insured or verified, and never touches billing. Renter
texts the site sends go from the 888 line, 8 AM to 9 PM ET, with consent and
STOP checked.

Base: `https://drivereal.com/api/public/fleet/`

| endpoint | does | doc |
|---|---|---|
| `status` | read: whole-journey digest, one lead's journey and next step, lookup by any phone/email, a renter's balance | [fleet-status.md](fleet-status.md) |
| `applicants` | read: review queue and one applicant's review packet | [fleet-applicant-review.md](fleet-applicant-review.md) |
| `applicant-decision` | approve (no hard blockers), decline (reason required; `skip_notify` skips the email and text), or needs_staff | [fleet-applicant-review.md](fleet-applicant-review.md) |
| `profile-note` | append a note on the driver profile, attributed to FLEET | [fleet-applicant-review.md](fleet-applicant-review.md) |
| `license-facts` | save DOB / expiry / number / state read off the license photo (never "verified") | fleet-license-facts.md (PR 376) |
| `screening-result` | record a RentID result (license status, criminal record) onto background_check_status / mvr_status; OFF until app_settings.fleet_rentid.record_results | fleet-rentid.md |
| `background-report` | file a background report entry (RentID order/result with case list, FL DMV license check, or other provider) with any number of files onto the driver's Screening tab (`background_reports`); a record, never a decision; OFF until Automations → Background Reports (FLEET); files also need Document Uploads (FLEET) | background-reports.md |
| `assign-vehicle` | list available cars; put one on an approved applicant at its listed rate | fleet-assign-vehicle.md (PR 377) |
| `send-agreement` | send the agreement after the renter confirmed terms (call or YES text) | [fleet-send-agreement.md](fleet-send-agreement.md) |
| `amend-agreement` | send an updated agreement to an ACTIVE rental (e.g. a new weekly rate the renter agreed to); generated from v1.14 with no Reservation Fee or new deposit; the rate changes only after they sign (switch, Off) | [fleet-amend-agreement.md](fleet-amend-agreement.md) |
| `driver-document` | file a document onto a driver's profile, team only, never verified (switch, Off) | [below](#driver-document) |
| `insurance-card` | hand over an insurance ID card found in team@ Gmail (Inbox or Spam) for Fleet Inbox to read; filed to a renter only on an exact VIN + name match, never verified (switch "Insurance ID Cards To Portal", On) | [renter-insurance-cards.md](renter-insurance-cards.md) |
| `insurance-applied` | check off Insurance Quote as Applied (yellow) on an approved applicant once insurance is applied for; one audit row, never a checkmark or insurance verification; the uploaded quote (`driver-document`, category insurance_quote) turns it green | [fleet-insurance-applied.md](fleet-insurance-applied.md) |
| `pickup-slots` | open pickup slots; book one | [fleet-pickup-schedule.md](fleet-pickup-schedule.md) |
| `resend-link` | resend the signing link or the missing-files upload link (switch, Off) | [fleet-resend-link.md](fleet-resend-link.md) |
| `handoff` | hand a person to staff (complaint, injury, payment dispute, ...); bots pause | [fleet-handoff.md](fleet-handoff.md) |
| `missing-items` | preview / run the one-time missing-items message | [missing-items-outreach.md](missing-items-outreach.md) |
| `payment-text-pause` | pause rent texts for an approved payment deal; status; cancel | [fleet-payment-text-pause.md](fleet-payment-text-pause.md) |
| `refund-reservation` | refund a paid Reservation Fee for one of the six refundable reasons (idempotent; one per fee) | [reservation-fee-refunds.md](reservation-fee-refunds.md) |
| `reservation-fee-link` | get the $50 Reservation Fee Checkout link for a signed applicant (reuses the open one; sends nothing) | [fleet-reservation-fee-link.md](fleet-reservation-fee-link.md) |
| `vehicle-maintenance` | read: mileage log, oil next service due, monthly inspection and its history | [below](#vehicle-maintenance) |
| `mileage-reading` | append one mileage log entry, optional photo (switch, Off) | [below](#mileage-reading) |
| `service-due` | set the next oil service due miles and date (switch, Off) | [below](#service-due) |
| `monthly-inspection` | set monthly inspection last done, next due, notes, and one photo (switch, Off) | [below](#monthly-inspection) |

Events the site sends FLEET (signed webhooks): [fleet-webhooks.md](fleet-webhooks.md).

## What FLEET still cannot do (staff only, by design)

- Close or reopen an application; clear a Needs Staff flag or a handoff.
  Decline is `applicant-decision` with `decision: "decline"`.
- Run or record a background check or MVR; verify insurance; verify a license.
- Charge or waive anything, or refund anything except a paid Reservation Fee
  through `refund-reservation` (six refundable reasons only; one refund per
  fee). Change a rate directly. (A new rate for an active rental goes only
  through `amend-agreement`: it is pending until the renter signs the updated
  agreement, and Stripe is never changed by FLEET except for that Reservation
  Fee refund.)
- Propose a weekly rate outside $200–$1,000 (staff only).
- Complete the pickup checklist, activate a rental, record a return, end a rental.
- File a signed agreement or a rental application (eSign and staff only), or
  verify, approve or reject any document.

## driver-document

`POST https://drivereal.com/api/public/fleet/driver-document`. Off until the
Automations switch **Document Uploads (FLEET)** (`fleet_document_uploads`) is On;
while Off: `409 {"reason":"switched_off"}`, nothing saved.

```json
{
  "lead_id": "<application id>",
  "category": "other",
  "file_name": "REAL RENTALS AGREEMENT.pdf",
  "content_base64": "<the file, base64; a data: prefix is accepted>",
  "label": "Original v1.13 agreement (superseded)",
  "expires_at": "2029-01-21",
  "idempotency_key": "doc-<lead_id>-1"
}
```

- `category`: `license_front`, `license_back`, `insurance`, `gig_profile`,
  `income`, `insurance_quote`, `screening`, `trip_history`, `other` (the staff
  upload categories). `agreement` and `rental_application` are refused (eSign
  and staff only); `verification_recording` is Owner only. An old or paper
  agreement goes under `other` with a `label`: `other` is multi-file, replaces
  nothing and never counts as the current signed agreement.
- `label` optional, up to 140 characters. `expires_at` optional, only for
  `license_front`, `license_back`, `insurance` (`YYYY-MM-DD`).
- The type is read from the file's bytes: PDF, JPEG, PNG, WebP or HEIC, up to
  20 MB decoded (`415` / `413` otherwise). The name and any claimed type are
  not trusted.
- Saved exactly like a staff upload: bucket `driver-docs`, path
  `<lead_id>/internal/<category>-<uuid>.<ext>`, documents row with
  visibility team only (`["admin"]`), `review_status` "uploaded". Nothing is
  verified or approved, nothing on the application changes and the driver is
  not told. A new file in a single-file category (e.g. `license_front`)
  replaces the current one like a staff upload, except a file staff already
  verified is never replaced (`409 {"reason":"verified_on_file"}`).
- Idempotent: the same `idempotency_key`, or the same bytes for the same driver
  and category, returns `200 {"duplicate":true,"document_id":…}` without saving
  again. A key reused for a different file is `409`.
- Audited as `document.fleet_upload` (category, label, sha256, size, key).

Reply `201`:

```json
{ "ok": true, "lead_id": "…", "document_id": "…", "category": "other",
  "label": "…", "file_name": "…", "mime_type": "application/pdf",
  "size_bytes": 123456, "sha256": "…", "visibility": ["admin"],
  "review_status": "uploaded", "verified": false, "next": "…" }
```

## vehicle-maintenance

`POST https://drivereal.com/api/public/fleet/vehicle-maintenance`. Read only.
The Vehicle Maintenance (FLEET) switch does not gate this read.

`POST /api/public/fleet/gps-readings` is the GPS alert feed. It does not
read or write this mileage log.

```json
{ "vehicle_id": "ca3d2cc6-0144-4efa-b0d6-5091b27db254" }
```

`license_plate` may be sent instead of `vehicle_id` (letters and numbers,
matched ignoring case). Send both only when they name the same car.

Reply `200` (the unit number and the full VIN are not included):

```json
{
  "ok": true,
  "vehicle": {
    "id": "ca3d2cc6-0144-4efa-b0d6-5091b27db254",
    "license_plate": "EC20LK",
    "vin_last6": "……",
    "year": null,
    "make": null,
    "model": null,
    "current_odometer": null,
    "odometer_updated_at": null
  },
  "mileage_log": [
    {
      "id": "…",
      "observed_on": "2026-11-23",
      "mileage": 163977,
      "source_type": "manual",
      "source_label": "FLEET · Manual",
      "note": null,
      "status": "valid",
      "document_id": null,
      "has_photo": false
    }
  ],
  "mileage_log_truncated": false,
  "next_service_due": {
    "item": "Oil Change",
    "schedule_id": "…",
    "next_due_miles": 166869,
    "next_due_on": null,
    "interval_miles": 5000,
    "last_done_on": null,
    "last_done_miles": null,
    "notes": null
  },
  "monthly_inspection": {
    "item": "Monthly Inspection",
    "schedule_id": null,
    "interval_days": 30,
    "last_done_on": null,
    "next_due_on": null,
    "notes": null,
    "history": [],
    "history_truncated": false
  }
}
```

`mileage_log` is the newest 100 `odometer_readings` (`mileage_log_truncated`
when more exist). `status` is `valid`, `conflict`, or `superseded`. Current
mileage on the vehicle is the newest valid reading; this call does not
change it. `history` is the newest 50 Monthly Inspection rows.

## mileage-reading

`POST https://drivereal.com/api/public/fleet/mileage-reading`. Off until
Automations → **Vehicle Maintenance (FLEET)** (`fleet_vehicle_maintenance`);
while Off: `409 {"reason":"switched_off"}`, nothing saved. Appends one
`odometer_readings` row through the same writer staff use. It does not set
`vehicles.current_odometer` itself; the database trigger does, from the
newest valid reading.

```json
{
  "vehicle_id": "ca3d2cc6-0144-4efa-b0d6-5091b27db254",
  "license_plate": "EC20LK",
  "observed_on": "2026-11-23",
  "mileage": 163977,
  "note": "Shop reading",
  "source_type": "manual",
  "file_name": "odometer.jpg",
  "content_base64": "<optional photo, base64; a data: prefix is accepted>",
  "idempotency_key": "ec20lk-2026-11-23-odometer"
}
```

- `observed_on`: `YYYY-MM-DD`, not in the future (Eastern Time). `mileage`:
  whole miles, 0 through 1,999,999.
- `source_type`: `manual` (default), `odometer_photo`, `inspection`, or
  `other`. A photo forces `odometer_photo` unless `source_type` is
  `inspection` or `other`. `odometer_photo` without a photo is `400`.
  Rental pickup and return readings are not accepted here.
- Photo, when sent: type is read from the bytes (JPEG, PNG, WebP, or HEIC),
  up to 20 MB decoded (`415` / `413` otherwise). One photo per call. Stored
  in the private `vehicle-docs` bucket, team only (`visibility` `["admin"]`),
  `document_id` on the reading. The same bytes for the same vehicle are not
  stored twice.
- `note` optional, up to 500 characters.
- Idempotent on `idempotency_key`: the same key and the same vehicle, date,
  and mileage return `200 {"duplicate":true}` and do not append again. A key
  reused for a different reading is `409`.
- A reading that drops more than 500 miles below an earlier valid reading is
  stored with `status` `conflict` for staff review. It does not become the
  current mileage until staff mark it valid.
- Audited as `fleet.mileage_reading`.

Reply `201`:

```json
{
  "ok": true,
  "duplicate": false,
  "vehicle_id": "…",
  "license_plate": "EC20LK",
  "vin_last6": "…",
  "reading_id": "…",
  "observed_on": "2026-11-23",
  "mileage": 163977,
  "source_type": "manual",
  "note": "Shop reading",
  "status": "valid",
  "document_id": null,
  "has_photo": false
}
```

## service-due

`POST https://drivereal.com/api/public/fleet/service-due`. Same switch as
`mileage-reading` (Off until On). Sets the Oil Change row on
`maintenance_schedules`: `next_due_miles` and `next_due_on`. It does not
invent `last_oil_change_miles`. A new row uses the vehicle's
`oil_interval_miles`, or 5000 when that is empty. Send `interval_miles` to
set a different interval (1 through 200,000).

```json
{
  "license_plate": "EC20LK",
  "next_due_miles": 166869,
  "next_due_on": "2026-12-15",
  "notes": null,
  "interval_miles": 5000,
  "idempotency_key": "ec20lk-next-oil"
}
```

- At least one of `next_due_miles` and `next_due_on`. Omit a field to leave
  it unchanged. Send `null` to clear it. `next_due_on` is `YYYY-MM-DD` and
  may be in the future. `notes` optional, up to 2,000 characters.
- Until migration `20261123120100_maintenance_schedule_explicit_next_due.sql`
  is applied, a later update that also has a last service date or mileage
  recomputes the next due as last service plus the interval. With no last
  service on the row, the miles and date are stored as sent either way.
  Apply that file with `supabase db push` or the Supabase SQL editor after
  review. Do not seed rows.
- Idempotent on `idempotency_key` for the same vehicle and the same requested
  miles and date. A key reused for a different due is `409`.
- Audited as `fleet.service_due`. Sends nothing to the renter.

Reply `201` when the oil row is created, `200` when it is updated:

```json
{
  "ok": true,
  "duplicate": false,
  "vehicle_id": "…",
  "license_plate": "EC20LK",
  "vin_last6": "…",
  "schedule_id": "…",
  "item": "Oil Change",
  "next_due_miles": 166869,
  "next_due_on": "2026-12-15",
  "interval_miles": 5000,
  "notes": null
}
```

## monthly-inspection

`POST https://drivereal.com/api/public/fleet/monthly-inspection`. Same switch
(Off until On). One Monthly Inspection schedule per vehicle, interval 30
days, plus a history row on `maintenance_records` when `last_done_on` is
sent. A check with no cost does not create an expense. An `odometer` on that
check is one `odometer_readings` row (`source_type` `inspection`), not a
direct edit of current mileage.

```json
{
  "vehicle_id": "ca3d2cc6-0144-4efa-b0d6-5091b27db254",
  "last_done_on": "2026-11-23",
  "next_due_on": "2026-12-23",
  "notes": "All clear",
  "odometer": 163977,
  "file_name": "inspection.jpg",
  "content_base64": "<optional photo>",
  "idempotency_key": "ec20lk-monthly-2026-11-23"
}
```

- `last_done_on` cannot be in the future. A photo or `odometer` requires
  `last_done_on` (`400` otherwise). Omit a field to leave the schedule
  unchanged. `notes` up to 2,000 characters. Photo rules match
  `mileage-reading` (JPEG, PNG, WebP, or HEIC, 20 MB, one per call, private
  `vehicle-docs`, `document_id` on the history row).
- `interval_days` on a new row is 30. The reply's `next_due_on` is what the
  database stored. Before the migration in [service-due](#service-due),
  setting `last_done_on` rolls `next_due_on` to that date plus 30 days. After
  the migration, a `next_due_on` sent in the same call is kept.
- Notes or next due alone do not add a history row. `last_done_on` does.
- Idempotent on `idempotency_key` for the same vehicle, last done, next due,
  notes, and whether a photo was sent. A different payload with the same key
  is `409`.
- Audited as `fleet.monthly_inspection`. Sends nothing to the renter.

Reply `201` when a history row is written, `200` when only the schedule changes:

```json
{
  "ok": true,
  "duplicate": false,
  "vehicle_id": "…",
  "license_plate": "EC20LK",
  "vin_last6": "…",
  "schedule_id": "…",
  "record_id": "…",
  "item": "Monthly Inspection",
  "interval_days": 30,
  "last_done_on": "2026-11-23",
  "next_due_on": "2026-12-23",
  "notes": "All clear",
  "document_id": "…",
  "has_photo": true
}
```

Staff edit the same facts on the vehicle record, Service tab: Mileage Log
(Add Reading, with an optional photo), Next Service Due, and Monthly
Inspection. The read-only Maintenance Log flag stays off, and renter
oil-change or maintenance texts stay off.
