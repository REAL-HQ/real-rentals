# FLEET: Save What It Read Off The License Photo

The application never asks for a date of birth or a license expiry, so FLEET
reads them off the front of the license (Dolmar, t298s1611) and saves them
here. The age and expiry rules then work. A reading is **never a
verification**: it is labelled "Read by FLEET from license photo", and the
field rep confirms the license at pickup.

`POST https://drivereal.com/api/public/fleet/license-facts` (Bearer `FLEET_API_KEY`, JSON)

```json
{ "lead_id": "…", "document_id": "<license_front document id from the packet>",
  "dob": "1990-02-03", "license_expiration": "2029-05-01",
  "license_number": "C123456789012", "license_state": "FL",
  "address_line1": "123 Example St", "address_city": "Exampleville", "address_state": "FL", "address_zip": "00000",
  "confidence": 0.95, "note": "optional", "idempotency_key": "license-<lead_id>-1" }
```

1. Get the packet with `include_urls: true` and open the `license_front` URL (15 minutes).
2. Send what you can read clearly. Any field may be left out. The license
   number and issuing state are needed because the rental agreement prints
   them (it names the only person allowed to drive) and the application never
   asks for them; without them FLEET's agreement send is refused. If you are not
   sure of a date, leave it out (the applicant then goes to staff as today).
3. Rules: `document_id` must be this applicant's current, not-rejected
   `license_front`. `dob` must be 16 to 100 years ago; `license_expiration`
   between 2000 and 2100; `license_number` 4-20 letters/digits (spaces and dashes
   dropped); `license_state` a two-letter US code. The license number is never
   returned in full (masked to the last 4).
4. A date is copied onto the application only into an empty field or one an
   earlier FLEET reading filled. A value staff or the applicant entered is
   never overwritten: it comes back in `conflicts`, and FLEET sends `needs_staff`.

Reply `201 { ok, reading_id, label, verified: false, applied[], unchanged[],
conflicts[], assessment { recommendation, hard_blockers, escalations } }`. A
repeat with the same `idempotency_key` returns `duplicate: true`. Errors:
`400`, `401`, `404`, `409` (wrong document, key reused for another applicant),
`503` (table not installed: nothing changed).

An expired license read off the photo is a hard blocker; under 25 and expiring
within 30 days escalate, as before. The packet shows the latest reading under
`license_reading`, and the record's Activity shows "Read by FLEET from license
photo (not verified)". Nothing here writes a review status, verified flag,
screening, insurance or background field.

Storage: `public.fleet_license_readings` (`proposed/fleet-license-readings-v1.sql`).

## Rule changes in the same release (t298s1611)

- Missing income proof is a note (`requested_income`), not a staff escalation:
  the missing-documents outreach asks the applicant for it.
- "Applied before" escalates only when an earlier application with the same
  phone or email was declined or closed (`prior_declined`). Sending the same
  open application again is a note (`resubmitted`).

Optional address fields (`address_line1`, `address_city`, `address_state`, `address_zip`) are stored on the reading. If they differ from the primary application address they are saved as a second profile row labeled "License address" and never overwrite the primary or a staff-entered value.
