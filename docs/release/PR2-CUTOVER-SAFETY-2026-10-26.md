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

---

# Step C2 result: PR 2 published (Owner-approved, 2026-10-27)

## Pre-publish checks (all passed, about 00:20Z)

| Check | Result |
|---|---|
| Preview branch / PR 2 branch | Both `5e492a87` |
| Lovable `latest_commit_sha` | `5e492a87`, status ready, agent idle, no edits since 2026-10-26 13:31:53Z |
| Scope against A.2 | 49 files. No Stripe, payment, webhook, billing, autopay, swap, migration, M2, Record Rental or `esign.server.ts` paths. |
| Flags | Every flag declaration identical to live A.2 |
| Rollback commit `8ea838c2` | Tree identical to A.2 |
| Activation-setting package | Installed: wrapper, setter and trigger present; 1 evidence row. Exception `false`, 0 changes. Other settings identical (`dbc2b2a9…`). |
| Security 0031 / S1 / journals / scheduled jobs | `d3387761…` / intact / 23 and 105 / unchanged |
| Insurance-authority preflight (read-only) | 13 of 13 ok (the activation package shows as installed) |
| Live before publish | `7c20aff8` (A.2). 14 of 14 responses were 200 in the last hour. |

## Publish

`deploy_project` was called **once**, no retry, at about 00:21Z.
- Response: `status: pending`, deployment **`4ad9e141-63ba-4040-bddd-ffcf0ee606ee`**.
- URL: https://charming-maker-space.lovable.app

## Read-only check right after publishing (00:21:24Z)

Identical to the pre-publish baseline:
- applications 160, last update 21:43:53Z;
- documents 94, storage 131, agreements 1, screenings 5 (2 verified);
- 0 insurance audit rows; rentals 0; payments 0; vehicles unchanged;
- audit_log 948, last row is the C1 evidence;
- exception OFF; other settings identical;
- policies 173, 0031 unchanged, S1 intact, journals 23/105, scheduled jobs unchanged;
- insurance-authority objects absent.

drivereal.com was still serving `7c20aff8` with 0 non-200 responses. The switchover to `4ad9e141` is watched read-only through `x-deployment-id`.

**Not done (waits for separate approval):** the insurance-authority SQL (C4). It needs the Owner's confirmation that `data-commit-sha` = `5e492a87` and the look-only check of the insurance panel and activation dialog.

## Switchover (read-only, `net._http_response` `x-deployment-id` from drivereal.com scheduled calls)

| Deployment | First seen | Last seen | Non-200 |
|---|---|---|---|
| `7c20aff8` (A.2) | — | 00:20:00Z | 0 |
| (no header) | 00:25:00Z | 00:25:00Z | 1: a pg_net 5 s client timeout on the automations job. Same pattern as before A.2. Not an HTTP error. |
| **`4ad9e141` (PR 2)** | **00:30:00Z** | — | 0. The automations job returned `{"ok":true,…,"errors":0}`. |

The switch took about **9 minutes** this time; A.2 took about 50.

**Invariants at 00:31:54Z:** identical to the baseline.
- exception OFF, 0 changes; other settings identical;
- applications 160 (no updates), documents 94, storage 131, agreements 1;
- screenings 5 (2 verified, unchanged), insurance audit 0, rentals 0, payments 0;
- audit 948;
- policies 173, 0031 unchanged, S1 intact, journals 23/105, scheduled jobs unchanged;
- insurance-authority SQL absent.

**State B:** PR 2 serving, activation setting installed, insurance-authority SQL not installed. This is fail-closed and safe to hold.

**Waiting for the Owner:**
1. `data-commit-sha` = `5e492a87` on drivereal.com.
2. Look-only check: the insurance panel and the activation dialog render.
3. Separate approval for the insurance-authority SQL (C4).

Staff should reload any open back-office tabs.

---

# PR 2 live verification and final insurance-authority gate (2026-10-27)

**Live SHA:** the Owner confirmed `data-commit-sha="5e492a87b723bc838b962ec2c1bb4a0c347aeceb"` on drivereal.com. Server side, all 6 calls since 00:30Z came from `4ad9e141`, with 0 errors.

## 1–2. The two screens: visual checks UNVERIFIED (agent cannot reach drivereal.com; proxy 403)

**Deployed-source inspection** at `5e492a87`, identical to the Lovable head:

| Item | Source evidence |
|---|---|
| Insurance panel: Owner and Manager controls | `InsuranceVerificationCard` receives `canDecide={isManager}` (`DriversPanel.tsx:2608`). Others see "Yes/No", "Request Verification" and "Only A Manager Or Owner Can Verify Or Revoke." The decision is never written from the browser (`withoutInsuranceDecision`). |
| Insurance status and expiry | Readiness status is one of `verified`, `unverified`, `missing` or `expired`. Expired means the application or current insurance document date is before today. Shown as the "Insurance Verified" requirement detail. "Verified By" and "Verified At" fields shown. |
| Activation dialog: insurance blocks | The "Insurance Verified" requirement is `enforcement: "hard"` unless the exception is allowed (`activation-readiness.ts:332-336`). Hard blockers render under "Cannot Activate". Only `no_interview` and `no_passed_inspection` can be overridden; everything else, including future codes, is hard (`isHardBlocker`). |
| Exception OFF | The acknowledgement box ("Insurance Not Verified") appears only when `exceptionAllowed`. The production value is `false`. |
| Permanent Record | Unchanged from #278 (vault-replace-guard 17/0). The signed agreement's document is still current. |

**What the Owner should see** (production aggregates, no personal data):
- Both approved drivers have insurance status **missing** and **no** unused signed agreement.
- Their dialog should therefore show "Cannot Activate", with both the insurance and signed-agreement requirements unmet, and no insurance acknowledgement box.

## 3. Production safety (read-only, 00:51:52Z)

| Item | Result |
|---|---|
| Security 0031 | 5 policies, `d3387761…` |
| S1 | Trigger 1, authenticated status UPDATE false, guard function present |
| Activation-setting SQL | Installed: wrapper, trigger, 1 evidence row |
| Insurance exception | `false` (OFF), 0 changes. Other settings identical. |
| Insurance-authority SQL | Not installed |
| Journals / scheduled jobs / `activate_rental_tx` | 23 and 105 / all 5 unchanged / `dfadcc73…` unchanged |
| Customer data | Applications 160 (last update 21:43:53Z), documents 94, storage 131, agreements 1, screenings 5 (2 verified), rentals 0, payments 0, vehicles unchanged |
| Audit since the C1 evidence row | 0 rows (no insurance, rental or setting actions) |

## 4. Insurance-authority request and preflight (not submitted)

| Item | Result |
|---|---|
| Request | sha256 **`eb7710d7fc3ff58adc0c1d0424245b205dda98f9f319ad29f24adf5363e68950`**. Matches the approval. `SHA256SUMS` OK. Same as the pushed branch. 26,159 bytes, ASCII only. |
| Preflight (00:5xZ) | **13 of 13 ok, unchanged** since before the publish. Target identity ok; journal `5cfa7e88…`; 0031 `d3387761…`; helpers present; no evidence yet; objects absent; screening triggers are the expected three. Activation package installed; M2 Window 2 not installed. |
