# Window 1: backfill scope count and undo rehearsal (2026-10-24)

## Production read-only count (owner-approved, run once)

File: `backfill-scope-count-readonly.sql`, sha256 `7c88f5cd622ee71402693c4312693e4dfc98418e5cd5bc41b4b1d1f52f191e14` (2,991 bytes).
- It was submitted once, unchanged, through `query_database` to `8cf1f99e`.
- It is a single SELECT that returns counts and catalog flags only.
- It covers exactly the rows the backfill writes and the owner undo reverses: current
  `license_front`/`license_back` documents of non-deleted applications, and the objects they name.

| Count | Production | Needed for an exact undo |
|---|---|---|
| `objects_with_content_sha256_key` (the approved count) | **0** | 0 |
| `objects_with_sha256_key` | 0 | 0 |
| `objects_user_metadata_null` / `_not_object` | 0 / 0 | 0 |
| `docs_hash_already_set` | 0 | 0 |
| `docs_in_scope` / `objects_in_scope` | 24 / 20 | — |
| `objects_shared_by_multiple_docs` / `docs_with_multiple_objects` / `docs_immutable_path` | 0 / 0 / 0 | — |
| **`docs_without_object`** | **4** | — (see below) |
| `storage_objects_has_version` / `has_user_metadata` | true / true | — |
| `storage_objects_user_triggers` / `updated_at_trigger` | 2 / 1 | — |

The two Storage triggers are Supabase's own: `update_objects_updated_at` (BEFORE UPDATE, sets
`updated_at = now()`) and `protect_objects_delete`. The definitions were read from the disposable
project.

## Undo exactness: confirmed, no capture needed

`scripts/m2-window1-undo-rehearsal.sh` (local harness, synthetic data) seeds production's exact
profile, adds both Supabase triggers, records 20 hashes through the step 2 recorder as
`service_role` (as `writeUploadedContentSha` does), then runs the owner undo
`proposed/rollback/backfill-content-sha.sql`. Result:
- `user_metadata`, `content_sha256`, `version`, `metadata` and every other column of all 24 documents
  and 20 objects are **identical** to the pre-backfill snapshot;
- all 20 binding rows are deleted;
- out-of-scope rows are untouched (including one carrying a client `content_sha256` key);
- the step 2 rollback and the hosted step 1 rollback then run cleanly.

**Only difference:** the trigger-maintained `updated_at` changes on 20 objects and 24 documents.
The undo's `UPDATE` also touches the 4 documents that were never hashed. No SQL path restores these
timestamps. No M2, app or Storage logic reads them for these rows (the recorder binds by `version`,
which production has).

## Window 1 gate blocker: 4 licence documents have no stored object

The gate (`proposed/backfill-document-content-sha.sql`) requires `missing=0`. The rehearsal shows
those 4 documents leave it at `missing=4` whatever the backfill does: there are no bytes to hash.
Approval for those applicants would also be refused after step 3
(`license_documents_ambiguous_or_missing`) until a new licence is uploaded.

## Investigation of the 4 (owner-approved, read-only, run once)

File: `missing-files-investigation-readonly.sql`, sha256 `70476487c6f841c4a8d0206fc99e17ab02f4ab7862c6320783d13cc52f280f16`.
It returns labels, statuses, day-precision dates, booleans and counts only: no ids, names, paths or
images.

| | m1 | m2 | m3 | m4 |
|---|---|---|---|---|
| category | license_front | license_back | license_front | license_back |
| application status / contact status | closed / unqualified | closed / unqualified | closed / unqualified | closed / unqualified |
| user account / signed agreement | no / 1 signed | no / 1 signed | yes / none | yes / none |
| rentals / identity reviews | none / none | none / none | none / none | none / none |

The pairing is m1 + m2 and m3 + m4 (identical application metadata); the correction asserts exactly
2 applications.

**Common to all four:**
- *Applications:* created 2026-10-05, reviewed, last updated 2026-10-15. Not deleted, purged,
  duplicate, on legal hold or expired.
- *Document rows:* kind `document`, `application/pdf`, uploaded by **staff** on 2026-10-05, review
  status `verified`. No size was recorded, and no audit entry exists for the document.
- *The file:* bucket `license-uploads` exists. Nothing is at the path, in any other bucket, under a
  case or slash variant, or in the same folder.
- *Replacements:* no other document in the same category exists for these applications, and no
  current licence of the other side has a file. No legacy `license_photo_url` is set.

**Reading:** these are staff-entered licence records on two closed, unqualified applications. The
rows were created on 2026-10-05, but the PDFs were never stored, or were removed with their whole
folder. Nothing superseded them, and no replacement exists. **None is needed for an active
approval:** both applications are closed, with no rental and no identity review. A closed
application *is* an approval source status, so if one is reopened, step 3 refuses approval until
a new licence is uploaded. That holds whether or not these rows stay current.

**Exclusion under existing rules:** the backfill excludes only non-current documents and deleted
applications, so these rows are not excluded today. Soft-deleting the applications is wrong (one
has a signed agreement). Changing the gate would rebuild the reviewed package.

## Smallest correction for missing=0 (proposed; needs separate owner approval)

`mark-missing-licence-docs-not-current.sql` (sha256 `44f71ac9…5089c`), submitted only as
`request-mark-missing-licence-docs.sql` (guard v3 + those bytes, sha256 `e2c91d05…be1a3`).

**What it does:**
- sets `is_current = false` on exactly those 4 rows;
- writes one `document.marked_not_current` audit row each.

**What it does not do:** delete anything, or change the path, hash, application, agreement, rental,
Storage or any policy.

**It refuses, changing nothing, unless every investigated fact still holds:**
- exactly 4 rows on 2 closed applications;
- the same bucket, uploader role, type, review status and dates;
- one front and one back each;
- no rental and no identity review.

It then asserts that no current licence in scope names a missing file. Approval stays closed for
those applicants until a new upload: step 3 needs exactly one current front and back with verified
bytes.

`scripts/m2-window1-missing-licence-fix.test.ts` (local harness, synthetic profile): 6/6.
- A tampered request is refused.
- Drift is refused whole: an extra missing row, or a reopened application.
- The exact request changes only those 4 rows and adds 4 audit rows. Applications, agreements,
  objects, other documents and Security 0031 are unchanged.
- A second submission is refused.
- After steps 1–2 and a backfill, the gate reads **missing=0 mismatched=0**.
