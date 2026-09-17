# Rental agreements + document vault

Build an in-house e-signature flow (DocuSign-style) plus a per-driver document area shared by your team and the renter.

## 1. Send an agreement

- On each driver's record in the back office, a **Send rental agreement** button.
- The agreement is generated pre-filled from data you already have: company details, driver name/address/license, assigned vehicle (year, make, model, color, plate/VIN), weekly rate, deposit, start/return dates, and market.
- A review screen shows the filled agreement before sending, so you can correct anything.
- Sending emails the renter a secure link (from team@drivereal.com) and the agreement also appears in their portal.

## 2. Signing

- Renter opens the link (no account needed) or signs in the portal.
- They read the agreement, type their full legal name, and tick the consent box.
- Company signature is pre-applied, so the agreement completes the moment the renter signs.
- We record signer name, timestamp, IP, and browser for the audit trail.
- On completion: a finished PDF-style copy is saved to that driver's file, and both your team and the renter get a confirmation email.
- Status shown in the back office: Draft, Sent, Viewed, Signed, Voided. You can resend or void an unsigned agreement.

## 3. Document vault (per driver)

- One "Documents" area per driver, visible in the back office and in the renter's portal.
- Categories: driver's license (front/back), insurance card, gig profile screenshot, signed agreements, other.
- Both sides can upload; uploading a new file for a category replaces the current one and keeps the old version in history.
- Each document can carry an expiry date (license, insurance) with an "Expiring soon / Expired" flag, and it feeds the existing daily reminder emails.
- Team-only documents can be marked internal so the renter does not see them.
- Files are private; access is through short-lived secure links only.

## 4. Agreement template

- The agreement text is editable in back-office settings using merge fields (e.g. {{driver_name}}, {{vehicle}}, {{weekly_rate}}), so you can update terms without code changes.
- We seed a first version based on your current rental terms; you can refine the wording afterwards.

## Technical notes

- New tables: `agreement_templates` (versioned body + merge fields), `agreements` (driver, vehicle, rental, merge data snapshot, status, token hash, sent/viewed/signed timestamps, signer name, IP, user agent), and `document_versions` on top of the existing `documents` table (category, expiry, visibility, superseded_by).
- Signing link uses a hashed, single-purpose, expiring token; the public sign route lives under `src/routes/api/public/*` + a public `/sign/$token` page that loads only the agreement it names.
- Server functions in `src/lib/agreements.functions.ts` (admin: create/send/void/resend; public: fetch-by-token, sign) with admin role checks; renter-facing reads via `requireSupabaseAuth` in the portal.
- Completed agreement rendered to a static HTML/PDF snapshot stored in the private `rental-agreements` bucket, linked as a `documents` row with visibility `[driver, admin]`.
- Storage RLS scoped per driver folder; document reads served through signed URLs.
- Emails via existing Resend setup in `src/lib/email.server.ts`.
