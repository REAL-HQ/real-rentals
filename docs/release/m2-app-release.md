# M2 application release — release A (both flags off)

Branch `release/m2-app-flags-off`, based on **`67b62664`**, the accepted and
currently live release #266.

**Preparation only.** Not published, not approved for publication. Both feature
constants are `false` and this branch does not change them.

```
src/lib/document-content-sha.ts:23   export const DOCUMENT_CONTENT_SHA256_ENABLED = false;
src/lib/identity-verification.ts:9   export const IDENTITY_VERIFICATION_ENABLED = false;
```

## Why this is a forward port and not a deploy of the M2 branch

`29d47ee3`, the M2 packet base, and `67b62664` are **divergent siblings** off
`7e3e6eb6` — not ancestor and descendant. `src/` differs by 449 files,
+1,538 / −55,759. **Publishing `29d47ee3` would revert release #266.** So the M2
application code is ported forward onto the live release instead.

The port was taken as the diff from the merge base `7e3e6eb6` to `29d47ee3`,
restricted to the M2 paths, and applied with `git apply -3`. All three
call-site patches applied **cleanly**, with no conflict and no hand-editing.

## What this branch adds

New modules, taken from `29d47ee3` unchanged:

| File | Role |
|---|---|
| `src/lib/document-content-sha.ts` | the upload hasher and the `PGRST202` probe; holds the flag |
| `src/lib/identity-verification.ts` | holds the flag and the hold message |
| `src/lib/identity-verification.functions.ts` | `verifyApprovalIdentity`; refuses on the flag as its first statement |
| `src/lib/approval-rpc.server.ts` | `approveThroughPacket`: the RPC-then-legacy fallback contract |
| `src/lib/approval-source-statuses.ts` | the approvable-status list the flag-on refusal uses |

Call sites, patched in place:

| File | Change |
|---|---|
| `src/lib/applications.functions.ts` | `approveApplication` routes through `approveThroughPacket` instead of writing `status: "approved"` directly |
| `src/lib/documents.functions.ts` | `persistConfirmedDocument` extracted, hasher threaded through `registerDocument` and the wizard sync |
| `src/components/admin/ApplicantDocuments.tsx` | the Verify Identity action, which renders nothing while its flag is off |

Operational tooling and proofs: `scripts/backfill-document-content-sha.ts`,
`scripts/m2-hosted-preflight.ts`, the three `scripts/m2-*.test.ts` files,
`scripts/m2-functional-proof.sql`, and the five SQL files those proofs read.
**The 29-step packet is not on this branch.** It stays on
`review/m2-packet-29d47ee3`, unchanged. The SQL carried here is the contract the
application code is written against, plus the backfill's own report and undo —
nothing that installs the boundary.

## Why release A is inert

With both flags `false`:

- `recordUploadedContentSha` returns `null` before touching storage, so the
  insert columns are what they are today.
- The Verify Identity action returns `null` and renders nothing.
- `verifyApprovalIdentity` throws its hold before the manager lookup and before
  either RPC.
- `approveThroughPacket` calls `approve_application_checked`, gets `PGRST202`
  because no packet SQL is installed, and falls back to the same service-role
  update and the same `application.approved` audit entry that `67b62664` writes
  today. The flag-on status refusals are skipped because both flags are off.

`scripts/m2-approve-fallback.test.ts` asserts each of those statically and
passes. So release A can ship ahead of the install window without a flag change
and without an approval interruption. It is **required** to ship before step 3,
which installs `approval_application_guard` and refuses the direct status write
that `67b62664` performs.

## Verification run on this branch

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **pass** |
| `npm run build` | **pass** (fresh build; `.output` rebuilt) |
| `node scripts/client-chunks.test.mjs` | **pass**, all routes hydrate, no server-only identifier in any chunk |
| `scripts/m2-approve-fallback.test.ts` | **pass** |
| `scripts/dark-flag-coverage.test.mjs` | **pass** — 62 dark modules, **0 unaccounted** |
| `scripts/m2-content-sha.test.ts` **against a live PostgreSQL 16.15** | **pass** — see below |
| `scripts/payments-webhook-invariants.test.mjs`, `payments-webhook-events.test.ts` | **pass** |
| The rest of `npm test` | **pass**, with one environmental exception below |

### Dark-flag coverage — three modules classified

The #266 coverage safeguard failed on this branch until the three M2 modules
were classified, which is the safeguard working as intended. Each was read, then
placed in exactly one list:

- `identity-verification.functions.ts` → **FLAG_FIRST_IN_HANDLER**. The flag
  throw is the first statement in the handler, ahead of the `requireManager`
  import and lookup and ahead of both RPCs.
- `applications.functions.ts` → **MIXED_LIVE**. Approve and the application list
  serve real traffic; the flags tighten one sub-path, the legacy fallback's
  status refusal.
- `documents.functions.ts` → **MIXED_LIVE**. The document vault is live; the flag
  gates only whether an upload is hashed.

### Content-hash evidence — new, and run against a real database

Run against a disposable PostgreSQL **16.15** cluster with `pgcrypto` in the
`extensions` schema. This is **not** the Supabase-compatible install rehearsal,
which remains blocked; it proves the backfill mechanism only.

```
content sha matches extensions.digest
mode=dry-run total=1002 fingerprinted=1001 hashed=0    skipped=1001 missing=0 mismatched=0 pending=1 storage_errors=0
mode=write   total=1002 fingerprinted=1002 hashed=1    skipped=1001 missing=0 mismatched=0 pending=0 storage_errors=0
mode=write   total=1002 fingerprinted=1002 hashed=0    skipped=1002 missing=0 mismatched=0 pending=0 storage_errors=0
```

So the application's SHA-256 and `extensions.digest` agree, the backfill pages
past the 1000-row batch boundary, and a second `--write` run is a no-op — which
is the property that lets the backfill be resumed inside the window.

### One environmental failure, pre-existing and unrelated

`scripts/agreement-evidence.test.cjs` fails at `initdb: cannot be run as root`.
It builds its own cluster as the invoking user, and this container runs as root.
It is independent of this port and fails the same way on `67b62664`.

Also recorded, because it nearly became a false finding: the first `npm test`
run on this branch reported three hydration blockers. `.output` was a stale
build from 12:06, before this branch existed. After `rm -rf .output && npm run
build`, all three pass.

## What still gates publication

1. Code review of this port.
2. **Release B** — the same branch with both constants `true`. Not prepared; it
   is a separate owner approval and must not be published before step 2 is
   installed.
3. The rehearsal blocker in `docs/development/M2-GO-NO-GO.md`, decision 3.

The sequence this branch is release A of is in
`docs/development/M2-GO-NO-GO.md`.
