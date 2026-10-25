# PR 2 deployment plan (driver activation readiness)

**Status: PLAN ONLY.** Every production step below needs its own explicit Owner approval:
- Preview branch update
- Publish
- each SQL submission

Nothing here has run in production.

## Owner decisions this plan implements (2026-10-25)

- **Insurance verification stays fail-closed.**
  - A rental is never activated with unverified required insurance, unless the Owner has turned on
    "Allow Activation Without Insurance Verification". That setting lives under Settings → Rentals →
    Rental Terms and defaults to OFF.
  - Even with the setting on, a Manager or Owner must explicitly acknowledge the warning.
- **Only Managers and Owners verify or revoke insurance.**
  - Coordinators can edit insurance information and use Request Verification.
  - Coordinator insurance document upload and review stay **out of scope**, because Security 0031 hides
    insurance documents from Coordinators. Security 0031 is unchanged.
- **Interview stays optional.** Overriding it needs a written reason. That reason is re-checked inside the
  activation transaction and recorded in the audit log.
- **Before the SQL is installed, the fallback fails closed.**
  - Activation requires verified insurance, and every override is refused.
  - Insurance decisions are audited first (`atomic: false`) and refused if the audit write fails.

## Why the order matters

| Package | Effect on the live Release A app if installed early | Constraint |
|---|---|---|
| `activation-insurance-setting` (request `b80babcc…5505`) | None. Its trigger and policies apply only to the `app_settings` key `rental_activation`, which Release A never reads or writes. Release A calls `activate_rental_tx`, which stays unchanged. | **Can be installed before PR 2 is published.** |
| `insurance-verification-authority` (request `eb7710d7…e950`) | **Breaks the live "Insurance Verified" toggle.** Release A writes `driver_screenings.insurance_verified/_at/_by` from the browser (`DriverScreening.tsx:767-769`), and `zz_insurance_decision_guard` refuses that. | **Must be installed only after PR 2's app is confirmed live.** |

## Sequence (keeps the gap between Publish and the required SQL to minutes)

**Before the window** (separate approvals, any day after Release A.1 is live):
1. Run `activation-insurance-setting`: preflight (read-only), then the request (once), then
   verify-after (read-only).
   - Release A behaviour is unchanged.
   - The setting is OFF.
   - The wrapper sits unused until PR 2's app calls it.

**Window** (one approval covering 2–5, ideally at a quiet hour with no activation in progress):
2. Run the IVA `preflight-readonly.sql`. All gates must be true. If any gate is false, **stop** and do not publish.
3. Publish PR 2's app (Release A.2).
4. Confirm the new build is serving: the `data-commit-sha` on the published site equals the
   approved commit.
   - If the publish failed or the SHA does not match, **stop**.
   - Do not install IVA.
5. Submit the IVA request once, then run verify-after (all `ok`).
   - Target time from step 3 to step 5: under 10 minutes.
   - Ask staff to reload open back-office tabs. A tab still running the old build gets a refusal on the
     Insurance Verified toggle. It fails closed and changes nothing.

**After:**
6. Watch for 24 hours (read-only):
   - `insurance.verified` / `insurance.revoked` / `insurance.verification_requested` audit rows;
   - `rental.activated` rows carrying `atomic: true`;
   - no `auditError` reports.
7. Turning the Owner setting ON is a separate business decision. It stays OFF.

**Exposure during steps 3→5** (minutes):
- The new app already routes every decision through the server with audit-first.
- A Coordinator could still write the decision columns directly through the database API, which is
  exactly today's Release A exposure. No new risk is introduced.

## Rollback (reverse order; each needs approval)

| Situation | Action |
|---|---|
| Problem after step 5 | IVA rollback request (`69d5dcef…d082`), **then** republish Release A.1. Never republish A.1 while IVA is installed: A.1's toggle would be refused. |
| Problem with the activation package | Its rollback request (`57498a82…3893`). PR 2's app then falls back to fail-closed. |
| Publish failed at step 3 | Nothing to undo. The activation package is harmless to A.1. |

## Interactions with other gated work

| Gated work | Interaction |
|---|---|
| S1 | Already installed, as the packages require. S1's own verify-after and rollback still succeed with both packages installed (tests C1–C2). |
| Security 0031 | Required exactly as installed. Unchanged. |
| M2 Window 1 / Window 2 | Any order was tested (C1–C4). Recommended: both PR 2 packages before Window 2. Under the Window 2 lock, activation returns 40001 and writes nothing; a retry succeeds. |
| Drizzle 0023 | Independent. |
