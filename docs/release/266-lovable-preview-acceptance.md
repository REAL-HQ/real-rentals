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

- [x] **`/thank-you` Google Ads tag — verified preserved, nothing to decide.**
      Owner instruction 2026-10-23: keep it; do not remove or disable it. The
      baseline keeps it. Verified by diff, not assumed:
      the tag is not in `thank-you.tsx` on either side — live injects it inline
      from `__root.tsx` on *every* page, and the baseline moves it to
      `GOOGLE_ADS_BOOTSTRAP` in `src/lib/tracking-url.ts`, still injected from
      `__root.tsx` for every path **except** `isCredentialTrackingPath`
      (`/login`, `/invite`, `/sign`, `/sign/*`, `/card`, `/card/*`).
      `/thank-you` is **not** in that list, so the tag loads there, and the
      conversion id is byte-identical on both branches. Net effect: tracking
      unchanged on /thank-you, removed from credential routes, plus a sanitized
      `page_location`. Confirm in the preview that the tag request fires on
      /thank-you and does **not** fire on /login.
- [x] **Payments webhook** (`api/public/payments/webhook`, +212/−42) — cannot be
      clicked through, and now does not have to be. `npm run test:webhook`
      (`scripts/payments-webhook-invariants.test.mjs`) asserts the three
      AGENTS.md rules structurally and fails if a guard is dropped:
      every payments update carries `.neq('status','paid')` and
      `.neq('status','refunded')` so a collected row cannot be un-paid
      (including updates built from a variable); every `notified_status` write
      is a conditional claim so a replayed Stripe event cannot email twice;
      the unmatched-invoice warnings only `console.warn` and write no charge;
      and a row staff marked paid while a failure reason was set keeps that
      record. Both guard-removal mutations fail the test.
      **Still do by hand:** confirm a real Stripe event in the preview produces
      the same payment row state as production.
- [ ] **`api/public/cron/automations`** — confirm the diff does not change send
      timing or recipients.

- [ ] **The two environment flags — the only link from this release to a pending
      migration.** Both already exist in live, so #266 does not add them, but
      their production values are not readable from this session and one of them
      is dangerous while drizzle `0023` is unapplied. In the Cloudflare/Lovable
      environment settings for the production deployment, confirm each is
      **unset, or set to anything other than the exact string `"true"`**:

      | Variable | If it is `"true"` |
      |---|---|
      | `APPLICATION_RESUME_ATOMIC_ENABLED` | Application Resume calls `reserve_application_recovery` / `finish_application_recovery` — **functions that only exist in pending 0023**, so recovery sends would fail at the RPC |
      | `DRIVER_ISSUE_ALERTS_ENABLED` | Driver issue **emails send** to drivers |

      The code states the rule itself (`src/lib/application-recovery.server.ts`):
      *"Set `APPLICATION_RESUME_ATOMIC_ENABLED=true` only after that SQL."*
      Record both observed values here before publishing:
      `APPLICATION_RESUME_ATOMIC_ENABLED = ______`  ·
      `DRIVER_ISSUE_ALERTS_ENABLED = ______`

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
