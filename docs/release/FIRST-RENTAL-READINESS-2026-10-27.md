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

