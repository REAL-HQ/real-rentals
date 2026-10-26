# PR 2 final release safety review (2026-10-26, non-production)

## Scope

| | |
|---|---|
| Candidate | `5e492a87`, on Preview |
| Live | A.2 `5d442808`, deployment `7c20aff8` |
| SQL | `activation-insurance-setting` (AIS) `b80babcc…5505`, then `insurance-verification-authority` (IVA) `eb7710d7…e950` |
| Rollback requests | AIS `57498a82…4893`, IVA `69d5dcef…d082` |
| Prepared rollback commit | `rollback/pr2-to-a2` = **`8ea838c2469dba3d16309b7606f2ba69fd96dcda`**. It fast-forwards from `5e492a87` and its tree is identical to A.2 (`8f30bad3`). |

No changes to Stripe, autopay, End Rental, M2, Record Rental, Security 0031 or S1. The insurance exception stays OFF.

## Recommendation: GO for the production window (no genuine blocker)

## 1. Hosted Preview

V1–V7 remain **UNVERIFIED** on the hosted Preview, because the agent cannot reach it. The supporting evidence is all automated and passing at `5e492a87`:
- activation-readiness 77/0;
- vault-replace-guard 17/0;
- database package tests 61/0;
- eSign harness 50/50.

**Only one visual check is release-critical:** V3+V5.
- **What:** the Owner opens one driver's Screening/insurance panel and the activation dialog, look-only, and both render without error.
- **Why:** PR 2 replaces both screens, staff need them for the first rental, and source-level UI tests do not render them.
- **When:** at cutover step C3, before IVA. It can also be done on Preview beforehand.
- **If it fails:** do not install IVA; roll back per R2.

The other visual checks are covered by tests or by production data (exception row absent, so OFF; 0 Coordinator accounts).

## 2. Cutover sequence and the state between steps

| Step | Action | State afterwards |
|---|---|---|
| C1 | AIS preflight (read-only), then AIS request once, then verify-after | **A.2 + AIS.** No behaviour change. The AIS trigger and its three restrictive policies apply only to the `app_settings` key `rental_activation`, which A.2 never reads or writes. `activate_rental_tx` is unchanged. |
| C2 | IVA preflight (read-only), then publish `5e492a87` once | About **50 minutes** of A.2 + AIS (the A.2 publish took 50 minutes to reach drivereal.com). The switchover is detected read-only from drivereal.com's `x-deployment-id`. |
| C3 | Owner confirms the live `data-commit-sha` = `5e492a87`, plus the V3+V5 look-only check | **PR 2 + AIS, no IVA** (state B below) |
| C4 | IVA request once, within about 10 minutes of C3, then verify-after | **PR 2 + AIS + IVA.** Final state. |

### State B: PR 2 live, IVA not yet installed (for example, if C4 is delayed)

This state is safe to hold indefinitely.

**Activation stays fail-closed.**
- PR 2 calls `activate_rental_checked_tx`, installed by AIS. The database re-checks insurance in the same transaction.
- With the exception OFF, unverified, expired or missing insurance is refused even with an override and a reason.
- If AIS were absent, PR 2 would still fail closed: it activates only with verified insurance and refuses every override (`rentals.functions.ts:449-478`).

**Insurance verification stays usable** for Managers and the Owner.
- PR 2 calls `set_insurance_verification`. Until IVA exists this returns PGRST202.
- On PGRST202 it falls back to: `requireManager`, then the audit row written **first** (refused if the audit fails), then the decision (`insurance-verification.functions.ts:41-140`).
- Limitation: the audit and the decision are not one transaction. The audit is never skipped.

**Remaining exposure.** Direct database-API writes to the decision columns remain possible. This is the same as today, not new.
- There are 0 Coordinator accounts.
- Browser tabs still running A.2 can flip the old toggle without an audit until they are reloaded.
- Mitigation: staff reload back-office tabs at C3.

### State C: IVA installed

- Decisions are made only through `set_insurance_verification`: Manager/Owner check plus audit, atomic.
- The guard refuses changes to `insurance_verified` / `_at` / `_by` from authenticated, anon and service_role. Other screening edits are unaffected (the check is `IS DISTINCT FROM` on those three columns only).
- No other app path or migration writes those columns.
- A stale A.2 tab gets a refusal on the toggle and nothing changes. Fix: reload.

### Wrong-order case, prevented by C3

If IVA ran while A.2 was still serving, the A.2 toggle would be refused. That fails closed, but insurance verification would be unavailable until PR 2 is serving. This is why C4 waits for the Owner's SHA confirmation, not for the publish call.

## 3. Rollback (each step needs separate Owner approval; nothing runs automatically)

These rollback orders were tested in C1–C4: S1 verify-after stays true and the 0031 md5 is unchanged.

### R1: failure before publication (C1 or the C2 preflight)

| Case | Action |
|---|---|
| AIS refused (any guard) | Nothing to undo: the package raised and nothing committed. Stop and report. Do not retry. |
| AIS installed, then abort | Leave AIS in place (inert for A.2), or submit the AIS rollback `57498a82…`. |
| Unfreeze Publish | Fast-forward Preview to `8ea838c2` (tree = A.2), so an accidental Publish ships A.2. |

### R2: after publication, before IVA

| Case | Action |
|---|---|
| Publish not serving after about 90 minutes (`x-deployment-id` unchanged) | Do not install IVA. Do not republish automatically. Report. |
| PR 2 live but faulty (for example, the V3+V5 check fails) | 1. Fast-forward Preview to `8ea838c2`.<br>2. Publish once.<br>3. Wait about 50 minutes.<br>4. Owner confirms the live `data-commit-sha` = `8ea838c2…` (tree identical to A.2).<br>5. AIS may stay (inert for A.2) or be rolled back with `57498a82…`.<br>IVA is not installed, so A.2's toggle keeps working. During the 50 minutes PR 2 stays live and fail-closed. |

### R3: after IVA

| Case | Action |
|---|---|
| IVA problem only | Submit the IVA rollback `69d5dcef…`. PR 2 then automatically uses its audit-first fallback (state B). No republish is needed. |
| PR 2 app problem | **IVA rollback first** (`69d5dcef…`), then R2's app rollback. Never republish A.2 while IVA is installed. |
| AIS rollback (only if needed, last) | Submit `57498a82…`. If PR 2 is still live, it then fails closed and refuses all overrides. |

## 4. Expected temporary limitations

| Window | Limitation |
|---|---|
| C1 to the switchover (about 50 minutes) | None. A.2 behaves exactly as today. |
| During the switchover | Edge caches may briefly serve either build. Both are safe. |
| State B | Verification audit is not atomic. Old tabs need a reload. The Owner exception can't be turned on (it stays OFF). |
| After C4 | Old A.2 tabs get a refusal on the insurance toggle until reloaded |

The Owner setting toggle works only after AIS, and only for the Owner. It is not used in this window.

## 5. Minimum production approval

> I approve the PR 2 production window for Lovable project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6`:
> 1. Run the `activation-insurance-setting` read-only preflight; if every gate is true, submit request
>    `b80babcc275bea4682bc9b69ba3ce11d5f2833ced848c9682b00979311765505` once, then its read-only verify-after.
> 2. Run the `insurance-verification-authority` read-only preflight; if every gate is true, publish once at
>    `5e492a87b723bc838b962ec2c1bb4a0c347aeceb` (rollback commit `8ea838c2`, tree identical to A.2 `5d442808`).
> 3. After I confirm the live `data-commit-sha` is `5e492a87…` and that the insurance panel and activation dialog
>    render (look only), submit request `eb7710d7fc3ff58adc0c1d0424245b205dda98f9f319ad29f24adf5363e68950` once,
>    then its read-only verify-after.
>
> The insurance exception stays OFF. Rollbacks R1–R3 need separate approval.

---

# Step C1 result: activation-insurance-setting INSTALLED (Owner-approved, 2026-10-26)

| | |
|---|---|
| Request | `request-activation-insurance-setting.sql`, sha256 `b80babcc275bea4682bc9b69ba3ce11d5f2833ced848c9682b00979311765505` (matches the approval; `SHA256SUMS` OK; identical to `feature/driver-activation-readiness` @ `5e492a87`) |
| Preflight (read-only, 22:42Z) | 19 of 19 rows ok. Journal md5 `5cfa7e88…`, 0031 `d3387761…`, `activate_rental_tx` md5 `dfadcc73…`, objects absent, key absent. |
| Submission | Once, through `query_database`, no retry. Result `rows: []`: the guard (exact bytes plus trailer) and every in-transaction postcondition passed. |
| Evidence row | `security_migration_verified` / `database_migration` / `activation_insurance_setting_v1` at **22:45:21.78Z**, txid **107299**, executor `postgres` |
| Verify-after (read-only) | 15 of 15 ok. Wrapper, setter and guard bodies plus ACLs as reviewed. Trigger 1. Three restrictive policies. `activate_rental_tx` unchanged (`dfadcc73…`) and still service-role only. One evidence row. |
| **Insurance exception** | `{"allow_activation_without_insurance_verification": false}` (**OFF**). 0 audited setting changes. |

## Before (22:42:53Z) and after (22:46:09Z)

| Item | Before | After |
|---|---|---|
| `app_settings` keys other than `rental_activation` | 10, md5 `dbc2b2a9…` | **identical** |
| `rental_activation` row | absent | present, OFF |
| `app_settings` policies | 1 (`Admins manage settings`) | that one plus 3 restrictive `rental_activation_setting_*` |
| `app_settings` triggers | `app_settings_updated_at` | that one plus `rental_activation_setting_guard` |
| Total policies | 170 | 173 (+3, as above) |
| Security 0031 md5 | `d3387761…` | **unchanged** |
| S1 (trigger, no authenticated status UPDATE, guard function) | 1 / false / true | **unchanged** |
| Journals Drizzle / Supabase | 23 / 105 | **unchanged** (no ledger write) |
| Scheduled jobs 2–6 (md5, schedule, active) | as before | **unchanged** |
| Applications (count, last update) | 160, 21:43:53Z | **unchanged** |
| Documents / storage / agreements / screenings / rentals / payments / vehicles / user_roles | 94 / 131 / 1 / 5 (2 verified) / 0 / 0 / 10 / 6 | **unchanged** |
| audit_log | 947 | 948 (+1: the evidence row only) |
| Insurance-authority objects | absent | absent (not installed) |
| Live deployment | `7c20aff8` (A.2) | `7c20aff8` (A.2). PR 2 is not published. |

**State now: A.2 + activation setting (state A).** A.2 behaviour is unchanged: it never reads the `rental_activation` key and still calls the unchanged `activate_rental_tx`.

**Rollback, if ever needed (separate approval):** request `57498a82…4893`.

**Next:** Step C2 (insurance-authority preflight, then publish `5e492a87`) waits for the Owner's separate approval.
