# Release A.2: live publication and smoke checklist (2026-10-26)

**Published:** Lovable project `8cf1f99e`, deployment `7c20aff8-9c7a-4c9c-9ff2-f6d9a445e456`, sent once at about 11:17Z.
- The call returned `pending`. Lovable has no deployment-status API, so the Owner confirms the live build.
- **Approved commit:** `5d442808730c29a8cb3021eff14c2a7316b90434` (tree `8f30bad3`).
- **Rollback:** republish `a3df8545ea411d1322e27fbddf558fc4073ba4e7`.

## Checks before publishing (all passed)

| Check | Result |
|---|---|
| Preview branch `integration/grok-baseline-2026-10-22` | `5d442808`, same as `release/a2-candidate` |
| Lovable `latest_commit_sha` | `5d442808` |
| Scope against `a3df8545` | Exactly the 12 reviewed files |
| Excluded work | No migrations, `proposed/`, webhook, Stripe or payment, Record Rental, insurance/activation (PR 2) or M2 paths in the diff. #280 is not included. |
| M2 flags | `DOCUMENT_CONTENT_SHA256_ENABLED = false` and `IDENTITY_VERIFICATION_ENABLED = false` |
| Rollback refs unchanged | `rollback/live-rc266-67b62664`, `rollback/pre-rc266-7e3e6eb6`, `rollback/pre-release-a-7c7d7b6b`, `release/m2-app-flags-off` `f8b2480f`, `release/reminder-cap` `a3df8545` |

## Read-only database baseline (11:16:51Z, before publishing)

| Item | Value |
|---|---|
| Applications | 155 (2 approved, 9 partial) |
| Documents / storage objects | 93 / 130 |
| Agreements / rentals / payments | 1 / 0 / 0 |
| Insurance verified | 2 |
| audit_log | 932, last row 2026-10-25 23:29:12Z |
| Security 0031 | 5 policies, md5 `d33877618a9f40924d14e49b6653d7fa` |
| Policies | 170 |
| S1 | Trigger present; `authenticated` cannot update `status` |
| Journals | Drizzle 23, Supabase 105 |
| M2 step 2 function | Absent |

Scheduled jobs:

| Job | md5 |
|---|---|
| 2 | `478d975e` |
| 3 | `7a659464` (still broken; unchanged on purpose) |
| 4 | `454777d5` |
| 5 | `269d0f4c` |
| 6 | `cf4fedd9` |

The read-only query is in the scratchpad as `a2-watch.sql`. It is the Release A watch query plus S1, scheduled-job and core counts.

## Live smoke checklist (Owner, on drivereal.com; look only)

| # | Check | Expected |
|---|---|---|
| L1 | Page source `data-commit-sha` | `5d442808…` **This confirms the deployment.** |
| L2 | `/apply` on a phone, scrolled to the contact step. **Do not type**: the first keystroke creates a partial application. | The SMS consent text is fully visible above Continue. Continue is no longer a sticky bar over the text. |
| L3 | Home, `/portal` sign-in, back office Drivers list | All load as before |
| L4 | `/sign/not-a-real-token` | "This Link Is No Longer Active" |
| L5 | Only if staff are already preparing a real agreement: Prepare Agreement preview | The licence expiry reads like "Jun 1, 2029". If Send is refused, a notice stays on screen explaining why and asks staff to regenerate the preview. |

**About L5:** previews generated before this release are refused at Send by design. Staff see the new notice and press Regenerate Preview. That is expected, not a regression.

## Monitoring (read-only; natural activity only)

| Area | Signal | Regression means |
|---|---|---|
| Agreement Send | New `agreements` rows and their send audit entries. Staff reports of the refusal notice. | A Send that is refused again *after* regenerating, or an agreement whose licence date is blank or wrong |
| Safe Autofill | No new errors. Any autofill write changes only blank fields. | A field that already had a value gets overwritten, or autofill errors |
| Apply layout | New `partial` and `new` applications keep arriving at the usual rate. No support reports about the consent step. | Applications stall at the contact step |
| Invariants | 0031 md5, S1, journals 23/105, the 5 scheduled-job md5s | Any change means **stop** and report |

No test applications, sends or charges are made. If a result is unclear, inspect it read-only and stop.

## Read-only check after publishing (12:07:43Z)

Every item matches the baseline:
- applications 155, with the same status breakdown; 0 applications updated since the baseline;
- documents 93, storage objects 130, 0 uploads without a stored file;
- agreements 1, rentals 0, payments 0, insurance verified 2;
- audit_log 932, last row unchanged;
- 0031 still 5 policies with md5 `d3387761…`; 170 policies in total;
- S1 still in place;
- journals 23/105; M2 step 2 still absent;
- all 5 scheduled-job md5s and schedules unchanged.

Scheduled runs since the baseline all succeeded: job 4 ran 10 times, job 5 once and job 6 once. Job 2's next run is at 12:15.

Lovable still reports `latest_commit_sha` `5d442808`, `is_published` true and status ready. The Preview branch and every rollback ref are unchanged.

**Pending:** L1, the Owner's check of the live `data-commit-sha`. It is the only proof that deployment `7c20aff8` is serving.
