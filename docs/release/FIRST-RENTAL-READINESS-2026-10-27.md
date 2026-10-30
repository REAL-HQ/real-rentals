# First rental: consolidated launch readiness (2026-10-27)

| | |
|---|---|
| Live | `5e492a87`: A.2 + PR 2, deployment `4ad9e141` |
| Database | Activation setting and insurance authority installed. Insurance exception **OFF**. |
| This review | Read-only against production. One new review branch. No charges, subscriptions, refunds, publishes, SQL or Stripe changes. |

## Verdict

**Not yet GO for the first rental.**

Three things remain, all small:
1. Publish the billing-safety branch (one app-only release).
2. The Owner confirms the Stripe live configuration.
3. The Owner accepts manual weekly billing for launch.

After that the first rental can be accepted, attended, using the checklist in `MVP-LAUNCH-GO-NO-GO-2026-10-26.md` §3.

## PR 2: DEPLOYED and installation-verified (no further work)

| Item | Value |
|---|---|
| App | `5e492a87`, deployment `4ad9e141`, live SHA confirmed by the Owner |
| Activation-setting SQL | Request `b80babcc275bea4682bc9b69ba3ce11d5f2833ced848c9682b00979311765505`, txid 107299, verify-after 15/15 |
| Insurance-authority SQL | Request `eb7710d7fc3ff58adc0c1d0424245b205dda98f9f319ad29f24adf5363e68950`, txid 107840, verify-after 8/8 |
| Rollback refs | IVA `69d5dcef91d46b2529f70d2783a68289095d998f55937d252f1ae116b729d082`, then app `rollback/pr2-to-a2` = `8ea838c2` (tree identical to A.2), then AIS `57498a8277f66d23ca6b2a18800bed243295cb9a6979c8063e75945dbc384893`. Each needs approval. |
| Pending operational acceptance (natural use only) | First real insurance Verify gives one `insurance.verified` audit row. First real activation gives `rental.activated` with `checked_in_transaction: true`. |

## Payment and rental-lifecycle findings

### Confirmed defects (live code `5e492a87`)

| # | Defect | Evidence | Status |
|---|---|---|---|
| D1 | **Weekly autopay start is rejected by Stripe.** `startRentalAutopay` sends `items[].price_data.product_data`. | Stripe's official OpenAPI spec (`2026-09-30.endive`): `POST /v1/subscriptions` `items[].price_data` **requires `product`** (an existing Product id) and has **no `product_data`**. Only `POST /v1/prices` and Checkout accept `product_data`. SDK 22.0.2 types agree; the code needs an `as any` cast to compile. The dormant coordination path has the same request shape. | **Excluded from launch.** Start is switched off (branch below). |
| D2 | **Duplicate subscriptions possible.** Check-then-create on `rentals.stripe_subscription_id`, no lock, no idempotency key on `subscriptions.create` or `customers.update`. | Code `rental-payments.functions.ts:223-266` | Excluded: start is off |
| D3 | **Autopay could start on a closed rental.** The button loads the latest rental of any status; the server has no status check. | Code `DriversPanel.tsx` `AutopayActions`; `startRentalAutopay` | **Fixed on branch** |
| D4 | **Stop Autopay hides failures.** It swallows any cancel error, then clears the subscription id. Stripe can keep billing while the app shows autopay off. | Code `rental-payments.functions.ts:288-294` | **Fixed on branch** |
| D5 | **End Rental does not cancel the subscription.** `end_rental_tx` only clears `autopay_active`; the id remains and Stripe keeps billing. The webhook then records rent on a closed rental. | Code `rentals.functions.ts` `endRental`; `end_rental_tx` | **Fixed on branch** (refuses until autopay is stopped) |
| D6 | Autopay failure emails are not claimed via `notified_status`, so a redelivered `invoice.payment_failed` resends the email | Code `webhook.ts:356-433` | Autopay only. Deferred while autopay is off. |

Today's production exposure is **none**: 0 rentals, 0 subscriptions, 0 payments.

### Suspected issues (not proven; handled by operating rules)

| # | Issue | Rule for launch |
|---|---|---|
| S1 | A Charge Card that ends in an *ambiguous* error (network or timeout, not a card decline) is marked failed. Retrying uses a new idempotency key, so a charge Stripe actually completed could be repeated. | After any non-decline error, check the Stripe Dashboard (or wait for the webhook) before retrying |
| S2 | Two simultaneous Charge Card submissions (two tabs) create two charges. One tab is protected by the busy button. | One person charges, from one tab |
| S3 | The live/sandbox mode is chosen by the browser and trusted by the server. Risky only if sandbox credentials and a sandbox webhook point at production. | Owner confirms no sandbox webhook targets drivereal.com |
| S4 | Driver "Pay Now" can refuse ("Your balance changed") when balances include statuses the portal doesn't sum | Staff charge with Charge Card |

### Checked and safe for manual weekly billing

- **Charge Card** (`chargeCardOnRental`, Owner only):
  - writes the payment row **before** collection;
  - charges one off-session PaymentIntent with an idempotency key (`payments:<id>:attempt:<n>`);
  - marks `paid` only on `succeeded` and `failed` otherwise.
- **Webhook:**
  - never un-pays;
  - a `payment_intent.succeeded` for a charge marked failed after a timeout still settles it as paid;
  - refunds go only through `apply_payment_refund` (refund in the Stripe Dashboard).
- **Late fees:** policy is `enabled: false` in production, so the daily job adds nothing.
- **Automations:** the 5-minute automations job sends messages only; nothing else charges or writes payments.

## Review branch: `fix/billing-launch-safety` @ `7629c44a` (base: live `5e492a87`)

**App only:** 7 files, no SQL, no new Stripe calls, no flag turned on.

| Change | Effect |
|---|---|
| `src/lib/rental-autopay-flag.ts`: `RENTAL_AUTOPAY_START_ENABLED = false` | Start Autopay refused before any Stripe call or role lookup (both paths). With the switch on, a non-active rental is still refused. |
| `src/lib/subscription-cancel.server.ts` | Stop clears the id only when Stripe reports `canceled` or `incomplete_expired`. Anything else, including "no such subscription", returns an error and leaves autopay on. |
| `endRental` (published path) | Refuses while `stripe_subscription_id` or `autopay_active` is set |
| `DriversPanel` `AutopayActions` | No Start on closed rentals or while off ("Autopay Off · Charge Weekly"). Stop shown whenever a subscription exists. |
| `scripts/billing-launch-safety.test.mjs` (in `npm test`) | 15 checks, running the real handlers against fakes. **9 fail on live `5e492a87`, all pass on the branch.** |

Results:
- tsc, build and full `npm test` pass;
- agreement-evidence 11/0;
- PR 2 behaviour is untouched (`rentals.functions.ts` gains one guard after the existing status check).

**Deferred (not needed for launch):** a corrected autopay start. It would follow `stripe-operations.server.ts`:
1. `prices.create` with `product_data`;
2. `subscriptions.create` with `price`;
3. idempotency keys and an atomic claim on the rental.

It must then be verified in Stripe **test mode** (needs Owner approval) before the switch is turned on.

## Live Stripe configuration (Owner confirms; no secret values shared)

| # | Check | Why |
|---|---|---|
| C1 | Lovable payments go-live complete for **live** mode; the published site's publishable key starts with `pk_live_` | The site picks live or sandbox from that prefix |
| C2 | Secrets present: `STRIPE_LIVE_API_KEY`, `PAYMENTS_LIVE_WEBHOOK_SECRET`, `LOVABLE_API_KEY`; `SITE_URL` = `https://drivereal.com` | Stripe calls, signature check, card-setup return links |
| C3 | Stripe live webhook endpoint = **`https://drivereal.com/api/public/payments/webhook?env=live`** | Without `?env=live`, every event gets a 200 response and is silently ignored |
| C4 | Webhook events at least: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `customer.subscription.deleted`, `customer.subscription.updated` | Card on file, charge result, refunds. The two subscription events let a Dashboard cancel clear any stray subscription (the End Rental guard relies on it). |
| C5 | No sandbox webhook points at drivereal.com | Prevents sandbox events writing live rows (S3) |
| C6 | Stripe live has no pre-existing subscriptions billing these drivers (Dashboard or back-office Stripe Collections) | App records show 0; anything there was made outside the app |

## What remains before the first rental

| # | Item | Type | Approval |
|---|---|---|---|
| 1 | Review `fix/billing-launch-safety` (`7629c44a`) | Non-production | — |
| 2 | Preview → `7629c44a`, publish once, Owner confirms live SHA | **Production (app only)** | Separate approval |
| 3 | Stripe live configuration C1–C6 | Owner action | Owner |
| 4 | Business decision: **manual weekly billing** (Owner presses Charge Card each week); autopay off | Owner decision | Owner |
| 5 | Operating rules S1–S2 for Charge Card | Owner decision | Owner |
| 6 | First rental attended with the §3 checklist; read-only checks after each step | Operations | — |

Rollback for item 2: Preview to `5e492a87` (the current live code; republish needs approval).

## Update: PR #284 reviewed, Preview plan (2026-10-27)

**Draft PR:** https://github.com/REAL-HQ/real-rentals/pull/284. Head **`4268c667`** (tree `2018f3c9`); base `release/pr2-live` = `5e492a87`. Same 7 files.

**Independent review:**
- All subscription-creation paths are blocked or unreachable.
- Cancellation state is accurate in every outcome.
- Manual charges are untouched.
- No Stripe call on End Rental without a subscription. Production has 0 rentals with a subscription or autopay flag.

Review fixes are in `4268c667`:
- End Rental now points to the Stripe Dashboard, because the back office renders **no** autopay control;
- Stop reports a failed database clear;
- tests grew to 19 (11 fail on live).

tsc, build, full `npm test` and agreement-evidence 11/0 pass.

**Remaining gaps (not blockers; handled by `MANUAL-WEEKLY-BILLING-PROCEDURE.md`):**

| # | Gap | Handling now |
|---|---|---|
| G1 | Charge Card always creates a new row, so a retry after a decline leaves the declined row owed | Preferred: driver Pay Now. Otherwise charge once more and Waive the declined row with a note. |
| G2 | Charge Card says "Charged" even when Stripe returns the payment as pending | Staff confirm the row shows **Paid**. A one-line UI fix can follow on approval. |
| G3 | The `closeoutV2` path skips the subscription guard | Unreachable (flag off, SQL absent). Move the guard before enabling it. |
| G4 | No working autopay | Off. A corrected start needs Stripe test-mode verification and approval. |
| G5 | The payments screen allows deleting payment rows | Pre-existing. Procedure: never delete; Waive with a note. |

**Preview and publish plan** (each step needs its own approval):
1. Read-only watch (0031, S1, journals, scheduled jobs, rentals with a subscription = 0).
2. Fast-forward Preview `integration/grok-baseline-2026-10-22` from `5e492a87` to `4268c667`. One push, no force. Confirm Lovable `latest_commit_sha`, then run the read-only watch again.
3. Owner look-only check on Preview: Charge Card dialog opens. Do not charge.
4. Publish once. The switch is watched through `x-deployment-id`. Owner confirms the live `data-commit-sha` = `4268c667…`.
5. Rollback: fast-forward Preview to **`rollback/billing-to-pr2` = `9271787f`** (tree identical to `5e492a87`) and republish. No SQL involved.

## Preview updated to PR #284 (Owner-approved, 2026-10-27)

**Pre-checks (all passed):**
- `5e492a87` → `4268c667` is a fast-forward; exactly the 7 reviewed files differ.
- `payment-collection.server.ts`, `webhook.ts`, `payments.functions.ts` and `stripe(.server).ts` are byte-identical. In `rental-payments.functions.ts` only the import and the start/stop functions change; `chargeCardOnRental` is untouched.
- The only flag difference is the new `RENTAL_AUTOPAY_START_ENABLED = false`. No SQL, migration, insurance or activation files.
- Every `subscriptions.create` site is unreachable:
  - `rental-payments.functions.ts` start returns at line 214;
  - the coordination path sits after line 214, and its flag is false;
  - `stripe-operations.server.ts` is imported nowhere.
- End Rental guard at `rentals.functions.ts:661`.
- `billing-launch-safety` 19/19.
- Rollback refs intact, including `rollback/billing-to-pr2` = `9271787f` and `rollback/pr2-to-a2` = `8ea838c2`.

**Push:** one fast-forward, no force: `5e492a87..4268c667` on `integration/grok-baseline-2026-10-22`.

**Lovable:**
- `latest_commit_sha` = `4268c667`, `last_edited_at` 06:01:59Z, status ready.
- `read_file` at `4268c667` returns the new `rental-autopay-flag.ts` (hard `false`).
- A new home-page screenshot was rendered from the new build.

**Production, read-only, before 06:01:44Z and after 06:07:26Z: identical.**

| Item | Value |
|---|---|
| Security 0031 | `d3387761…` |
| S1 | Intact |
| Insurance authority | Setter md5 `603cc13a…`; trigger; 1 evidence row |
| Activation setting | Installed; exception OFF |
| Policies | 173 |
| Journals | 23 / 105 |
| Scheduled jobs | Unchanged |
| Rentals | 0 (0 with a subscription or autopay) |
| Payments | 0 |
| Applications | 160 (no updates) |
| Audit log | 949 (no new rows) |
| Live | Still `4ad9e141` (PR 2); 0 non-200 since the push |

**Hosted page loads (Drivers, Payments, rental pages): UNVERIFIED.** The Preview host is unreachable from the agent (proxy 403). The build and full test suite pass for `4268c667`. Owner look-only check: open Drivers → a driver, Payments, and a booking; open the Charge Card dialog and close it **without charging**.

**Publish is frozen** until a separate approval. Revert Preview: fast-forward to `9271787f` (tree identical to `5e492a87`).

## PR #284 final release review: GO to publish (pending the Owner's explicit authorization)

**Preview review (hosted pages UNVERIFIED; the agent cannot reach the Preview host).** From source at `4268c667`, the release changes **no rendered screen**:
- `DriversPanel.tsx` changes only one import and the never-rendered `AutopayActions`.
- `PaymentsPanel.tsx`, `BookingActions.tsx`, `ManualPaymentsWorkspace.tsx` and every route are byte-identical to live.
- No screen renders an autopay control, and no UI calls `startRentalAutopay`; a test asserts both.

The Owner's look-only check is still open: Drivers, a driver, a booking, Payments, and the Charge Card dialog opened and closed **without charging**.

**Scope:**
- Exactly the 7 files.
- Charge Card, Stripe client, webhook, payment collection and migrations unchanged.
- 0031, S1, insurance authority and exception OFF verified unchanged at 06:07Z.

**Publish approval wording:**
> I approve publishing Lovable project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6` once at commit `4268c6671447b7749351bafb636ac8a12c7da2c9` (PR #284, billing launch safety). Rollback: fast-forward Preview to `9271787f` (tree identical to the current live `5e492a87`) and republish. No SQL, no Stripe changes.

**Publish procedure:**
1. Read-only watch before publishing.
2. `deploy_project` once, no retry.
3. Watch `x-deployment-id` until the new deployment serves.
4. Read-only watch after.
5. The Owner confirms `data-commit-sha` = `4268c667…`.

**Rollback** (separate approval; app only, no SQL):
1. Fast-forward `integration/grok-baseline-2026-10-22` to `rollback/billing-to-pr2` = `9271787f`.
2. Publish once.
3. The Owner confirms `data-commit-sha` = `9271787f…`. Its tree is identical to `5e492a87`.

## Financial-integrity release (draft PRs, non-production)

Both are based on PR #284 (`fix/billing-launch-safety` @ `4268c667`) and kept separate. Neither modifies PR #284 or Preview.

| PR | Branch @ head | Change | Tests |
|---|---|---|---|
| [#285](https://github.com/REAL-HQ/real-rentals/pull/285) | `fix/charge-status-confirmation` @ `2c2c3014` | Charge Card shows **"Paid: $X collected"** only when Stripe returns `succeeded`. Otherwise a warning: not confirmed, Payments shows it as Processing, don't charge again, check Stripe. A failure says to check Stripe before charging again, never "can be retried". Server and idempotency unchanged. | `charge-status-confirmation` 7/7 (3 of the original 6 fail on `4268c667`). |
| [#286](https://github.com/REAL-HQ/real-rentals/pull/286) | `fix/payment-delete-protection` @ `08d7968f` | Delete → **Void (Entered In Error)**: only unpaid, not-in-flight statuses; confirmation shows the amount removed from what is owed; required reason; amount and balance kept; applied only if the row is still voidable. Webhook failure updates skip void and waived rows. Proposed DB guard package (not installed). | `payment-delete-ui` 6/6; `payments-webhook-events` 11/11 (2 new, fail without the fix); `payments-delete-guard.db` 17/17 on a disposable Postgres. |

**Combined branch:** `release/financial-integrity` @ `a90d8d94` = `4268c667` + #285 + #286. The only conflict was the `package.json` test line; it now runs both new tests.

**Independent review (read-only subagent), outcome:**

| # | Finding | Outcome |
|---|---|---|
| 1 | A late `payment_failed` / `invoice.payment_failed` moved a void (or waived) row back to failed, so it was owed and collectable again | **Fixed in #286** (+2 behavioural tests) |
| 2 | Void had no server-side precondition; a stale list could void a row Stripe had since collected | **Fixed in #286** (conditional update, reports 0 rows) |
| 3 | Waive, Mark as Paid and the status selector change status with no reason or eligibility (existing controls) | **Open**, not changed (outside this scope) |
| 4 | Void reason lives in `notes`, not the immutable `audit_log` | **Open**; needs a `void_payment` RPC (SQL) |
| 5 | An ambiguous Stripe error is stored as `failed`; a driver's Pay Now could start a new attempt before the webhook settles the first | **Open**; mitigated by the procedure; needs its own change to `payment-collection.server.ts` |
| 6 | `collectRows` guards only `paid` between selecting rows and charging them (race with a simultaneous void) | **Open**; narrow window |
| 7 | Voiding the last open row lets a driver be deleted (as Delete did before) | Note |
| 8–9 | Trigger is a deny-list; TRUNCATE; verify-after is catalog-only; v1 cannot be reinstalled after rollback | Documented; informational TRUNCATE row added to the preflight (request bytes unchanged) |
| 10 | Toast said "Pending" while Payments labels it "Processing"; `processing` case untested | **Fixed in #285** |

**Delete-guard SQL package** (`proposed/payments-delete-guard/`, not installed, separate approval):
- Install request sha256 `f200164664f9da85c23ca6ceb16498e97276a1da66706c357aa3fdc5c865057c`.
- Rollback request sha256 `9759df5d56cdb8d405b4d09ed881444322386c569ec3cd8f069f61bd81907929`.
- Preflight 13 rows, verify-after 6 rows.

## Minimum release sequence (each step needs its own explicit approval)

1. **PR #284** (billing launch safety): publish `4268c667` once. Wording above. Owner confirms `data-commit-sha`.
2. **Financial-integrity app release** (#285 + #286 = `release/financial-integrity`):
   1. Owner merges the two PRs after review.
   2. Preview fast-forward to the combined head; look-only check of Payments (Void menu) and the Charge Card dialog without charging.
   3. Publish once. Rollback: fast-forward Preview to `rollback/financial-integrity-to-billing` = `85eea646` (tree identical to `4268c667`; parent `a90d8d94`) and republish. If the merged head differs from `a90d8d94`, regenerate it on the new head the same way.
   - No SQL, no Stripe changes.
3. **DB delete guard** (separate SQL approval, only after step 2 is live):
   1. Preflight read-only, all ok.
   2. Submit `request-payments-delete-guard.sql` once.
   3. Verify-after read-only, all ok.
   - Rollback is its own request.
   - The app does not depend on it, so it can wait.

Weekly autopay stays OFF throughout. The insurance exception stays OFF.

## First-rental gate (all must be true)

| # | Condition | Status |
|---|---|---|
| G-1 | Billing-safety release live (PR #284) | Pending publish approval |
| G-2 | Accurate payment-status messaging live (#285) | Pending step 2 |
| G-3 | Financial-record deletion protection live: app Void (#286); DB guard installed or explicitly deferred by the Owner | Pending steps 2–3 |
| G-4 | Stripe live configuration verified by the Owner (C1–C6: live keys in Lovable secrets, webhook URL `https://drivereal.com/api/public/payments/webhook?env=live`, the six events, signing secret) | Pending Owner |
| G-5 | Manual weekly billing procedure accepted by the Owner (`MANUAL-WEEKLY-BILLING-PROCEDURE.md`) | Pending Owner |
| G-6 | Controlled first-rental acceptance checklist: one real driver; first `insurance.verified` and first `rental.activated` observed read-only; first Charge Card read against Stripe before any second press | Pending; at the first rental |

## Financial controls final review (2026-10-27)

`release/financial-integrity` stays at `a90d8d94` (tested baseline, unchanged).

**Controls on `a90d8d94`, as reviewed:**

| Control | Who | Behaviour on `a90d8d94` | Risk |
|---|---|---|---|
| Status dropdown | Manager+ | Any row to any status, one click, no confirmation, reason or audit. `paid → current/failed` clears `paid_date`. | **Blocker.** A misclick un-pays a Stripe-collected charge. It drops out of revenue (`net_collected` counts only paid/refunded) and becomes chargeable again (Pay Now / Charge Card), so the driver can be charged twice. It can also set `refunded` with no money moving, or `waived`. |
| Mark as Paid | Manager+ | Any row, including void, refunded, Processing. One click; no method, reason or audit; `balance_due` not zeroed. | **Blocker.** Records revenue with no money received. Marking a Processing row paid hides a charge Stripe may still fail. |
| Waive | Manager+ | Any row, including paid. One click; no confirmation, reason or audit. | **Blocker.** Silently forgives a legitimate debt, or removes collected revenue from a paid row. |
| Add Payment | Manager+ | Status choice includes paid, refunded, waived. | Same false-revenue risk as Mark as Paid. |
| Void (Entered In Error) | Manager+ | Open rows only; confirmation shows the amount; reason in notes; conditional on the status at the time. | Acceptable. The reason is in `notes` only, not the audit log. |
| Refund | — | Not in the app. Stripe Dashboard → webhook → `apply_payment_refund`. | Correct. |

**Smallest correction:** `fix/payment-status-controls` @ `63ed49ca` (separate review branch on `a90d8d94`; app only, no SQL).
- All four status actions go through one server function, `changePaymentStatus`:
  - authorises the action on the server;
  - requires a reason;
  - applies only if the row still has the status the screen showed;
  - writes actor, before/after, reason and method to the immutable `audit_log`, and undoes the change if the audit insert fails.
- Rules (`src/lib/payment-status-rules.ts`):

| Action | Who | From |
|---|---|---|
| Change Status | Manager+ | Open → open only |
| Void (Entered In Error) | Manager+ | Open |
| Waive (Forgive Debt) | **Owner** | Open |
| Mark as Paid (Received Outside Stripe) | Manager+, with the method | Open |
| Mark as Paid (Received Outside Stripe) | **Owner** | Processing, after checking Stripe |
| Refund | Stripe Dashboard only | — |

  - Paid, refunded, waived and void rows never change in the app.
  - Add Payment creates only owed charges.
- The webhook protections (never un-pay; failures skip void and waived) are unchanged.
- Tests:
  - `payment-status-controls` 11/11: the real server function against a fake DB, covering roles, settled rows, stale screen, audit-failure undo and reason required.
  - `payment-delete-ui` 6/6.
  - Full check: tsc, build and the full `npm test` pass.

**Remaining limit (needs SQL, separate approval):** RLS "Managers manage payments" (ALL) still lets a Manager change a row's status directly through the API with their own session. The app controls stop accidental and casual changes; only an RLS or trigger change stops a deliberate one.

## Delete guard: bypass analysis (repo and local baseline only; no production SQL)

| Path | Bypasses the guard? |
|---|---|
| Manager / driver / anon via PostgREST or supabase-js DELETE | No: refused (`payments_are_financial_history_void_instead`) |
| Server code (`service_role`) DELETE | No: refused |
| TRUNCATE | No practical path. PostgREST and supabase-js cannot issue TRUNCATE. `anon`, `authenticated` and `service_role` are NOLOGIN. TRUNCATE of `payments` also fails without CASCADE because `toll_charges` (and two other tables) reference it. No migration revokes TRUNCATE on `payments`, so production grants are unknown; the preflight's informational row reports them at install time. |
| Parent deletes (`ON DELETE SET NULL`) | No: an UPDATE, rows kept |
| Disabling or dropping the trigger, `session_replication_role` | Needs the table owner or a superuser |
| The database owner (`postgres`): approved SQL, Lovable `query_database`, the Supabase dashboard table editor / SQL editor | **Yes, by design.** Anyone with project SQL or dashboard access can still delete. Keep that access to the Owner. |
| UPDATE instead of DELETE (status → void/waived, amount → 0) by a Manager via the API | Not a delete. Covered in the app by `fix/payment-status-controls`; at the database level it needs the RLS change above. |

## Release 2 final (Owner-approved for inclusion; non-production)

| Item | Value |
|---|---|
| PRs | [#285](https://github.com/REAL-HQ/real-rentals/pull/285) `2c2c3014`, [#286](https://github.com/REAL-HQ/real-rentals/pull/286) `08d7968f`, [#287](https://github.com/REAL-HQ/real-rentals/pull/287) `63ed49ca` (base `release/financial-integrity` @ `a90d8d94`) |
| Release 2 commit | `release/financial-integrity-2` @ **`78bb94af`** = `a90d8d94` + #287 (no conflicts). The tree equals `63ed49ca`. |
| Rollback | `rollback/release2-to-billing` @ `f8380725`: tree identical to `4268c667` (PR #284), parent `78bb94af` |
| Scope | 25 files. No migrations, RLS, insurance code or Supabase config. The webhook change only narrows failure updates. `proposed/payments-delete-guard/` is not executed by the app. |
| Tests on `78bb94af` | tsc, build and the full `npm test` pass (including `charge-status-confirmation` 7/7, `payment-delete-ui` 6/6, `payment-status-controls` 11/11, `payments-webhook-events` 11/11, `agreement-evidence` 11/11). `payments-delete-guard.db` 17/17. `build.py --check` reproduces every file byte for byte. |
| DB delete guard | Separate package, unchanged. Install `f2001646…057c`, rollback `9759df5d…7929`. |

**Release 2 publish procedure (separate approval, after PR #284 is live):**
1. Owner merges #285, #286 and #287.
2. Fast-forward Preview to `78bb94af`.
3. Owner does the look-only check.
4. Publish once.
5. Owner confirms `data-commit-sha`.

**Gap that does not block the first rental:** if Stripe actually collects a void or waived row, the webhook records it as Paid (Stripe is the evidence) but sends no staff alert. This needs a void to land in the milliseconds between a balance payment selecting its charges and charging them; a Processing charge can't be voided or waived. Follow-up: guard `collectRows` against void and waived rows, and alert staff, on a separate branch.

## Release 1 (PR #284) final publication preflight (2026-10-27 ~14:21Z)

| Check | Result |
|---|---|
| Candidate | `fix/billing-launch-safety` = `4268c6671447b7749351bafb636ac8a12c7da2c9` (unchanged) |
| Preview branch | `integration/grok-baseline-2026-10-22` = `4268c667` |
| Lovable sync | `get_project`: `latest_commit_sha` = `4268c667`, `agentFinished` true, last edited 06:01:59Z |
| Scope vs live `5e492a87` | Exactly the 7 reviewed files |
| Charge Card and Stripe code | `chargeCardOnRental`, `ChargeCardDialog`, `payment-collection.server.ts`, `stripe.server.ts`, the payments webhook, `supabase/` and `drizzle/` are all unchanged. The `rental-payments.functions.ts` hunks are in `startRentalAutopay`/`stopRentalAutopay` only. |
| Autopay | `RENTAL_AUTOPAY_START_ENABLED = false`. `AutopayActions` is not rendered anywhere. |
| Rollback | `rollback/billing-to-pr2` = `9271787f`, a fast-forward of `4268c667`, tree identical to live `5e492a87` |
| Production (read-only, aggregates) | Live deployment `4ad9e141` (77 responses, 0 HTTP errors in 6 h). Policies 173; 0031 `d3387761…` (5); S1 trigger 1; journals 23/105; cron md5s 2 `478d975e`, 3 `7a659464`, 4 `454777d5`, 5 `269d0f4c`, 6 `cf4fedd9` (all active); insurance exception `false`; IVA setter `603cc13a`; AIS/IVA evidence 1/1; late fees off; delete guard absent; 0 rentals, 0 payments, 0 subscription/autopay rentals; 166 applications; audit log 980; staff admin 1, team 2. |
| pg_net | 8 client timeouts (5 s), no HTTP errors. Already known and on the watch; not release-related. |
| Hosted visual checks (Drivers, Payments, Bookings, Charge Card) | **UNVERIFIED.** Preview and drivereal.com are unreachable from the agent. From source, Payments, Bookings and Charge Card are byte-identical to live; Drivers differs only in the unrendered `AutopayActions`. |

**Result: GO for Release 1 publication, pending the Owner's look-only Preview check and explicit authorization.**

## Release 2: issues the manual procedure cannot adequately mitigate

1. **Driver Pay Now during an unconfirmed charge.**
   - The portal shows Pay Now whenever pending, failed or past_due rows exist.
   - `payRentalBalance` collects every outstanding row, including `pending`, with a new attempt key.
   - So if the Owner's Charge Card is still processing, or timed out (recorded as `failed`) but succeeded in Stripe, the driver can be charged twice.
   - The procedure binds staff, not drivers.
   - **Smallest fix** (separate branch, about 3 files, no SQL):
     - Pay Now and the portal balance skip `pending` rows.
     - A non-decline Stripe error leaves the row `pending` ("unconfirmed") until the webhook settles it.
     - An Owner-only "No Charge in Stripe" action releases a pending row back to `failed` after checking Stripe.
   - Interim mitigation for the first controlled rental: tell the driver not to use Pay Now; the Owner charges and checks Stripe.
2. **Direct database status changes by a Manager.**
   - RLS "Managers manage payments" (ALL) lets the Owner or either Manager change status, amount or balance through the API with their own session. That bypasses Release 2's server checks and audit.
   - Drivers and partners have read-only access.
   - The procedure can only detect this (a weekly reconciliation of Stripe against Payments), not prevent it.
   - **Smallest fix** (separate SQL package and approval, built like the delete guard): a BEFORE UPDATE trigger refusing changes to `status`, `amount`, `balance_due`, `paid_date` and `refunded_amount` from `authenticated`. Staff changes would then go only through `changePaymentStatus` (service role, audited); the webhook and collection are unaffected.
3. **No alert on a Stripe success for a void or waived row** (a millisecond race). Low likelihood; fix it with item 1's branch.

## Payment safety corrections (non-production; separate branches, independently reviewed twice)

`release/financial-integrity-2` stays at `78bb94af`. Nothing below is merged into it, Preview or production.

### Confirmed duplicate-charge and billing-blocking paths

| # | Path | Evidence |
|---|---|---|
| D7 | **Charge Card, autopay start/stop and Remove Card refuse the Owner ("Forbidden").** They call `rpc('has_role')`. Migration `20260713042639` dropped `public.has_role` (it is `private.has_role` now, which PostgREST does not expose). | The production-order baseline has no `public.has_role`; a local PostgREST returns PGRST202. If production matches its migrations, **manual weekly billing cannot run**, with or without Release 1. Production is unverified: that needs a read-only catalog query, which needs approval. |
| P1 | Concurrent Pay Now presses on the same charge | Old code, real Postgres + PostgREST: 10 concurrent presses → **2 real charges** (3/3 runs). |
| P2 | A timeout or ambiguous Stripe error is recorded as `failed`, so Pay Now or Charge Card retries with a new idempotency key | Old code: the timed-out row became Failed and a second attempt was allowed |
| P3 | Pay Now during an Owner charge that is still processing | `payRentalBalance` collected `pending` rows |
| P4 | A late or duplicate `payment_failed` for an earlier attempt marks a newer in-flight attempt failed | No attempt match in the webhook |
| P5 | The late-fee cron reopens an unconfirmed (`pending`) charge as `overdue` (only when late fees are on) | Code |
| P6 | Charge Card always creates a new row: retrying a declined week's rent creates a second debt that Pay Now also collects | Code (UI never passes `paymentId`) |
| P7 | `invoice.payment_failed` fails a row Pay Now claimed, and rewrites `attempt_count` (idempotency key reuse) | Code; autopay is off, so there are no invoices today |
| P8 | Pay Now and Charge Card could collect a row Stripe is retrying as an invoice | Code; autopay is off |

### Corrections

**1. `fix/charge-card-role-check` @ `a23f73eb` (D7).**
- Charge Card, autopay start/stop and Remove Card now check the Owner server-side (`requireOwner` reading `user_roles`), as the other money functions do.
- The authority is unchanged: Owner only.

**2. `fix/pay-now-duplicate-protection` @ `c64bc2c6` (on top of 1; P1–P8).**
- **Atomic claim.** One conditional update moves a charge to `pending` only if it is owed, not in flight, and its `attempt_count` is below the new attempt. The attempt then backs out if any other row on the rental is pending. So at most one attempt per rental reaches Stripe, whatever the concurrency.
- **Unconfirmed outcomes stay Processing.** Only a Stripe `card_error` with HTTP 402 counts as definitely not charged. Everything else stays `pending`: timeouts, 5xx, 409, and gateway or retry 4xx.
- **Webhook ordering.**
  - A `payment_failed` only applies to the attempt it belongs to (`metadata.attempt`).
  - Invoice failures skip claimed rows and never write `attempt_count`.
  - Post-call updates only touch rows still on this attempt, so a fast webhook wins.
- **Portal and Pay Now.**
  - One shared balance computation (`rentalBalance`).
  - Pay Now is hidden and refused while anything is Processing; the portal says a payment is being confirmed.
  - Rows tied to a Stripe invoice are left to Stripe.
- **Charge Card.**
  - Refuses while a charge on the rental is Processing.
  - Refuses a second charge for this week's rent, matched by rental or by driver; an older unpaid week does not block.
  - Payments gets an Owner **Charge Card for This Charge** action that retries the existing row.
  - A request that loses a race voids its own new row, and the void is audited.
- **Owner recovery: Check Stripe and Release (Not Collected).**
  - Owner only, reason required, at least 10 minutes after the attempt.
  - The server lists every PaymentIntent in each configured Stripe account (live and sandbox) within an hour either side of the attempt, whatever the customer.
  - It refuses if any intent for the charge succeeded or is still open, or if Stripe can't be reached.
  - The audit row is written before the release.
- **Other fixes.**
  - Toll rebill creates owed (`current`) rows, not `pending`.
  - The late-fee cron skips `pending` and updates conditionally.
  - Combined-charge idempotency keys hash the sorted ids; the joined ids passed Stripe's 255-character limit at 7+ rows.

**3. `fix/payments-write-guard-sql` @ `ed2ed072`: proposed SQL, not installed.**
- **What it refuses.** A BEFORE INSERT OR UPDATE row trigger refuses direct changes from `authenticated` and `anon` sessions. It is an allowlist: only `notes`, and `payment_method` while the row is still owed, may change. New charges must start owed.
- **What it leaves alone.** `service_role` (audited server paths, webhook, crons), `apply_payment_refund`, FK actions and the database owner.
- **Requests.** Install request `91ad1504a9fdd1511f0ba0c19bdee42ed94ae8afc389c110a9f859a53f13438d`. Rollback `2ab7d318f947d1cff6b0ba1f2d1f49b2acd442f21985d4644460223dc896a015`. Preflight 13 rows, verify-after 6 rows.

### Test results

| Test | Result |
|---|---|
| `pay-now-concurrency.db` (real Postgres 17 + PostgREST 12.2.3, fake Stripe with idempotency and 409 semantics) | **12/12**: 10 concurrent presses → 1 charge; Pay Now racing Owner Charge Cards over 10 rounds; timeout-after-charge with a delayed and duplicated webhook; a never-reached request released by the Owner and retried once; release refusals (collected, open, Stripe unreachable, a customer change); audit-first; a stale failure webhook during a newer attempt; a fast webhook; decline then one retry; a legacy pending row; late-fee cron; portal = Pay Now through the driver's RLS session |
| `charge-status-confirmation` | 14/14 |
| `payment-delete-ui` | 6/6 |
| `payment-status-controls` | 11/11 |
| `billing-launch-safety` | 19/19 |
| `payments-webhook-events` | 11/11 |
| `payments-webhook-invariants` | Pass |
| `payments-write-guard.db` | **17/17**: Manager and Owner (20 refused changes), a column added later, Add Payment allowed and 9 bad inserts refused, Coordinator, driver, anon, `service_role`, refunds, parent deletes, both install orders with the delete guard, rollback |
| Full check (tsc, build, full `npm test`, incl. applicant-security) | Pass on `a23f73eb`, `c64bc2c6` and `ed2ed072` |

**Harness limit:** the local PostgREST 12.2.3 re-applies a mutation's `or=` filter to the returned rows. The concurrency test requests `select=*` on those PATCHes, a documented test-only shim. Production's PostgREST 14.5 behaviour for the webhook's `.or()` + `select('id')` queries is unverified.

### Recommended integration

- **Release 2 candidate = `c64bc2c6`.** It is linear on `78bb94af`: + role check + Pay Now protection.
  - Open it as PRs (role check, Pay Now) after your review.
  - Rebuild Release 2 from `78bb94af` plus both, with no conflicts, and re-run the full regression on the final commit.
- **The role check is required before the first rental**, if production matches its migrations: without it, Charge Card can't be used.
- **DB guards** come only after Release 2 is live, in this order: delete guard (unchanged), then write guard. Each has its own approval.

### Production approvals still needed

1. Read-only check: is `public.has_role(uuid, app_role)` absent, and how many payments are `pending`? Confirms D7 and the pre-deploy state.
2. Release 1 (PR #284) publication, after the look-only Preview check.
3. Release 2 publication (rebuilt candidate).
4. Payments DELETE guard SQL.
5. Payments write guard SQL (after Release 2 is live).
6. Owner: Stripe live configuration C1–C6, the manual weekly billing procedure, and the first-rental checklist.

**Not in scope, noted by review:**
- `scripts/agreement-template-library.proposed.sql` and `scripts/driver-issues/staff-note.proposed.sql` still reference `public.has_role`.
- These RPCs are called by the app but are in neither the migrations nor the baseline; they need read-only confirmation in production: `close_recorded_rental_v2`, `list_assignment_history_v1`, `resolve_application_identity_review`, `link_replacement_agreement_checked`.

## Production diagnosis (read-only, Owner-approved, 2026-10-27)

One `SET TRANSACTION READ ONLY` query; names, existence and counts only.

| Check | Result |
|---|---|
| Target | System identifier `7642734024280108049`, read-only on |
| `public.has_role` | **Absent.** Only `private.has_role(uuid, app_role)` (SECURITY DEFINER) exists. **D7 confirmed:** Owner Charge Card, autopay start/stop and Remove Card answer "Forbidden" in production today. |
| `close_recorded_rental_v2`, `list_assignment_history_v1`, `resolve_application_identity_review`, `link_replacement_agreement_checked` | All **absent**. Not first-rental blockers: closeout v2 is gated by `RECORD_RENTAL_CONTRACT_ENABLED=false`; vehicle history returns an empty list when the function is missing; the replacement agreement is gated by `SWAP_ENABLED=false`; identity review uses the RPC only when env `APPLICATION_RESUME_ATOMIC_ENABLED=true`, otherwise the existing server path (env value not visible from SQL). |
| `apply_payment_refund` | Present; SECURITY DEFINER; `service_role` only |
| Payments | 0 total; 0 Processing; 0 Processing that never had an attempt |
| Columns the fixes use | All present |
| Payments RLS | On. "Managers manage payments" (ALL, `private.is_manager()`), "Drivers can view their own payments" (SELECT), "Partners can view their payments" (SELECT). Matches the app's assumptions. |
| Role helpers | `private.has_role`, `is_manager`, `is_owner`, `is_staff` all present |
| `user_roles` | admin 1, team 2, driver 4 |
| `audit_log` insert | `service_role` yes; `authenticated` no (audits must be written server-side, as the fixes do) |
| Triggers on `payments` | `payments_updated_at` only; neither guard installed |
| Grants on `payments` | **`anon`, `authenticated` and `service_role` all hold SELECT/INSERT/UPDATE/DELETE/TRUNCATE.** The local baseline differs. With RLS, anon matches no rows, and TRUNCATE is not reachable through PostgREST, so this is not exploitable through the app. Revoking TRUNCATE (and anon's write grants) is a separate grant change needing its own approval. |

## Release 2 rebuild (non-production)

| Item | Value |
|---|---|
| Draft PRs | [#288](https://github.com/REAL-HQ/real-rentals/pull/288) `fix/charge-card-role-check` @ `a23f73eb` (base `release/financial-integrity-2`); [#289](https://github.com/REAL-HQ/real-rentals/pull/289) `fix/pay-now-duplicate-protection` @ `c64bc2c6` (stacked on #288) |
| **Release 2 candidate** | `release/financial-integrity-3` @ **`4fdf5a78`** = `78bb94af` + #288 + #289 (merge commits, no conflicts; tree = `c64bc2c6`; no migrations). `release/financial-integrity-2` is unchanged at `78bb94af`. |
| Rollback | `rollback/release2b-to-billing` @ `71eea6a7`: tree identical to Release 1 `4268c667`, parent `4fdf5a78` |

**Results on `4fdf5a78`:**

| Suite | Result |
|---|---|
| Full check (tsc, build, full `npm test` incl. `applicant-security`, `agreement-evidence` 11/11) | Pass |
| `pay-now-concurrency.db` | 12/12 |
| Guard compatibility (one-off, not committed): the concurrency suite with both proposed guards installed, plus manual-payment checks through PostgREST | 13/13 |
| `payments-delete-guard.db` | 17/17 |
| `payments-write-guard.db` (`ed2ed072`) | 17/17 |
| `payments-webhook-invariants` | Pass |
| `payments-webhook-events` | 11/11 |
| `billing-launch-safety` | 19/19 |
| `charge-status-confirmation` | 14/14 |
| `payment-status-controls` | 11/11 |
| `payment-delete-ui` | 6/6 |

The guard-compatibility checks through PostgREST were:
- A Manager's direct status change is refused by the write guard, and a direct delete by the delete guard.
- Add Payment (an owed charge) works.
- Mark as Paid (cash, with a reference) and Void through the audited server function work and are audited.

All Pay Now and Charge Card scenarios still pass with both guards installed.

**Legitimate manual payments remain possible:**
- Charge Card (new charge and retry on the same row);
- Pay Now;
- Mark as Paid (received outside Stripe), Void and Waive through the audited path;
- Add Payment.

**Refused:**
- a second attempt while one is Processing;
- an ambiguous outcome being retried;
- a second rent charge for the same week;
- a stale or duplicate failure webhook against a newer attempt.

## Database guard installation order and rollback dependencies

1. **Release 2 (`4fdf5a78`) live and Owner-confirmed first.** The write guard makes Release 1's direct Payments edits fail closed (an error, no change).
2. **Delete guard:** preflight (expects only `payments_updated_at`, as production has now) → request `f2001646…057c` → verify-after.
3. **Write guard:** preflight (accepts the delete guard present) → request `91ad1504…438d` → verify-after, right after install.

**Rollback:**
- **Independent.** Each guard's rollback removes only its own trigger and function and keeps the evidence rows. Both orders are tested.
- **App rollback.** To roll the app back from Release 2 to Release 1, roll back the write guard first; otherwise Release 1's Mark as Paid, Waive and status menu fail closed. The delete guard does not depend on the app version.
- **Reinstall.** Neither v1 can be reinstalled after its rollback without a v2.

## Remaining first-rental blockers (updated)

1. **D7: Charge Card is unusable in production.**
   - Release 1 does not fix it. Release 2 (`4fdf5a78`) does.
   - The manual weekly billing model cannot start until Release 2 is live.
2. Release 1 publication, then Release 2 publication (each a separate approval).
3. Owner: Stripe live configuration C1–C6, acceptance of the updated manual billing procedure, and the look-only Preview checks (unverified from the agent).
4. **Unverified:** production PostgREST 14.5's handling of the webhook's `.or()` + `select('id')` updates (the local 12.2.3 differs).
   - If it fails, the webhook answers 400 and Stripe retries.
   - Rows stay Processing, so this fails closed with no duplicate charge.
   - Watch the first live charge's webhook delivery in the Stripe Dashboard.
5. The DB guards are recommended but not blockers: install them, or have the Owner explicitly defer them (gate G-3).

## Direct Release 2 deployment review (non-production; Owner prefers Release 2 directly instead of Release 1 first)

**Candidate:** `release/financial-integrity-3` @ **`4fdf5a78b017aabf3b27815f4b584264387133a3`**.

**Compared with live `5e492a87`:**
- It contains every reviewed commit:
  - live `5e492a87`;
  - PR #284 `4268c667`;
  - #285 `2c2c3014`, #286 `08d7968f`, #287 `63ed49ca`;
  - #288 `a23f73eb`, #289 `c64bc2c6`;
  - and the tested Release 2 `78bb94af`.
- **37 files changed, all attributed to those PRs; no unreviewed change.** That is 25 app and test files, plus 12 `proposed/payments-delete-guard` files the app never executes.
- The only merge-resolved change is the `package.json` test line.
- No dependency changes, no migrations.

**Release 1 protections still present** (`billing-launch-safety` 19/19 on the candidate):
- Autopay start is off before any Stripe call.
- Stop reports failures.
- End Rental refuses while a subscription exists.
- The Stripe Dashboard is named as the place to stop autopay.

**Weekly autopay creation paths, all unreachable:**
1. `startRentalAutopay` returns `AUTOPAY_START_OFF_MESSAGE` before anything else (`RENTAL_AUTOPAY_START_ENABLED=false`).
2. `coordinateRentalSubscription` is only reachable behind `RENTAL_SUBSCRIPTION_COORDINATION_ENABLED=false`, after the same check.
3. `createReservedSubscription` (`stripe-operations.server.ts`) has no callers.

`AutopayActions` is rendered nowhere.

**Manual payments without `public.has_role`:**
- No `rpc('has_role')` remains in `src`.
- Charge Card, Charge Card for This Charge, Pay Now and Owner release all reached collection in the concurrency test, against the production-order baseline that has no `public.has_role` (as production doesn't).
- Mark as Paid and Void through the audited server path pass with both guards installed.

**Direct rollback:** `rollback/release2-direct-to-pr2` @ **`d42fee60bf69732c88471bd7570e03aac1c1b32c`**.
- Tree identical to live `5e492a87`, parent `4fdf5a78`: a fast-forward, so no force-push.
- It is a new ref; existing rollback refs are unchanged.
- **Tested:** full check pass; insurance / 0031 / S1 / M2 compatibility 61/61.
- **Compatible with the installed activation-setting and insurance-authority SQL:** it is exactly the application running with them today.
- Rolling back brings D7 back (Charge Card refused). If the payments write guard is ever installed, roll it back before rolling the app back.

**Test results on `4fdf5a78`:**

| Suite | Result |
|---|---|
| Full check (tsc, build, full `npm test`) | Pass |
| `pay-now-concurrency.db` | 12/12 |
| Guard compatibility | 13/13 |
| Webhook invariants | Pass |
| Webhook events | 11/11 |
| Charge Card | 14/14 |
| Billing safety | 19/19 |
| Payment status controls | 11/11 |
| Void UI | 6/6 |
| Delete guard | 17/17 |
| Write guard | 17/17 |
| **Insurance setting + authority + Security 0031 + S1 + M2 compatibility** (`activation-insurance-setting.db`) | **61/61** (all four orders C1–C4, rollbacks, PostgREST role checks) |

**Preview plan (not moved):**
- Fast-forward `integration/grok-baseline-2026-10-22` from `4268c667` to `4fdf5a78`: 16 commits, `git push origin 4fdf5a78…:refs/heads/integration/grok-baseline-2026-10-22`, no force.
- Then confirm the Lovable sync (`latest_commit_sha` = `4fdf5a78`, about 5 minutes).
- **Revert Preview:** fast-forward to `rollback/release2-direct-to-pr2` (`d42fee60`, the live tree).

**Owner look-only checks on Preview** (no charging, no changes):
1. **Drivers:** the list loads. Open a driver. On a driver with a card on file, open **Charge Card** and close it **without charging**.
2. **Bookings:** open a booking; it loads.
3. **Payments:**
   - the page loads (empty);
   - no Delete action;
   - **Add Payment** offers only owed statuses, shown as raw names: upcoming, current, overdue, past due, late, failed, unpaid, collections. No paid, refunded, waived or pending. Then **Cancel**.
4. **Pay Now:** shown only for a driver with an active rental; production has none, so it is not visible. Covered by tests; unverified on screen.

## Preview updated to direct Release 2 (Owner-approved, 2026-10-27 17:19Z)

**Pre-update checks** (all passed; otherwise it would have stopped):
- **Heads unchanged:** Preview was `4268c667`, the candidate `4fdf5a78`, the rollback ref `d42fee60`.
- **Clean fast-forward:** 16 commits.
- **Attribution:** 37 files, 0 unattributed to #284–#289.
- **Autopay:** start flag false; coordination flag false; `createReservedSubscription` has no callers; `AutopayActions` is rendered nowhere.
- **`has_role`:** 0 `.rpc('has_role')` calls; the one match is a comment.
- **Compatibility:** 0031, S1 and insurance 61/61 on this exact commit.

**Update:**
- `git push origin 4fdf5a78…:refs/heads/integration/grok-baseline-2026-10-22` → `4268c667..4fdf5a78` (fast-forward, no force).
- **Preview HEAD = `4fdf5a78b017aabf3b27815f4b584264387133a3`.**

**Lovable:**
- `get_project`: `latest_commit_sha` = `4fdf5a78…`, last edited 17:19:56Z, status ready, `agentFinished` true.
- `read_file` of `src/lib/rental-autopay-flag.ts` at that commit shows `RENTAL_AUTOPAY_START_ENABLED = false`.

**No publication:**
- `net._http_response` shows live still serving deployment `psr2.4ad9e141` (PR 2) at 17:15 and 17:20, all 200.
- The one 17:25 row is the known 5 s pg_net client timeout.

**Production read-only snapshot, before (17:19:35Z) and after (17:25:14Z): identical.**
- Policies 173; 0031 `d3387761…` (5); S1 trigger 1; journals 23 / 105.
- Cron md5s 2 `478d975e`, 3 `7a659464`, 4 `454777d5`, 5 `269d0f4c`, 6 `cf4fedd9` (all active).
- Insurance exception `false`; IVA setter `603cc13a`; insurance guard trigger 1; AIS/IVA evidence 1/1; late fees off.
- Payment guards absent (triggers `payments_updated_at`); `public.has_role` absent.
- Counts: applications 166, rentals 0, payments 0, subscription/autopay 0, agreements 1, documents 96, screenings 5, vehicles 10, audit log 1020, user_roles 7.
- Fingerprints: vehicles `2b0b7a57`, user_roles `1a2d9611`, app_settings `b9aae8d4`.
- No audit rows since the push. Last application/audit change at 16:32Z, before the push.

**Preview visual acceptance: UNVERIFIED.** The Preview host is unreachable from the agent (connection refused through the proxy). Owner look-only checks:
- **Drivers:** the list and a driver's details load.
- **Charge Card:** on a driver with a card on file, open **Charge Card** and close it **without charging**.
- **Bookings:** a booking opens.
- **Payments:**
  - loads empty;
  - no Delete;
  - **Add Payment** offers only upcoming, current, overdue, past due, late, failed, unpaid, collections — then **Cancel**.
- **Autopay:** no autopay-start control anywhere (a driver page may show "Autopay Off · Charge Weekly" only on an active rental; there are none).
- **Pay Now:** not visible (no active rentals).

**Publication:** not authorized. Revert Preview: fast-forward to `rollback/release2-direct-to-pr2` (`d42fee60`, live tree).

## Direct Release 2 published (Owner-approved, 2026-10-28)

**Pre-publish checks (01:28Z), all matching:**
- Preview = `4fdf5a78`.
- Lovable `latest_commit_sha` = `4fdf5a78`; ready; agent finished.
- Scope: 37 files, 0 unattributed.
- Autopay start and coordination flags false.
- 0 `has_role` RPC calls.
- Rollback `d42fee60` tree = live `5e492a87`.
- Production baseline identical to the Preview snapshot; the only non-200s were 5 pg_net timeouts.

**Publish:** `deploy_project` called once at about 01:29Z → status **pending**, **deployment `7f1b6a2b-c04e-47cb-bdb0-8f073ddf9719`**. No retry.

**Switch (from `net._http_response` `x-deployment-id`):**

| Deployment | Last / first seen | Responses |
|---|---|---|
| `psr2.4ad9e141` (PR 2) | Last seen 01:25:00Z | — |
| (none: the known 5 s pg_net timeout) | 01:30:00Z | 1 |
| **`psr2.7f1b6a2b` (Release 2)** | **First seen 01:35:00Z**, 01:40:00Z | 2, all 200 |

The switch took about 6 minutes.

**Post-publish production snapshot (01:40:37Z): identical to before.**
- Policies 173; 0031 `d3387761…` (5); S1 1; journals 23/105.
- Cron md5s 2 `478d975e`, 3 `7a659464`, 4 `454777d5`, 5 `269d0f4c`, 6 `cf4fedd9` (all active).
- Insurance exception false; IVA setter `603cc13a`; insurance guard 1; AIS/IVA evidence 1/1; late fees off.
- Payment guards not installed.
- Counts: applications 166, rentals 0, payments 0, subscription/autopay 0, agreements 1, documents 96, screenings 5, vehicles 10, audit 1020, user_roles 7.
- Fingerprints: vehicles `2b0b7a57`, user_roles `1a2d9611`, app_settings `b9aae8d4`.
- No audit rows since publishing. Last data change 2026-10-27 16:32Z.

**Awaiting the Owner's live check:** `view-source:https://drivereal.com/` (private window, no query string) → expected `data-commit-sha="4fdf5a78b017aabf3b27815f4b584264387133a3"`. If it differs, stop and report; do not republish.

**Rollback** (separate approval): fast-forward Preview to `d42fee60` (live PR 2 tree) and publish once.

## Release 2 COMPLETE (2026-10-30)

The Owner (independently verified) confirms drivereal.com serves `data-commit-sha="4fdf5a78b017aabf3b27815f4b584264387133a3"`. The home page, back office, Drivers and Payments render. **Release 2 publication and live-version verification are complete.** PR #284 (Release 1) is superseded: it is contained in Release 2.

## Payment reconciliation investigation: the empty Payments page (read-only, code + prior aggregates; no new SQL)

**Finding: by design, not a defect.** The Payments page is the app's own charge ledger. Regina's and Damon's weekly Stripe payments were made outside the app and are never written into it.

**How the app's payment data flows** (Release 2, `4fdf5a78`):

| Path | Reads/writes | Effect on external Stripe payments |
|---|---|---|
| Payments page (`PaymentsPanel`) | `supabase.from("payments").select("*")`, local table only, under RLS | Shows only rows that exist in `payments` |
| Rows are created by | Charge Card, Pay Now, Add Payment, toll rebill, the late-fee cron, the webhook | All app-originated |
| Webhook `payment_intent.*` | Updates rows named in `metadata.paymentIds`, or a row already holding the intent id. Inserts a row **only** if `metadata.rentalId` is present. | A payment link, invoice or dashboard charge has no app metadata → only a `console.warn` (`warnUnmatchedPayment`); **no row** |
| Webhook `invoice.*` | Looks up `rentals.stripe_subscription_id`. Without a linked rental → `warnUnmatchedInvoice` (log only). | An external subscription is not linked to any app rental (production has **0 rentals**) → **no row** |
| Overview → **Stripe Collections** (`STRIPE_COLLECTIONS_ENABLED = true`, Manager+) | Reads the **Stripe account itself**, read-only: invoices, charges (with balance transactions) and payouts in a date range | **This is where external Stripe payments are visible in the app** |
| Unmatched Stripe Payments (`STRIPE_UNMATCHED_PAYMENTS_ENABLED = false`) | Read-only list of paid Stripe invoices not linked to an app rental | Dormant |
| Stripe reconciliation (`stripe-reconciliation.functions.ts`: link a subscription to a rental, preview/apply history) | Needs proposed SQL `scripts/stripe-reconciliation/0033_…proposed.sql` (not installed); no screen uses it | Dormant, not installable today |

Prior read-only production aggregates (2026-10-27): payments 0, rentals 0, subscription/autopay rentals 0. With no rental records, no app path could have produced or linked a payment for them.

**Not verified (no Stripe access from the agent; no live key requested):**
- Stripe-side counts, and whether Regina's and Damon's billing is a Stripe subscription, an invoice or a payment link.
- Whether the live webhook endpoint (C1–C6) receives those events. If it does, they are logged as unmatched only: no row.

The Owner can check read-only in the Stripe Dashboard, or Overview → Stripe Collections (live, last 8 weeks).

**First-rental risk:** charging an existing externally billed renter with Charge Card while their external Stripe billing continues **double-bills them**. Before the app bills Regina or Damon, their external Stripe billing must be stopped in Stripe, effective from a week boundary.

**Options for financial accuracy:**
1. **Now, no development:**
   - Stripe stays the system of record for externally billed renters.
   - Use Stripe Collections (or the Stripe Dashboard) for their cash.
   - The app ledger covers app-billed rentals only.
   - App revenue reports (vehicle P&L, partner statements) exclude external payments until migrated.
2. **Per-renter cutover:**
   - Record the rental in the app.
   - Cancel the external Stripe billing at a week boundary (Owner, in Stripe).
   - Then bill weekly with Charge Card.
   - No historical import: history stays in Stripe.
3. **Later:** the proposed 0033 reconciliation (link the subscription and import history) after its own review, tests and SQL approval.

**Compatibility with the proposed payment guards:**
- **Both guards act only on `authenticated` and `anon` sessions.** Every legitimate import or reconciliation path runs as `service_role` (webhook, server functions) or inside SECURITY DEFINER functions owned by the database owner (0033's `stripe_ingest` / `stripe_link`), so it is not blocked.
- **Install order.** 0033 adds its own trigger on `payments`. The delete guard's reviewed preflight expects `payments_updated_at` only, and the write guard's accepts that plus the delete guard. So install the guards **before** 0033, or regenerate their preflights if 0033 goes first.
- **Corrections.** With the delete guard, a wrongly imported row can't be deleted from the app. It needs void/refund semantics or approved SQL.
- **Write guard and 0033 columns.** The write guard's allowlist also freezes 0033's new `payments` columns for user sessions, as intended.

## Payment guards: installation packets prepared (2026-10-30; nothing installed)

See [`PAYMENT-GUARDS-INSTALL-PACKET.md`](PAYMENT-GUARDS-INSTALL-PACKET.md): Packet 1 (payments DELETE guard) first, Packet 2 (write guard) second, each under its own approval. No SQL was run, nothing was published, and Stripe and customer data were not touched.
