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
