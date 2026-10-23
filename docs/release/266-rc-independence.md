# PR #266 — what can ship without any pending migration

Prepared 2026-10-23 by Claude Code. Every claim below is from a diff against
live `codex/revenue-publication`, not from the handoff notes.

## Headline: the whole of #266 is independent of 0031 and of every pending migration

| Check | Result |
|---|---|
| New migration files in the release | **none.** `git diff` over `supabase/migrations/` and `drizzle/migrations/` is **empty** — nothing runs on publish |
| `proposed/` SQL files added | 18, none of which is a migration and none of which runs |
| Depends on Security 0031's five policies | **no.** 0031 only *subtracts* Coordinator access. No code requires the policies to exist; it is defence in depth behind server-side tier checks that already ship |
| Depends on drizzle `0023` | only through `APPLICATION_RESUME_ATOMIC_ENABLED`, which **already exists in live** (below) |
| Feature flags set to `true` | **one** — `STRIPE_COLLECTIONS_ENABLED`, already `true` in production |
| Feature flags hard `false` | **60** |

So the smallest compatible release candidate is **#266 itself**, at `f9ffc71a`.
Carving it smaller would mean constructing and re-verifying a different tree,
which trades a verified artifact for an unverified one. Evidence already on
record: `tsc --noEmit` 0 errors, production build exit 0, `git merge-tree` 0
conflicts, local merge clean across 649 files.

## Two things that are *not* inert, and must be reviewed as live changes

A flag inventory is not enough: code outside the flags ships live.

### 1. The payments webhook — `+212 / −42`

`src/routes/api/public/payments/webhook.ts` is the largest live-path change in
the release. Read against the three AGENTS.md invariants, it **upholds** them:

- **Never un-pays.** The update is guarded `.neq('status','paid').neq('status','refunded')`
  and only touches `openIds` — rows not already paid.
- **Preserves a manual record.** Rows staff marked paid while a failure reason
  was still set are collected into `manualIds` and left alone: *"Keep that
  manual record. Status, paid_date, and failure_reason stay."*
- **Claims notices via `notified_status`**, unchanged.
- `warnUnmatchedInvoice` / `warnUnmatchedPayment` only `console.warn`; neither
  inserts a payments row.

Still: it runs in production the moment this publishes, for every Stripe event,
and no flag gates it. It is the single highest-risk item in the release and
belongs in the preview walkthrough as its own line.

Smaller live-path changes: `revenue-state.ts` `+15/−2`,
`payment-collection.server.ts` `+10/−2`. `esign.server.ts` and
`rentals.functions.ts` are **unchanged**.

### 2. Two flags are environment variables, not source constants

I previously said every flag is a source constant. **That was wrong for two of
them**, and the correction matters because an env var can switch a feature on at
publish with no code change:

| Flag | Gate | Risk |
|---|---|---|
| `DRIVER_ISSUE_ALERTS_ENABLED` | `process.env.… === "true"` | If set `"true"`, driver issue **emails send** |
| `APPLICATION_RESUME_ATOMIC_ENABLED` | `process.env.… === "true"` | Switches Application Resume to `reserve_application_recovery` / `finish_application_recovery` — **functions that only exist in pending 0023**. If `"true"` while 0023 is unapplied, that path calls RPCs that are not there |

**Both already exist in live** — verified present in `codex/revenue-publication`
as well as the baseline — so **#266 does not add this exposure**; it inherits it.
No action is required for the release itself. But the production values are not
readable from here, and one of them is the only link between this release and a
pending migration.

**Confirm before publish** (Cloudflare/Lovable environment settings): both are
unset, or not the exact string `"true"`. The code comment states the rule
plainly: *"Set `APPLICATION_RESUME_ATOMIC_ENABLED=true` only after that SQL."*

## Release candidate

| | |
|---|---|
| Candidate | `integration/grok-baseline-2026-10-22` @ `f9ffc71a` ([PR #266](https://github.com/REAL-HQ/real-rentals/pull/266)) |
| Migrations executed on publish | **none** |
| New features switched on | **none** |
| Blocked-migration work included | source only, inert behind 60 hard-`false` constants |
| Preserved live systems | Stripe Collections, eSign, Revenue, Drivers, Bookings, Payments — eSign and the rental lifecycle are byte-unchanged; the other paths are the reviewed diffs above |
| Acceptance | `docs/release/266-lovable-preview-acceptance.md`, plus the two items above |
| Rollback | republish `7e3e6eb6` |
| Status | **Ready for Approval — not published** |

## Why keeping blocked migrations in the release is the safe choice

Every migration-dependent feature ships as source behind a hard-`false`
constant. That is deliberate: the code is reviewed and in the tree, so when a
migration is approved the change is a one-line flag flip rather than a fresh
merge and re-verification. Removing that code to make a "smaller" release would
mean doing the integration twice.
