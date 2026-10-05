# eSign engine: audit findings + phase 1 plan

## 1. Existing architecture (inventory)

- **Tables:** `agreement_templates` (name, body, version, is_active). `agreements` has 24 columns: application_id (required), vehicle/rental/template ids, body, merge_data, status, token_hash, token_expires_at, sent/viewed/signed/voided timestamps, signer name/email/ip/user agent, company_signer_name (a free-text column that defaults to "REAL RENTALS"), document_id, and created_by.
- **Production data:** 0 agreements exist, so there are no live links or signed history to protect. All changes stay additive anyway.
- **RLS:** Admins manage templates. Managers manage agreements (`private.is_manager()`). Drivers can read agreements through `applications.user_id`. Grants include anon SELECT/UPDATE (RLS still blocks those requests, but the grant is wider than it needs to be).
- **Storage:** private `rental-agreements` bucket. Partners can read files through the `documents` visibility rule.
- **Server functions** (`agreements.functions.ts`): get/saveAgreementTemplate, listAgreements, previewAgreement, issueAgreement (send), sendAgreement, resendAgreement, voidAgreement, getAgreementByToken, signAgreement, getMyAgreements, signMyAgreement. Merge logic lives in `agreement-merge.ts`.
- **UI:** `AgreementsCard` (admin), `/sign/$token`, portal agreements tab, template editor in Settings.
- **Messaging:** Resend email helpers for sent, signed (renter) and signed (ops). SMS goes out on send only.
- **Tests:** `agreement-guard.test.mjs` (missing-field guard) only.

## 2. Generic vs rental-specific

- **Generic:** the document itself (title, body, status, timestamps), the signer, token issue/hash/expiry, viewing, signing, voiding, resending, the archive, the certificate, and the hash.
- **Rental-specific:** application_id, vehicle_id, rental_id, merge fields (`buildMergeData`), the missing-field blockers, the rental template, and auto-send on approval.

## 3. Defects found (from reading the code)

1. **Two people can sign at once.** Signing reads the record, archives it, then updates without checking status. Both requests win, which creates 2 archive rows and 2 sets of emails.
2. **Sign vs void race.** Void uses `.neq('status','signed')`, but signing does not check for void. A voided agreement can become signed.
3. **Signing in the portal breaks the email link.** It overwrites the emailed token with a 5-minute token. It also calls the `signAgreement` server-function stub from server code, which is a known published-app failure.
4. **Archive failures are silent.** If the upload or the documents row fails, the agreement still ends up `signed` with `document_id = null` and nobody is told.
5. **The archive is HTML, not PDF.** There is no checksum and no completion certificate.
6. **Resend has no guards.** Its update has no status condition (it can race with signing). It sends no SMS and writes no audit event.
7. **No eSign audit events** anywhere.
8. **The company signer is free text** with no authorised configuration.
9. **Email and SMS failures are only logged.** Staff can't see them. Acceptable, but should be recorded.
10. **Expired tokens:** the expired page doesn't tell the renter the link expired (it shows a generic "invalid link").

## 4. Proposed schema (additive only)

`agreements` stays as the engine's document table. It is not renamed, and the rental flow keeps using it.

- Make `application_id` nullable and add a check that rental-type documents still require it.
- **New on `agreements`:** `source` ('rental' | 'standalone', default 'rental'), `completed_at`, `expires_at`, `completed_document_id` (an alias that `document_id` keeps backfilling), `archive_status` ('none' | 'pending' | 'archived' | 'failed'), `archive_error`, `archive_attempts`, `sha256`, `company_signer_title`, `metadata jsonb`.
- **New status value `signing`** (a short-lived lock) and status order: draft → sent → viewed → signing → signed. Voided is terminal from draft, sent or viewed only.
- **New table `esign_recipients`:** document_id, name, email, phone, role ('signer' | 'cc'), signing_order, status, sent_at, viewed_at, signed_at, ip, user_agent, auth_method ('email_link' | 'portal'), token_hash, token_expires_at, token_revoked_at. Existing columns are mirrored for the single renter signer, and one renter recipient is backfilled per agreement (there are 0 today).
- **Company signature:** an `app_settings` key `esign_company_signer` (name, title), editable only by the Owner. Agreements snapshot it at send time.
- **Database functions:**
  - `esign_begin_signing(token_hash)`: an atomic `UPDATE ... WHERE status IN ('sent','viewed') AND token not expired/revoked RETURNING`. It returns `won`, `already_signed`, `voided` or `expired`.
  - `esign_void(id)`: a conditional update that refuses `signing` and `signed`.
- **Grants:** revoke anon from both tables.

## 5. Signing pipeline (one path for the token link and the portal)

```text
claim (atomic -> signing) -> render PDF -> sha256 -> upload -> documents row
  -> finalize (signed, archive_status=archived, completed_document_id, sha256)
  -> emails/SMS (failures recorded, never block)
on render/upload/row failure: status=signed, archive_status=failed, audit document.archive_failed
  -> retry server fn (Manager+) + cron sweep -> document.archive_recovered
```

- The signature itself is committed once the claim wins. A failed archive is visible state, never a silent null.
- Portal signing calls a shared server-only `completeSigning()` helper and never touches the emailed token.

## 6. PDF + certificate

- The PDF is built on the server with `pdf-lib`, a pure-JS library that works in the hosting runtime. Same input always produces the same output.
- **Page 1+:** the full agreement text with renter and company signature blocks.
- **Final page, "Certificate of Completion":** document ID, title, created/sent/viewed/signed times, signer name and email, IP, browser, authentication method, signature method (typed name + consent), and the SHA-256 of the agreement body. The SHA-256 of the full PDF is stored in the record and shown in the admin UI, since a file can't contain its own hash.

## 7. Access model

- Owner: everything, including the company signer and templates.
- Manager: create, send, resend, void, retry archive.
- Coordinator: read-only list and download.
- Driver: only their own agreements, by RLS and server checks.
- Partner: none for now.
- Every check runs on the server and in RLS, not just by hiding buttons.

## 8. Audit events

`document.created`, `.sent`, `.viewed`, `.resent`, `.signed`, `.voided`, `.archive_failed`, `.archive_recovered`, plus `template.created`/`.updated`. Each records the actor and document id only, with no tokens or document text, via the existing `audit.server.ts`.

## 9. Admin UI changes (minimal, needed to prove the engine)

`AgreementsCard` gets: an "Archive failed — Retry" badge, a Download PDF link, the hash, and buttons hidden by role. Nothing else changes. The standalone eSign app UI is out of scope for this phase.

## 10. Verification

- **Scripted tests:** concurrent double-sign (one winner, one already-signed), sign vs void both orders, resend kills the old token, expired, tampered or random token, another driver's id through the portal, forced upload failure leading to `failed` then retry leading to `archived`, a documents-row failure, an email failure, and a stale preview with blanks being re-rendered.
- **Browser end to end:** prepare → send → open link → sign → PDF in the driver's vault and the portal.

## Technical notes

- **Files:** `src/lib/esign.server.ts` (engine: claim, complete, archive, pdf, hash, audit), refactored `agreements.functions.ts` (rental consumer), `src/lib/esign-pdf.server.ts`, a cron route `api/public/cron/esign-archive-retry.ts` (CRON_SECRET), `scripts/esign-engine.test.mjs`, and one additive migration.
- Record the engine rule in AGENTS.md.
