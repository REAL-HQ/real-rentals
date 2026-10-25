# Post-S1 candidate: read-only Preview review and real-device checks

**Candidate (revised A.1):** `release/post-s1-rc2` @ `4a0eed9c`, tree `0c00c2e5…`, review PR #281. It contains PR 1 → PR 4 → PR 3 → #278. The original reference candidate is #276 (`700e7bcc`).

**The Lovable Preview runs on the production database.** Every check below is read-only. Do not type into
the application form, submit, approve, sign, void, upload or delete anything. The behaviour that needs
writes was already verified on the local synthetic stack (`POST-S1-READINESS-2026-10-25.md` §3,
evidence in `post-s1-e2e-2026-10-25/results.json`). Those results stay the record for it.

## 0. Approval needed first

Pointing the Preview at the candidate means updating the production-connected branch
`integration/grok-baseline-2026-10-22` from `14cbf81b` to `4a0eed9c`. **That needs explicit Owner
approval.**

- That branch is also what the next Publish ships, so between the Preview update and either Publish
  or a revert, nobody may click Publish without approval.
- **Revert:** move the branch back to `14cbf81b` (rollback refs in `RELEASE-A-ROLLBACK.md`). The live site
  stays on deployment `8818c842` (14cbf81b) until a separate Publish approval.
- **Database:** the candidate contains no migration, so the Preview update changes no database state.
  - Before and after the update, the read-only watch (`release-a-watch-readonly.sql`) must show the same
    23 Drizzle and 105 Supabase migration receipts and 170 policies.
  - Any change is an immediate **stop**: revert the branch and report.

## 1. Read-only Preview checks (production-backed; no writes)

| # | Check | How (read-only) | Expected |
|---|---|---|---|
| P1 | Build identity | Page source `data-commit-sha` | `4a0eed9c…` |
| P2 | Public pages | Load home, /apply (**do not type**: the first keystroke creates a `partial` row), /portal sign-in | Load; no new console errors compared with Release A |
| P3 | Back office | Owner: Drivers list, a driver drawer, Documents tab | Load as before |
| P4 | Signed agreement cannot be deleted | Open the Documents tab of a driver who already has a signed agreement. **Look only.** | No Delete action on the signed-agreement card; ordinary documents still show Delete |
| P4b | Signed agreement is a permanent record (#278) | Same card as P4. **Look only.** | Shows "Permanent Record"; no Replace and no Needs New on the signed-agreement card. Ordinary documents still show Replace. |
| P5 | Dead signing link | Open `/sign/not-a-real-token` | "This Link Is No Longer Active" with "Sign In to Your Portal"; no form. An unknown token reads nothing and writes nothing. **Never open a real customer signing link**: opening an unopened one marks it viewed and writes an audit row. |
| P6 | Voided agreement in the portal | Only if a voided agreement already exists. Staff Driver Preview of that driver. | "Cancelled · No Action Needed", no "Review & Sign" |
| P7 | Contract date format | Only if a Manager can open an existing agreement or preview **without** pressing Send | Dates read "Oct 11, 2026" |
| P8 | Monitoring | Read-only watch before and after | Unchanged apart from organic activity |

**Notes on P6 and P7:**
- **P6:** Driver Preview writes one audit row by design (Manager+, audited). That is normal staff activity; skip it if you want zero writes.
- **P7:** if preview generation stores anything, skip P7. It is already covered locally (rows 3.1 and 3.2).

**Not checkable read-only. Covered by the local run, then confirmed after Publish:**

| Behaviour | Why it can't be checked on Preview | Local evidence | After Publish |
|---|---|---|---|
| Resume lock on decided applications | Needs a resume link | Rows 1.1–1.3 | Watch for support contacts |
| Save, retry and 14-day sessions; recovery single use and 30-minute expiry | Needs typing and token minting | Rows 4.1–4.3, 4.7 | — |
| Reminder emails | Needs sends; the cron runs against the published site, not Preview | Rows 4.4–4.5 after the fix | First hourly run: no "claim failed" lines, and reminder-sent stamps appear |
| Initials stored uppercase | Needs signing | Row 3.5 | — |

## 2. Real-device checks (complete before Publish)

Run these on a physical iPhone (iOS Safari, current and previous major version) and Android phone
(Chrome). Use the **Preview URL**, read-only as above. Focus fields without typing in /apply.

| # | Check | Device | What's needed |
|---|---|---|---|
| D1 | Phone field shows the numeric keypad on focus (do not type) | iOS + Android | Real keyboard |
| D2 | Email and name fields offer native autofill suggestions on focus (do not accept) | iOS + Android | Real autofill sheet |
| D3 | No sideways scrolling on home, /apply, /sign/not-a-real-token, /portal sign-in, back office | iOS + Android | WebKit rendering; local emulation covered Chromium only |
| D4 | Sticky wizard footer and safe areas with the dynamic toolbar | iOS | Safe-area insets |
| D5 | Opening a link from the Mail and Gmail apps lands on the right page (use `/sign/not-a-real-token` in an email to yourself) | iOS + Android | In-app browsers |
| D6 | Cursive signature fonts render on the signing page (dead-link page shows the fonts load) | iOS + Android | Web fonts |

**Need writes, so they wait for a disposable hosted environment or a post-Publish natural occurrence.**
Do not create test applications in production.

| # | Check | Device | What's needed |
|---|---|---|---|
| D7 | Drawing a signature with a finger versus page scroll; rotating after drawing | iOS + Android | A real signature flow |
| D8 | Saving when iOS backgrounds the tab | iOS | A real save |
| D9 | Airplane-mode offline, then "Couldn't Save — Retry", then "Saved" | iOS + Android | A real save |

**Already proven locally** (Chromium device emulation at 320, 360, 390 and 412 px):
- layout without horizontal overflow;
- input types, `autocomplete` and `inputMode` attributes;
- touch drawing producing a stored signature.

## 3. After the review

Record P1–P8 and D1–D6 as PASS, FAIL or PENDING.

Publish needs its own approval:
- the deployment checklist is `RELEASE-A-PUBLISH-CHECKLIST.md`;
- rollback is a republish of `14cbf81b`.
