# RC #266 — published

**Published 2026-10-23 by the owner, through the Lovable editor.**
Release candidate `67b62664` (`integration/grok-baseline-2026-10-22`).

Status: **initial production smoke-test pass — not full release acceptance.**

## Before / after, captured from the live Overview

Every value matched exactly across the publish:

| | Value |
|---|---|
| Gross Collections | $1,050.00 |
| Refunds | $0.00 |
| Stripe Fees | $31.35 |
| Net Collections | $1,018.65 |
| Successful Payments | 3 |
| Active Subscriptions | 0 |
| Upcoming Billing | 3 |
| Linked Failures | 2 |
| Revenue tile | $340 |
| Overdue Leads | 99 |
| Fleet | 10 vehicles |

Lead Priorities and Recent Applications both load. Regina's next billing date
shows **October 26**, matching the schedule computed before her change.

### The figures are internally consistent

- $1,050.00 − $31.35 = **$1,018.65** ✓ — fees are ~3% + $0.30 per charge across 3 charges.
- The Revenue tile is a narrower window than Collections: one $350 charge net of
  fees is ≈ $339.55, shown as **$340**. Revenue is "verified Stripe net plus
  recorded non-Stripe payments", not a repeat of the Collections total.

### What this confirms about the release

The Stripe Collections reader — the one path Preview could never exercise,
refactored across three modules in this release — **is reading live Stripe
correctly in production**, with pagination, fees and refunds all reporting. That
was the largest open risk and it is now closed by observation rather than by
test alone.

## Standing item, unchanged by this release

Collections reports **3 successful payments / $1,050** from Stripe, while the
app's `payments` table holds **0 rows** (verified read-only before publishing).
Those are the three known unrecorded Stripe invoices. Publishing did not change
that, and was not expected to — it is the gap **Link to Rental** was built to
close, and that feature is not in this release and remains off.

## Remaining before full acceptance

Drivers · Bookings · Active Rentals · Payments · eSign · deployed-version
confirmation.

## Rollback remains available, untouched

| | |
|---|---|
| Primary | `rollback/pre-rc266-7e3e6eb6` @ `7e3e6eb6` |
| Secondary | `codex/revenue-publication` @ `0946c750` |

Neither branch was modified. Triggers and the restore procedure are in
`266-DEPLOY-RUNBOOK.md` sections D and E. **Rollback restores code, not data.**
