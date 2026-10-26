# M2 Window 1: missing-files recheck (2026-10-26, read-only)

**Trigger:** Grok's Preview QA saw "File Missing from Storage" on two non-agreement files of an eSign test record.

**Method:** `proposed/m2-window1/backfill-scope-count-readonly.sql` (sha256 `7c88f5cd…`), plus one aggregate of
every `documents` row whose storage object is missing. Read-only (`SET TRANSACTION READ ONLY`); counts only, no ids,
paths or customer data.

## Backfill scope (current `license_front` / `license_back`, application not deleted)

| Item | Count |
|---|---|
| docs_in_scope | 21 (was 20 after the 2026-10-24 correction; one organic licence upload since) |
| docs_without_object | **0** |
| objects_in_scope | 21 |
| Shared / multiple objects | 0 / 0 |
| Already hashed | 0 |
| `sha256` / `content_sha256` keys present | 0 / 0 |
| `user_metadata` null / not an object | 0 / 0 |

## All documents without a storage object

| Category | Current | Application | Count | In backfill scope? |
|---|---|---|---|---|
| `gig_profile` | yes | closed | 2 | No (category) |
| `insurance` | yes | closed | 2 | No (category) |
| `license_front` | **no** | closed | 2 | No (not current; the 2026-10-24 correction) |
| `license_back` | **no** | closed | 2 | No (not current; the 2026-10-24 correction) |

## Conclusion

- Grok's two files are among the `gig_profile` / `insurance` rows. They are outside the content-hash backfill scope.
- **They are not a Window 1 blocker.** The Window 1 data gate (`docs_without_object = 0`) still holds.
- They are a data-hygiene item on a closed test record. They need an Owner decision (leave, or mark not-current with a
  separately approved correction like 2026-10-24's). They are not part of M2.
- Re-run this check immediately before any Window 1 approval.
