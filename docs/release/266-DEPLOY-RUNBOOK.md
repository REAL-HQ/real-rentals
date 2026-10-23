# RC #266 — publish and rollback runbook

Project: **https://lovable.dev/projects/8cf1f99e-71ad-4a93-a47c-bfbe833616d6**

| | |
|---|---|
| Publish | `integration/grok-baseline-2026-10-22` @ **`67b62664`** |
| Roll back to | `codex/revenue-publication` @ **`0946c750`** |

> **Rollback target corrected.** Earlier notes said `7e3e6eb6`. Production has
> moved on twice since (`ec07e587`, `0946c750`), so `7e3e6eb6` would **drop two
> commits**. Roll back to **`0946c750`**.

---

## A. Before publishing

- [x] **A1. Environment flags — no longer a gate.** Production is on Lovable
      Cloud, not your Cloudflare account; my earlier instruction was wrong. All
      four flags are strict `=== "true"` checks, so unset means **off**, and
      **#266 does not change any of them**. The two that would matter need
      database functions that do not exist (`stripe_ingest`,
      `reserve_application_recovery`), so they cannot be silently working.
      Optional confirmation only: `docs/release/266-env-flags.md`.
- [ ] **A2. Deployment identity, before.** Lovable → Project settings → Git.
      Branch = `integration/grok-baseline-2026-10-22`, commit = **`67b62664`**,
      status **"In sync with GitHub"**.

      **I cannot confirm the currently *deployed* SHA from here, and neither
      does that field.** It reports the *selected branch* — it already reads
      `67b62664` because you switched the picker, while the published site is
      still the previous build. drivereal.com is unreachable from this
      container (HTTP 000), and Lovable exposes no deploy-history tool. **Read
      the last published commit in the Lovable editor's publish/deployment
      history** and write it here before publishing: `________`. It should be
      `0946c750`; if it is anything else, that is the real rollback target.
- [ ] **A3. Note what production is on now** so rollback is unambiguous:
      `codex/revenue-publication` @ **`0946c750`**.

### A3b. Pre-publish database baseline — measured 2026-10-23 11:43 UTC

Read-only from production. Compare against these after publishing.

| | Before |
|---|---|
| `payments` rows | **0** |
| `payments` net collected | **0** |
| rows with a Stripe invoice id / payment intent id | **0 / 0** |
| `rentals` (total / active) | **0 / 0** |
| `vehicles` (total / available / rented) | **10 / 4 / 0** |
| `applications` | **142** — new 94, closed 21, reviewing 9, partial 8, declined 6, duplicate 4 |
| `agreements` | **1** |

> **Read this before trusting the Revenue check.** The payments table is
> **empty**, and there are no rentals. Money currently lives in Stripe, not in
> the app's tables — consistent with the known unrecorded Stripe invoices. So
> **Revenue showing `$0` or near-zero is the correct present value, not a
> fault**, and a Revenue figure that suddenly shows a large number after
> publishing is the suspicious direction, not the other way round.
>
> There is also **no `bookings` table**; that screen is backed by other data.
> Judge C6 by "the screen loads and an item opens", not by row counts.
- [ ] **A4. Pick a quiet window.** Publishing swaps the Worker for every user.
- [ ] **A5. Owner approval** — yours, explicitly, after A1 and A2.

## B. Publish

- [ ] **B1.** Confirm the branch picker still reads `67b62664`. **Publish**.
- [ ] **B2.** Wait for the publish to report complete.
- [ ] **B3. Deployment identity, after.** Re-read the project's commit; it must
      read **`67b62664`**. If it reads anything else, stop and roll back.

> Publishing changes code only. **No migration runs** — this release ships none.
> The database is untouched either way.

## C. Smoke tests, in this order

Stop at the first failure and go to section D.

| # | Check | Pass |
|---|---|---|
| **C1** | **Revenue** — Overview total loads and matches the figure from before publish | a number, not "Unavailable" |
| **C2** | **Stripe Collections** — screen loads, rows match real drivers, totals plausible | loads, no error banner |
| **C3** | **Lead Priorities** | loads |
| **C4** | **Recent Applications** | loads |
| **C5** | **Drivers** — list, filters, open one detail panel | loads |
| **C6** | **Bookings** — list, open one | loads |
| **C7** | **Payments** — paid / unpaid / refunded read as before | matches pre-publish |
| **C8** | **eSign** — an existing signed agreement opens, archive status shows | opens |

C1 and C2 are first deliberately: the Stripe reader refactor is the one change
Preview could not exercise.

- [ ] **C9.** Record the on-screen Revenue and Collections figures **before**
      publishing, so C1 and C2 are comparisons and not guesses. The database
      baseline in A3b is the other half of that comparison.

## D. Roll back immediately if any of these

**Payment double-counting** — the baseline is **0 payment rows**
- Any payment row whose `stripe_invoice_id` or `stripe_payment_intent_id`
  already appears on another row.
- Revenue rising with no matching Stripe collection behind it.
- More payment rows than Stripe charges in the same period.
- A driver's balance drops by more than they actually paid.

*A payment row appearing at all is not automatically wrong — the webhook writes
one when Stripe reports a payment. Duplicates and unmatched rows are the fault.*

**Incorrect payment status**
- A row that was `paid` now reads `pending`, `failed` or anything else.
- A `refunded` row changes state.
- A row staff marked paid by hand loses its `failure_reason`, `paid_date` or status.

**Missing production data** — measured against A3b, not against an assumption
- Applications shows fewer than **142**, or Drivers is empty.
- Vehicles shows fewer than **10**.
- An agreement that existed before is gone (**1** on file).
- ~~Revenue reads `$0`~~ — **removed. `$0` is correct today**: the payments
  table is empty. The suspicious direction is Revenue showing a *large* figure
  with no collections behind it, which is covered under double-counting.

**Failed Stripe collection reads**
- Revenue shows "Unavailable" **after** publish when it worked before.
- Collections shows a partial or obviously wrong total — the reader is built to
  refuse rather than return a partial, so a partial total means something is wrong.
- Repeated "Stripe temporarily unavailable" beyond one retry.

**Anything else**
- A driver or renter reports a wrong charge, a wrong balance or an unexpected email.

## E. Rollback

- [ ] **E1.** Lovable → Project settings → Git → branch picker →
      **`codex/revenue-publication`**.
- [ ] **E2.** Wait for "In sync with GitHub"; confirm commit **`0946c750`**.
- [ ] **E3. Publish.**
- [ ] **E4.** Re-read the commit: must be **`0946c750`**.
- [ ] **E5.** Re-run C1–C8 against the restored build.

> **Rollback restores code, not data.** If a defect wrote rows — a double-counted
> payment, a wrong status — those rows survive the rollback. Roll back first to
> stop it spreading, then tell me what was written; correcting data is a separate
> decision and needs its own approval.

## F. After a clean run

- [ ] Record the published commit, the time, and the C1 Revenue comparison.
- [ ] Watch Payments and Collections for the first full billing cycle.
- [ ] Post-release backlog: the `checkout.session.completed` handler test gap,
      and a restricted read-only Stripe key for Preview so the collections
      reader can be exercised before the next release.

## Not in this release

Security 0031 (blocked on executor authority) · Rental Closeout Option B
(separate migration approval) · Link to Rental (not in the candidate).
