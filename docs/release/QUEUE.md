# Release queue

Updated 2026-10-23 by Claude Code.

**Three separate queues.** Nothing moves between them without the gate named in
its row. Development does not stop while approvals are pending.

| Queue | Means |
|---|---|
| **Ready to Ship** | Verified, needs no approval from you — merged or mergeable into a non-production branch |
| **Ready for Approval** | Complete and evidenced; waiting on your decision |
| **Blocked** | Cannot proceed, and the blocker is named |

---

## Ready to Ship — no approval needed

| Item | Where | Evidence |
|---|---|---|
| **Link to Rental** (`96bc898a`, dark) | `claude/unmatched-link-96bc898a` | 22/22 tests, tsc 0, three gates keep it off. The rejected double-collection work was not brought in |
| **Dark-feature coverage ledger** | `scripts/dark-flag-coverage.test.mjs`, in `npm test` | 59 modules, 0 unaccounted; both negative controls fail correctly |
| **Payments webhook invariants** | `scripts/payments-webhook-invariants.test.mjs`, in `npm test` | 13 statements checked; both guard-removal mutations fail the test |
| **Closeout harness + v2 proposal** | `scripts/closeout-harness/`, `proposed/end-rental-returns-approved-v2.sql` | 24/24 + mutation check. The SQL itself is a separate approval, below |
| **0031 documentation set** | `docs/security/` | Package verified `32c17aa7…`; feasibility 16/16. Installation is a separate approval, below |

---

## Ready for Approval — waiting on your decision

| Item | Branch / artifact | What you decide | Evidence |
|---|---|---|---|
| **Release #266** — the grok baseline | `integration/grok-baseline-2026-10-22` @ `f9ffc71a`, [PR #266](https://github.com/REAL-HQ/real-rentals/pull/266) | Walk the preview checklist, then approve publish | `docs/release/266-lovable-preview-acceptance.md`. tsc 0, prod build exit 0, 0 conflicts, **no migrations ship**, only flag true is already true live. Webhook invariants now **tested**, not eyeballed. Two items left for you: the preview walkthrough and the two env flag values |
| **Rental closeout (Option B)** | `proposed/end-rental-returns-approved-v2.sql` | Approve the migration | `docs/rental-closeout-readiness.md`. 23/23 behavioural + mutation check; verified against the live function |
| ~~Regina — Monday billing~~ | `docs/billing/regina-change-status.md` | **Nothing — done by Grok 2026-10-23.** Reported complete, independently unverified (no Stripe credential here). Matches the schedule computed in advance | Optional read-only Dashboard confirmation listed |

## Blocked — not on me

| Item | Blocker | Who |
|---|---|---|
| **Security 0031** | **Re-diagnosed 2026-10-23 — no longer a Lovable ticket.** An Oct 7 Lovable migration did create two `storage.objects` policies (verified), so the authority exists in the `supabase/migrations/` path. But 0031's seal pins `execution_role: postgres`, and `postgres` cannot create that policy — so the sealed package fails on *both* paths, for two different reasons. Blocked on two small things, both ours: the resealed artifact (`32c17aa7…`, still not found anywhere) and one read-only probe to identify the real executor. **Package recovered and verified 2026-10-23** — `32c17aa7…` and both companion files match; the reseal proven to be two insertions only (removing them reconstructs `479d44d3…`); **every pre-flight gate passes against live, catalog seal included**. Stored at `docs/security/0031-package/`, outside migration discovery. One blocker left: storage-policy authority. Earlier:  the Oct 7 migration provably executed byte-identically, but **no read-only operation reports the executor's effective role**, and present-day authority is unestablished (two explanations fit). The self-reporting probe **would create a migration receipt**, so it was not run. Single atomic route confirmed; split withdrawn. Plans: `docs/security/0031-executor-verification.md`, `docs/security/0031-installation-plan.md` | You (one question to Lovable Support; artifact) |
| **Adam — card 8542 / $350 Oct 23** | Needs a read-only Dashboard check (steps in the billing doc). Nothing sent, retried or scheduled. | You (Dashboard) |
| **Repo visibility / branch protection** | Reading protection returns HTTP 403 "Resource not accessible by integration" — the token has no admin scope, so it can neither be read nor set. Ruleset proposal exists, not applied. | You |
| **M2 / M3 hosted install** | Separate owner migration approvals, in the documented order | You |

## Integration / Testing — in hand

| Item | Status | Notes |
|---|---|---|
| **Link to Rental** (`96bc898a` from #267) | **Testing — done, dark** | `claude/unmatched-link-96bc898a`. Cherry-picked alone; 22/22 tests, tsc 0. Three gates keep it off. The rejected double-collection work was **not** brought in — the one failing assertion depended on it and was narrowed instead. Enabling it writes financial records and needs your approval. |
| **Rental closeout (Option B)** | **Ready for Approval** | See above. Owner re-confirmed the spec 2026-10-23: return to Approved only from Active; Suspended, Declined and **Closed** all preserved — each now a harness case. 24/24. |
| **0031 ledger reconciliation** | **Done** | `docs/security/0031-journal-reconciliation-2026-10-23.md`. Reported reseal SHA `32c17aa7…` matches nothing available (279 refs, 6,873 blobs, Drive, handoff zip) — unverified, not claimed. Live ledger: entries 1–22 identical to the seal, one row appended. |

## In Development — next, not waiting on you

| Item | Flag (all hard `false`) | State |
|---|---|---|
| **Application Resume** | `APPLICATION_RESUME_ENABLED` | **Unblocked a question, see below.** Depends on drizzle `0023_application_resume_atomic_security.sql` |
| **Record Rental** | `RECORD_RENTAL_CONTRACT_ENABLED` | Depends on M2/M3 SQL. Note: while off, `activeFilterApplicationIds` falls back to `openRentalApplicationIds` — an open rental alone counts as Active |
| **Vehicle Swap** | `SWAP_ENABLED` | Depends on `proposed/vehicle-swap-v1.sql` |
| **Unified Payments** | `UNIFIED_FINANCE_ENDPOINT_ENABLED` | `src/lib/unified-finance-flag.ts` |

### Resolved today: is drizzle 0023 applied in production?

It was listed as an open unknown. **It is not applied.** Read-only mapping of
every live journal row onto the migration files by SHA-256:

```
journal id  1..23  ->  0000_fleet_inbox_job_queue.sql .. 0022_waitlist_resolve_phone_conflict.sql
                       (in order, no gaps, every hash matched a file)
files not in the journal (1): 0023_application_resume_atomic_security.sql
```

So production runs everything through **0022** (the last, applied 2026-10-19
11:22 UTC) and **0023 is the single pending migration**. Application Resume's
atomic security work therefore has no database support live yet — its flag must
stay `false`, and installing 0023 is a migration approval like any other.

## Standing rules being followed

- No production publish, migration, customer-data write, live Stripe call,
  permission change or feature enablement without your explicit approval.
- Silence is never approval.
- Development continues on non-production branches while approvals wait.
- Branches pushed: `claude/unmatched-link-96bc898a`, `claude/ops-2026-10-23`.
