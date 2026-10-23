# M2 cutover sequence, interrupted-install recovery, and the rehearsal blocker

2026-10-23. Read-only preparation. No SQL was executed against production, no
flag changed, no document modified. **The 24 packet files and 31 rollback files
are byte-unchanged from `29d47ee3`; nothing in this document edits them.**

Companion to `docs/development/M2-GO-NO-GO.md`, which holds the four decisions
and the evidence behind them. This one is the operational procedure.

---

## 1. The cutover sequence

Two publishes and two SQL phases, in this order. The ordering is not a
preference: each position is forced by a named constraint.

| # | Action | Forced by |
|---|---|---|
| **1** | Publish **Release A** — `release/m2-app-flags-off`, both flags `false` | Step 3 installs `approval_application_guard`, which refuses the direct `status='approved'` write that live `67b62664` performs. Release A routes Approve through `approveThroughPacket`, which falls back to the legacy write on `PGRST202` only. Must be live **before step 3**; may be live days earlier. |
| **2** | Soak Release A | It is the only publish whose effects can be observed without any SQL installed. Confirm Preview check 1 against production traffic. |
| **3** | **Step 1**, verify | Creates `rr_approval_executor`. Inert to Release A. |
| **4** | **Step 2**, verify | Installs `record_uploaded_content_sha` and `private.uploaded_content_sha`. Still inert to Release A, because the flag is off and the hasher returns before any call. |
| **5** | Publish **Release B** — same branch, both flags `true` | **After step 2** so every licence uploaded from this moment is hashed, and **before step 3** so the approval boundary never meets an unhashed upload. This is the ordering that removes the outage. |
| **6** | `scripts/backfill-document-content-sha.ts --write` | Hashes the 24 historical licence documents. Flag-independent: it calls `writeUploadedContentSha` directly. |
| **7** | `proposed/backfill-document-content-sha.sql` **as a report** | The gate. `missing = 0` **and** `mismatched = 0`. The script's own dry-run output is not the gate — a dry run never downloads. |
| **8** | **Step 3**, verify | The approval boundary. From here Approve requires a verified identity review and a server-recorded licence hash. |
| **9** | **Steps 4 – 25**, verify each | Record Rental. |
| **10** | **Step 29**, verify with `proposed/m2-verify/step29-after-step25.sql` | Closes the CREATE window. Step 29's own query cannot pass here — see section 2. |

Steps **26** (vehicle swap), **27** (extend) and **28** (return checklist) are
out of this window. Their application code is dark.

**Window length.** Steps 5 → 7 is the only part that must run back to back, and
it is bounded by the backfill: **24 documents, roughly 20 minutes.** Everything
before step 5 and after step 8 can be paced.

**What is interrupted, and what is not.** Between Release B and step 3 the
Verify Identity action errors with `PGRST202`, because `verify_approval_identity`
arrives with step 3. **Approval itself is unaffected** in that gap — the RPC does
not exist yet, so Release B still falls back to the legacy write. Rolling that
gap back is a publish, not a rollback: revert Release B. No SQL past step 2 has
run.

**One ordering trap.** Once step 3 commits, **Release B cannot be reverted on its
own.** With step 3 installed and the flags off, the identity UI disappears and
Approve closes. The order is always step 3's rollback first, then revert
Release B.

**And a rollback window that closes on first use.** `rollback/00-approval-boundary.sql`
raises `00_rollback_unused_install_only` when any `approval_identity` or
`verified` row exists. Immediately after step 3 there are none. **The first time
a manager uses the new Verify Identity action, that rollback stops working**, and
recovery becomes export-and-remove (`rollback/00-approval-data-export.sql`) or
point-in-time recovery. If step 3 is to be reversible, do not let staff use the
action until the install is finished.

---

## 2. The step 29 verification mismatch — resolved without touching the SQL

Each per-step verify asserts an exact function count. After step 25 there are
**71**; step 29's own query asserts **76**, because steps 26 – 28 contribute
five. Run after a 1 – 25 install it returns `f` on a **correct** install, which
the runbook reads as "stop and roll back".

Resolved by composition, not by editing either approved query:

- **`proposed/m2-verify/step29-after-step25.sql`** — the step 25 query **verbatim**
  (99 lines, `count(*)=71`) plus the **two** `has_schema_privilege(...,'CREATE')`
  negations copied **verbatim** from the step 29 query. No new SQL logic.
- **`scripts/m2-step29-after-step25.mjs`** generates it from
  `proposed/HOSTED-INSTALL.md`. Nothing is retyped.
- **`scripts/m2-step29-after-step25.test.mjs`** asserts the composition is
  faithful: exactly two lines added, both present verbatim in step 29, and
  removing them reproduces the step 25 query byte for byte. It also asserts
  71 ≠ 76, so if the counts ever converge the test says the file is obsolete.

Checked on a real PostgreSQL 16.15: the composed query **parses**. The only error
on an empty cluster is `function "private.record_agreement_evidence(...)" does
not exist` — name resolution, as expected with no packet installed. A control
with a deliberate syntax error returns `syntax error at or near "AND"` instead,
so the two outcomes are distinguishable.

Still the owner's call: run all 29 steps and use step 29's own query, or run
1 – 25 + 29 and use this composed one. If the composed one is chosen, it must be
written into the runbook before the window opens, so nobody is reading a query
that is expected to fail.

---

## 3. Interrupted-install recovery, step by step

### Why this reduces to "which steps committed"

Every install file is exactly one transaction, and so is every rollback —
counted, not assumed. The 24 packet files carry no `BEGIN`, so `psql -1` or a
single editor run is the transaction. The five approval-boundary files each
contain exactly one `BEGIN` and one `COMMIT`. All 30 rollback files likewise.

**So no step can leave partial state.** Every step is fully committed or fully
absent, and recovery never depends on what the operator remembers doing.

### Locating the stop point

Run `scripts/m2-hosted-preflight.ts` read-only against the database. It prints
one `PASS`/`STOP` line per object, each labelled with the step that first
creates it. The highest step whose objects are present is the last committed
step. No new SQL, no recollection.

### The one temporary privilege

Step 5 (`proposed/m2-packet/03.sql`) holds the packet's **only** `GRANT CREATE`:

```sql
CREATE ROLE rr_record_executor NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT rr_record_executor TO postgres WITH SET TRUE;
GRANT CREATE ON SCHEMA private, public TO rr_record_executor;
```

All three statements are in the **same transaction**, so a failed step 5 leaves
neither the role nor the grant. The role is `NOLOGIN NOSUPERUSER NOBYPASSRLS`
and granted to `postgres` only; every per-step verify asserts that neither `anon`
nor `authenticated` is a member. While the grant stands the reachable path is
`postgres`, not a client JWT.

### Immediate verification and revocation

After **any** stop, run **`proposed/m2-verify/no-executor-create.sql`** and record
the result. It must return `t`. It covers both schemas and all three executor
roles, where the preflight's `public CREATE holders` row covers only `public` and
only fails for `anon`/`authenticated`.

Proven on PostgreSQL 16.15 with both controls:

| State | Result |
|---|---|
| No `rr_` role exists | **`t`** |
| After step 5's exact `GRANT CREATE ON SCHEMA private, public` | **`f`** |
| After step 29's exact `REVOKE CREATE ON SCHEMA public, private` | **`t`** |

### Which branch to take

| Stop point | Grant | Action |
|---|---|---|
| **Before step 5 commits** | none exists | Nothing to revoke. Run the assertion, record `t`, stand down. |
| **After step 5, before step 8**, abandoning | stands | **Unwind.** Run each committed step's rollback in **strict reverse step order**, ending with step 5's `rollback/03-record-rental.sql`, which does `REVOKE ALL ON SCHEMA "public"` and `"private"` (CREATE included) then `DROP ROLE`. Reverse order is required: later steps depend on earlier objects. Then the assertion. |
| **At or after step 8, before step 29**, holding to resume | stands | **Close it early.** The last ownership transfer inside 1 – 25 is **step 7** (`05.sql`); steps 8 – 25 transfer nothing. Run `proposed/m2-packet/21-revoke-executor-create.sql` now, then the assertion, then resume into 8 – 25 later. Do **not** take this branch if you will resume into **step 26**, which transfers `private.swap_operations`, `private.swap_number_seq` and `swap_rental_vehicle_tx` and needs CREATE again; `rollback/21-revoke-executor-create.sql` re-grants it if you change your mind. |
| **Any stop with an `approval_identity` or `verified` row present** | stands | The step 3 and step 9 rollbacks **refuse** (`00_rollback_unused_install_only`, `06b_rollback_unused_install_only`). Export with `rollback/00-approval-data-export.sql`, move and remove those rows, then unwind. If they cannot be moved, restore from backup or PITR. **Do not force the rollback.** |
| **Completed through step 29** | revoked | Step 29's own verify, or the composed query for a 1 – 25 install. |

**Note on the existing stop rule.** The runbook says *"Run only that step's
rollback, then stop."* That is right for returning a single failed step, and it
is **not** a complete stand-down: it leaves every earlier step committed,
including step 5's grant. And at a stop past step 7, step 5's rollback is itself
wrong — it drops a role the committed steps depend on. Use the table above.

### Standing rule

> No M2 install is left stopped. Every stop ends in one of the rows above, and
> `proposed/m2-verify/no-executor-create.sql` is run and its `t` recorded before
> standing down.

### Per-step reference

Transaction mode and the rollback file for each step, taken from the approved
Order table. Steps **2, 3, 9, 14 and 25** carry their own `BEGIN`/`COMMIT` and
must be run **without** `psql -1`; every other step uses `-1` or one editor run.

| Step | Install file | Txn | Rollback for this step |
|---|---|---|---|
| 1 | `01.sql` | `-1` | `01-auth-binding.sql` |
| 2 | `record-uploaded-content-sha.sql` | own | `record-uploaded-content-sha.sql` |
| 3 | `00-approval-boundary.sql` | own | `00-approval-boundary.sql` |
| 4 | `02.sql` | `-1` | `02-safe-release.sql` |
| 5 | `03.sql` | `-1` | `03-record-rental.sql` |
| 6 | `04.sql` | `-1` | `04-closeout-legacy-guard.sql` |
| 7 | `05.sql` | `-1` | `05-evidence.sql` |
| 8 | `06.sql` | `-1` | `06-document-identity.sql` |
| 9 | `06b-approval-identity-check.sql` | own | `06b-approval-identity-check.sql` |
| 10 | `07.sql` | `-1` | `07-evidence-consumer.sql` |
| 11 | `08.sql` | `-1` | `08-evidence-recovery.sql` |
| 12 | `09.sql` | `-1` | `09-issuer-permissions.sql` |
| 13 | `10.sql` | `-1` | `10-approval-permissions.sql` |
| 14 | `10b-approval-executor-writes.sql` | own | `10b-approval-executor-writes.sql` |
| 15 | `11.sql` | `-1` | `11-executor-permissions.sql` |
| 16 | `12.sql` | `-1` | `12-deposit-nullability.sql` |
| 17 | `13.sql` | `-1` | `13-closeout-projection.sql` |
| 18 | `14.sql` | `-1` | `14-issuer-identity-permissions.sql` |
| 19 | `15.sql` | `-1` | `15-consumption-scope.sql` |
| 20 | `16.sql` | `-1` | `16-closeout-scope.sql` |
| 21 | `17.sql` | `-1` | `17-storage-integrity.sql` |
| 22 | `18.sql` | `-1` | `18-subscription-coordination.sql` |
| 23 | `19.sql` | `-1` | `19-signed-archive-protection.sql` |
| 24 | `19b.sql` | `-1` | `19b-agreement-evidence.sql` |
| 25 | `19c-agreement-contract.sql` | own | `19c-agreement-contract.sql` |
| 26 | `20.sql` | `-1` | `20-vehicle-swap.sql` |
| 27 | `extend.sql` | `-1` | `extend-rental.sql` |
| 28 | `return.sql` | `-1` | `return-checklist.sql` |
| 29 | `21-revoke-executor-create.sql` | `-1` | `21-revoke-executor-create.sql` |

---

## 4. The rehearsal blocker, and how to clear it

Still **NO-GO**. Not runnable from this container: no Docker daemon
(`/var/run/docker.sock` absent) and no Supabase CLI.

### A finding that makes this easier than Security 0031

The packet creates **48 policies: 47 on `public.*` tables and one on
`private.approval_operations`**, a table it creates itself. **None on
`storage.objects`.** There is no `CREATE POLICY` on `storage`, no `ALTER TABLE
storage.*`, no `GRANT ON SCHEMA storage`. Steps 2 and 3 reference
`storage.objects` only inside function bodies, which resolve at execution time.

So M2 does **not** need the Storage-policy authority that Security 0031 is
blocked on. `postgres` owns `public.*` and the packet creates `private`, so the
production role can install every one of those 48 policies. **M2 is not gated on
0031.**

### Options, best first

| Option | Docker | Real Storage / Auth / PostgREST | Note |
|---|---|---|---|
| **A throwaway Supabase project** | no | **yes** | Free tier. The most faithful thing reachable without Docker, and it exercises the real Storage API that the conditional content-hash merge depends on. **Recommended.** |
| A Supabase **branch** on the hosted plan | no | yes | Cleanest if the plan includes branching; confirm before relying on it. |
| Supabase CLI local stack (`supabase start`) | **yes** | yes | Needs a machine with a Docker daemon. Not this container. |
| Vanilla PostgreSQL + stubs | no | **no** | What the preserved 16.15 / 17.11 rehearsal is. Keep it; it cannot replace the above. |

### What the new environment must contain

The preserved rehearsal failed twice on exactly this, and the causes are
recorded in `docs/m2-rehearsal.md`. The baseline needs `supabase/migrations`
**plus** two objects that live Drizzle created and `supabase/migrations` does
not:

- `public.application_identity_reviews` — `drizzle/migrations/0019_application_identity_reviews.sql`, grants tightened by `0020`. Step 6 (file `04.sql`) drops and replaces its `application_identity_reviews_resolution_check`.
- `applications.deleted_at`, with `deleted_by`, `deleted_reason`, `purged_at`, `legal_hold` from the same statement — `drizzle/migrations/0016_0016_driver_deletion_stage1.sql`.
- `public.application_waitlist_holds` — Drizzle `0014_waitlist_holds_and_safe_promotion.sql`. `extend_rental_tx` names it inside a PL/pgSQL body, so a missing table lets `CREATE FUNCTION` succeed and fails only at execution.

**No packet file may be edited to add them.** On the real database these objects
already exist, so a packet that created them would fail there.

Two replay notes from the same record, both outside the packet: one migration
grants `applications.sms_consent` before another adds the column, and several
later migrations repeat a `CREATE POLICY`/`CREATE TRIGGER` an earlier one already
applied. Whoever builds the baseline will hit both.

### What the rehearsal must then prove

1. All 29 steps apply in order, each per-step verify returning `t`.
2. `proposed/m2-verify/step29-after-step25.sql` returns `t` after a 1 – 25 + 29 run.
3. `scripts/m2-hosted-preflight.ts` prints `PASS` on every line before step 1.
4. The content-hash merge against **real** `storage.objects` rows — the one thing
   a stubbed table cannot show, and the mechanism the whole approval boundary
   rests on.
5. Approve through `approve_application_checked` on a **manager's own JWT**, and
   the direct service-role write refused.
6. Each rollback, in reverse, returning the catalog to the baseline.
7. `proposed/m2-verify/no-executor-create.sql` returning `t` at the end.

Item 4 is the reason the preserved evidence is not sufficient on its own.
