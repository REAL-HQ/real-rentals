# Renter Insurance ID Cards → Driver Portal

Dolmar (t379u): when the insurance company sends a renter's ID card, it should
be saved to the renter's portal automatically so they always have it.

## Flow

1. **Arrives.** Either (a) an email to the intake inbox (`inbox@`, Resend) with
   the card attached — `src/lib/inbound-email.server.ts` stores the original in
   `vehicle-docs` and queues it in Fleet Inbox exactly as before — or (b) FLEET
   finds the card in the **team@ Gmail** inbox **or Spam** (the app cannot read
   Gmail) and hands it over with `POST /api/public/fleet/insurance-card`
   (`src/lib/fleet-insurance-card.server.ts`). That endpoint writes the same
   shape: `inbound_emails` (provider `gmail`, one row per message+attachment),
   an email Fleet Inbox batch, the original in `vehicle-docs`, a
   `fleet_inbox_jobs` job. It is idempotent on the Gmail message+attachment and
   on the bytes (SHA-256).
2. **Read.** The one analysis path (`analyzeItemCore`) classifies the file. The
   reader now also transcribes `approved_drivers` (as printed).
3. **Matched or not** (`src/lib/renter-insurance-card.ts`, pure):
   - Only items classified `insurance_card` from the **email** channel.
   - A PDF repeating the same card on several pages is one card. Two different
     VINs (or conflicting dates) in one file → staff.
   - The VIN must be a valid 17-character VIN read with confidence, on a fleet
     car (not archived) that has an **active or reserved** rental.
   - The named insured **or** an approved driver must match that renter's
     `applications.full_name`: first and last name equal; middle names, middle
     initials, "LAST, FIRST" and Jr/Sr/II/III ignored. Strict on purpose.
   - Exactly one renter must match. Expired cards → staff.
4. **Filed** (`src/lib/renter-insurance-card.server.ts`): the bytes are copied
   to `driver-docs/<application id>/insurance-<uuid>.<ext>` and saved as a
   `documents` row: category/kind `insurance`, label **Insurance ID Card**,
   file name `Insurance ID Card.pdf` (the original attachment name is never
   shown to the renter — it can carry the carrier's name), notes
   `Effective MM/DD/YYYY` (dates only), visibility `driver` + `admin`,
   `review_status` **uploaded** (not reviewed), `uploaded_by_role` `email`,
   `source` `insurance_email`, `content_sha256`, `expires_at` only when printed.
   Older current cards are kept as history (`is_current=false`,
   `superseded_by=<new>`), except a card staff already **verified**: it stays
   current until staff review the new one (same hold as a renter upload,
   `insurance-review-hold.ts`). The Fleet Inbox item gets a staff-only note
   "Filed to the renter's Documents …". Audited as
   `document.insurance_card_auto_filed`.
5. **Not matched:** nothing is filed. The Fleet Inbox item is set **Needs
   Attention** with a warning that starts "Insurance ID card — not filed to a
   renter:" and the reason, plus one staff bell notification "Insurance Card
   Needs Filing" (staff-wide; never addressed to a renter) per file. Staff
   file it from the driver's Documents (Insurance Card → + Add).

Never: marks anyone insured or verified (`driver_screenings.insurance_verified`
is untouched), changes an application/rental, sends a text or email, or names
the carrier or broker in renter-facing text.

## Where it shows

- **Renter portal → Documents → Your Documents → Insurance Card**: "Latest",
  `Insurance ID Card.pdf · <size> · Uploaded <date/time>`, View opens the PDF.
  Earlier cards are listed under "Previous Uploads".
- **Back office → driver profile → Documents → Insurance Card**: same row with
  a **From Email** tag (admin only); staff can review, set expiry, or replace.
- **Fleet Inbox**: the original email file with the outcome note/warning.

## Switch

Back Office → Automations → **Insurance ID Cards To Portal**
(`renter_insurance_cards`), default **On** (storing only). Off: cards stay in
Fleet Inbox as before and the FLEET hand-over returns 409.

## Migration

None. Uses existing tables/columns (`documents`, `fleet_import_*`,
`inbound_emails`, `fleet_inbox_jobs`, `notifications`, `audit_log`) and the
existing `driver-docs` / `vehicle-docs` buckets.
