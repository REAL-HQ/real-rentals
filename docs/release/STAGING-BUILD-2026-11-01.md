# Staging build — jcjsdribajbfracrmnkm — 2026-11-01 (t33u + t35 safeguard)

Executed ~8:20–8:28 PM ET via the Supabase connector (role `postgres`, db `postgres`, system id 7702070854497379551).
`guard.sh --db-only` passed before every submission, and every submission began with the system-id guard. Each submission ran once; no retries.
No production, Lovable, old staging or Stripe access; no deploy; no key requested. Rollback = delete the staging project.

## Baseline (16 submissions, all OK) — `scripts/staging/build/gen-batches.py`, manifest and SHA256SUMS in `evidence-2026-11-01/`
- b000: Lovable `sandbox_exec` role + its default grant (Supabase already has the anon/authenticated/service_role defaults); drizzle ledger table.
- b001–b012: 118 supabase files (labelled sms_consent GAPFILL included) + drizzle 0000–0022, each batch in one transaction.
- b013: 23 production ledger rows → first-23 md5 `5cfa7e88…` (= production). b014: production definitions of the 3 functions. b015: exclusions (no-ops).
- **t35 safeguard**: in the same transaction as each cron-scheduling file (6 supabase + drizzle 0000/0001), every drivereal.com job is unscheduled and its absence asserted.
  Drizzle 0000 itself inserts a 'fleet-inbox' token, so the safeguard deletes it in the same transaction (it never commits) and asserts it is absent.
  This was found by the local replay of the exact submissions, which caught it before staging.
- Local replay of the exact submissions (`local-replay.sh`, recording pg_cron emulation): 197/197, 0 drivereal jobs, 0 fleet token.

## Checks on staging
- 197-object comparison vs production: **197/197 identical** after the baseline and again after all packages (0 missing, 0 extra, 0 differing).
- Recomputed 0031 catalog hash (staging, pre-0031): `37a805cb499b0a91b9d7dbbed82ced944b80ac19b0af5f0e6044e0f2f84d62d8` (production `c753236e…`; local `dbb3fe8e…`).
- audit_log ACL = production pin exactly; applications ACL after S1 = production S1 evidence exactly.

| Step | Preflight | Install | Verify-after |
|---|---|---|---|
| 0031 v2 (sysid + catalog hash adapted) | inner gates | OK | 0031 policies md5 `d3387761…` = production (seen in every later preflight/verify) |
| RECONSTRUCTED S1 | inner gates | OK | adapted read-only gates: 9/9 substantive true incl. journal_exact_23 and policies_0031_exact; evidence gates false/null by design (RECONSTRUCTED evidence row) |
| insurance activation setting | 19/19 ok | OK | 15/15 |
| insurance verification authority | 13/13 ok | OK | 8/8 |
| payments DELETE guard | 13/13 ok | OK | 6/6 |
| payments write guard | 13/13 ok | OK | 6/6 |
| 0023 | 15/15 ok | OK | 7/7 |

- The S1 verify script first failed **at compile time** (read-only, no state change): it counted `supabase_migrations.schema_migrations`, which does not exist on staging (receipts are not recreated by design).
  It was adapted to return 0 when that table is absent (`evidence-2026-11-01/s1-verify-adapted.sql`) and run once.
- Normalized fingerprint (181 objects): staging overall **`5f8a7d0f…` = local `5f8a7d0f…`**, identical line by line.
- Functional tests (`functional-tests-staging.sql`, one submission, fake rows: `*@test.invalid`, "STAGING TEST", fixed test UUIDs): **24/24 pass**.
  End state: application active, 1 active rental, payment void, 2 payments. Insurance exception = false.
- Cron/pg_net (final, 01:28 UTC = 8:28 PM ET): cron jobs 0 (drivereal.com 0), cron runs 0, pg_net queue 0, responses 0, fleet-inbox token 0, fleet jobs 0.

## Differences
- Staging has no `supabase_migrations` receipts (by plan) and no cron jobs (safeguard). Production has both.
- 0031 catalog hash is environment-specific (above). Synthetic test rows remain on staging (4 auth users, 1 application, 1 vehicle, 2 payments, etc.).
