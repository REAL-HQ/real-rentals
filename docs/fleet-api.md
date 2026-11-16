# FLEET API: Every Endpoint

All endpoints: `POST`, JSON body, `Authorization: Bearer <FLEET_API_KEY>`
(compared in constant time; under 24 characters means "not configured", `503`),
`Cache-Control: no-store` JSON replies. Every write is audited as
"FLEET (automated)". FLEET never declines anyone (it sends `needs_staff`),
never marks anyone insured or verified, and never touches billing. Renter
texts the site sends go from the 888 line, 8 AM to 9 PM ET, with consent and
STOP checked.

Base: `https://drivereal.com/api/public/fleet/`

| endpoint | does | doc |
|---|---|---|
| `status` | read: whole-journey digest, one lead's journey and next step, lookup by any phone/email, a renter's balance | [fleet-status.md](fleet-status.md) |
| `applicants` | read: review queue and one applicant's review packet | [fleet-applicant-review.md](fleet-applicant-review.md) |
| `applicant-decision` | approve (no hard blockers) or needs_staff | [fleet-applicant-review.md](fleet-applicant-review.md) |
| `license-facts` | save DOB / expiry / number / state read off the license photo (never "verified") | fleet-license-facts.md (PR 376) |
| `assign-vehicle` | list available cars; put one on an approved applicant at its listed rate | fleet-assign-vehicle.md (PR 377) |
| `send-agreement` | send the agreement after the renter confirmed terms (call or YES text) | [fleet-send-agreement.md](fleet-send-agreement.md) |
| `amend-agreement` | send an updated agreement to an ACTIVE rental (e.g. a new weekly rate the renter agreed to); generated from v1.14 with no Reservation Fee or new deposit; the rate changes only after they sign (switch, Off) | [fleet-amend-agreement.md](fleet-amend-agreement.md) |
| `driver-document` | file a document onto a driver's profile, team only, never verified (switch, Off) | [below](#driver-document) |
| `pickup-slots` | open pickup slots; book one | [fleet-pickup-schedule.md](fleet-pickup-schedule.md) |
| `resend-link` | resend the signing link or the missing-files upload link (switch, Off) | [fleet-resend-link.md](fleet-resend-link.md) |
| `handoff` | hand a person to staff (complaint, injury, payment dispute, ...); bots pause | [fleet-handoff.md](fleet-handoff.md) |
| `missing-items` | preview / run the one-time missing-items message | [missing-items-outreach.md](missing-items-outreach.md) |
| `payment-text-pause` | pause rent texts for an approved payment deal; status; cancel | [fleet-payment-text-pause.md](fleet-payment-text-pause.md) |

Events the site sends FLEET (signed webhooks): [fleet-webhooks.md](fleet-webhooks.md).

## What FLEET still cannot do (staff only, by design)

- Decline, close or reopen an application; clear a Needs Staff flag or a handoff.
- Run or record a background check or MVR; verify insurance; verify a license.
- Charge, refund or waive anything; change a rate directly. (A new rate for an
  active rental goes only through `amend-agreement`: it is pending until the
  renter signs the updated agreement, and Stripe is never changed by FLEET.)
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
