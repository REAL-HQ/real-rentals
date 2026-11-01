# S1 read-only verification

`s1-verify-after-readonly.sql` is the exact reviewed S1 verify-after. It is copied byte for byte from the S1 package (`proposed/security-s1/verify-after-readonly.sql`, commit `bd86d450`); sha256 `9a4c46d859078e5b6d09e1bcccc72da35ad6a379133341b05a824714b3766a68`.

**Run it (with Owner approval):**
- through Lovable `query_database` on project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6`;
- with `SET TRANSACTION READ ONLY;` added as the first line;
- once.

It returns one JSON object (`s1_verify`) and reads catalog data and hashes only. Last full pass: 2026-10-31 02:18 UTC, `all_gates: true`.

## Reading the result after Drizzle 0023

The gate `journal_exact_23` hashes **every** row of `drizzle.__drizzle_migrations` and expects exactly the first 23 (`5cfa7e88ccac860637339bd9bdaab72c`).

**If 0023 added a 24th receipt,** this gate is `false` and `all_gates` is `false`. That is an expected consequence of 0023, not an S1 failure. In that case S1 is intact when all three of these hold:
1. the other 11 gates are all `true`: `evidence_one_well_formed`, `not_rolled_back`, `trigger_exact`, `trigger_sorts_last`, `function_exact`, `protected_columns_closed`, `authenticated_insert_form_only`, `anon_insert_unchanged`, `acl_matches_evidence`, `fingerprint_matches_evidence`, `policies_0031_exact`;
2. `facts.drizzle_receipts` = 24;
3. a separate read-only check shows the first 23 receipts still hash to `5cfa7e88…`:
   `SELECT md5((SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text);`

**If 0023 was applied without a Drizzle receipt,** all 12 gates must be `true`.

**Any other false gate means stop and report.** Don't attempt a fix.

0023 itself does not touch `public.applications`. It creates `application_recovery_attempts` and three functions, and none of them update applications. So `fingerprint_matches_evidence` and `acl_matches_evidence` should stay `true`.
