# Release A — rollback and recovery (2026-10-24)

Release A is in the Preview branch and **not published**. The live site still runs #266 (`67b62664`).

## References

| Ref | Commit | Purpose |
|---|---|---|
| `integration/grok-baseline-2026-10-22` | `14cbf81b906cd7c65a587a1dba53c0b8e87d1b1f` | Release A merge (parents `7c7d7b6b`, `f8b2480f`; tree `df4427c7`, the tested scratch-merge tree) |
| `rollback/pre-release-a-7c7d7b6b` *(new)* | `7c7d7b6b5470ace54826eac0e040b73d909b2ed8` | Production branch just before the merge: #266 plus the two Lovable type-regeneration commits |
| `rollback/live-rc266-67b62664` *(new)* | `67b626641ec83b871e608f8621857054d7859d55` | The accepted live #266 code |
| `rollback/pre-rc266-7e3e6eb6` | `7e3e6eb6` | Existing; unchanged |
| `preserve/2026-10-08-all-pending` | `95503ef1` | Existing; unchanged |
| `release/m2-app-flags-off` / `release/m2-app-flags-on` | `f8b2480f` / `6ee81415` | Release A / Release B sources; unchanged |

**Immutability is not enforced yet.** The session's git proxy refused the annotated tags (HTTP 403).
The two new references were therefore pushed as branches and are protected only by convention.
To make them immutable, the owner should do one of these:
- protect `rollback/*` (a GitHub ruleset that blocks updates, deletion and force-push); or
- create the tags `rollback/pre-release-a-7c7d7b6b` and `rollback/live-rc266-67b62664` on those commits.

## 1. Before M2 step 3 (Release A published, or not)

This is code only, with no database change.
1. On the production branch, `git revert -m 1 14cbf81b` and push. Do not reset; history stays intact.
2. In Lovable, confirm the latest commit, then publish.
3. If Release A was never published, nothing on the live site changes. Reverting only clears Preview.

The result is identical in code to `rollback/pre-release-a-7c7d7b6b`: #266 plus the generated types.
That is valid through Window 1, because steps 1–2 and the hash backfill do not touch the approval
path.

## 2. After M2 step 3

**The site must not go back to #266.** Step 3 (`04-step-3.sql`) installs these triggers:
- `approval_boundary` on `public.applications`: `private.approval_application_guard()` refuses any
  direct change of `status` to `approved`;
- the audit guard: only `rr_approval_executor` may write `application.approved`, otherwise it raises
  `approval_audit_rpc_required`.

#266 approves applicants by writing the status and the audit row directly. After step 3, every
#266 approval fails. Release A's compatibility gate (`approval-rpc.server.ts`) reads
`approval_evidence_version`. Once step 3 is in, it routes approvals through
`approve_application_checked`, never the direct write.

Recovery after step 3:
- **Code problem in Release B:** publish Release A again (revert the Release B merge). It is safe on
  an M2 database. However, with its flags off it cannot record identity verification, so approvals
  needing a new verified identity are refused (cleanly, nothing written) until Release B returns.
  Plan this as a short approval pause, not a full fallback.
- **Code problem in Release A itself:** fix forward on Release A. No safe older build exists.
- **Database problem:** follow INSTALL.md's stop-point table on `review/m2-packet-29d47ee3`. If a verified
  approval-identity row exists, the only way back is a **database restore**, and Lovable Cloud offers
  daily snapshots only (see `READINESS-2026-10-24.md` §2). The restored schema then lacks M2, so
  publish Release A (its gate falls back to the legacy path when the packet is absent). Never publish #266 against a partly restored state.

## 3. Which build is live, when

| Phase | Live build | Never live |
|---|---|---|
| Now → before Window 1 | #266, then Release A once published | — |
| Window 1 (steps 1–2, backfill) | **Release A** | Release B (content hashing needs step 2) |
| Between the windows | Release B (after its own approval), Release A as the fallback | — |
| Window 2 (steps 3–29) and after | **Release B**, with Release A as the only fallback | **#266**, and anything older |

Keep `release/m2-app-flags-off` (`f8b2480f`) and the Release A merge `14cbf81b` available until M2 is
complete and Release B has been stable. Do not delete or move either.
