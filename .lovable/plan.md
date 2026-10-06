# Phase 2 — Maintenance Intelligence, Mileage History, Vehicle Timeline

## Audit Summary (What Already Exists And Will Be Reused)

- **Service events** — `maintenance_records` already holds vehicle, item/category, status (open/done), vendor, shop, odometer, invoice number, performed date, total cost, schedule link and notes. It becomes the one canonical service event / work item. **No new "repair ticket" or "service event" table.**
- **Schedules** — `maintenance_schedules` (per-vehicle, miles and/or days) is extended with a company-default layer and per-vehicle overrides.
- **Expenses** — `vehicle_expenses` stays the single financial truth. A service event links to its expense row, so each dollar is counted once.
- **Vendors** — the unified Vendors list is reused. Repair-shop matching uses a normalized name ("PEP BOYS" = "Pep Boys" = "PepBoys"), and the text printed on the receipt is kept as it appears.
- **Evidence** — `documents` + private `vehicle-docs` + `document_vehicle_links` + `vehicle_field_provenance`. One file is stored once, and one invoice can link to several vehicles.
- **Fleet Inbox** — the same items → proposals → Review → Apply pipeline, same VIN/unit/plate matching, and the same rule that year/make/model alone never decides which car it is.
- **Mileage today** — one editable `vehicles.current_odometer`, plus odometer fields on inspections and service. Rentals have no pickup/return mileage yet. Production data is empty for maintenance, schedules, expenses and vendors, so nothing needs migrating.

## What Gets Built

1. **One Mileage History** (new `odometer_readings`): mileage, date observed, source (Service, Inspection, Rental Checkout/Return, Manual, Fleet Inbox, Title, Registration, Odometer Photo, Incident), link to the source record, evidence document and page, who entered it, and a status (Valid / Needs Review — Odometer Conflict / Superseded).
   - Current mileage is taken from the newest valid reading, so an older receipt never lowers it.
   - A newer date with clearly lower miles gets flagged for review and is never auto-corrected.
   - A unique evidence key blocks duplicate readings from the same uploaded file.
   - Corrections add a new reading with a reason. Old readings are never deleted.
2. **Service Events, Upgraded** — add parts, labor, tax, other cost, warranty/covered amount, payment status, source, document and page, and an "original extraction" snapshot. Add **service line items** (`maintenance_record_items`), so one invoice can list several services without duplicating the file.
3. **Corrections Trail** — editing an evidence-backed field records the old value, the new value, who, when and why in the audit log. The original file is never changed.
4. **Fleet Inbox Recognizes Receipts** — a new "Service Invoice" document type. The reader extracts date, vendor, invoice number, mileage, items and costs. Review shows Vehicle, Date, Vendor, Mileage, Services, Cost, Page and Issues, with Approve / Edit / Match Another Vehicle / Ignore / Retry. Approve creates, in one step: the service event, its items, one mileage reading, one linked expense and provenance. Bulk approve is only offered for strong VIN/unit matches.
5. **Maintenance Settings** — Settings → Fleet → Maintenance: company intervals (miles and/or months) that the Owner can edit, plus a per-vehicle override that remembers the company default. No intervals ship pre-filled. Status per vehicle: All Clear / Due Soon / Due / Overdue ("Overdue by 612 miles").
6. **Downtime** — when a person moves a car into or out of Maintenance, a start/end row is recorded (`vehicle_downtime`). Nothing moves a car into Maintenance automatically.
7. **Vehicle Detail**
   - A new **Service** tab: Latest Service, Next Due, Open Work, History rows (date · miles · services · vendor · cost · View Receipt), Mileage History table plus a small chart, and maintenance spend for Owner/Manager only.
   - **Add Service** and **Add Reading** forms with drag-and-drop receipt upload. Uploads stay private.
   - A new **Timeline** tab built from the existing records (vehicle added, documents, mileage, service, inspections, rentals, incidents, status changes, photo published), with simple filters showing only the kinds of events that actually exist.
   - The Overview Service card shows the real status and links to the Service tab.
8. **Service Page** becomes the fleet-wide center: Needs Attention / Upcoming / History, filtered by Vehicle, Status, Type and Vendor.
9. **+ Add → Service** opens Add Service.
10. **Roles** — Owner: everything including settings. Manager: manage and see costs. Coordinator: service workflow with **no costs** (removed on the server). Drivers: no access to internal invoices.

## Not In This Phase

ROI or profitability, lost-revenue math, a texting provider, rental pickup/return mileage capture screens (the history model accepts these readings; capturing them comes later), and any auto-status changes.

## Verification

Controlled test receipt (one car, several items, mileage, vendor, parts/labor/tax/total) gives: one file, the right car by VIN, one service event with its items, one mileage reading, one expense with no double count, and correct provenance. Also checked:
- re-uploading the same receipt is blocked;
- an older receipt does not lower current mileage;
- a lower reading on a newer date is flagged;
- a year/make/model-only receipt for the Fusions goes to Review;
- schedule due math;
- Coordinator sees no costs.

All test data is cleaned up, the nine real vehicles are left untouched, and nothing is published.

## Technical Notes

- One migration adds `odometer_readings`, `maintenance_record_items`, `maintenance_defaults`, `vehicle_downtime` and the new columns on `maintenance_records`, `maintenance_schedules` and `vehicle_expenses` (`maintenance_record_id`). It includes grants, RLS that reuses existing staff/role helpers, and a cost-free view for Coordinators.
- Triggers: recompute `vehicles.current_odometer` from the newest valid reading; flag conflicts; open/close downtime on status change.
- Server logic lives in `src/lib/maintenance.functions.ts` and `src/lib/odometer.ts` (pure rules, unit-tested). Fleet Inbox rules are extended in `src/lib/fleet-inbox.ts`, and the reader prompt in `document-reader.server.ts`.
- The database is shared by the preview and the live site. The changes only add new tables and columns, so the live app keeps working before publishing.
