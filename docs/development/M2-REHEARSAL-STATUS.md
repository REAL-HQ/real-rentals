# M2 rehearsal — environment provisioned, replay in progress

2026-10-23. **Status: IN PROGRESS. Not a GO/NO-GO.** The environment exists and
its fidelity is proven; the baseline replay is **14 of 122** migrations in.
Security 0031 is resolved (`docs/security/0031-ROOT-CAUSE.md`). Two blockers are
open, both needing an owner action: see section 6.

No production SQL was executed. No production credential, Stripe key or
customer record was used or copied. One **read-only** catalog query was run
against production, recorded in section 4.

## 1. The environment

| | |
|---|---|
| Lovable project | `c27f585c-ae1a-4ca2-b61f-a0d29c170f64` |
| Workspace | `cGRWl46NvDMHQ0QKwl9X` ("My Lovable") |
| Database | Supabase, provisioned by `enable_database` |
| Access | `query_database` only — no connection string is exposed |

**Isolation.** Production is a different Lovable project in a **different**
workspace, on a different Supabase project. The rehearsal project was created
fresh, and at provisioning held **0 public tables, 0 `auth.users`, 0
`storage.objects`, no `rr_%` role** and none of the packet's objects. Production
has 142 applications and 10 vehicles. They cannot be confused.

## 2. Fidelity — why this is a real hosted rehearsal

| HOSTED-INSTALL pre-check | Rehearsal | Production |
|---|---|---|
| `SHOW server_version` | **17.11** | 17.6 |
| `storage.objects.version` is `text` | **yes** | yes |
| `storage.objects.user_metadata` is `jsonb` | **yes** | yes |
| `postgres` is superuser or BYPASSRLS | **not superuser, BYPASSRLS true** | identical |
| `postgres` holds CREATE on `public` | **yes** | yes |

All six Supabase schemas (`auth`, `storage`, `extensions`, `graphql_public`,
`realtime`, `vault`) and all six Supabase roles are present, and
`storage.objects` has its real 15-column shape.

**Better than the preserved vanilla rehearsal in two ways that matter:**

- `pg_net`, `pg_cron` and `pg_graphql` are **available and installed**. The
  vanilla replay had to strip those `CREATE EXTENSION` lines.
- `pgcrypto` is in `extensions`, so `extensions.digest` works — which
  `scripts/m2-content-sha.test.ts` needs and skipped locally.

**Both runbook transaction modes are reproducible.** `query_database` accepts
multi-statement batches and explicit transactions, proven with a `BEGIN /
CREATE TABLE / ROLLBACK` probe that genuinely rolled back. So a `-1` packet file
runs as `BEGIN; <file> COMMIT;` and an own-transaction file runs verbatim.

## 3. Replay progress — 14 of 122, and what was deliberately omitted

Progress is tracked in the rehearsal database itself, not in notes:
**`public.__rehearsal_ledger`** records each applied migration with its
sequence, filename, local SHA-256 prefix and a note. It is the authority on
what has been applied, and it caught a bookkeeping error early — two
migrations believed applied were not, which the ledger and a catalog check
(`public.documents` absent, `app_role` having 2 of 5 values) exposed
immediately.

Applied: migrations **1 – 14** (all of them; 6 was a no-op, see below).

Current state: **22 tables**, **59 public policies**, 8 storage policies,
5 private storage buckets (`driver-docs`, `license-uploads`,
`profile-screenshots`, `rental-agreements`, `condition-media`), **0 rows**.

**Omitted on purpose, and this must not be forgotten:**

- The demo-vehicle seed `INSERT` in migration 1, and the `UPDATE` statements in
  migrations 4 and 6. The authorization is synthetic data only, and the
  rehearsal will get purpose-built synthetic rows instead. **These are data
  statements, not schema**, so the baseline schema is unaffected — but any
  later claim of a "full faithful replay" has to exclude them explicitly.

**108 migrations remain.** The channel is the constraint: there is no
connection string, so every statement is relayed through tool arguments. Batches
of ~20 KB are accepted, so this is mechanical but long, and the per-step verify
queries are what will catch any relay error — a corrupted statement shows up as
a failed verification, which fails the rehearsal by the rule you set.

## 4. Security 0031 — RESOLVED, see docs/security/0031-ROOT-CAUSE.md

This came out of a privilege probe on the rehearsal project and is the most
consequential thing found today.

0031 has been blocked all along on the conclusion that the production executor
cannot create policies on `storage.objects`, because `CREATE POLICY` needs
superuser or table ownership and `BYPASSRLS` does not grant it.

**On the rehearsal project, `CREATE POLICY ... ON storage.objects` succeeded** —
with these facts:

| | Rehearsal | Production (read-only query) |
|---|---|---|
| `storage.objects` owner | `supabase_storage_admin` | `supabase_storage_admin` |
| Members of `supabase_storage_admin` | **none** | **none** |
| `postgres` CREATE on `storage` schema | **no** | **no** |
| `postgres` UPDATE on `storage.objects` | yes | yes |
| `postgres` in `supabase_privileged_role` | **yes** | **yes** |
| Existing `storage.objects` policies | 1 (the one just created) | 24 |
| Server version | 17.11 | 17.6 |

So the privilege that matters is almost certainly membership in
**`supabase_privileged_role`**, which production's `postgres` also holds — and
the earlier reasoning did not account for it.

**This does not yet prove production can do it.** The versions differ (17.11 vs
17.6) and only an attempt on production settles it.

**The bounded check, which needs your approval and which I have not run:** on
production, inside an explicit transaction, `CREATE POLICY` a throwaway policy
on `storage.objects` and then `ROLLBACK`. It persists nothing and leaves no
policy behind; it only answers whether the privilege exists. It is still a write
attempt against production, so it is yours to authorize.

## 5. What remains before any GO/NO-GO

1. Relay the remaining 118 migrations, then
   `proposed/rehearsal/drizzle-prerequisites.sql`.
2. Fail loudly if the baseline is empty or any of the three Drizzle objects is
   missing.
3. `scripts/m2-hosted-preflight.ts` — every line `PASS`.
4. Steps 1 – 29 with every per-step verify returning `t`.
5. The reduced path's `proposed/m2-verify/step29-after-step25.sql`.
6. `proposed/m2-verify/no-executor-create.sql` returning `t`.
7. All rollbacks in reverse, back to the baseline catalog.
8. The ten validation areas, with synthetic rows only.

Two of the ten cannot be reached through `query_database` alone and need to be
reported as such rather than claimed: the **real Storage API upload path**
(`info()` and `download()`, which the content-hash merge binds to) and a true
**PostgREST JWT round trip**, including the schema-cache reload after step 3.
Manager and Coordinator boundaries can be exercised with `SET LOCAL ROLE` plus
`request.jwt.claims`, which is how Supabase RLS is normally tested, and that
distinction will be stated in the final report.

---

## 6. The two open blockers

### 6a. Storage API and PostgREST JWT testing — blocked by the session's network policy

The rehearsal Supabase project is reachable in principle: its endpoint and
publishable key are now in the project source, and the five private buckets
exist. But outbound HTTPS from this session is refused:

```
nhcgrevnanuzroudxpux.supabase.co:443 — connect_rejected
gateway answered 403 to CONNECT (policy denial)
```

This is the session's egress policy, not Supabase. **To unblock, add
`nhcgrevnanuzroudxpux.supabase.co` to the environment's Allowed domains** (cloud
environment menu → Edit → Network access), leaving "Allow package managers"
ticked. Steps: https://code.claude.com/docs/en/cloud-environments#network-access

Per the instruction not to substitute SQL-only role simulation for real API
testing, nothing here is being simulated and nothing is reported as passed.
Once the host is allowed, this covers real uploads and downloads, content
hashing over the real `info()`/`download()` path, JWT authorization through
PostgREST, and schema-cache reload behaviour after step 3.

### 6b. No bulk SQL path — the relay works but is slow

Investigated, as asked:

| Route | Available |
|---|---|
| Postgres connection string from the Lovable MCP | **no** — no tool exposes one |
| `query_database` with large multi-statement batches | **yes** — ~20 KB per call, explicit transactions supported |
| Supabase Management API | needs a personal access token |
| Having the Lovable agent apply the SQL | rejected: it would paraphrase, and fidelity is the whole point |

So the relay is viable and verified, just slow. **The fast supported route is a
direct Postgres connection string for the disposable project only**, from that
project's Supabase dashboard. With it the remaining 108 migrations, the 24
packet files and the 31 rollbacks run locally with `psql -f`, at full fidelity,
and with the runbook's `-1` and own-transaction modes applied natively instead
of emulated. That is a credential for a throwaway project holding no real data —
not a production credential.

---

## 7. Update — 59 of 122, and a production-contact hazard found in the migrations

### Progress

| | |
|---|---|
| Migrations applied | **59 of 122** (sequence 1–59, contiguous) |
| Public tables | 27 |
| Public policies | 70 |
| Storage policies | 23 |
| `private` functions | 7 |
| Storage buckets | 5, all private |
| `cron.job` rows | **0 — deliberately** (see below) |
| Rows of real data | none; `markets`/`sites` hold configuration rows only |

Checks that passed along the way, each asserted in the same statement that
applied the work:

- Migration 36 rewrote every helper reference from `public.*` to `private.*`
  through a `DO` block: **6 private helpers created, 0 leftover public
  wrappers, 53 policies rewritten.** That is the largest structural migration
  in the baseline and it applied cleanly.
- `anon` and `authenticated` both have **no `USAGE` on `private`** after
  migration 46 — one of the privilege assertions every HOSTED-INSTALL per-step
  verify repeats.
- `app_role` carries all 5 enum values; `public.documents`, `public.rentals`,
  `public.agreements` and `public.agreement_templates` all present.

### Deviations, all recorded in the ledger — sequences 39, 46, 47, 58

**One replay fix (39).** Migration 39 grants `INSERT` on
`applications.sms_consent`, a column migration 44 adds. The column was added
first, exactly as `docs/m2-rehearsal.md` records from the earlier run. **The
defect reproduced precisely**, which is itself a result for validation item 1:
the dependency ordering in `supabase/migrations` is wrong in that one place, on
any fresh replay. No migration file was edited.

**Three production-contact safety omissions (46, 47, 58).** This is worth your
attention beyond the rehearsal.

Migrations 46, 47 and 58 each call `cron.schedule(...)` with a job body that
does:

```
extensions.http_post(url := 'https://drivereal.com/api/public/cron/wizard-recovery', ...)
extensions.http_post(url := 'https://drivereal.com/api/public/cron/ops-reminders', ...)
```

`pg_cron` and `pg_net` are **really installed** on this rehearsal project, not
stubbed as they were in the vanilla run. So scheduling those jobs would have
made the **rehearsal database call production every hour**, with a bearer token
from its own `private.cron_tokens`. That is squarely inside "do not connect to
production", so the `cron.schedule` calls were skipped. Everything else in those
files — the columns, `private.cron_tokens`, the token rows, the
`get_cron_token` functions — was applied.

`cron.job` is verified **empty**, and the M2 packet touches no cron object, so
nothing downstream depends on this.

**The general point:** any replay of `supabase/migrations` into a live Supabase
project will schedule hourly POSTs at drivereal.com unless those three calls are
removed. Worth knowing before anyone clones production for any other purpose.

### Connection investigation — settled, no faster route exists

You approved a direct PostgreSQL connection if available. It is not, and no
credential would change that:

| Probe | Result |
|---|---|
| DNS for `db.<ref>.supabase.co` and `aws-0-*.pooler.supabase.com` | **does not resolve** in this environment |
| Proxy `CONNECT` to port **5432** | connection reset — non-443 ports are not tunnelled |
| Proxy `CONNECT` to port **443** | **403**, a policy denial — this is the allowlist |
| `socat` / `ncat` / `proxytunnel` | **not installed** |
| `psql` | present (16.15), but has nothing it can reach |

So I did not ask for a database password: it could not be used, and asking would
have put a credential in chat for nothing.

**What the 443 allowlist would unlock, beyond the Storage and JWT tests:** with
HTTPS to the project reachable, a `SECURITY DEFINER` exec function created in
this disposable database and called over PostgREST with the project's service
key becomes a genuine bulk SQL channel — the remaining migrations, the 24 packet
files and the 31 rollbacks could be posted in a handful of requests instead of
transcribed. That is acceptable **only** because this database is disposable and
holds no real data, and the function would be dropped at the end. It is not a
pattern for production.

Until then the relay continues in verified batches, as instructed.

---

## 8. Intentional rehearsal safety exclusions — cron jobs that call production

Owner-acknowledged 2026-10-23. These are **deliberate**, not defects in the
rehearsal, and they are recorded on each affected ledger row with the prefix
`INTENTIONAL REHEARSAL SAFETY EXCLUSION`.

Rule, set by the owner: no scheduled jobs or webhooks calling drivereal.com from
the rehearsal environment.

| Ledger seq | Migration | Job | Target |
|---|---|---|---|
| 46 | `20260722235626_0c2a4606…` | `wizard-recovery-hourly` | `https://drivereal.com/api/public/cron/wizard-recovery` |
| 47 | `20260722235657_f2c6714d…` | `wizard-recovery-hourly` (reschedule) | same |
| 58 | `20260815153000_4b3d85d0…` | `ops-reminders-daily` | `https://drivereal.com/api/public/cron/ops-reminders` |

In each file only the `cron.schedule(...)` call was excluded (and in 47 the
`DROP`/`CREATE EXTENSION pg_net` cycle, since `pg_net` already lives in
`extensions`). Every other statement — columns, `private.cron_tokens`, the token
rows, `get_cron_token` — was applied. `cron.job` is verified empty. The M2
packet touches no cron object.

**Five more files schedule the same kind of job** and will be handled the same
way: 60 (`/cron/automations`), 62 (`/cron/late-fees`), 68 (`/cron/automations`),
69 (`/cron/late-fees`), 92 (`/cron/esign-archive-retry`). Migrations 93, 94 and
121 only name a `resend_message_id` / `provider` column and send nothing.

## 9. Connectivity — allowlist confirmed

After the owner allowlisted `nhcgrevnanuzroudxpux.supabase.co` on 443, a single
harmless read-only request was made:

```
GET /rest/v1/markets?select=slug&limit=2   (publishable key)
-> HTTP 200  [{"slug":"tampa"}, {"slug":"orlando"}]
```

Configuration rows only. The Storage API and PostgREST JWT validations are now
reachable. They depend on the packet being installed, so they run after it.

## 10. Bulk execution — proposed, not built

See `docs/development/M2-REHEARSAL-BULK-PROPOSAL.md`. Hand relay cannot prove a
file is byte-identical to the repo, so **the packet will not be run by hand
relay**: a packet result whose bytes cannot be proven is not a result. Baseline
relay continues meanwhile.

---

## 11. Paused at 60 of 122 — pending the bulk-staging decision

Migration 60 (`fleet_ops_foundation`, 33 KB) applied in two parts: 39 public
tables, 6 buckets (adds `vehicle-docs`), 30 inspection-template items, one
automation workflow seeded **inactive**, `cron.job` still **0**. Its
`automations-every-5-min` job (POSTs to drivereal.com every five minutes) is the
fourth intentional rehearsal safety exclusion.

**Why the relay is paused rather than continued.** Files 1–60 were retyped
through tool arguments. Their schema effects are catalog-verified batch by batch,
but their bytes cannot be proven identical to the repo. Every further file
relayed by hand adds to that unprovable set, while the proposal in
`M2-REHEARSAL-BULK-PROPOSAL.md` would let files 61–122 — and the packet — run
byte-exact with the database computing each hash. Continuing by hand now would
lower the provability of the final result.

If the proposal is approved there are two ways forward:

| Option | Files 1–60 | Effort |
|---|---|---|
| Continue from 61 on this project | stay hand-relayed, catalog-verified only | lowest |
| **Rebuild from scratch on a fresh disposable project** | **byte-exact like the rest** | slightly higher; bytes travel by `curl`, not transcription |

The second makes the whole rehearsal provable end to end and is the
recommendation. The `sms_consent` ordering fix and the cron exclusions carry over
unchanged: the column is added by a separate recorded statement before file 39
runs, and cron files run byte-exact with every job unscheduled before commit.
