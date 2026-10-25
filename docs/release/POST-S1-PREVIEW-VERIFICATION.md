# Post-S1 Preview verification: PR 1, PR 4, PR 3 (release candidate)

**What this covers.** The candidate is Release A `14cbf81b`, plus `feature/resume-reliability` `733804dc` (which includes PR 1,
`9c66abd8`), plus `feature/esign-signing-fixes` `1bcb437a`. The merged tree is
`a9362dfbc9e08c8b61abc7d4825cb1b1fb514e3e` (commit `700e7bcc`).

**Changes involved.** These are app-only changes: no migration, no SQL, no feature flags, and no change to Security 0031 or S1.

**Where to test.** Use Lovable Preview only, with synthetic test data, in the disposable or Preview project. Do not use production customer
records, and do not send production email or SMS.

Record PASS, FAIL or PENDING for each check. PENDING means the check needs data that does not exist naturally. Do not create
production records to satisfy a check.

## 0. Gate

| # | Check | Expected |
|---|---|---|
| 0.1 | `data-commit-sha` on the Preview page | the release candidate commit (not 14cbf81b) |
| 0.2 | Home page, /apply, back office and portal | all load; no console errors beyond the Release A baseline |
| 0.3 | M2 flags | both still false (Release A behaviour) |

## PR 1: decided applications locked; signed agreements protected in the vault

| # | Steps | Expected |
|---|---|---|
| 1.1 | Open a resume link for a synthetic application in `partial`, `new`, `complete` or `reviewing` status, then edit a field | Saves normally |
| 1.2 | Set the synthetic application to approved through the normal Manager flow, then reopen the same resume link | The wizard is read-only with the message "This application is already being processed — contact us to make changes." It does not say which decision was made |
| 1.3 | With the locked application, try to change a field, or replay a save request from devtools | Refused; the row is unchanged in the back office |
| 1.4 | Back office → Applicant Documents for a driver with a signed rental agreement | No Delete button on the signed-agreement PDF |
| 1.5 | Call Delete on that document from devtools | Refused with the signed-agreement message; the file and row remain |
| 1.6 | Delete an ordinary document (for example a duplicate photo) as Owner | Works as before |

## PR 4: save and resume reliability

| # | Steps | Expected |
|---|---|---|
| 4.1 | /apply, part 1: type in fields | Indicator shows "Saving…", then "Saved" |
| 4.2 | Switch the browser to offline (devtools), type, then go back online | Shows "Couldn't Save — Retry" while offline, then "Saved" once online. No duplicate application is created |
| 4.3 | Request a recovery link twice for the same email | Each link signs in once and expires after 30 minutes; a second use is refused. An already-open applicant session is **not** signed out |
| 4.4 | Reminder email (capture-only environment) | The link in the email is a 30-minute single-use recovery link |
| 4.5 | Reminder candidates | Deleted, purged, closed or decided applications get no reminder; one email per stage (no duplicate send) |
| 4.6 | iOS Safari and Android Chrome: phone and email fields | Numeric keypad for phone; autofill suggests name, email and phone |
| 4.7 | Decided application (as in 1.2) with the save queue | Shows the locked state and stops retrying |

## PR 3: e-signature fixes

| # | Steps | Expected |
|---|---|---|
| 3.1 | Manager preview of an agreement | Dates read like "Oct 11, 2026" (America/New_York) |
| 3.2 | Preview after 8 pm ET (past midnight UTC), then Send | Send succeeds; no fingerprint mismatch from the UTC date roll-over |
| 3.3 | Void a synthetic pending agreement, then open the driver portal | Shows "Cancelled · No Action Needed"; no "Review & Sign" button |
| 3.4 | Reopen the signing link after signing | "This Link Is No Longer Active", with "Sign In to Your Portal" |
| 3.5 | Enter initials in lowercase | The stored and printed initials are uppercase (no CSS-only change) |
| 3.6 | Signed agreement record | `agreements.metadata` holds the template key, version and fingerprint; PDF, SHA-256 and archive behave as before |

## Sign-off

The owner records the Preview results. Publishing the candidate needs separate explicit approval.

For rollback, republish `14cbf81b`; see `RELEASE-A-ROLLBACK.md`.
