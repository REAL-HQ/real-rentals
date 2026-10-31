# Payment guards: production installation packets (prepared 2026-10-30; nothing executed)

**Live app:** Release 2, `4fdf5a78` (Owner-verified). Two separate SQL packages, installed in this order, each under its own approval:
1. **Payments DELETE guard v1**
2. **Payments write guard v1** (only after 1 is installed and verified)

Externally billed Stripe customers stay separate: no import, no historical payments recreated.

## Evidence common to both

**Compatibility with live Release 2 (`4fdf5a78`):**
- The app never deletes payments.
- Every staff money action goes through audited server functions (`service_role`): Charge Card, Pay Now, Mark as Paid, Void, Waive, the Owner release, the webhook, and the late-fee and rebill crons.
- The only direct user-session write is Add Payment, inserting an owed charge, which the write guard allows.
- Results on `4fdf5a78`:

  | Suite | Result |
  |---|---|
  | `payments-delete-guard.db` | 17/17 |
  | `payments-write-guard.db` | 17/17 |
  | Concurrency suite with both guards installed | 13/13 |
  | Full regression and 0031/S1/insurance compatibility | 61/61 |

**Production-like preservation run (2026-10-30, local Postgres 17, `rr_tpl` + 0031 + S1 + AIS + IVA installed, as in production): 15/15.** Script: `scripts/payments-guards-preservation.db.test.mjs` (set `R2_TREE`, `PWG_TREE`, `S1_DIR` to checkouts of the package branches).
- Both preflights: only the two local target rows differ.
- The DELETE guard installs, then its verify-after is all ok.
- The write guard installs, then its verify-after is all ok.
- After each step:
  - **S1 verify-after:** all gates true.
  - **Insurance-setting and insurance-authority verify-afters:** all ok.
  - **0031:** `d3387761…` unchanged.
- **Server-side operations as `service_role` keep working:** charge insert, claim, paid, notice claim, failed, waive, void, and a refund through `apply_payment_refund`.
- **A Manager's own session:** a direct delete or status change is refused.
- **Rollback:** write guard first, then DELETE guard. Each removes exactly its objects, triggers return to `payments_updated_at`, the four evidence rows are kept, and S1, the insurance setting, insurance authority and 0031 are unchanged.

**Neither guard blocks** server-side payments, refunds or the webhook: all run as `service_role` or in SECURITY DEFINER functions owned by the database owner. Reconciliation (proposed 0033) would also run that way. Install the guards **before** any future 0033, or regenerate their preflights.

**Submission rules (both packages):**
- Exact file bytes, ASCII, final newline.
- Sent once through Lovable `query_database` on project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6`. Guard v3 checks its own text, the package bytes, and that only the Management API trailer follows.
- No retry.
- Success = `{"rows":[]}`.
- If the result is ambiguous: inspect read-only (evidence row and objects) and stop.

---

## Packet 1: Payments DELETE guard v1

**What it does:**
- A BEFORE DELETE row trigger `zz_payments_delete_guard` on `public.payments`, calling SECURITY INVOKER `private.payments_delete_guard()`.
- Refuses deletes from `authenticated`, `anon` and `service_role` with `payments_are_financial_history_void_instead` (42501).
- The database owner and parent `ON DELETE SET NULL` actions are unaffected.
- No policy, grant or row changes.

**Artifacts** (in the live tree `4fdf5a78`, `proposed/payments-delete-guard/`; `SHA256SUMS` verified; `build.py --check` byte for byte):

| File | SHA-256 |
|---|---|
| `request-payments-delete-guard.sql` (**submit**) | `f200164664f9da85c23ca6ceb16498e97276a1da66706c357aa3fdc5c865057c` (13005 bytes) |
| `request-rollback-payments-delete-guard.sql` (rollback) | `9759df5d56cdb8d405b4d09ed881444322386c569ec3cd8f069f61bd81907929` (10995 bytes) |
| `preflight-readonly.sql` | `19002d0d3d0f477fc3c2827991a0f92a8b12a2659d4a17a596df4ee4cbf3942d` |
| `verify-after-readonly.sql` | `41423e62d0b028bf46a8bf728e3e257765fba4c5d9063f1b781a21c0ab413dac` |

**Read-only production preflight** (12 rows; run as step 1 of the approved operation). Expected values, against the latest read-only production snapshots (2026-10-27/28):

| Check | Expected | Last known in production |
|---|---|---|
| `target.system_identifier` | `7642734024280108049` | Matches |
| `target.database` / `target.executor` | `postgres` / `postgres` | Matches (AIS/IVA installs) |
| `drizzle.first_23_receipts_md5` | `5cfa7e88…` | Matches (IVA preflight); 23 receipts |
| `security_0031.policies_md5` | `d3387761…` | Matches |
| `audit_log.insert_for_executor` | true | True |
| `private_schema.present` | true | True |
| `evidence.none_yet` | 0 | 0 |
| `objects.absent` | true | True (guard absent) |
| `payments.triggers` | `payments_updated_at` | Matches |
| `payments.fks_set_null_only` | `payments_driver_id_fkey:n,payments_rental_id_fkey:n,payments_vehicle_id_fkey:n` | **Not yet read in production**; matches the production-order baseline |
| `payments.rows`, `payments.truncate_api_roles` | Informational | 0 rows; `anon`/`authenticated`/`service_role` hold TRUNCATE (not reachable via PostgREST; a separate grant review) |

**Steps:**
1. **Preflight**, read-only. Stop unless every non-informational row is ok.
2. **Before snapshot**, read-only: the standard safety snapshot.
3. **Submit** `request-payments-delete-guard.sql` once.
4. **Verify-after**, read-only, 6 rows, all ok:
   - function definition and no API execute;
   - trigger `tgtype` 11 enabled;
   - `payments` fingerprint unchanged since install;
   - one evidence row;
   - 0031 md5.
5. **After snapshot**, read-only. It must be identical to the before snapshot, except for one new `audit_log` evidence row and the new trigger.

**Rollback** (separate approval):
1. Submit `request-rollback-payments-delete-guard.sql` once.
2. Expect `{"rows":[]}`.
3. Verify read-only:
   - `private.payments_delete_guard()` absent;
   - no `zz_payments_delete_guard` trigger;
   - evidence rows `payments_delete_guard_v1` and `…_rollback` present.

v1 cannot be reinstalled after a rollback (a replay is refused); that needs a v2. The app does not depend on the guard.

**Approval wording:**
> I approve, for Lovable project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6`: (1) the read-only preflight `preflight-readonly.sql`; and, only if every non-informational row is ok, (2) one submission of `request-payments-delete-guard.sql` (sha256 `f200164664f9da85c23ca6ceb16498e97276a1da66706c357aa3fdc5c865057c`) exactly once with no retry, then (3) the read-only verify-after and safety snapshots. Rollback, only with separate approval: `request-rollback-payments-delete-guard.sql` (sha256 `9759df5d56cdb8d405b4d09ed881444322386c569ec3cd8f069f61bd81907929`).

---

## Packet 2: Payments write guard v1 (after Packet 1 is installed and verified)

**What it does:**
- A BEFORE INSERT OR UPDATE row trigger `zz_payments_write_guard`, calling SECURITY INVOKER `private.payments_write_guard()`. Active only for `authenticated` and `anon` sessions.
- **Update.** An allowlist: only `notes`, plus `payment_method` while the row is still owed, may change. Everything else is frozen, including columns added later: status, amounts, balances, paid date, refunds, Stripe ids, attempt and notice state, links, type and due date.
- **Insert.** New charges must start owed.
- `service_role`, owner-defined SECURITY DEFINER functions, FK actions and the owner are unaffected.

**Artifacts** (branch `fix/payments-write-guard-sql` @ `ed2ed072`, `proposed/payments-write-guard/`; `SHA256SUMS` verified; `build.py --check` byte for byte):

| File | SHA-256 |
|---|---|
| `request-payments-write-guard.sql` (**submit**) | `91ad1504a9fdd1511f0ba0c19bdee42ed94ae8afc389c110a9f859a53f13438d` (14924 bytes) |
| `request-rollback-payments-write-guard.sql` (rollback) | `2ab7d318f947d1cff6b0ba1f2d1f49b2acd442f21985d4644460223dc896a015` (10977 bytes) |
| `preflight-readonly.sql` | `6769c3e2ced3ea0f8631ca9001537ca6a55556ecdf1473c20579276380467fd6` |
| `verify-after-readonly.sql` | `e9bc5a7757178a005df6b424313b0a4e80c85d9edb06958e6fa9e99dde3d3e15` |

**Preflight** (13 rows) — the same target, journal, 0031, audit and private-schema gates, plus:
- `payments.triggers` = `payments_updated_at,zz_payments_delete_guard` (the DELETE guard installed);
- no SECURITY INVOKER function writes `payments`;
- FKs set-null only;
- no write-guard evidence or objects yet.

**Steps:** preflight → before snapshot → submit once → verify-after (6 rows, trigger `tgtype` 23) → after snapshot. These mirror Packet 1.

**Rollback** (separate approval):
1. Submit `request-rollback-payments-write-guard.sql` once.
2. Verify read-only that the write-guard function and trigger are absent and the DELETE guard is intact.
3. **If the app is ever rolled back to before Release 2, roll back the write guard first.** Release 1's Payments screen edits rows directly and would fail closed.

**Approval wording:**
> I approve, for Lovable project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6`, after the payments DELETE guard is installed and verified: (1) the read-only preflight `preflight-readonly.sql` of `proposed/payments-write-guard` (branch `fix/payments-write-guard-sql` @ `ed2ed072`); and, only if every non-informational row is ok, (2) one submission of `request-payments-write-guard.sql` (sha256 `91ad1504a9fdd1511f0ba0c19bdee42ed94ae8afc389c110a9f859a53f13438d`) exactly once with no retry, then (3) the read-only verify-after and safety snapshots. Rollback, only with separate approval: `request-rollback-payments-write-guard.sql` (sha256 `2ab7d318f947d1cff6b0ba1f2d1f49b2acd442f21985d4644460223dc896a015`).

---

## Stripe live verification (Owner, in the Stripe Dashboard; the agent has no Stripe access and asks for no keys)

Lovable lists Stripe as an enabled workspace integration. Live charges use `STRIPE_LIVE_API_KEY` through Lovable's connector gateway. The webhook checks `PAYMENTS_LIVE_WEBHOOK_SECRET`.

Minimum checks, in **live mode**, read-only. Change nothing.

| # | Where | Check |
|---|---|---|
| S1 | Developers → Webhooks | An enabled endpoint `https://drivereal.com/api/public/payments/webhook?env=live` exists |
| S2 | That endpoint → events | It includes `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and (optional while autopay is off) `invoice.paid`, `invoice.payment_failed` |
| S3 | That endpoint → recent deliveries | Mostly 2xx. External payments (Regina's, Damon's) are acknowledged 200 and recorded nowhere, by design. 400s mean a signing-secret or handler problem: report them. |
| S4 | Lovable → project → Secrets (names only) | `PAYMENTS_LIVE_WEBHOOK_SECRET`, `STRIPE_LIVE_API_KEY` and `LOVABLE_API_KEY` exist. Confirm the webhook secret matches the endpoint's signing secret without sharing either value. |
| S5 | drivereal.com → Overview → **Stripe Collections**, environment live, last 30 days | Loads without error (the live key works, read-only). Its totals match Dashboard → Payments for the same range. |
| S6 | Dashboard → Customers → Regina, Damon | Note only: billing type (subscription, invoice, payment link) and next charge date. **Do not change anything.** |

## Existing externally billed customers (Regina, Damon): duplicate-billing risk

- **Entering a rental does not bill anyone.** No job creates rent charges automatically, and autopay is off.
- **The webhook can't link them by itself.** It ignores their external payments and setup-mode checkouts without app metadata.
- **Duplicate billing happens only if someone bills them in the app while their Stripe billing continues:**
  - **Charge Card:** a second charge on the card.
  - **Add Payment + Pay Now:** the driver pays twice.
  - **Overdue past-due reminders:** reminders for app-entered owed rows could prompt a second payment.
- **Rule until a reviewed migration plan exists:**
  - Keep them billed only in Stripe.
  - If their rental is recorded in REAL RENTALS, do not Charge Card them or add rent charges.
  - Stop their Stripe billing (at a week boundary, Owner-approved) before the app bills them.
'''

---

## Packet 1 installed (Owner-approved, 2026-10-31)

**Result: INSTALLED AND VERIFIED.** One submission, no retry. The write guard was not installed.

| Step | Time (UTC) | Result |
|---|---|---|
| Package bytes | before | `request-payments-delete-guard.sql` sha256 `f2001646…057c` (13005 bytes, ASCII) = approved; `SHA256SUMS` OK; `build.py --check` byte for byte; tree `4fdf5a78` clean |
| Preflight (read-only) | 02:16 | 12/12 required rows ok. `payments.fks_set_null_only` read in production for the first time: `payments_driver_id_fkey:n,payments_rental_id_fkey:n,payments_vehicle_id_fkey:n` (ok). Informational: 0 payment rows; TRUNCATE held by `anon,authenticated,service_role` (unchanged, separate grant review) |
| S1 verify-after (read-only) | 02:18 | `all_gates: true` (12 gates); fingerprint `a2b05c35…` = evidence |
| Insurance-setting verify-after (read-only) | 02:17 | 15/15 ok; exception `false`, 0 audited changes |
| Insurance-authority verify-after (read-only) | 02:17 | 8/8 ok |
| Before snapshot (read-only) | 02:17:08 | see below |
| **Submission** | 02:19:40 | `{"rows":[]}`; evidence txid 120057 |
| Verify-after (read-only) | 02:20 | 6/6 ok: function body sha256 `dc651bb2…`, SECURITY INVOKER, `search_path=""`, ACL `{postgres=X/postgres}` (no API execute); trigger `zz_payments_delete_guard` tgtype 11, enabled; `payments` fingerprint `20b00031…` = evidence; 1 evidence row; 0031 `d3387761…` |
| After snapshot (read-only) | 02:20:33 | see below |

**Fingerprint comparison, before → after:**

| Item | Before | After |
|---|---|---|
| Catalog excluding the payment guards: functions (public + private) | 94 / `d52cdfa24515` | 94 / `d52cdfa24515` |
| Triggers | 78 / `f096de5ed1e2` | 78 / `f096de5ed1e2` |
| All policies | 173, `66a01e279796` | 173, `66a01e279796` |
| Table ACLs (public, private, storage) | 90 / `a8d6cb061416` | 90 / `a8d6cb061416` |
| Column ACLs | `ad5992e11508` | `ad5992e11508` |
| Relations | 84 / `13c2b947afcd` | 84 / `13c2b947afcd` |
| `payments` columns, ACL, RLS, policies, constraints, FKs | `73063cfb`, unchanged, `true/false`, `873fd273`, `d5a4db9a`, set-null | identical |
| `apply_payment_refund` | `4b515ba5`, SECURITY DEFINER | identical |
| `payments` triggers | `payments_updated_at` | `payments_updated_at,zz_payments_delete_guard` (**expected**) |
| `private.payments_delete_guard()` | absent | present (**expected**) |
| Payment-guard evidence | none | `payments_delete_guard_v1`: 1 (**expected**) |
| Write guard | absent | absent |
| 0031 / S1 trigger / AIS + IVA evidence / IVA setter / insurance trigger | `d3387761…` / 1 / 1 + 1 / `603cc13a` / 1 | identical |
| Insurance exception / late fees | false / false | false / false |
| Journals: drizzle 23 (`5cfa7e88…`), supabase 105 (`c092289b`) | | identical |
| Cron jobs 2–6 (active, schedule, command md5) | `478d975e`, `7a659464`, `454777d5`, `269d0f4c`, `cf4fedd9` | identical |
| Counts: applications 187, rentals 0, payments 0, autopay/subscription rentals 0, agreements 1, documents 115, screenings 5, vehicles 10, user_roles 7, storage objects 152 | | identical |
| Fingerprints: vehicles `2b0b7a57`, user_roles `1a2d9611`, app_settings `b9aae8d4`, applications `3eab79ac` | | identical |
| audit_log | 1125 | 1126 (+1 = the evidence row, `security_migration_verified`, actor `postgres`) |

**Live app:** Release 2, deployment `psr2.7f1b6a2b`, serving HTTP 200 throughout. The two null-deployment cron responses (02:05 before, 02:20 after) are the known 5-second pg_net timeouts; the same pattern appears at 00:30.

**Delete refusal:** proven by the catalog checks above (exact reviewed function body and trigger) and by the local suites (`payments-delete-guard.db` 17/17; production-like preservation 15/15). No delete was attempted in production: payments has 0 rows and production writes beyond the approved request were not authorized.

**`sandbox_exec`:** the `payments` ACL includes `sandbox_exec=ar` (SELECT and INSERT only). This is the platform role investigated on 2026-10-25 (`docs/security/s1-preflight-2026-10-25/SANDBOX-EXEC-FINDINGS.md`). It has no DELETE privilege anywhere, and it is unchanged by this install.

**Rollback** stays available under separate approval only: `request-rollback-payments-delete-guard.sql` sha256 `9759df5d56cdb8d405b4d09ed881444322386c569ec3cd8f069f61bd81907929` (unchanged in the live tree).
