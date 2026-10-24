# Security 0031 — direct installation attempt, 2026-10-24 (refused by the package; nothing persisted)

Approved by the Owner: one guarded `query_database` submission of `../0031-direct-route/request.sql`.

| Step | Result |
|---|---|
| Local bytes | `request.sql` = guard + unchanged package; matches `SHA256SUMS` (`0d0c67d8…`, package `32c17aa7…`) |
| Preflight (`../0031-preflight-readonly.sql`) | every gate GO (`preflight-result.json`) |
| 0023 | not applied: no table, no functions, no receipt newer than #23 (`state-0023.json`) |
| Access baseline (RLS as real accounts; counts only; statement always aborts) | `access-baseline.json`; no Coordinator account exists in production (1 Owner, 2 Managers, 3 drivers) |
| Fingerprint before | identical in every field to the fingerprint taken before the first (migration-tool) attempt earlier on 2026-10-24 (`fingerprint-before.json`) |
| Submission (once) | `POST_UNEXPECTED_CATALOG_CHANGE`, line 121 (`execution-result.txt`) |
| After (read-only) | 0 policies, 0 evidence rows, Drizzle 23, Supabase 105, fingerprint identical to before (`after-attempt.json`) |

## Cause: a collation defect in the sealed package

`before_catalog` orders each table's policies with `ORDER BY policyname` (type `name`, which
always sorts in C order). The normalisation of `after_catalog` re-sorts them with
`ORDER BY p->>'policyname'` (jsonb text, the database default `en_US.UTF-8`, case-insensitive).
`storage.objects` is the only catalogued table with mixed-case policy names, so its 24-policy
array is reordered and the comparison fails even with no change at all. Read-only proof on
production: the normalisation alone, applied to the unchanged catalog, changes it
(`diagnosis.json`). The package's earlier tests ran on C-locale databases, where both orders
agree. As sealed, the package can never pass on production, whatever the route.

The route worked as designed: the guard proved the exact bytes, every earlier gate passed,
the policies were created exactly as sealed, and the refusal rolled everything back.

## Fix (not prepared or applied; needs a new package and a new approval)

One expression in the normalisation: `ORDER BY p->>'policyname'` →
`ORDER BY (p->>'policyname') COLLATE "C"`. This changes the inner package checksum (`cf8d5572…`
is unaffected; that hash covers only the DDL text) and the outer package checksum, so the guard
must be regenerated. The fix should be tested on a disposable database created with
`en_US.UTF-8` and the same mixed-case policy names.
