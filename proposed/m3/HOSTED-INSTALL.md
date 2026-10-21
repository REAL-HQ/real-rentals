# Hosted M3 install

Proposed procedure for two owner-pending database changes. This file does not connect to a database, and it does not run the install. Nothing in this repository applies these files. They are not drizzle migrations and they are not `supabase/migrations`. Take a backup, or confirm point-in-time recovery covers the start of the window, before any statement that writes.

No application flag is changed. This packet does not add a flag. `WAITLIST_CLAIM_SECRET` is not read and is not stored.

The local rehearsal is Postgres on `127.0.0.1:55442`. `SHOW server_version` there returned `16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)`. Run the same statement on the hosted database and record what it returns. Do not assume the local string.

## What the two steps do

Step 1 adds the Driver Doc Expiry dates for Uber and Lyft approval. The source is `proposed/driver-doc-expiry-tnc.sql` on PR #226 at `7bfe60e4`. `license_expiration` and `insurance_expires_on` are already on `public.applications` and this step does not modify them. The new columns are nullable `date` values with no default:

- `public.applications.tnc_uber_approval_expires_on`
- `public.applications.tnc_lyft_approval_expires_on`

A nullable column with no default does not rewrite existing rows. The application row count stays the same. The columns inherit the existing applications row policies. The file does not grant and does not create a policy. There is no column-level ACL on either new column.

Step 2 is the Coming Soon waitlist email limit. The source is `proposed/waitlist-coming-soon-rate-v1.sql` on `cursor/waitlist-claim-b1d6` at `dda2f73b` (PR #173). The function is `public.waitlist_coming_soon_email_limit()`. It is `SECURITY DEFINER` with `search_path` empty. A before-insert trigger stamps `created_at` to `now()` and raises `waitlist coming soon rate limit` when that trimmed, lowercased email already has 5 rows in the last hour. Every source counts. The advisory lock key is `btrim(lower(email))`. The index is `waitlist_coming_soon_email_created_idx` on that expression and `created_at`.

`SECURITY DEFINER` is required. An invoker count runs as the inserting role. `anon` cannot `SELECT` `public.waitlist`, so the insert would fail with permission denied. A definer that still obeyed row level security would miss other sessions' rows, and the limit would never trip. The empty `search_path` keeps an unqualified name from being redirected. The checklist reports the owner of `public.applications` and `public.waitlist` and requires that owner to be a superuser or `BYPASSRLS`, because the function owner is the installer. The session that runs the checklist is a separate least-privilege role.

The source file grants `EXECUTE` to `anon` and `authenticated`. On the local rehearsal the trigger body still ran when the inserting role's `EXECUTE` privilege was false. The body runs as the function owner. This packet therefore revokes `PUBLIC`, `anon`, `authenticated`, and `service_role`, and it does not grant. That is the only difference from the source function body. Existing `anon` insert privileges stay the 12 Coming Soon columns from migration `20260721192708`. `created_at` is not one of them. Roles that can set `created_at` still cannot backdate it, because the trigger overwrites it for every role, including `service_role`.

## Assumptions

- The limit is email-only. `public.waitlist` has no IP column. An IP limit would store a hash and is a separate owner decision.
- `WAITLIST_CLAIM_SECRET` stays an application HMAC key, at least 32 bytes, and it is not the service-role key. PR #173 signs the claim token with it and stores only a nonce hash. This packet does not add `claim_token_hash`. The preflight reports whether that column is already present. Either answer is a pass.
- The existing waitlist insert policy still rejects an email that fails its pattern. Trimming groups the counter. It does not widen what that policy accepts. A padded address is in the same bucket when the trigger runs, which is before the policy check.
- Re-running an apply file is safe when the object already has this shape. A different type, a different function body, a trigger on another table, or an index of the same name with a different definition raises and the file rolls back.
- Rollback drops only what that step added. Step 1 does not drop `license_expiration` or `insurance_expires_on`. Step 2 does not change grants and does not drop `claim_token_hash`.

## How a file runs

Run one file per execution. Do not paste the next file into the same run.

Each apply file and each rollback file contains `BEGIN` and `COMMIT`. Run it without psql `-1`, so its `COMMIT` commits only that file. `lock_timeout` is 2 seconds inside the file and does not stick.

```
psql -v ON_ERROR_STOP=1 -f proposed/m3-packet/01-tnc-approval-expiry.sql
```

The verify files and `proposed/m3/preflight.sql` are a single `SELECT`. Run each one alone. Do not wrap a verify file in the same execution as an apply file.

## Pre-checks

Stop if any of these fail. Nothing has been written yet, so there is nothing to roll back.

1. `SHOW server_version;`
2. `bun scripts/m3-hosted-preflight.ts --url '<local url>'`. It loads `proposed/m3/preflight.sql` and accepts exactly one `SELECT`. A tokenizer handles comments, standard strings, `E''` strings, dollar quotes, and quoted identifiers, so a semicolon inside those cannot start another command. A function call is refused unless it is `exists`, `to_regprocedure`, `to_regclass`, `coalesce`, `string_agg`, `count`, `current_setting`, `pg_catalog.pg_get_userbyid`, or `pg_catalog.has_column_privilege`. A `U&` identifier or string is refused. The URL is refused when it sets `standard_conforming_strings`, including through `options`. After connect the script prints `STOP` and does not run the checklist when that setting is not `on`, when the current role is a superuser (`run as least-privilege read-only role`), or when `dblink` or `postgres_fdw` is installed. Those extensions can write from a read-only transaction. The statement is sent with the extended protocol (`prepare: true`, `simple: false`), which rejects a multi-command string. The connection sets `default_transaction_read_only` to `on`. The transaction checks that `transaction_read_only` is `on` and ends with `ROLLBACK`. Run it as a least-privilege read-only role. The script does not create that role. `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, and `PGDATABASE` fill in parts the URL leaves out. It prints the host and port only. Pass `--url`. A host other than `127.0.0.1`, `localhost`, or `[::1]` also needs `--hosted`. There is no default connection, and the script does not read `SUPABASE_URL`. The checklist prints 17 preflight rows plus `transaction_read_only`. Every `ok` value is true before install. `applications rows` and `waitlist rows` are reports: a non-zero count is still true. Both TNC columns are `absent`, read from `information_schema`, so a missing column is that row and does not raise. The rate function, trigger, and index are `absent`. `anon`, `authenticated`, and `service_role` are present. The owner of `public.applications` and `public.waitlist` is a superuser or `BYPASSRLS`. `anon` insert columns are the 12 Coming Soon columns.

After step 2 is installed, the same preflight no longer says the new objects are absent. That means the packet is already there. It is not a signal to drop it.

## Order

After each file, run its verify file in a new execution. The query must return `t`. If the file errors before commit, that file rolled back. Fix it and run it again. Do not run its rollback. If the file commits and the verification returns `f` or errors, stop and use the rollback named on that row. Roll back in reverse order: step 2, then step 1.

| Step | File | Transaction | Verify | Rollback if this step committed and the check failed |
| --- | --- | --- | --- | --- |
| 1 | `proposed/m3-packet/01-tnc-approval-expiry.sql` | own `BEGIN`/`COMMIT`, no `-1` | `proposed/m3-verify/01-tnc-approval-expiry.sql` | `proposed/m3-rollback/01-tnc-approval-expiry.sql` |
| 2 | `proposed/m3-packet/02-waitlist-coming-soon-rate.sql` | own `BEGIN`/`COMMIT`, no `-1` | `proposed/m3-verify/02-waitlist-coming-soon-rate.sql` | `proposed/m3-rollback/02-waitlist-coming-soon-rate.sql` |

HOSTED-INSTALL step 1 is `proposed/m3-packet/01-tnc-approval-expiry.sql`.

HOSTED-INSTALL step 2 is `proposed/m3-packet/02-waitlist-coming-soon-rate.sql`.

## Local proof

`scripts/m3-rehearsal-proof.sh` clones the local database `m2` on `127.0.0.1:55442` into `m3_rehearsal`, proves the packet there, and drops `m3_rehearsal`. It refuses a non-loopback URL, and it refuses to write `m2`. It does not connect to a hosted database. Install, verify, and rollback use the local superuser. The preflight uses a separate `m3_preflight_reader` role with `pg_read_all_data`, and the proof drops that role after it drops the clone. It runs `scripts/m3-step-citations.test.mjs`, `scripts/m3-hosted-preflight.ts` (one `SELECT`, allowlist, extended protocol, `ROLLBACK`, `checklist stops=0 checks=18`), each apply file twice, each verify file, `scripts/m3-rate-proof.sql`, then each rollback. `pg_dump --schema-only --no-owner` after step 2's rollback matches the snapshot taken after step 1. The same dump after step 1's rollback matches the snapshot taken before step 1. Waitlist table and column ACLs after step 2 match the snapshot taken before step 1. The rate proof inserts and rolls back, and it leaves no `m3-proof-` rows. No application flag is changed.

SHA-256 of the current files:

| File | SHA-256 |
| --- | --- |
| `proposed/m3-packet/01-tnc-approval-expiry.sql` | `1e8e53c5996acd96ce02c2589a0c9494b7a3e3c98d38e0868d1e337b57836470` |
| `proposed/m3-packet/02-waitlist-coming-soon-rate.sql` | `7cadfc39c7892bafb5794b20693df18aa46b6a10a50657af7a323d321da30877` |
| `proposed/m3-verify/01-tnc-approval-expiry.sql` | `8844ad6ce3651d0b4c37d31b9f2b35db85606d44fbe7e3c68381668d7c0f0739` |
| `proposed/m3-verify/02-waitlist-coming-soon-rate.sql` | `fb72ba5230c0a6813370741cf3fc7531895c173b36c46865281e2d558d933788` |
| `proposed/m3-rollback/01-tnc-approval-expiry.sql` | `281295b8de768d7e94c37339bd128de96f655c673e592e18e3ea8644097fd85e` |
| `proposed/m3-rollback/02-waitlist-coming-soon-rate.sql` | `35028430946f2221f85606c5d7b0292138d0229da7ed6159501f01ad1d84544d` |
| `proposed/m3/preflight.sql` | `3bd8ee74845eb70c2050a21be1035ccc4e0e6fce864a291552b12c21d46eb082` |
