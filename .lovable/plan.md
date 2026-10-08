# Unified Applicant Access — Architecture Audit & Plan

Status: audit only. Nothing implemented, migrated or published. The Application Resume repair stays a separate release.

## 1. What exists today (audited)

| Area | Finding |
|---|---|
| Applicant records | 59 active applications. Each one is a record, not a login. Only 1 is linked to a sign-in account (`applications.user_id`). |
| Sign-in accounts | 3 accounts in total, with 1 Driver role. Roles live in their own table and are checked on the server. |
| Driver Portal sign-in | Email + password only (`/login`, `/set-password`, password-reset email). No passwordless option. |
| When accounts get created | Only when staff approve or activate a rental (`provisionDriverAccount`). It looks up or creates the account by email and grants Driver. It already refuses to take over an application owned by a different email, or an account someone registered early with an applicant's email. |
| Applicant access before approval | Resume links: a stored hash, 14-day expiry, reusable (39 live today), and not tied to any account. They grant only the application and upload screens. |
| Staff links | Use the same 14-day reusable link. Owner/Manager send them. |
| Waitlist | 16 entries, 15 linked to an application through `promoted_application_id`. Holds are separate and append-only. |
| Becoming a renter | Approved → account set up + set-password email → rental starts through the atomic rental steps. Signing an agreement never grants portal access. |
| Email | Sends are logged per message. 21 sends in the last 30 days, 0 bounces or failures recorded. Past problems were Spam/Promotions placement, not delivery failures. The From address is not changed until the domain is verified. |
| SMS | No working texting provider. Quo is not connected yet. Opt-in is optional and transactional only. |
| Duplicate risk | 3 email addresses and 2 phone numbers appear on more than one application. Phone and email are not proof of who someone is. |

## 2. Proposed unified identity

```text
One person = one sign-in account (email) = one or more applications
Lead -> Waitlist -> Applicant -> Approved -> Active Driver
       (the same account the whole way; roles and stages change, never the login)
```

- **Start without registering:** the form creates the application exactly as it does now. No account and no password.
- **Account created quietly:** at the first verified step, a passwordless account is set up for the email on file and linked through `applications.user_id`. A verified step means the applicant clicks a link sent to that email.
- **One sign-in method for everyone:** the Driver Portal sign-in gets a "Email Me A Sign-In Link" option (one-time code or link, short-lived). It uses the existing sign-in system, so there is no second login system. Password sign-in stays optional for current drivers.
- **What each stage can see:** the portal decides on the server from the person's linked application stage and roles. Applicant and Waitlist see Application, Documents and Status. Approved and Active also see Rental, Payments and Agreements. Roles are still granted only when staff approve.
- **Resume links become entry points:** clicking a valid resume link proves control of the inbox, signs the person in and links the account. Existing 14-day links keep working until they expire. New ones are short-lived and single-use.
- **Staff links** use the same single-use sign-in link. Only Owner and Manager can send them, and every send is recorded in the audit log.

## 3. Security and duplicate rules

- Accounts are linked only by a verified email click. A typed email or phone never links anything.
- If an email already belongs to an account linked to a different application, staff review it. This reuses the existing refusal path.
- The 3 duplicate-email and 2 duplicate-phone groups go to a staff review list. No automatic merging.
- A person with no verified email can still finish the application through resume links. The account is set up at approval, as it is today.
- Public sign-in screens give the same answer whether or not an email matches, with rate limits on email and IP.
- Driver Preview and Experience preview stay view-only.

## 4. Email deliverability

- Codes as well as links: a 6-digit code in the email works even when link scanners or Spam filters break the link.
- Show truthful send status (reusing the resume repair), the retry countdown, and Spam/Promotions guidance.
- Texted codes come later, only once an SMS provider is approved. The design leaves room for them.
- No sender or Reply-To changes until the domain is verified.

## 5. Phased rollout (each phase needs your approval)

1. **Passwordless portal sign-in:** add the sign-in link and code to the existing portal sign-in. No data changes.
2. **Applicant portal view:** stage-based screens for not-yet-approved applicants, with server checks on every read and write.
3. **Account linking on verified click:** a resume link click or verified sign-in sets up and links the account. New single-use links; old links honoured until they expire.
4. **Staff tools:** single-use staff links, audit records and the duplicate review list.
5. **Existing records:** a dry-run report first. No existing records are changed until you approve.

## Technical details

- Reuse `provisionDriverAccount`'s safeguards, split into "link identity" and "grant driver role".
- Add an applicant flag to the portal context (no new role) so applicant access never depends on what the browser claims.
- Possible additions to the database: a link-audit table and an index on lower(email). Additions only, no destructive changes.
- Tests: role-context tests (Owner/Manager/Coordinator/Driver/Applicant/signed-out), cross-applicant access attempts, link replay and expiry, duplicate-email conflicts, desktop and mobile.

## Decisions needed

- Passwordless sign-in for everyone, or keep passwords as an option for existing drivers?
- Codes only, links only, or both (recommended)?
- Should Waitlist-only leads (no application) get portal access, or only once they apply?
