# Staging readiness (option B: fresh Supabase project), 2026-10-31

Prepared by VIBE, ~11:10 PM ET. **Plan only.** Nothing was created, deleted, wiped, paused or written. No production access of any kind. Inventory = read-only `SET TRANSACTION READ ONLY` queries on the old staging, aggregates only.

## Readiness checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Exact identifiers | **PASS** | Old staging: project `bhpdppyxnkokzhlkgcsc` "real-rentals-app-resume-staging", org `jzabyqmbinqnzkxcccug` (REAL HQ, **free plan**), us-east-1, PG 17.11.0.003, system id **`7692130048193495360`**. Production: ref `yuyzdsnrbfhkmfzpvhwx`, system id `7642734024280108049`, hosted by Lovable (not in this org). |
| 2 | Isolation from prod | **PASS (DB) / RISK (repo)** | Different system id and project (so different keys). 0 FDW servers, no dblink/postgres_fdw, no pg_net, no cron schema, 0 functions mentioning the prod ref or drizzle.com/drivereal.com, 0 edge functions. **Risk:** the committed repo `.env` points `SUPABASE_URL`/publishable key at **production**, and `.env.production` holds a `pk_live_` token. Every staging run must override all `.env` values (see §Stripe). |
| 3 | Inventory | **Done** | 20 public tables, all RLS on: applications 5, application_resume_tokens 20, application_recovery_attempts 10, application_identity_reviews 4, applicant_upload_grants 43, applicant_upload_authorizations 43, audit_log 3, documents 2, markets 1, user_roles 4, staging_email_captures 6, staging_email_capture_attempts 15; rentals, vehicles, partners, app_settings, odometer_readings, automation_* = 0. **No `payments` table.** 17 public policies; 0031 policies absent. Functions: 8 public, 14 private. Triggers include `applications_active_guard`, `guard_application_identity_write`, audit append-only, and `staging_frozen` on 7 tables; **no S1 `zz_application_write_guard`**. No migration journals (supabase or drizzle). Storage: `license-uploads` (private, 3 objects), `profile-screenshots` (private, 0). Auth users: 4. Extensions: pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp. Secrets: not readable by the connector (names unavailable). |
| 4 | No real customer data | **PASS** | All 5 application emails, all 6 captured-email recipients and all 4 auth users are `@example.invalid`; 0 application phones outside 555-xxxx. The 3 storage objects were not opened; by provenance they are harness fixtures (UNVERIFIED by content). |
| 5 | Rebuild + rollback plan | **Prepared** | Below. Two gaps need Owner input. |
| 6 | Stripe test mode only | **PASS by design** | Plan uses only Owner-provided `sk_test_`/`pk_test_` + `stripe listen` webhook secret; code patch refuses non-`sk_test_` keys. No live keys, no change to the live endpoints `we_1TwE5m…`. |

## Cost

`get_cost` for a new project in org REAL HQ: **$0/month** (free plan). Free-plan limits: 2 active projects per org (today: old staging active, `advisors-club-staging` paused, so a new one makes 2 active); free projects pause after ~7 days idle; 500 MB DB.

**Recommendation:** re-pause old staging `bhpdppyxnkokzhlkgcsc` (needs your OK). It costs $0 but takes one of the 2 free active slots, and the new project needs one.

## Rebuild plan (new project, e.g. `real-rentals-staging-2026-11`)

1. Create the project in org REAL HQ, us-east-1 ($0). Record its ref and system id; every script below refuses on prod id `7642734024280108049` and pins to the new id.
2. Schema in production order from `release/financial-integrity-3` @ `4fdf5a78` (`scripts/staging/migration-order.sh`):
   1. `supabase/migrations/*.sql` (filename order);
   2. `drizzle/migrations` 0000–0022 and write the 23 journal receipts;
   3. guarded packages in production order, as adapted copies (only the system-id pin changes; diff recorded): 0031 v2 (`docs/security/0031-package-v2`, git `e0c2fe6e`) → S1 → activation-insurance-setting → insurance-verification-authority → payments-delete-guard → payments-write-guard (`fix/payments-write-guard-sql` @ `ed2ed072`) → 0023 (`feature/app-resume-finish` @ `b0f5158d`).
3. Settings: insurance exception **OFF**; autopay flags off; resume flags off.
4. Synthetic seed only: 1 Owner, 1 Manager, 1 driver (`*@example.invalid`, 555 phones), 1 vehicle, 1 market, fake licence images.
5. Verification (read-only): `scripts/staging/inventory-readonly.sql`; 0031 md5 = `d33877618a9f40924d14e49b6653d7fa`; S1 verify-after `all_gates: true`; 0023 verify-after 7/7; payment-guard verify-afters; drizzle first-23 md5. Scripts with the prod system id literal are run as copies with the new id substituted.

**Gaps needing Owner input**
- **G1:** production has 105 supabase receipts but the tree has 122 migration files. The exact production list needs one Owner-approved read-only production query (`SET TRANSACTION READ ONLY; SELECT version FROM supabase_migrations.schema_migrations ORDER BY 1;`, names only), or accept filename order and reconcile by schema diff.
- **G2:** the S1 install SQL is not in the repo (only its verify-after). Need the package (`proposed/security-s1`, commit `bd86d450` per README) from wherever it lives, or rebuild S1 from its verify-after spec (not byte-identical).

## Rollback

Delete the **new** project only (one dashboard/connector action, Owner-approved). Old staging `bhpdppyxnkokzhlkgcsc` is never modified. Code: delete branch `feature/staging-rehearsal`. Stripe: revoke the test restricted key; `stripe listen` stops when the process ends.

## Stripe test-mode plan

- App runs locally on the box (`vite dev`, development mode) from `feature/staging-rehearsal`, with a gitignored `.env.local` overriding **all** six Supabase values to the new project.
- Owner provides via masked secret requests (never in chat): `sk_test_…` restricted key (Charges/PaymentIntents/Customers/SetupIntents/Checkout write, webhooks read), matching `pk_test_…`, new-staging `SUPABASE_SERVICE_ROLE_KEY` (staging only; never the production one).
- `stripe listen --forward-to localhost:<port>/api/public/payments/webhook?env=sandbox` provides `PAYMENTS_SANDBOX_WEBHOOK_SECRET` locally. No Dashboard endpoint is created.
- Staging-only patch in `src/lib/stripe.server.ts`: if `LOVABLE_API_KEY` is unset **and** the key starts with `sk_test_`, call `api.stripe.com` directly; otherwise unchanged. Live keys are never accepted on that path. Never merged.
- Resend/Twilio/Anthropic keys left unset: no real email/SMS.
