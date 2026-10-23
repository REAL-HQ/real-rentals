# M2 — decisions required before installation can be requested

2026-10-23. Read-only. No production SQL, no publish, no flag change.
**All 29 steps, original checksums, per-step verification and rollback files are
preserved unchanged on this branch.**

---

## The finding that changes the shape of the step 3 hold

**The flag-on application code is not in the accepted production release.**

| Module the hold names | In release `67b62664` | On M2 `29d47ee3` |
|---|---|---|
| `src/lib/document-content-sha.ts` | **absent** | present, flag `false` |
| `src/lib/identity-verification.ts` | **absent** | present, flag `false` |

So "deploy the flag-on builds" is not a flag flip. It is **a second application
release** — M2 app code merged, published, with both constants `true` — before
any SQL runs. That release is not prepared and is not part of #266.

### Why flag-on is safe before the SQL exists

`document-content-sha.ts` detects the missing function by error code —
`PGRST202` — and says what it does:

> *"record_uploaded_content_sha is not installed; confirming the upload without
> a content hash. **Approval stays closed while content_sha256 is null.**"*

So it fails safe: the upload still confirms, no hash is written, nothing throws.
**But it is not inert.** A licence uploaded in that window gets no hash, and
**that application cannot be approved** until step 2 lands and the backfill runs.

The reverse order is worse. The runbook: installing the packet first "makes live
Approve fail — the approval triggers refuse both of those writes", which closes
Approve for *every* application, not just new uploads. **App first is the lesser
window, and it is not a zero window.**

---

## Backfill assessment — measured, read-only

| | |
|---|---|
| Current licence documents (`license_front` + `license_back`, `is_current`, application not deleted) | **24** |
| With a valid 64-hex `content_sha256` | **0** |
| Needing a hash | **24** |
| `documents.content_sha256` column (step 0 prerequisite) | **present** |
| `private.uploaded_content_sha` binding table | **absent** — step 2 creates it |

### How "zero missing and zero mismatched" gets verified — and why not yet

**`mismatched` cannot be measured today.** It compares the stored hash against
`private.uploaded_content_sha`, which does not exist until step 2. So the hold
is inherently sequenced and cannot be pre-cleared:

1. **Step 2** installs `record_uploaded_content_sha` and the binding table.
2. Run `scripts/backfill-document-content-sha.ts --write` with a service-role
   key and an explicit `--url` (it refuses any other JWT role and prints the
   target host). It downloads each of the 24 objects and writes both sides.
3. Run `proposed/backfill-document-content-sha.sql` **as a report**. It writes
   nothing; a session setting `m2.backfill_content_sha` to `write` is refused.
   **The gate is this SQL report showing `missing = 0` and `mismatched = 0`** —
   not the script's own output, because a dry run never downloads and its
   `mismatched=0` proves nothing.
4. **Then** step 3.

---

## Temporary CREATE privilege — covered on two paths, exposed on a third

Step 5 runs `GRANT CREATE ON SCHEMA private, public TO rr_record_executor`.

| Path | Grant removed? |
|---|---|
| Install completes → **step 29** `REVOKE CREATE ON SCHEMA public, private FROM rr_record_executor` | **yes** |
| Install stopped → **step 5 rollback** `proposed/rollback/03-record-rental.sql` runs `REVOKE ALL ON SCHEMA "public"` and `"private"` from that role, which includes CREATE | **yes** |
| **Install stopped and left without rolling back** | **no — the grant persists** |

The packet covers success and rollback. The gap is operational: the runbook says
*"Stop at the first failed check. Do not start the next file,"* and a stop that
is never rolled back leaves CREATE standing. That needs a standing rule, not a
code change.

---

## Smallest sequence that makes Record Rental operational

**Steps 1 – 25, then step 29.** Verified earlier: `03.sql` leaves both evidence
helpers deny-all; the subscription contract arrives at step 7, the **agreement
contract only at step 25**. Step 29 is required to close the privilege window.

This **excludes** step 26 (Vehicle Swap), 27 (extend) and 28 (return checklist).

Caveat already on record: the runbook treats steps 1–29 as one window, and
*"approval and signing during that window see a partial install."* Stopping at 25
is a legitimate feature boundary **only if 29 runs in the same window**.

---

## Rehearsal — cannot be run here, and the vanilla attempt was not a pass

| | |
|---|---|
| `docker` binary | present |
| Docker daemon socket | **absent** — no containers can run |
| `supabase` CLI | absent |
| Vanilla PostgreSQL attempt | **failed** — 115 of 122 `supabase/migrations` errored; the baseline builder **exited 0 while producing zero tables** |

That attempt is recorded as a failure, not a pass. A real rehearsal needs a
Supabase-compatible environment (a Supabase CLI local stack, or a branch/project
on the hosted plan) — neither is available from this container.

Existing evidence stands on its own: `docs/m2-rehearsal.md` records a fresh
local run matching **every per-step privilege dump** on PostgreSQL 16.15 and
17.11, with final counts of 0 `rr_%` roles, 0 applications, 0 approval functions.

---

# The decisions

| # | Decision | Why it blocks |
|---|---|---|
| **1** | **Approve preparing a second application release** carrying the M2 app code with `DOCUMENT_CONTENT_SHA256_ENABLED` and `IDENTITY_VERIFICATION_ENABLED` set `true`. | That code is not in production. Without it the hold can never clear. This is the real gate, and the largest piece of work. |
| **2** | **Accept the Approve window**, or schedule it. Between that release and step 2 + backfill, newly uploaded licences get no hash and **those applications cannot be approved**. | Unavoidable in either order; app-first is the smaller exposure. |
| **3** | **Rehearsal: accept the recorded evidence, or provision a Supabase-compatible environment.** | Cannot be re-run from here. |
| **4** | **Adopt the rule: any stop runs step 5's rollback before standing down.** | Otherwise an abandoned install leaves `CREATE` on `public` and `private` granted. |

Nothing else needs deciding before installation can be *requested*. The
installation itself remains a separate approval, and steps 26–28 stay out of the
Record Rental window.
