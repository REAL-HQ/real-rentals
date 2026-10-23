# PR #266 — Lovable Preview acceptance checklist

Baseline `integration/grok-baseline-2026-10-22` @ `f9ffc71a`, onto live
`codex/revenue-publication`. Prepared 2026-10-23 by Claude Code.

**Green checks are not permission to publish.** `tsc --noEmit` = 0 errors,
production build exit 0, `git merge-tree` 0 conflicts — that is all machine
evidence that the code *compiles and merges*. It says nothing about whether the
live business still works. This list is the part a machine cannot do.

## Before you switch the preview

> **The preview runs against the LIVE database.** Everything you click writes to
> real data. Read, filter and open; do not create, send, charge or sign.
> **Never press Publish while the preview is on the baseline** — Publish deploys
> whatever branch the preview is pointing at.

1. Note the current branch so you can switch back: `codex/revenue-publication`.
2. **Project settings → Git → GitHub branch picker →
   `integration/grok-baseline-2026-10-22`.**
3. Wait for **"In sync with GitHub"** before testing anything.
4. Confirm the commit shown is `f9ffc71a`.

## What this release does and does not change

Verified by diffing the baseline against live, not taken on trust:

| | |
|---|---|
| New database migrations | **none.** `git diff` over `supabase/migrations/` and `drizzle/migrations/` is empty. Nothing runs on publish. |
| New `proposed/` SQL files | 18 — none is a migration, none runs |
| Feature flags set to `true` | **exactly one: `STRIPE_COLLECTIONS_ENABLED`** — already `true` live. The baseline turns on **nothing new**. |
| Flags still hard `false` | ~60, including Record Rental, Swap, Vehicle P&L, every finance report, Unmatched Payments, all five Billing Controls |
| Routes added | `portal_.help`, `portal_.roadside`, `vehicles.$id` |
| Routes changed | `__root`, `admin`, `apply`, `card.$applicationId`, `fleet.$id`, `fleet.index`, `index`, `login`, `portal`, `thank-you`, `api/public/payments/webhook`, `api/public/cron/automations` |

Two of those changed files carry money and need their own checks below: the
**payments webhook** and **thank-you** (the Google tag decision).

## 1. The six live systems must still work

Sign in as **Owner**. For each, the pass condition is "same as production", not
"no error on screen".

- [ ] **Revenue** — Overview totals match what production shows right now.
      Open production in a second tab and compare the numbers directly. A
      silently different total is the single worst outcome of this release.
- [ ] **Stripe Collections** — the screen loads, lists live subscriptions and
      charges, and each row still matches a driver. It must not offer to retry,
      charge or notify.
- [ ] **Payments** — the list loads; paid/unpaid/refunded states read the same as
      production. Net collected per row unchanged.
- [ ] **Drivers** — the list loads, filters and counts behave, and a driver's
      detail panel opens. Check one Active driver with a running rental.
- [ ] **Bookings** — the list loads and a booking opens.
- [ ] **eSign / Agreements** — an existing signed agreement still opens and its
      archive status still shows. **Do not send or sign anything.**

## 2. Nothing unfinished became reachable

- [ ] No new tab, card or button appears for: Record Rental, Vehicle Swap,
      Unmatched Stripe Payments, Vehicle Profitability, any Owner P&L or finance
      report, Incident Board, Tolls & Tickets, Maintenance Log, Billing Controls
      (payment-method links, billing-day change, extensions).
- [ ] Spot-check two by URL: typing a disabled feature's path falls back to
      Overview rather than rendering it.
- [ ] **Link to Rental** does not appear on the Payments screen. (It is not even
      in this baseline — it is on `claude/unmatched-link-96bc898a`, dark.)

## 3. The three new routes

- [ ] `/portal/help` — loads, content is correct, and it makes **no** claim about
      insurance coverage or about driving for Uber / Lyft / DoorDash. Any such
      claim needs insurer or platform verification first and must not ship.
- [ ] `/portal/roadside` — loads; the roadside SMS alert path stays off
      (`ROADSIDE_SMS_ALERTS_ENABLED` is `false`).
- [ ] `/vehicles/<id>` — open a **published** vehicle: photos load. Then open an
      **unpublished** one: it must not expose originals or unapproved AI
      retouches.

## 4. The money-touching changed files

- [ ] **`/thank-you`** — decide the Google tag question *before* publishing, not
      after. Confirm whether the tag is present here, and confirm it is absent on
      `/login`, `/sign` and `/card/<id>`. Publishing with it missing stops Ads
      conversion tracking; publishing with it on a token page risks leaking a
      credential URL if the sanitizer regresses.
- [ ] **Payments webhook** (`api/public/payments/webhook`) — cannot be clicked
      through. Review the diff against live by eye and confirm it still: never
      un-pays a row, claims notices via `notified_status`, and writes no second
      charge. If the diff touches any of those three, hold the release.
- [ ] **`api/public/cron/automations`** — confirm the diff does not change send
      timing or recipients.

## 5. Driver-facing spot check

- [ ] Open the portal as a driver via **Driver Preview** (Manager+, audited).
      Confirm it is read-only: no driver write action is offered, and the
      preview cannot act as the driver.

## 6. Leaving the preview

- [ ] Switch the branch picker back to **`codex/revenue-publication`**.
- [ ] Confirm "In sync with GitHub" again.
- [ ] Confirm no records were created during the walkthrough.

## Sign-off

Publishing is one release of RC3–RC17 together: a wide blast radius, and the
rollback is republishing `7e3e6eb6`. Record it here.

| | |
|---|---|
| Walked by | |
| Date | |
| Sections 1–6 all pass | ☐ |
| Google tag decision made (§4) | ☐ |
| **Approved to publish** | ☐ |

Anything that fails: say which box and what you saw. A failure is a fix on a
branch and a re-preview, not a publish with a caveat.
