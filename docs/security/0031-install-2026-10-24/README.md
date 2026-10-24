# Security 0031 — installed in production, 2026-10-24 13:15:26 UTC

Approved operation: one Lovable `query_database` call to project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6`
with `../0031-package-v2/request-v2-guard3.sql` (`1acaf722…7c32`, package `d101c54e…`).

| Check | Result |
|---|---|
| Preflight (`preflight.json`) | every gate GO; `0023` unapplied; storage-policy authority present |
| Submission | completed, no error: the guard and every package gate passed (any failure raises) |
| Executed bytes (`pg_stat_statements`) | guard `cd0365c3…` (1,960 bytes) and package `8d030e94…` (22,501 bytes) = the approved files minus their final `;\n`; 1 call each |
| Policies | 5 `RESTRICTIVE` `SELECT` for `{authenticated}`; exactly 1 on `storage.objects` |
| Audit evidence | 1 row `ae016d33-b706-4421-8190-a9bbe6101ddd`: executor and session `postgres`, txid 100208, SQL `cf8d5572…`, catalog `c753236e…`, five verified policy names |
| Migration records | Drizzle 23 (journal hash unchanged), Supabase 105 |
| Fingerprint (`fingerprint-before.json`, `after-install.json`) | policies 165 → 170, storage policies 24 → 25, audit rows 886 → 887; every other value identical, including roles, memberships, grants, functions, columns, triggers and other policies |
| Owner / Manager / driver access (`access-before-after.json`) | identical before and after |
| Coordinator test (`coordinator-test-result.txt`) | aborted with `permission denied for schema private` before counting; nothing committed; role state unchanged; not retried |
| Coordinator test v2 (`coordinator-test-v2-result.json`), one approved run | aborted by design; simulated Coordinator is staff, not manager; **0** applications, identity reviews, identity documents, agreements and identity files; keeps 20 non-identity documents and 10 vehicles. Role table hash, policies, evidence and receipts unchanged |

**Status: Security 0031 fully verified, 2026-10-24. Installation workstream closed.** Do not reinstall
or modify the five policies; any change is a new, separately approved package.
