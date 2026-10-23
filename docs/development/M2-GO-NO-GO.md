# M2 — GO/NO-GO on the four decisions

2026-10-23. Read-only investigation. No production SQL, no publish, no flag
change, no permission change. **The 29 packet steps, their checksums, their
per-step verify queries and all 31 rollback files are unchanged on this branch.**

| # | Decision | Verdict |
|---|---|---|
| 1 | Deployment sequence for the second application release | **GO to prepare** — sequence fixed; the port is scoped but not built |
| 2 | Application-approval interruption | **GO** — the outage is eliminable; residual is a ~20 minute scheduled window |
| 3 | Rehearsal against a Supabase-compatible environment | **NO-GO — blocked.** Cannot be provisioned from this container |
| 4 | Temporary CREATE privilege cleanup | **GO** — step-aware procedure below; step 5's rollback is *not* the right action at most stop points |

**Installation overall: NO-GO.** Gated on 3 (no rehearsal environment) and on 1
(the application release does not exist yet). Nothing here asks to install.

---

## Correction to this document's previous revision

Three statements in the earlier revision were wrong. They are corrected below
and the corrections change the plan, so they are stated plainly rather than
edited away.

1. **"Deploy the M2 app code" cannot mean deploying `29d47ee3`.** The two trees
   are divergent siblings, not ancestor and descendant.
2. **The approval window is not unavoidable.** It was called unavoidable in
   either order. It is removable by resequencing, because the backfill does not
   depend on the flag.
3. **The minimum sequence 1–25 + 29 has no valid verification query.** Step 29's
   verify asserts 76 functions; after step 25 there are 71.

---

## 1. Deployment sequence

### Both flags are plain source constants

```
src/lib/document-content-sha.ts:23   export const DOCUMENT_CONTENT_SHA256_ENABLED = false;
src/lib/identity-verification.ts:9   export const IDENTITY_VERIFICATION_ENABLED = false;
```

No environment variable reads either one. Activation is an edit plus a rebuild
plus a publish — **a release, not a toggle.** So the install needs two publishes,
not one.

### The M2 application code is on a divergent branch, not ahead of production

| | |
|---|---|
| Accepted, live release | `67b62664` (2026-10-23) |
| M2 packet base | `29d47ee3` (2026-10-22) |
| Merge base of the two | `7e3e6eb6` (2026-10-20) |
| `src/` diff `67b62664` → `29d47ee3` | **449 files, +1,538 / −55,759** |

`29d47ee3` is **not** production plus M2. It is an older sibling that never
received release #266. **Publishing it would revert the accepted release.** The
M2 application release must be built as a **forward port onto `67b62664`**.

#### Scope of the forward port — measured

Four modules are absent from `67b62664` and must be added whole:

| File | Lines |
|---|---|
| `src/lib/document-content-sha.ts` | ~190 |
| `src/lib/identity-verification.ts` | small |
| `src/lib/identity-verification.functions.ts` | small |
| `src/lib/approval-rpc.server.ts` | 62 |
| `scripts/backfill-document-content-sha.ts` | operational, not shipped |
| `scripts/m2-hosted-preflight.ts`, `m2-*.test.ts` | tooling and proofs |

Three existing files take call-site edits. `67b62664` has none of this code:
its approval path is the plain service-role `status: "approved"` write at
`applications.functions.ts:1254`, and its `documents.functions.ts` contains no
`persistConfirmedDocument`, no `UploadHasher` and no `content_sha256` at all.

| File | `67b62664` | `29d47ee3` | Delta |
|---|---|---|---|
| `src/lib/applications.functions.ts` | 1,442 | 1,491 | +49 |
| `src/lib/documents.functions.ts` | 807 | 900 | +93 |
| `src/components/admin/ApplicantDocuments.tsx` | 474 | 521 | +47 |

Fourteen commits on the M2 lineage touch these paths. Cherry-picking them across
a 55,759-line divergence will conflict in both large server modules. **Port by
hand, carry the M2 test scripts as the proof, do not cherry-pick the chain.**

### Smallest safe sequence

| # | Action | Why here |
|---|---|---|
| **A** | **Publish release A** — `67b62664` + the M2 port, **both flags `false`** | Must precede step 3: step 3 installs `approval_application_guard`, which refuses the direct `status='approved'` write that `67b62664` performs. Release A routes Approve through `approveThroughPacket`, which falls back to the legacy write on `PGRST202` only. |
| **B** | Step 1, then step 2 | Step 2 installs `record_uploaded_content_sha` and `private.uploaded_content_sha`. Both inert to release A. |
| **C** | **Publish release B** — identical code, both flags `true` | From this moment every new licence upload is hashed, because step 2 exists. |
| **D** | `scripts/backfill-document-content-sha.ts --write`, then `proposed/backfill-document-content-sha.sql` as a report | Hashes the 24 historical licence documents. Gate: the SQL report shows `missing = 0` **and** `mismatched = 0`. |
| **E** | Steps 3 → 25, then the step 29 revoke | The Record Rental boundary. |

**Release A is behaviourally inert and can ship days ahead of the window.** With
both flags `false`: `recordUploadedContentSha` returns `null` before touching
storage; the identity action returns `null` and renders nothing; the identity
server function throws its hold before any role lookup; and the legacy approval
fallback is byte-equivalent in effect to today's write. `scripts/m2-approve-fallback.test.ts`
asserts each of those statically and **passes** (`approve fallback pass`).

**Release B must come after step 2 and before step 3** — not before step 2. That
ordering is what removes the outage, and it is what the runbook already
prescribes: *"Step 2 installs the content-sha function first, so the byte
backfill can run before the approval boundary."*

### Why the backfill does not need the flag

`scripts/backfill-document-content-sha.ts:351` calls `writeUploadedContentSha`
directly. Only `recordUploadedContentSha` is flag-gated
(`document-content-sha.ts:72`); `writeUploadedContentSha` at line 114 has no
flag check. The script says so itself at line 50: *"This does not turn
DOCUMENT_CONTENT_SHA256_ENABLED on."* So the backfill is driven by step 2's
existence, not by the flag — which is what makes step C and step D independent.

---

## 2. Approval interruption

### The outage is eliminated

The failure mode the hold warns about — *"Otherwise Approve closes for everyone"* —
happens only if step 3 is installed while licence hashes are missing. Under the
sequence above that cannot occur:

- Every licence uploaded from release B onward is hashed at upload time (step 2
  is already installed).
- Every licence uploaded before release B is hashed by the backfill.
- The SQL report proving `missing = 0` and `mismatched = 0` is taken immediately
  before step 3.

There is therefore **no applicant for whom approval is closed by a missing hash.**

### Residual window — exact cause, duration, workflows, rollback

One real residual remains, between release B and step 3's commit.

| | |
|---|---|
| **Cause** | `IDENTITY_VERIFICATION_ENABLED` is `true` from release B, so the identity action appears on the applicant review screen. It calls `public.verify_approval_identity`, which **step 3 creates**. Called before step 3, PostgREST returns `PGRST202` and the action errors. |
| **Duration** | Release B publish + backfill of **24 documents** + one SQL report. **~20 minutes.** It is bounded by the backfill, not by review volume. |
| **Affected workflow** | The identity-verification action only. **Approval itself is unaffected** — `approve_application_checked` does not exist yet, so `approveThroughPacket` falls back to the legacy write and staff approve exactly as they do today. |
| **Rollback** | Revert release B (flags back to `false`) and republish. No SQL is involved, because no SQL has run past step 2. |

Step 3's own commit is a single transaction and is not a separate window.

### The step-3 rollback window closes on first use — operational, must be planned

`proposed/rollback/00-approval-boundary.sql` raises
`00_rollback_unused_install_only` when **any** `approval_identity` or `verified`
row exists. Immediately after step 3 there are none, so the rollback is
available. **The first time a manager uses the new identity action, that
rollback stops being available**; recovery then requires
`proposed/rollback/00-approval-data-export.sql` (read-only), moving and removing
those rows, or point-in-time recovery.

Consequence for ordering: **release B cannot be reverted on its own once step 3
is in.** With step 3 installed and the flags back off, the identity UI
disappears and approval closes. The only correct order is step 3's rollback
first, then revert release B.

### Not an interruption — the permanent change

After step 3, approving an applicant requires a verified `approval_identity`
review and a server-recorded licence hash. Each applicant in `new` or
`contacted` needs one manager action before approval. That is the feature, not
an outage, and it should be communicated to staff before the window.

---

## 3. Rehearsal — NO-GO, reported as a blocker

| | |
|---|---|
| `docker` binary | present (29.9.1) |
| Docker daemon | **not reachable** — `/var/run/docker.sock` does not exist |
| `supabase` CLI | **absent** |

A Supabase-compatible environment cannot be provisioned from this container.
Reporting the blocker rather than bypassing it, as instructed.

### Preserved evidence, and exactly what it does and does not cover

`docs/m2-rehearsal.md` is unchanged. It records a full run matching **every
per-step privilege dump** on PostgreSQL **16.15** and **17.11**, with final
counts of 0 `rr_%` roles and 0 approval functions. That evidence stands.

The earlier **vanilla PostgreSQL** attempt is recorded as a **failure** and is
not offered as a pass: 115 of 122 `supabase/migrations` errored and the baseline
builder exited 0 while producing zero tables.

What the preserved rehearsal cannot cover, and what the new environment must
therefore supply:

| Dependency the packet has on a real Supabase stack | Where |
|---|---|
| `storage.objects` with `version` as `text` and `user_metadata` as `jsonb`, written by the real Storage API | 9 references in step 2 and step 3; the content-hash merge is conditional on the live object's id and version |
| `auth.users`, `auth.sessions` and a real manager JWT | step 1 and step 3; `approve_application_checked` and `verify_approval_identity` are granted to `authenticated` only and are exercised on the user's own JWT, not the service role |
| PostgREST, for the `PGRST202` fallback contract | the whole legacy-fallback path depends on that one error code |
| `extensions.digest` (pgcrypto in the `extensions` schema) | `scripts/m2-content-sha.test.ts`, which skipped here for lack of a database |
| Two live objects created by **Drizzle**, not by `supabase/migrations` — `public.application_identity_reviews` and `applications.deleted_at` | the recorded cause of the two first-pass failures in `docs/m2-rehearsal.md` |

The local stubs in the preserved rehearsal stand in for the first three. **A
stubbed `storage.objects` cannot prove the conditional merge**, which is the one
mechanism the whole approval boundary rests on.

### Minimum acceptable environment

A Supabase CLI local stack, or a throwaway branch/project on the hosted plan,
with the Drizzle migrations applied alongside `supabase/migrations`. Either is
sufficient; neither is reachable here. `scripts/m2-hosted-preflight.ts` is
already written to run against it read-only and prints one `PASS`/`STOP` line
per check, labelled with the install step that first creates each object.

---

## 4. Temporary CREATE privileges — step-aware recovery

### The one grant

`proposed/m2-packet/03.sql` (install **step 5**):

```sql
CREATE ROLE rr_record_executor NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT rr_record_executor TO postgres WITH SET TRUE;
GRANT CREATE ON SCHEMA private, public TO rr_record_executor;
```

It is the **only** `GRANT CREATE` in the packet. The role is `NOLOGIN`,
`NOSUPERUSER`, `NOBYPASSRLS`, and is granted to `postgres` only — every per-step
verify query asserts that neither `anon` nor `authenticated` is a member of it.
So while the grant stands, the reachable path is `postgres`, not a client JWT.

### No step can leave partial state — verified

Every install file is exactly one transaction, and so is every rollback:

- The 24 packet files carry no `BEGIN`; `psql -1` or a single editor run is the
  transaction.
- The five approval-boundary files each contain **exactly one** `BEGIN` and
  **exactly one** `COMMIT` (steps 2, 3, 9, 14, 25) — counted, not assumed.
- All 30 rollback files likewise contain exactly one `BEGIN`/`COMMIT` pair.
  (`00-approval-data-export.sql` has none; it is a read-only export, not a
  rollback.)

**Therefore every step is either fully committed or fully absent.** Recovery
depends only on *which steps committed* — which the catalog answers — and never
on what the operator remembers doing. This is what makes the procedure below
deterministic.

### Why "run step 5's rollback" is the wrong instruction at most stop points

The runbook's existing stop rule is *"Run only that step's rollback, then stop.
Do not continue the install in the same window."* It does not unwind earlier
steps. So a stop at, say, step 12 rolls back step 12 and stands down with steps
1–11 committed — **including step 5's grant.** And at that point step 5's
rollback is *also* wrong: it `DROP`s `rr_record_executor`, which steps 6, 7 and
onward depend on. Both halves of the concern are real.

### Procedure

**First, locate the position.** Run `scripts/m2-hosted-preflight.ts` read-only.
It prints a `PASS`/`STOP` line per object labelled with the step that creates it;
the highest step whose objects are present is the last committed step. No new
SQL and no operator recollection is required.

**Then take the branch that matches.**

| Position | Grant state | Correct action |
|---|---|---|
| Stopped **before step 5 committed** | `rr_record_executor` does not exist, so no grant exists. Step 5 creates the role and grants CREATE **in the same transaction**, so a failed step 5 leaves neither. | Nothing to revoke. Confirm with the assertion below and stand down. |
| Stopped **after step 5, before step 8**, and abandoning | Grant stands | **Unwind.** Run the rollback of every committed step in **strict reverse step order**, ending with step 5's `proposed/rollback/03-record-rental.sql`, which runs `REVOKE ALL ON SCHEMA "public"` and `"private"` (CREATE included) and then `DROP ROLE`. Reverse order is required because later steps depend on earlier objects. |
| Stopped **at or after step 8, before step 29**, and holding the window to resume later | Grant stands | **Close it early.** The last ownership transfer to `rr_record_executor` inside steps 1–25 is **step 7** (`05.sql`). Steps 8–25 transfer nothing. So run `proposed/m2-packet/21-revoke-executor-create.sql` now and resume into steps 8–25 afterwards. Do **not** take this branch if you intend to resume into **step 26** (`20.sql`), which transfers `private.swap_operations`, `private.swap_number_seq` and `swap_rental_vehicle_tx` and so needs CREATE again; `proposed/rollback/21-revoke-executor-create.sql` re-grants it if you change your mind. |
| Stopped after step 5 and abandoning, but an `approval_identity` or `verified` row exists | Grant stands, and the step 3 and step 9 rollbacks **refuse** (`00_rollback_unused_install_only`, `06b_rollback_unused_install_only`) | Export with `proposed/rollback/00-approval-data-export.sql`, move and remove those rows, then unwind. If they cannot be moved, restore from the backup or the PITR snapshot. **Do not force the rollback.** |
| Completed through step 29 | Revoked | Confirm with step 29's own verify query. |

**Important:** taking the early-revoke branch means step 29's own verify query
will not pass as written — see the next section.

### Confirmation assertion

The preflight's `public CREATE holders` row reports the grantee list but only
fails for `anon` and `authenticated`, and it covers `public` only. Use this
read-only assertion after any recovery. It must return `t`.

```sql
SELECT NOT EXISTS (
  SELECT 1
  FROM (VALUES ('rr_record_executor'), ('rr_approval_executor'), ('rr_evidence_issuer')) AS r(rol)
  CROSS JOIN (VALUES ('public'), ('private')) AS s(nsp)
  WHERE to_regrole(r.rol) IS NOT NULL
    AND has_schema_privilege(r.rol, s.nsp, 'CREATE')
) AS no_executor_create;
```

A role that no longer exists is skipped by `to_regrole(...) IS NOT NULL`, so the
same query is correct after a full unwind and after a successful install.

### Standing rule to adopt

> No M2 install is left stopped. Every stop ends in one of the rows above, and
> the assertion above is run and recorded before standing down.

---

## The minimum Record Rental sequence has a verification gap

Earlier work established the smallest sequence that makes Record Rental
operational as **steps 1–25, then step 29** — `03.sql` leaves both evidence
helpers deny-all, the subscription contract arrives at step 7 and the agreement
contract only at step 25. That holds. Steps 26 (Vehicle Swap), 27 (extend) and
28 (return checklist) are excluded.

**But step 29's verify query cannot pass after step 25.** Each per-step verify
asserts an exact function count:

| After step | Functions asserted |
|---|---|
| 25 | **71** |
| 26 | 75 |
| 27, 28, 29 | **76** |

Step 29's query asserts `count(*)=76`, so run after a 1–25 install it returns
`f` — which the runbook reads as "stop and roll back," on a correct install.

Two ways out, and this is the owner's call:

- **(a) Install all 29 steps.** Steps 26–28 verify as written. Their application
  code is dark, so they are behaviourally inert, but the change is wider.
- **(b) Install 1–25 + 29 and verify the revoke with a composed assertion** —
  step 25's verify query (which asserts `count(*)=71`) plus the two
  `has_schema_privilege(..., 'CREATE')` negations lifted verbatim from step 29's
  query. No new SQL logic; it composes two queries that already exist.

**(b) is the recommendation**, because it keeps the installed surface to what
Record Rental needs. It must be written into the runbook before the window
opens, so the operator is not reading a query that is expected to fail.

---

## What this does not ask for

No installation, no publish, no flag change, no SQL execution, no permission
change. Decision 1 is taken as approval to **prepare** the application release;
that branch is next and will carry both flags `false`.
