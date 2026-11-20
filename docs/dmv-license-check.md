# State DMV License Check (draft, Nov 20 2026)

Rule (Dolmar, Nov 20 2026, 9:30 and 9:39 AM ET): besides RentID, every applicant's license is checked on the state DMV site (Florida: FLHSMV Driver License Check). Check before approval, and again right before the agreement and $50 Reservation Fee go out if the last check is over 24 hours old. Applies to staff approvals. Any result other than Valid (suspended, revoked, cancelled, expired, not found) is Needs Staff: no agreement, no Reservation Fee link, Dolmar flagged. Out-of-state licenses show as Unverified.

## What this adds
- `license_dmv_checks` (migration `20261120161733`, NOT applied): status, license_state, checked_at (server clock), checked_by, note or screenshot_path. Append-only; staff can read and insert.
- `src/lib/dmv-license-check.ts` rules (client-safe), `.server.ts` gate + log, `.functions.ts` server functions, `DmvLicenseCheckCard` on the driver Overview.
- Gates (server-side): `approveApplicationCore` (staff and FLEET), `buildMergeData` blockers (preview, staff send, FLEET send, auto-send, resend), `chargeReservationFeeAfterSigning` (staff Copy Reservation Fee Link, FLEET reservation-fee-link, post-signing checkout, Payment Not Completed restart). When the fee is blocked after signing, no fallback payment link is created either.
- Non-valid result: opens or extends the open `needs_staff` flag (code `dmv_check_not_valid`) and writes an audit entry with `flag_dolmar: true`. No message is sent to anyone.

## Rollout
Enforcement turns on when the migration is applied (same pattern as the blacklist). Before that the code is inert. Applying it will immediately require a fresh Valid check for every approval, agreement send and fee link.

## Not automated
The check is a manual staff step. See the PR description for the automation finding.
