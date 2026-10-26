# Signed Agreement Immutability

Owner rule: signed-document replacement semantics are not changed silently. This
page records the intended behaviour.

## Intended Behaviour

Signed-agreement evidence is immutable in the document vault. The document vault
cannot delete it, replace it, supersede it or mark it Needs New.

A document counts as signed-agreement evidence when any of these is true:

- `isSignedAgreementEvidence` matches its row shape (`src/lib/signed-agreement-evidence.ts`):
  kind `rental_agreement`, category `agreement`, bucket `rental-agreements`, or a
  `completed-v1/` or `immutable-v1/` archive path.
- An `agreements` row names it in `document_id` or `completed_document_id`.

Signing, voiding and archiving go only through `src/lib/esign.server.ts`. The vault
is not a signing path.

## What Replace And Needs New Did Before

Confirmed on `9c66abd8` with `scripts/vault-replace-guard.test.mjs`, which runs the
real handlers against a fake Supabase.

- **Replace** on the "Signed agreement" card (`ApplicantDocuments`) called
  `createDocumentUploadUrl`, which signed a new random path in the `driver-docs`
  bucket. It then called `confirmDocumentUpload`, and `persistConfirmedDocument`
  inserted a new current row in category `agreement`. That same call set
  `is_current=false, superseded_by=<new row>` on **every** current `agreement` row
  for the driver, including the archived, e-signed PDF. The signed record moved to
  "Replaced versions", and the uploaded file appeared as the driver's signed
  agreement.
  - The signed PDF bytes were **not** overwritten. The vault only writes new random
    paths in `driver-docs` and never `upsert`s into `rental-agreements`.
  - `agreements.document_id` was **not** repointed. eSign links and the driver's
    signed-PDF link kept pointing at the original row.
- A **driver** could do the same by calling the two endpoints directly with category
  `agreement`. The portal UI never offers that category, but the server accepted it.
  That superseded the signed row, or, when no signed row existed, put a file the
  driver uploaded into the "Signed agreement" slot.
- **Needs New** (`setDocumentReview` with status `rejected`) set
  `review_status='rejected'` on the signed record, added a note, logged an audit
  "Asked for a replacement of …" and showed the card as "Needs Replacement".
  Agreements are not a required document, so nothing told the driver and nothing
  asked them to upload a replacement. It was not a parallel signing path. It did
  label signed evidence as rejected, and it pointed staff to the Replace action
  described above.

## What Changed

- `createDocumentUploadUrl` and `confirmDocumentUpload` refuse with
  `SIGNED_AGREEMENT_REPLACE_REFUSED` when a current row in the target category is
  signed-agreement evidence. Both rules above apply. The upload-URL step refuses
  before anything is signed, so no object is left behind. The confirm step checks
  again because it is the step that supersedes and it can be called on its own. If a
  lookup fails, the upload is refused (fail closed).
- Drivers cannot upload category `agreement` at all
  (`SIGNED_AGREEMENT_DRIVER_UPLOAD_REFUSED`).
- `setDocumentReview` refuses `rejected` (Needs New) for signed-agreement evidence
  (`SIGNED_AGREEMENT_NEEDS_NEW_REFUSED`).
- `ApplicantDocuments` and `DocumentVault` use `signedAgreementLocked` to hide
  Replace and Needs New on a locked card. `ApplicantDocuments` shows a
  "Permanent Record" tag in their place. Delete was already hidden and refused by
  PR 1.

## What Still Works

- Ordinary documents (licence, insurance, gig profile and others): Upload, Replace
  (the old version goes to history), Needs New and Delete work as before, for staff
  and for drivers on their own application.
- Staff can still file a **first** agreement into an empty "Signed agreement" slot.
- Verify, and clearing a review (status `uploaded`), still work on a signed
  agreement. Staff can clear a "Needs Replacement" status that was set before this
  change.
- **Archive retry** is unaffected. The `esign-archive-retry` cron and the staff
  Retry button call `retryArchive` and `archiveDocument` in `esign.server.ts`. These
  write `rental-agreements` and `documents` directly through the service role and
  never go through the vault endpoints. The legacy layout's re-upload
  (`upsert: true` at `{applicationId}/agreement-{id}.pdf`) renders the same signed
  record again. It is the one legitimate server-side rewrite, and it is preserved.
  `completed-v1` is content-addressed and never overwrites. This is covered by the
  last test in `scripts/vault-replace-guard.test.mjs`.
- `esign.server.ts` and `esign-pdf.server.ts` are unchanged.

## How Staff Correct A Wrong Agreement

- **eSign agreement with a mistake** (wrong vehicle, rate or wording): void it
  through the eSign flow, then prepare and send a new agreement. The template change
  belongs in Owner templates. The voided agreement and its archive stay on file as
  history.
- **Paper agreement**: file it as a new, separate document. Never replace the signed
  record. The Paper Agreements registration (`register_paper_agreement`, bucket
  `rental-agreements`) is the intended path. It is currently held by `PAPER_RELEASE`.
  Until it is released, a vault upload into an empty "Signed agreement" slot is the
  only vault option. Once a signed agreement is on file, the vault refuses another
  upload into that slot. The paper copy then waits for Paper Agreements, or the
  agreement is re-sent through eSign.
- **Deleting or retiring signed evidence** is a separate, authorised retention
  review (`refuseArchiveDeletion` in `signed-archive-protection.server.ts`). The
  document vault cannot do it.
