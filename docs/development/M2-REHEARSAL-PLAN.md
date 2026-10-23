# M2 rehearsal — provisioning and run procedure

2026-10-23. The rehearsal itself is **not run**: it cannot be provisioned from
this container (no Docker daemon, no Supabase CLI). This is the procedure, with
the parts that could be prepared and proven here already prepared and proven.

**The authoritative packet is unchanged.** 24 packet files, 31 rollback files and
`HOSTED-INSTALL.md` are byte-identical to `29d47ee3`. Nothing below edits them.

## Why a throwaway Supabase project, not Docker

The packet creates **48 policies: 47 on `public.*` and one on
`private.approval_operations`**, a table it creates itself. **None on
`storage.objects`.** There is no `CREATE POLICY` on `storage`, no
`ALTER TABLE storage.*`, no `GRANT ON SCHEMA storage`. Steps 2 and 3 reference
`storage.objects` only inside PL/pgSQL bodies, which resolve at execution time.

So M2 needs none of the Storage-policy authority Security 0031 is blocked on,
`postgres` can install all 48 policies, and **M2 is not gated on 0031.**

| Option | Docker | Real Storage / Auth / PostgREST |
|---|---|---|
| **Throwaway Supabase project (free tier)** | no | **yes** — recommended |
| Supabase branch on the hosted plan | no | yes, if the plan has branching |
| Supabase CLI local stack | **yes** | yes |
| Vanilla PostgreSQL + stubs | no | **no** — this is the preserved 16.15/17.11 evidence; it cannot replace the above |

The deciding factor is real `storage.objects` rows written by the real Storage
API. The content-hash merge is conditional on an object's id and version, and a
stubbed table cannot prove it. That is the one gap in the preserved rehearsal.

## Step 0 — the baseline, prepared and proven

`supabase/migrations` (122 files) does not create three objects the packet
expects. `docs/m2-rehearsal.md` records two first-pass failures caused by
exactly this; the third is quieter.

| Object | Packet dependency | Source |
|---|---|---|
| `public.application_identity_reviews` | step 6 failed without it | Drizzle `0019`, grants tightened by `0020` |
| `applications.deleted_at` + `deleted_by`, `deleted_reason`, `purged_at`, `legal_hold` | step 13 failed without it | Drizzle `0016` |
| `public.application_waitlist_holds` | `extend_rental_tx` names it in a PL/pgSQL body, so `CREATE FUNCTION` succeeds and only execution fails | Drizzle `0014` |

**`proposed/rehearsal/drizzle-prerequisites.sql`** supplies exactly these and
nothing else. It is *extracted* from those four migrations by
`scripts/m2-rehearsal-prerequisites.mjs`, not restated, with each slice
attributed to its source file. `scripts/m2-rehearsal-prerequisites.test.mjs`
asserts the extract stays faithful, that nothing beyond the packet's
prerequisites comes along (the rest of `0016` creates deletion tables and
functions that reference further Drizzle tables), that it is one transaction,
that it names no `rr_` role and no `GRANT CREATE`, and that it creates none of
the objects the packet creates.

**Proven on PostgreSQL 16.15.** Applied to a stub cluster it creates all three
objects, and the inline `resolution` CHECK comes out auto-named
**`application_identity_reviews_resolution_check`** — which is the name step 6
expects to drop and replace. That was a specific risk; it is settled.

No packet file may be changed to create these. On the real database they already
exist, and a packet that created them would fail there.

## Run procedure

1. Provision the throwaway project. Record its ref; it must not be
   `yuyzdsnrbfhkmfzpvhwx` (production).
2. Apply `supabase/migrations` in order. Two replay notes from
   `docs/m2-rehearsal.md`, both outside the packet: one migration grants
   `applications.sms_consent` before another adds the column, and several later
   migrations repeat a `CREATE POLICY`/`CREATE TRIGGER` an earlier one already
   applied.
3. Apply `proposed/rehearsal/drizzle-prerequisites.sql` (one transaction, no
   `psql -1`).
4. **Fail loudly on an empty baseline.** The earlier attempt exited 0 while
   producing zero tables and was nearly reported as a success. Assert a non-zero
   table count and the three objects above before going further.
5. `bun scripts/m2-hosted-preflight.ts --url '<connection>' --hosted`. Every
   line must be `PASS`.
6. Steps 1 – 29 in order, one file per execution, each per-step verify returning
   `t`. Transaction modes: steps **2, 3, 9, 14, 25** carry their own
   `BEGIN`/`COMMIT` and run **without** `-1`; all others use `-1`.
7. For the reduced sequence, steps 1 – 25 then 29, verify step 29 with
   `proposed/m2-verify/step29-after-step25.sql` — step 29's own query asserts 76
   functions and there are 71 after step 25.
8. `proposed/m2-verify/no-executor-create.sql` must return `t`.
9. Every rollback in reverse order, ending at the baseline catalog.
10. `proposed/m2-verify/no-executor-create.sql` must return `t` again.

## What the rehearsal must prove that nothing here can

1. The content-hash merge against **real** `storage.objects` rows — the one thing
   a stubbed table cannot show, and the mechanism the approval boundary rests on.
2. `approve_application_checked` on a **manager's own JWT**, with the direct
   service-role write refused.
3. The **PostgREST schema reload** after step 3. Until the cache reloads, the
   function is unreachable although its column exists. Release A's compatibility
   gate refuses that state with a message naming the cache rather than falling
   back into `approval_rpc_required`, but the reload itself has to be observed
   and timed here, because it lands inside the window.
4. The approve / re-approve / document-upload checks that must not run against
   Preview, since Preview is the production database.
5. `scripts/m2-content-sha.test.ts` with `M2_DATABASE_URL` set, including the
   `extensions.digest` comparison.

Items 1 – 4 are why the preserved 16.15 / 17.11 evidence, which stands on its own
for the catalog and privilege dumps, is not sufficient by itself.
