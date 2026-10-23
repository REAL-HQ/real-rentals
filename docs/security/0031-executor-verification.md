# Security 0031 — executor verification by read-only means

Prepared 2026-10-23 by Claude Code. Every fact below comes from a read-only
`SELECT`. **No DDL, no DML, no migration was submitted, no deployment state
changed.** Verified: the Supabase ledger still holds **105** receipts and the
drizzle ledger **23**, unchanged across ~20 queries.

## 1. Direct answer: can the migration executor report its effective role read-only?

**No. Not reliably, and not for its current privileges.** Two things are
readable, and neither is the answer:

| Source | What it reports | Why it is not the answer |
|---|---|---|
| `supabase_migrations.schema_migrations.created_by` | `apikey@lovable.dev` — for 101 of 105 receipts, including all four Oct 7 ones | An **API identity**, not a PostgreSQL role. It says who submitted, not what role executed. |
| Owner of objects a past migration created | `postgres` owns `public.fleet_service_transactions`, created by the Oct 7 migration | Ownership can be **normalized after creation** (`ALTER TABLE … OWNER TO postgres` is routine Supabase behaviour), so it is evidence, not proof, of the executing role. |

So the executor's effective role is **not established**, exactly as you
cautioned. What follows is what *is* established.

## 2. The October 7 migration did execute, byte for byte

Not inferred from the repo — read from the ledger:

| | |
|---|---|
| version | `20261007034524` |
| `created_by` | `apikey@lovable.dev` |
| statements | **1** (the whole file as a single statement) |
| recorded statement length | 4,162 bytes |
| recorded statement SHA-256 | `9285a2ea57be057d45acdea9d0655e39d5ff33be0f0930c27509782a95c68872` |
| repo file SHA-256 | **`9285a2ea…` — identical**, 4,162 bytes |
| contains `CREATE POLICY "Managers manage vehicle doc objects" ON storage.objects` | yes |
| contains `CREATE POLICY "Staff manage operational vehicle doc objects" ON storage.objects` | yes |
| contains `CREATE TABLE public.fleet_service_transactions` | yes |

The file ran as **one statement**, so it committed or it didn't. The table
exists and both policies exist. **It committed.** The Lovable migration
mechanism did create policies on `storage.objects`.

## 3. The contradiction, stated plainly

The same transaction created a table now owned by `postgres`. But verified
today:

| Check | Value |
|---|---|
| `postgres` `rolsuper` | **false** |
| owner of `storage.objects` | `supabase_storage_admin` |
| members of `supabase_storage_admin` | **0 — the role has no members at all** |
| `pg_has_role('postgres','supabase_storage_admin','USAGE')` | **false** |
| `has_schema_privilege('postgres','storage','CREATE')` | **false** |
| `postgres` memberships | `anon`, `authenticated`, `authenticator`, `pg_create_subscription`, `pg_monitor`, `pg_read_all_data`, `pg_signal_backend`, `sandbox_exec`, `service_role`, `supabase_privileged_role`, `supabase_realtime_admin` |
| `supabase_admin` `rolsuper` | **true** (the only superuser in that set) |

`CREATE POLICY` requires superuser or ownership, and ownership passes only for a
member of the owning role. **`postgres` satisfies neither today**, and cannot
grant itself the membership: PostgreSQL 16 requires ADMIN OPTION on the target
role, and `postgres` is not a member of it at all.

Two explanations fit, and the catalog cannot distinguish them:

- **(a)** The executor was not `postgres` (likely `supabase_admin`, the one
  superuser), and the new table's ownership was normalized to `postgres`
  afterwards.
- **(b)** The executor was `postgres` and it held storage privileges on
  October 7 that have since been revoked by a Supabase platform change.

**Either way, present-day authority is not established.** Under (a) 0031's
`execution_role: postgres` pin is wrong for that route; under (b) the pin is
right but the privilege is gone. The install cannot proceed on Grok's inference,
and I am not treating historical success as present authority.

## 4. A caveat worth recording: a receipt is not proof of execution

Three receipts carry
`created_by = 'reconciled: applied out-of-band, end state verified before recording'`
(versions `20260925160000`–`20260925170000`). Those rows were **recorded after
the fact for SQL the mechanism did not run.**

So ledger presence alone never proves the mechanism executed something. For
October 7 it does, because `created_by` is the API identity *and* the recorded
statement hash matches the file *and* its objects exist — three independent
checks. That standard should apply to any future claim made from the ledger.

## 5. The proposed probe — it WOULD be recorded, so it is not being run

You asked whether the `DO` block would create a receipt or persistent change.
**It would.** Every submission through the migration mechanism inserts a row
into `supabase_migrations.schema_migrations` — that is how all 105 got there.
A receipt is persistent deployment state. **Not executed. Presented here for
separate approval.**

### Exact statement, if you approve it

One file in `supabase/migrations/`, e.g.
`20261023HHMMSS_executor_identity_probe.sql`:

```sql
DO $$
DECLARE
  v text;
BEGIN
  SELECT format(
    'executor=%s session=%s super=%s owns_storage=%s storage_create=%s privileged=%s',
    current_user,
    session_user,
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
    pg_has_role(current_user, 'supabase_storage_admin', 'USAGE'),
    has_schema_privilege(current_user, 'storage', 'CREATE'),
    pg_has_role(current_user, 'supabase_privileged_role', 'USAGE')
  ) INTO v;
  RAISE EXCEPTION 'EXECUTOR_PROBE: %', v;
END $$;
```

### Consequences, stated exactly

- **It raises an exception on purpose.** The transaction aborts, so the probe
  writes nothing and leaves no object behind. The answer arrives in the error
  message.
- **Because it aborts, it should leave no receipt either** — but I cannot
  promise that: whether the mechanism records a receipt for a failed submission
  depends on Lovable's runner, which I cannot read. Treat "a receipt may be
  created" as the worst case.
- **No DDL, no DML, no grants, no ownership change, no schema change** in either
  outcome.
- Rollback: nothing to roll back. If a receipt row appears, it can be deleted by
  a separately approved statement, or left as a harmless record.
- It consumes one migration version number.

### A cheaper alternative that answers less

Lovable's `query_database` channel executes SQL and provably creates **no**
receipt — 105/23 unchanged across all my queries. Through it, `current_user` is
`postgres` with none of the storage privileges. But that channel is **not
provably the migration executor**, so it cannot settle §3. It is why the probe
is the only self-reporting option, and why the honest answer to §1 is "no".

### The zero-execution alternative, which I recommend first

Ask Lovable Support one narrow question: *"When the migrations API applies a
file for project `yuyzdsnrbfhkmfzpvhwx`, what PostgreSQL role executes the
statements, and does it retain `CREATE POLICY` authority on `storage.objects`?"*

That costs nothing, risks nothing, and answers §3 completely. The probe is the
fallback if they will not say.

## 6. Single atomic installation — the preferred route, and it looks feasible

Per your instruction: **all five restrictive policies in one transaction through
the proven Supabase route. No split.** Not prepared as a package yet, because
§3 is unresolved — but the shape is settled, and one finding makes it simpler
than feared:

> **Installing via `supabase/migrations/` does not touch the drizzle ledger.**
> `drizzle.__drizzle_migrations` stays at **23** rows. So a package whose journal
> pin expects **23** is exactly right for this route — and the missing
> 23-receipt resealed artifact is precisely that package.

Consequences:

- The **23-receipt artifact is the correct package for this route**, not a
  compromise. Recovering it is now the highest-value single action.
- `0023` must stay unapplied, or the drizzle ledger moves to 24 and the pin
  fails. It is pending today, so the window is open.
- Only the **role pin** is in question. If §3 resolves to (b) — executor is
  `postgres` — then the existing seal is correct as written and **nothing needs
  resealing at all.** If (a), the role pin must change, which is a new package
  under §7.
- All four `public.*` policies are on tables `postgres` owns, and the fifth is
  the only one needing storage authority — so one transaction covers all five if
  the executor has that authority, which is exactly what §3 asks.
- Atomicity is preserved: the package is a single `DO` block, and the Oct 7
  precedent shows this mechanism runs a whole file as one statement.

**No split plan is being prepared.** I will only propose one if the
single-transaction route is demonstrated impossible, and then only as a
separately reviewed document.

## 7. If a new package turns out to be necessary

Only if §3 resolves to (a). It would be a **new package with a new checksum that
does not inherit the old approval**, per your instruction. Requirements, to be
met before it is proposed for review:

1. **New SHA-256**, printed alongside the old one, with the old explicitly
   marked superseded and not reused.
2. **Explicit differences** — a line-by-line diff against the approved inner SQL
   `cf8d5572670cb3f865fc0911d623ff070e6a9be1ca8d254c87db8f2a5c3cd723`, with each
   change justified. Expected changes: the `execution_role` pin, and nothing else.
3. **Unchanged protections demonstrated** — the five policies byte-identical,
   and every guard still present and still firing.
4. **Disposable rollback tests** — forward and rollback exercised in a throwaway
   PostgreSQL cluster, as `scripts/closeout-harness/` already does for the
   closeout change: install, verify the five policies, roll back, verify clean
   removal, plus negative controls proving each guard refuses a tampered input.
5. **Independent review required** — stated on the package itself: it is not
   covered by the earlier approval and needs its own.

I am **not** writing that package now. §3 first.

## 8. Status

| | |
|---|---|
| Did the Oct 7 migration create Storage policies? | **Yes — proven three ways** |
| Does a read-only operation report the executor's effective role? | **No** (§1) |
| Is present-day Storage authority established? | **No** (§3) |
| Would the probe be recorded? | **Yes — so it was not run** (§5) |
| Recommended next step | **One question to Lovable Support** (§5), zero execution |
| Highest-value recovery | **The 23-receipt artifact — it is the right package for this route** (§6) |
| Installation | **Blocked. Needs your separate approval, and §3 resolved first.** |
