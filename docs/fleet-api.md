# FLEET API: Every Endpoint

All endpoints: `POST`, JSON body (exceptions: `vehicle-expenses` also answers `GET`, and
`rental-pickup-odometer` also answers `PATCH`), `Authorization: Bearer <FLEET_API_KEY>`
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
| `driver-document` | file a document onto a driver's profile, never verified; insurance cards are shared with the driver, everything else team only unless `driver_visible` (switch, Off) | [below](#driver-document) |
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
| `vehicle-expenses` | `POST` record an expense on a vehicle (repair, maintenance, registration…) with an optional receipt, idempotent, duplicates flagged; `GET` list a vehicle's expenses (create: switch, Off) | [below](#vehicle-expenses) |
| `vehicle-expenses-list` | the same list for callers that can only POST | [below](#vehicle-expenses) |
| `rental-inspection-photo` | add one Pickup or Return photo to a rental, shown as Ours; renter not notified (switch, Off) | [below](#rental-inspection-photo) |
| `rental-pickup-odometer` | `PATCH` set a rental's pickup odometer; lowering needs `force` and a note (switch, Off) | [below](#rental-pickup-odometer) |

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
  "idempotency_key": "doc-<lead_id>-1",
  "driver_visible": false
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
- `driver_visible` optional, `true` or `false` (anything else is `400`).
  Who sees the file:
  - `insurance` (the renter's insurance ID card): staff **and the driver**
    (Back Office → driver profile → Documents, and Driver Portal →
    Documents), visibility `["driver","admin"]`. Send `"driver_visible": false`
    to keep one team only.
  - every other category: team only, visibility `["admin"]`, unless
    `"driver_visible": true`. Default `false`, so nothing else becomes
    renter-visible by accident.
  - `insurance_quote` and `screening` are always team only;
    `"driver_visible": true` is refused with `400` (broker or insurer quotes
    and screening reports are never shown to renters).
- Saved exactly like a staff upload: bucket `driver-docs`, path
  `<lead_id>/internal/<category>-<uuid>.<ext>` when team only, or
  `<lead_id>/<category>-<uuid>.<ext>` when shared with the driver; documents
  row with the visibility above, `review_status` "uploaded". Nothing is
  verified or approved, nothing on the application changes and the driver is
  not told. Every category FLEET may file keeps every file. A new upload
  adds a file. It does not replace the one already there. `agreement` and
  `rental_application` are refused, so this call never supersedes a signed
  agreement.
- Idempotent: the same `idempotency_key`, or the same bytes for the same driver
  and category, returns `200 {"duplicate":true,"document_id":…}` without saving
  again. A key reused for a different file is `409`.
- Audited as `document.fleet_upload` (category, label, sha256, size, key,
  `driver_visible`).

Reply `201`:

```json
{ "ok": true, "lead_id": "…", "document_id": "…", "category": "other",
  "label": "…", "file_name": "…", "mime_type": "application/pdf",
  "size_bytes": 123456, "sha256": "…", "visibility": ["admin"],
  "driver_visible": false, "review_status": "uploaded", "verified": false,
  "next": "…" }
```

An `insurance` upload replies `"visibility": ["driver","admin"]` and
`"driver_visible": true`. The driver gets no message when a file is shared;
it simply appears in Driver Portal → Documents.

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

## vehicle-expenses

Writes the same `vehicle_expenses` table Back Office → Expenses reads and
writes, so an entry shows there at once (Expenses → the vehicle, or the
Expenses list). Staff can edit or delete any entry there.

Create is off until Automations → **Expenses (FLEET)** (`fleet_expenses`) is
On; while Off: `409 {"reason":"switched_off"}`, nothing saved. Listing stays
available while it is Off. Sends nothing to anyone and changes no rental,
payment or billing record.

### Create: `POST https://drivereal.com/api/public/fleet/vehicle-expenses`

```json
{
  "license_plate": "EC20LK",
  "date": "2026-11-25",
  "amount": 74.50,
  "category": "repair",
  "vendor": "Pep Boys",
  "description": "Front brake pads",
  "notes": "Replaced both front pads",
  "invoice_number": "INV-1001",
  "payment_method": "card",
  "is_recurring": false,
  "receipt_base64": "<optional receipt, base64; a data: prefix is accepted>",
  "receipt_file_name": "invoice-1001.pdf",
  "idempotency_key": "ec20lk-2026-11-25-brakes-inv1001"
}
```

```bash
curl -sS -X POST https://drivereal.com/api/public/fleet/vehicle-expenses \
  -H "Authorization: Bearer <FLEET_API_KEY>" -H "Content-Type: application/json" \
  -d '{"license_plate":"EC20LK","date":"2026-11-25","amount":74.50,"category":"repair",
       "vendor":"Pep Boys","description":"Front brake pads","invoice_number":"INV-1001",
       "idempotency_key":"ec20lk-2026-11-25-brakes-inv1001"}'
```

- **Vehicle**: `vehicle_id` (UUID) or `license_plate` (`plate` is accepted
  too; case, spaces and dashes are ignored). Both together must match. Unknown
  vehicle `404`; a plate on more than one vehicle `409` (send `vehicle_id`);
  an archived vehicle `409` (staff add those in Expenses).
- `date` (also `incurred_on`): a real `YYYY-MM-DD`, not in the future (Eastern
  Time) and not more than 5 years old.
- `amount`: dollars, greater than 0, at most 2 decimals, up to 1,000,000. A
  number or a plain numeric string (`"74.50"`).
- `category`: one of `registration`, `insurance`, `maintenance`, `repair`,
  `tires`, `fuel`, `cleaning`, `towing`, `parking`, `tolls`, `finance`,
  `purchase`, `gps`, `other` (the same list as Expenses; case-insensitive).
- `description` up to 300 characters. Send `description` or `notes`; with only
  notes, the description is the start of the notes. `notes` up to 1,500.
- `vendor` (name): matched to the Vendors list when exactly one vendor has
  that name (ignoring case, spaces and punctuation); that vendor is attached.
  A vendor that is not in the list is never created: its name is kept in the
  notes as `Vendor: <name>` and `vendor_matched` is `false`.
- `invoice_number` (also `ticket_number`): saved as the expense's Reference.
- `payment_method` free text up to 60 characters; `is_recurring` boolean.
- **Receipt** (optional, one per expense): PDF, JPEG, PNG, WebP or HEIC, read
  from the bytes, up to 20 MB (`415` / `413`). Stored the way Expenses stores
  one: private `receipts` bucket at `<vehicle_id>/<time>-<random>.<ext>`, with
  `receipt_path`, `receipt_name` and `receipt_mime` on the expense row, so
  Expenses shows it under Receipt → View.
- The row is saved with no staff user as creator and the line `Added by FLEET.`
  at the end of its notes. Audited as `expense.fleet_created`
  ("FLEET (automated)").
- **Idempotent on `idempotency_key`**: the same key with the same request
  returns the original (`200`, `"duplicate": true`, `"matched_by":
  "idempotency_key"`) and saves nothing. The same key with anything different
  (vehicle, date, amount, category, vendor, description, notes, invoice
  number, payment method, recurring, or receipt file) is `409
  {"reason":"idempotency_key_reused"}` and saves nothing. If staff deleted the
  expense since, the replay says `"deleted": true` and does not recreate it.
- **Likely duplicates warn, never refuse.** `duplicate_warnings` lists earlier
  expenses on the same vehicle with the same date, amount and vendor (a row
  with no vendor on file counts; with no vendor sent, any vendor counts), and
  any expense, on any vehicle, with the same invoice or ticket number
  (spacing and punctuation ignored; `same_vehicle` says which). The new
  expense is saved either way. `warnings` can also hold
  `same_receipt_file_already_on:<expense_id>`.

Reply `201`:

```json
{
  "ok": true,
  "duplicate": false,
  "expense": {
    "id": "…",
    "vehicle_id": "ca3d2cc6-0144-4efa-b0d6-5091b27db254",
    "license_plate": "EC20LK",
    "vin_last6": "123456",
    "date": "2026-11-25",
    "amount": 74.5,
    "category": "repair",
    "vendor": "Pep Boys",
    "description": "Front brake pads",
    "invoice_number": "INV-1001",
    "payment_method": "card",
    "has_receipt": true,
    "receipt_name": "invoice-1001.pdf",
    "created_by": "FLEET",
    "created_at": "2026-11-27T20:15:00.000Z"
  },
  "vendor_matched": true,
  "duplicate_warnings": [],
  "warnings": [],
  "next": "Saved to Back Office → Expenses."
}
```

A likely duplicate adds, for example:

```json
"duplicate_warnings": [
  { "expense_id": "…", "reason": "same_vehicle_date_amount_vendor", "same_vehicle": true,
    "date": "2026-11-25", "amount": 74.5, "invoice_number": null }
]
```

### List: `GET https://drivereal.com/api/public/fleet/vehicle-expenses`

Query: `vehicle_id` or `license_plate` (required), `from` and `to`
(`YYYY-MM-DD`, inclusive, optional), `limit` (1 through 500, default 200).
Newest first. Works for an archived vehicle. `POST
/api/public/fleet/vehicle-expenses-list` with the same fields as a JSON body
gives the same answer.

```bash
curl -sS "https://drivereal.com/api/public/fleet/vehicle-expenses?license_plate=EC20LK&from=2026-11-01&to=2026-11-30" \
  -H "Authorization: Bearer <FLEET_API_KEY>"
```

Reply `200`:

```json
{
  "ok": true,
  "vehicle": { "vehicle_id": "…", "license_plate": "EC20LK", "vin_last6": "123456", "archived": false },
  "from": "2026-11-01",
  "to": "2026-11-30",
  "count": 2,
  "total_amount": 86.84,
  "truncated": false,
  "expenses": [
    { "id": "…", "date": "2026-11-25", "amount": 74.5, "category": "repair", "vendor": "Pep Boys",
      "description": "Front brake pads", "invoice_number": "INV-1001", "payment_method": "card",
      "has_receipt": true, "receipt_name": "invoice-1001.pdf", "created_by": "FLEET",
      "created_at": "2026-11-27T20:15:00.000Z" }
  ]
}
```

`created_by` is `"FLEET"` for entries added through this API, `"Staff"` for
entries a signed-in person added, and `null` for older entries with no creator
on file. `vendor` is the Vendors-list name, or the name kept in the notes when
it was not in the list. `truncated` is true when more rows match than `limit`.
Neither call returns unit numbers or the full VIN.

## rental-inspection-photo

`POST https://drivereal.com/api/public/fleet/rental-inspection-photo`. Off
until Automations → **Rental Records (FLEET)** (`fleet_rental_records`);
while Off: `409 {"reason":"switched_off"}`, nothing saved.

```json
{
  "rental_id": "<rental id>",
  "stage": "pickup",
  "label": "Driver side",
  "file_name": "IMG_1204.jpg",
  "content_base64": "<the photo, base64; a data: prefix is accepted>",
  "idempotency_key": "rental-<rental id>-pickup-driver-side"
}
```

```bash
curl -sS -X POST https://drivereal.com/api/public/fleet/rental-inspection-photo \
  -H "Authorization: Bearer <FLEET_API_KEY>" -H "Content-Type: application/json" \
  -d "{\"rental_id\":\"<rental id>\",\"stage\":\"pickup\",\"label\":\"Front\",\"content_base64\":\"$(base64 -w0 front.jpg)\"}"
```

- `stage`: `pickup` (the Pickup tab; stored as phase `checkout`) or `return`
  (the Return tab; phase `checkin`).
- `label` (required, up to 200 characters) is the photo's caption. A label
  that names a standard angle (Front, Rear, Driver side, Passenger side,
  Interior front, Interior rear, Odometer, Fuel, Damage, Other) also sets the
  photo's angle.
- Photo: JPEG, PNG, WebP or HEIC, read from the bytes, up to 20 MB (`415` /
  `413`), one per call. The rental must exist (`404`), not be cancelled and
  have a vehicle (`409`).
- Stored exactly like a staff upload on the driver's Pickup / Return tab:
  `condition-media` bucket at
  `<vehicle>/trip/<application>/<rental>/<phase>-<uuid>.<ext>`, one
  `condition_media` row with `captured_by_role` `staff`, so it shows under
  **Ours**. The time taken comes from the photo's own EXIF when it has one.
- **GPS and camera data**: the original keeps its metadata for staff. The
  copy the renter sees is rebuilt with all metadata, including GPS, removed
  and checked clean; when that cannot be done safely (HEIC, over 20 MB) the
  renter sees the entry without the file. `renter_preview` says which.
- **No renter notification** of any kind (`renter_notified` is always `false`).
- Idempotent on `idempotency_key` (same rental, stage, label and photo; a
  different one under the same key is `409`), and the same bytes for the same
  rental and stage are never filed twice (`200`, `"matched_by":"content"`).
- Audited as `fleet.rental_inspection_photo`. Changes nothing else on the
  rental: not its status, payments, vehicle or driver.

Reply `201`:

```json
{
  "ok": true,
  "duplicate": false,
  "photo_id": "…",
  "rental_id": "…",
  "vehicle_id": "…",
  "license_plate": "EC20LK",
  "vin_last6": "123456",
  "stage": "pickup",
  "label": "Driver side",
  "shown_as": "Ours",
  "mime_type": "image/jpeg",
  "renter_preview": true,
  "taken_at_from_photo": true,
  "renter_notified": false
}
```

## rental-pickup-odometer

`PATCH https://drivereal.com/api/public/fleet/rental-pickup-odometer` (`POST`
with the same body is accepted too). Same switch as `rental-inspection-photo`
(Off until On).

```json
{
  "rental_id": "<rental id>",
  "odometer": 163977,
  "force": false,
  "note": "Photo of the odometer at handover shows 163977",
  "idempotency_key": "rental-<rental id>-pickup-odometer"
}
```

```bash
curl -sS -X PATCH https://drivereal.com/api/public/fleet/rental-pickup-odometer \
  -H "Authorization: Bearer <FLEET_API_KEY>" -H "Content-Type: application/json" \
  -d '{"rental_id":"<rental id>","odometer":163977,"idempotency_key":"rental-<rental id>-pickup-odometer"}'
```

- `odometer`: whole miles, 0 through 1,999,999. `note` up to 500 characters.
- A rental's pickup mileage is the odometer reading its `pickup_reading_id`
  points at, and a reading is never edited. A change adds a **correcting
  reading** (source `rental_checkout`, dated like the one it replaces, or the
  pickup day for a first reading), marks the old reading `superseded` (kept
  as history), and points the rental at the new one. The vehicle's current
  mileage follows from the database trigger as always.
- **Lowering**: a number below the one on file is `409
  {"reason":"would_lower"}` unless `force` is `true`, and a forced lowering
  also needs a `note` (`400` without one). Same number: `200
  {"unchanged":true}`, nothing written.
- Also refused with `409`: above the same rental's return odometer
  (`above_return`), and more than 500 miles below a valid reading the vehicle
  already has on or before that date (`below_vehicle_history`; `force` plus a
  `note` overrides, and the new reading is then flagged `conflict` for staff).
- Idempotent on `idempotency_key` (same rental and odometer; another number
  under the same key is `409`).
- Audited as `fleet.rental_pickup_odometer`. Sends nothing to the renter. The
  signed pickup checklist record is not touched.

Reply `200`:

```json
{
  "ok": true,
  "rental_id": "…",
  "vehicle_id": "…",
  "license_plate": "EC20LK",
  "vin_last6": "123456",
  "pickup_odometer": 163977,
  "previous_odometer": 163000,
  "reading_id": "…",
  "superseded_reading_id": "…",
  "status": "valid"
}
```
