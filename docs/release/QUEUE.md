# Release queue

Updated 2026-10-23 by Claude Code.

> **RC `67b62664` is FROZEN.** No further commits to
> `integration/grok-baseline-2026-10-22` unless a demonstrated release-blocking
> defect requires a fix. Feature work continues on separate branches and is not
> merged into this candidate.

| Queue | Means |
|---|---|
| **Ready to Ship** | Production-compatible, fully verified, **no unresolved prerequisites** |
| **Ready for Approval** | A specific decision for the owner |
| **Blocked** | An unresolved technical prerequisite |
| **Development / Integration** | Still needs testing or integration |

---

## Ready to Ship

| Item | Where | Why it needs nothing from you |
|---|---|---|
| — | — | — |
| **Release-verification tests** | now in the RC at `67b62664` | Dark-feature ledger (59 modules, 0 unaccounted), webhook invariants (13 statements), 9 simulated-event cases. Test files and `package.json` only — no application code |

## Ready for Approval

| Item | Decision | Evidence |
|---|---|---|
| **Release #266** @ `67b62664` | Walk `266-PREVIEW-SHORT.md`, send the four env values from `266-env-flags.md`, then approve publish | tsc 0, build exit 0, no migrations ship, only flag true is already true live, webhook invariants tested |
| **Rental Closeout Option B** | Approve `proposed/end-rental-returns-approved-v2.sql` | 24/24 behavioural + mutation check, verified against the live function |
| **Security 0031 installation** | Approve execution — **only after the blocker below clears** | Package `32c17aa7…` verified; every pre-flight gate passes live; feasibility 16/16 |

## Blocked

| Item | Prerequisite |
|---|---|
| **Security 0031** | Executor authority to `CREATE POLICY ON storage.objects`. No read-only operation reports it. **Not reopening until new evidence appears.** |
| **Application Resume (atomic path)** | Migration `0023`, pending. Until then `APPLICATION_RESUME_ATOMIC_ENABLED` must not be `"true"` |
| **Repo branch protection** | Token lacks admin scope; protection can be neither read nor set from here |

## Development Complete — Awaiting Integration / Activation

| Item | Where | Dependencies still unsatisfied |
|---|---|---|
| **Link to Rental** (`96bc898a`, dark) | `claude/unmatched-link-96bc898a` | Not in RC `67b62664`. 22/22, tsc 0, three gates keep it off. Needs: integration into a future candidate, then your approval to enable — enabling writes financial records |

## Development / Integration

| Item | State |
|---|---|
| **Record Rental** | Source only; needs M2/M3 SQL |
| **Vehicle Swap** | Source only; needs `proposed/vehicle-swap-v1.sql` |
| **Application Resume** | Source only; needs `0023` |
| **Unified Payments** | Source only, behind `UNIFIED_FINANCE_ENDPOINT_ENABLED` |

---

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
