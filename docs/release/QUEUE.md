# Release queue

Updated 2026-10-23 by Claude Code. Statuses: In Development · Testing ·
Integration · Blocked · Ready for Approval · Ready to Ship · Live.

**Only two things need you:** production approvals and business decisions. They
are collected at the bottom. Everything else is being worked.

## Ready for Approval — waiting on you

| Item | Branch / artifact | What you decide | Evidence |
|---|---|---|---|
| **Release #266** — the grok baseline | `integration/grok-baseline-2026-10-22` @ `f9ffc71a`, [PR #266](https://github.com/REAL-HQ/real-rentals/pull/266) | Walk the preview checklist, then approve publish | `docs/release/266-lovable-preview-acceptance.md`. tsc 0 errors, prod build exit 0, 0 merge conflicts, **no migrations ship**, **only flag true is one already true live** |
| **Rental closeout (Option B)** | `proposed/end-rental-returns-approved-v2.sql` | Approve the migration | `docs/rental-closeout-readiness.md`. 23/23 behavioural + mutation check; verified against the live function |
| **Regina — Monday billing** | `docs/billing/regina-monday-anchor-approval.md` | Run the 4 read-only Dashboard steps, send 5 values; then approve the operation | Schedule computed; the trial-offer revert risk identified |

## Blocked — not on me

| Item | Blocker | Who |
|---|---|---|
| **Security 0031** | `storage.objects` is owned by `supabase_storage_admin`; `CREATE POLICY` needs superuser or ownership, and `BYPASSRLS` does not grant it. Only `supabase_admin` can create the fifth policy, and it is not reachable. Lovable Support has not answered. **Installation stays blocked.** | Lovable engineering |
| **Adam — card 8542 / $350 Oct 23** | Needs a read-only Dashboard check (steps in the billing doc). Nothing sent, retried or scheduled. | You (Dashboard) |
| **Repo visibility / branch protection** | Reading protection returns HTTP 403 "Resource not accessible by integration" — the token has no admin scope, so it can neither be read nor set. Ruleset proposal exists, not applied. | You |
| **M2 / M3 hosted install** | Separate owner migration approvals, in the documented order | You |

## Integration / Testing — in hand

| Item | Status | Notes |
|---|---|---|
| **Link to Rental** (`96bc898a` from #267) | **Testing — done, dark** | `claude/unmatched-link-96bc898a`. Cherry-picked alone; 22/22 tests, tsc 0. Three gates keep it off. The rejected double-collection work was **not** brought in — the one failing assertion depended on it and was narrowed instead. Enabling it writes financial records and needs your approval. |
| **Rental closeout (Option B)** | **Ready for Approval** | See above. Harness hardened so a dead cluster can't look like findings. |
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
