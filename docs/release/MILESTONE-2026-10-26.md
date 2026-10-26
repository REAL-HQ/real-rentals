# Milestone 2026-10-26: A.2 ready for Preview review, other workstreams

**Live:** `a3df8545` (A.1 + reminder cap). The hourly reminder repair is deployed and first-run verified.
**Preview branch:** `a3df8545` (unchanged).

| Workstream | Branch @ head | Draft PR | State |
|---|---|---|---|
| Release A.2 (#277 + #279 + `/apply` consent footer) | `release/a2-candidate` @ `5d442808` (tree `8f30bad3…`) | #283 | **Ready for Preview review**: tsc / build / full test 0, agreement-evidence 11/0, eSign 50/50; consent overlap 45→0 (Pixel 7), 204→0 (iPhone SE) |
| PR 2 merged onto live | `feature/driver-activation-readiness` @ `418ec749` (merge `393d51e7`) | #275 (base now `release/reminder-cap`) | DEV-COMPLETE. 77/77 app, 61/61 DB, S1, 0031 and M2 C1–C4 pass; eSign 50/50; packages unchanged (`b80babcc…`, `eb7710d7…`) |
| Ops-reminders safety + job-3 package | `fix/ops-reminders-safety` @ `a20f2cc7` | — | DEV-COMPLETE. Unit 20/20 (15 fail on the old route), concurrency 12/12, scheduler DB 40/40; request `8a6a2166…1add` |
| M2 hash-only build on live | `release/m2-app-hash-only-live` @ `0520a3ff` | — | Merged and tested (57/57 chain); flags as the original |
| Release B on live | `release/m2-app-flags-on-live` @ `b122089f` | — | Merged and tested; flags as the original |
| Record Rental on live | `feature/record-rental-live` @ `9bb74cc3` (code up to `6e8b03f4`) | — | Merged and tested (59/59 chain, harness suites pass); all flags off |

## Read-only production checks (2026-10-26)

**Window 1 missing files:**
- Backfill scope: 21 documents, 0 missing (see `M2-WINDOW1-MISSING-FILES-RECHECK-2026-10-26.md`).
- Grok's two missing files are a `gig_profile` and an `insurance` document on a closed record. **Not a Window 1 blocker.**

**Ops-reminders preflight (06:03Z):**
- Every gate is true: job 3 is still the August definition; job 2 holds the installed fix; pg_net, the token and the checker are present; no earlier evidence row.
- First-run eligible: 0 past-due, 0 licence-expiring, 0 agreement reminders, so **0 driver emails**.
- Backlog 0. Team digests 0.
