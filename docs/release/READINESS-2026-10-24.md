# Release readiness — 2026-10-24 (Security 0031 installed and closed)

Goal: REAL RENTALS records the rentals and payments already happening. Order:

**Release A live → M2 Window 1 → Release B live → M2 Window 2 → Record Rental installs → activation → Link to Rental.**

Each arrow is a separate owner approval. Nothing in this document has been executed in production.

## 1. Release A (both M2 flags off)

| | |
|---|---|
| Branch | `release/m2-app-flags-off` @ `f8b2480f` |
| Base | `67b62664`, live release #266. 3 commits ahead. |
| Production branch | `integration/grok-baseline-2026-10-22` @ `7c7d7b6b`. That is #266 plus two unpublished Lovable type-regeneration commits (`b4ca43c7`, `7c7d7b6b`; generated types only, already judged benign). |
| Scope | Exactly the documented M2 port (`m2-app-release.md`): 8 `src` files, scripts, unexecuted `proposed/` SQL, docs and `package.json` test scripts. No `drizzle/` or `supabase/` migration, no dependency change. |
| Merged onto the production tip (scratch worktree) | Clean merge. These pass: typecheck, build, client-chunks, dark-flag coverage and gates, M2 suites (inert, fallback, compatibility gate, prerequisites), webhook suites, the full `npm test` chain, and `agreement-evidence` 11/11 (run non-root). No flag became `true`. |
| Behaviour with flags off | Approvals take today's path (the compatibility gate). **One deliberate change:** re-approving an already-approved application no longer rewrites status or logs a second `application.approved`. |
| Hard ordering rule | Must be live **before** M2 step 3, whose guard refuses #266's direct status write. Reverting to #266 after step 3 would break approvals. |

**Shortest safe checklist.** Preview runs against production data, so it is read-only only.

1. *(Owner approval: merge.)* `git merge --no-ff origin/release/m2-app-flags-off` into
   `integration/grok-baseline-2026-10-22` and push. Do not publish. The two Lovable
   type-regeneration commits ship with it.
2. Confirm Lovable's latest commit equals the merge commit.
3. In Preview, check only these (`m2-release-a-preview.md` §A):
   - the Verify Identity control is absent;
   - the Applications list, applicant detail and document vault load;
   - existing documents display;
   - there are no new console or server errors.
   Do not approve, upload or re-approve in Preview.
4. *(Owner approval: publish.)* Publish in Lovable.
5. After publishing, repeat the step 3 checks on the live site. The first real staff
   approval writes `application.approved` exactly as #266 does.
6. Rollback: revert the merge commit and publish. This involves no database change, and it
   is valid only until M2 step 3.

## 2. M2 Window 1 and Window 2

Package: `review/m2-packet-29d47ee3` @ `95d921dd`. The packet is byte-identical to `29d47ee3`, and
hosted amendments 3-pre and 3-post are included. The runbook is `proposed/m2-hosted-install/INSTALL.md`
on that ref: windows, stop-point table and rollback variants. **Exact submission list:
`proposed/m2-guarded/RUN-ORDER.md`.**

**New since the 2026-10-23 rehearsal:**
- **Compatible with Security 0031.** The harness now builds production's order: baseline,
  then 0031, then M2. On that state:
  - the M2 preflight has zero failures;
  - the Window 1 drill passes 13/13 (real backfill, gate report, stale-cache handling);
  - all 29 steps install with every verify true;
  - all Record Rental suites pass.
  No M2 file touches the five 0031 policies.
- **Every write is one guarded request** (`proposed/m2-guarded/`, 31 files). Each is the
  reviewed 0031 guard v3 followed by the unchanged packet file. `node scripts/m2-guarded-requests.mjs --check`
  reproduces them byte for byte. `scripts/m2-guarded-window.test.ts` plays both windows from
  these exact files, sent as the Management API delivers them:
  - preflight clean;
  - 31 writes, 29 verifies true;
  - stand-down true after each window;
  - a tampered file refused;
  - 0031 untouched.

  On the disposable project's real API route, a guarded file containing its own
  `BEGIN`/`COMMIT` (as five window files do) ran correctly, and its tampered copy was refused.

**Prerequisites before Window 1**
1. **Backup and PITR.** In the Supabase dashboard, confirm PITR is enabled for
   `yuyzdsnrbfhkmfzpvhwx`, and record the restore point and how to request it. After the
   first real identity approval, steps 3 and 9 cannot be rolled back; restore is the only
   way back.
2. Release A live.
3. No approvals or agreement signing during the window.
4. **Hash backfill (operator step, not SQL):** `bun scripts/backfill-document-content-sha.ts --url <project>`,
   then `--write`. It needs the production service_role key in the operator's own shell.
   Claude must not request or hold that key, so the owner runs this step (or approves another
   route). The write must end `missing=0 mismatched=0 storage_errors=0`, and the gate report
   (`proposed/backfill-document-content-sha.sql`) must read `missing=0`, `mismatched=0`.

**Window 1:** preflight → step 1 → verify → step 2 → verify → backfill → gate report →
`no-executor-create` (`t`). Approvals keep working throughout (Release A legacy path).

**Between the windows:** Release B (`release/m2-app-flags-on` @ `6ee81415` = Release A plus both
flags `true`) gets the same checklist as §1 and goes live. Its content hashing needs step 2,
which Window 1 installs.

**Window 2:** 3-pre → step 3 → 3-post → step 3 verify, then steps 4–29, each with its verify.
Then `no-executor-create` (`t`).
- **Approve is unavailable from step 3 until step 13**, so do not pause between them.
- **PostgREST:** if an approval says to reload the schema cache, send
  `NOTIFY pgrst, 'reload schema';`. The gate refuses in the meantime and never falls back.
- **Temporary `CREATE` privileges:** 3-pre grants and 3-post revokes the approval executor's;
  step 5 grants and step 29 (`21-revoke-executor-create.sql`) revokes the record executor's.
  `no-executor-create.sql` proves both are gone.
- **Recovery:** every file is one transaction, so a failed file leaves nothing behind. Use
  INSTALL.md's stop-point table: resume, run 3-post or step 29 for a held privilege, or roll
  back in strict reverse order with the hosted variants for 7, 5 and 1. **Once a verified
  approval-identity row exists, restore from PITR; never force the 3 or 9 rollback.**

## 3. Record Rental activation (all flags off; each item its own approval)

Code: `feature/record-rental-integration` @ this commit. It contains the six-step interface,
runtime, eligibility, gateway hardening, and the Security 0031 alignment (authorize before
reading evidence).

| # | Dependency | Artifact | Needs |
|---|---|---|---|
| 1 | M2 Windows 1–2 | above | licence snapshot/verify, evidence issuer, record transaction, storage integrity |
| 2 | Paper agreements | `proposed/paper-agreements-v1.sql`; `PAPER_RELEASE` | install, then flag |
| 3 | Historical agreements | `proposed/record-rental-historical/01` (+`02` rollback), `04` eligibility (+`05`) | install after 2 |
| 4 | eSign immutable archive | app patch `proposed/record-rental-historical/03-esign-immutable-v1-archive.patch` (`esign.server.ts`; the agreement-evidence pin moves with it); `SIGNED_ARCHIVE_V1_ENABLED` | code review, then flag |
| 5 | Evidence gateway | `proposed/record-rental-gateway/01`, `02` (key set), `04` (revoke), `03` (rollback) | install; owner sets secret `RECORD_RENTAL_EVIDENCE_GATEWAY_KEY` |
| 6 | Server env | `RECORD_RENTAL_STRIPE_ENVIRONMENT=live`; the existing Stripe reader (retrieve and list only) | owner |
| 7 | Flags | `RECORD_RENTAL_CONTRACT_ENABLED`, `HISTORICAL_AGREEMENTS_V1_ENABLED`, `SIGNED_RENTAL_TERMS_V1_ENABLED`, `SIGNED_ARCHIVE_V1_ENABLED` (plus `END_RENTAL_SAFE_V1_ENABLED`, `RENTAL_SUBSCRIPTION_COORDINATION_ENABLED`, `ARCHIVE_DELETION_GUARD_ENABLED` for the closeout path) | after 1–6, on a Release B-based build |
| 8 | Business decision | renters with **no** signed original (missing-contract exception) | not built |

## 4. Link to Rental (Stripe history), after rentals exist

Built dark: `linkStripeSubscription`, `previewStripeHistory` and `applyStripeHistory`
(`stripe-reconciliation.functions.ts`), plus the dry-run CLI `scripts/stripe-reconcile-dry-run.ts`.

Gated by:
- the `STRIPE_RECONCILIATION_ENABLED`/`ENV`/`ACCOUNT` pins;
- database package 0033.

No UI uses it yet. **Before any 0033 review:** the repository file
`scripts/stripe-reconciliation/0033_stripe_reconciliation.proposed.sql` hashes to `5f750ea5…`,
but `docs/stripe-reconciliation-review.md` records `67d6cb66…`. That needs reconciling.

Never charges, and never creates payments automatically. Historical imports need a
hash-matched preview and explicit linkage.

## 5. Owner approvals, in order

1. Merge Release A into the production branch (no publish), then publish Release A.
2. Confirm PITR and the restore point. Then M2 Window 1, including the operator-run backfill.
3. Release B: merge, then publish.
4. M2 Window 2.
5. Record Rental installs 2–5, each separately, then the gateway secret and server env.
6. Record Rental flags and publish of the integration build.
7. 0033 review (after the hash reconciliation), then Link to Rental activation.
8. Business decision on renters without a signed original.
