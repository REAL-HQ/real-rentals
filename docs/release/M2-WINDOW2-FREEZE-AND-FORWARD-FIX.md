# M2 Window 2: approval freeze and forward-fix recovery (2026-10-24)

**Window 2 is NO-GO.** This plan replaces "restore from backup/PITR" as the post-use answer. The
owner has not adopted archive-then-roll-back. No evidence deletion, archive migration or rollback
of a used install happens without separate approval. Security 0031 is not touched by anything here.

## Approval freeze: enforced by the build, not by instruction

Facts (verified on the reviewed refs):
- Release B = Release A plus two lines: `DOCUMENT_CONTENT_SHA256_ENABLED` and
  `IDENTITY_VERIFICATION_ENABLED` become `true`.
- From step 3, approval requires a verified `approval_identity` review
  (`positive_identity_required`).
- With the identity flag off, `verifyApprovalIdentity` throws its hold before any role lookup or
  RPC, and the Verify Identity control renders nothing.

**So while Release A is live and step 3 is installed, no identity approval can be created and no
new approval can complete.** Each attempt is refused cleanly and nothing is written. Already-approved
applications are unaffected.

| Phase | Live build | Approvals |
|---|---|---|
| Window 1 and until Window 2 starts | Release A | legacy path, normal |
| Steps 3–13 | Release A | unavailable (step 13 grants the executor) |
| Steps 13–29 and verification | Release A | refused: no identity can be verified |
| After step 29, **until the owner authorizes** | Release A | refused, as above |
| Resumption | Release B (separate publish approval) | identity verification, then approval |

**Change from the earlier plan.** `m2-release-b.md` publishes Release B between the windows,
precisely so that Approve does not close at step 3. The owner now *wants* it closed from step 3
until authorization, so Release B is held back. The cost is that uploads made while Release A is live are not hashed.

**Resumption checklist (owner):**
1. Window 2 complete: every verify `t`, `no-executor-create` `t`, evidence fingerprint taken.
2. Re-run the backfill `--write` (it fills only NULL hashes), then the gate report.
3. Publish Release B (separate approval).
4. The first approval is done by the owner or a named Manager on a known applicant, checked
   against the audit row.
5. Approvals resume.

**Superseded by `M2-WINDOW2-CUTOVER.md`:** the hash-only build (`release/m2-app-hash-only`) is
published inside Window 1, so no backfill re-run is needed. The forward-fix route is built and rehearsed.

## Forward-fix recovery (after real use)

Principles:
- Fixes are **additive**: `CREATE OR REPLACE FUNCTION` with the same signature, a new or replaced
  policy or grant.
- Nothing deletes or rewrites identity reviews, approval operations, `audit_log`, agreements,
  payments or rentals.
- Immutability triggers stay installed.

| Defect | Immediate containment | Fix |
|---|---|---|
| App defect in Release B | publish Release A: freeze, nothing written | code fix, Preview, publish approval |
| SQL defect in steps 1–13 (approval, identity, hashing) | publish Release A (freeze) | reviewed replacement function, sent as one guard v3 request (`gen-guard3.py`), first rehearsed on the harness with synthetic evidence rows present |
| A legitimate applicant refused (e.g. missing licence bytes) | none needed | business path: re-upload, then a new identity review. No SQL. |
| Temporary privilege left after a stop | — | 3-post or step 29 file (existing) |
| Defect in steps 14–29 (Record Rental, flags off) | flags stay off | forward fix; their rollbacks have no use-guard, but running one needs separate approval |
| Platform-level loss | — | Lovable daily backup; the pre-window export for targeted row recovery |

Every forward fix is accepted only if all of these hold:
1. its step verify(s) return `t`;
2. a read-only **evidence fingerprint** (counts and hashes over identity reviews, approval
   operations, approval audit rows and agreement evidence; returns hashes only) is unchanged
   before and after;
3. the five Security 0031 policies hash the same;
4. `no-executor-create` returns `t`.

## Before Window 2 can become GO

1. Build and rehearse the evidence fingerprint query, plus one sample forward fix (replace an
   approval function body) on the harness, with synthetic approvals present.
2. Owner decisions:
   - accept the freeze (Release A held through Window 2; Release B only on authorization);
   - accept forward-fix-only as the post-use strategy;
   - accept the Lovable export immediately before the window as the forensic baseline.
3. Window 1 complete and its gate clean.
