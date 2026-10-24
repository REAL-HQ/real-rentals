# Security 0031 v2 — collation-corrected package (prepared; not approved for production)

Supersedes `../0031-package/0031_guarded_coordinator_containment.sql`
(`32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f`). That file stays
unchanged for audit history. It must not be installed: on production's `en_US.UTF-8` it
always refuses (`../0031-direct-attempt-2026-10-24/`). v2 inherits no approval.

| Artifact | SHA-256 | Bytes |
|---|---|---|
| `0031_guarded_coordinator_containment_v2.sql` | `d101c54e903f8495b1d1c6fa063319a3ac5a88340cc0e5bd276b60cc87a3e9d1` | 22,503 |
| `submission-guard-v2.sql` (from `../0031-direct-route/gen-guard.py`) | `bdabb8dfc1a6244777da1282886ea841ef223d1f120f1d465efb2ecb65bef1c3` | 1,362 |
| `request-v2.sql` = guard + unchanged v2 package | `e84fe067eb0c169e79ff15b57c9ac62ac8de4953d7e32dc35b5b73144a9a257a` | 23,865 |
| Inner approved DDL (unchanged; checked by the package itself) | `cf8d5572670cb3f865fc0911d623ff070e6a9be1ca8d254c87db8f2a5c3cd723` | — |

## The change (`EXACT-v1-to-v2.diff`: one line, one expression)

```
- ... SELECT jsonb_agg(p ORDER BY p->>'policyname') FROM jsonb_array_elements( ...
+ ... SELECT jsonb_agg(p ORDER BY (p->>'policyname') COLLATE "C") FROM jsonb_array_elements( ...
```

The normalisation now sorts each table's policies in the same C order as the "before"
snapshot (`ORDER BY policyname`, type `name`). Nothing else changed:
- the five policy definitions and the inner DDL;
- role restrictions and catalog scope;
- the journal pins;
- the audit evidence and every other guard.

The normalisation's table sort (`t->>'schema', t->>'name'`) was left alone. For the fixed
seven-table scope it orders identically under C and `en_US`. Production showed this read-only
(`tables_order_same: true`), and test T2 shows it again.

The guard differs from v1's only in the expected length and hash.

## Disposable verification (`test/`, results in `test/results.json`): 25/25 pass

Environment:
- PostgreSQL 17.6 (production's version);
- a database created with libc `en_US.UTF-8`, matching production;
- `replica.sql`, which reproduces the exact catalog scope the package inspects, including
  production's 24 mixed-case `storage.objects` policy names and the 23-receipt journal.

Test copies change exactly two profile values (system identifier and catalog hash), and this
is asserted (T0b). Every request is sent as the Management API sends it: one transaction, with
its comment trailer.

| # | Required demonstration | Result |
|---|---|---|
| T0 | Cluster orders like production: the old normalisation reorders `storage.objects`, the new one does not | pass |
| T1 | Original package fails with `POST_UNEXPECTED_CATALOG_CHANGE`; nothing persists | pass |
| T1b | Control: on a C-collation database the original passes, which is why earlier tests missed it | pass |
| T2 | Corrected package passes the same scenario | pass |
| T3 | All five restrictive SELECT policies install together; exactly one evidence row | pass |
| T3b | Role effect: Coordinator loses identity data but keeps non-identity documents and objects; Owner, Manager and driver unchanged | pass |
| T4a–e | Genuine catalog mutations still refused (`POST_UNEXPECTED_CATALOG_CHANGE`): extra grant, extra mixed-case storage policy, dropped policy, widened helper ACL, new column | pass |
| T5a | Failure after the DDL leaves no policies and no evidence | pass |
| T6 | Re-run after success refused (`PARTIAL_INSTALL`); state unchanged | pass |
| T7 / T7b | Drizzle journal identical on the direct route; a receipt added first is refused (`JOURNAL_DRIFT_OR_REPLAY`) | pass |
| T8a–c | Real `request-v2.sql`: guard passes and the package refuses the foreign target; a one-byte policy weakening is refused by the guard; a statement placed before the guard is refused and rolled back | pass |
| T9 / T9b | Production Coordinator plan rehearsed (below) | pass |

**Negative controls** (one guard weakened in a v2 test copy; the matching test must then fail):

| # | Weakened guard | Outcome |
|---|---|---|
| N1 | Catalog comparison removed | mutation accepted, so detected |
| N2 | Partial-install check removed | re-run refused only by a different guard (`SCHEMA_POLICY_GRANT_DRIFT`), so detected |
| N3 | Journal check removed | refused only later (`POST_JOURNAL_CHANGED`), so detected |
| N4 | A policy weakened to `USING (true)` | refused by `SQL_CHECKSUM_MISMATCH` |

Reproduce with `PG17_BIN=<postgresql 17 bin> bun test/run.ts`, run as root; the cluster runs
as an unprivileged user. Binaries used: npm `@embedded-postgres/linux-x64@17.6.0-beta.15`.

## Independent review checklist

- [ ] `sha256sum -c SHA256SUMS` passes; v1 still hashes to `32c17aa7…`.
- [ ] `EXACT-v1-to-v2.diff` changes one line, and the word diff is only
      `p->>'policyname'` → `(p->>'policyname') COLLATE "C"`.
- [ ] The inner `approved_sql` block is byte-identical: the package still checks `cf8d5572…`.
- [ ] `request-v2.sql` = `submission-guard-v2.sql` + package, with nothing else:
      `cat submission-guard-v2.sql 0031_guarded_coordinator_containment_v2.sql | cmp - request-v2.sql`.
- [ ] Guard v2 differs from guard v1 only in length (22503) and hash (`d101c54e…`).
- [ ] `test/run.ts` asserts the v1 and v2 bytes before testing, and test copies alter only
      the profile line (T0b).
- [ ] `test/replica.sql` matches production's inspected scope: audit-log ACL and columns,
      role-helper text, 23 receipts, mixed-case storage policy names.
- [ ] Results reproduce 25/25 on PostgreSQL 17 with `en_US.UTF-8`.
- [ ] The negative controls show each tested guard is load-bearing.

## Production operation requiring approval (not authorised)

Same procedure as `../0031-direct-route/README.md`, with v2 artifacts:
1. Read-only preflight (`../0031-preflight-readonly.sql`) and fingerprint
   (`../0031-direct-route/fingerprint-readonly.sql`); stop on any difference from
   `../0031-direct-attempt-2026-10-24/`.
2. One Lovable `query_database` call to project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6`
   with exactly `request-v2.sql` (`e84fe067…257a`). No retry.
3. Read-only verification (`../0031-direct-route/verify-after-readonly.sql`). The expected
   `executed_text` for v2 is `{len 22501, sha 8d030e94bb381d6217ffe53c37c0bc79f5ec7b392536ad41791badac57216921}` (the package minus
   its final `;\n`, as `pg_stat_statements` records it). Then the fingerprint (policies +5, storage policies +1,
   audit rows +1, everything else unchanged), and the Owner and Manager access recheck
   against the 2026-10-24 baseline.

## Coordinator access test (production has no Coordinator account)

`coordinator-access-test.sql` is one always-aborting statement. It borrows one existing
driver login, gives it the coordinator role inside the transaction only, counts what that
user can read through row-level security, and raises. Nothing commits; it returns counts
only. It refuses if a real Coordinator exists; use that account instead. Rehearsed as T9 and
T9b: it sees no identity data, keeps non-identity documents, and the roles table is unchanged
afterwards.

Before use, read-only: confirm `public.user_roles` accepts a second role row for a user
(constraints and enum labels), and that none of its triggers reach outside the transaction.
Running it on production is a separate approval.
