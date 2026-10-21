# Application Resume

How a draft is saved and opened today, and what `APPLICATION_RESUME_ENABLED` adds on top. The flag is a hard `false` constant. With it off, `/` and `/apply` do not load the resume module and do not render the banner.

## How a draft is saved today

`/apply` collects name, phone, and email, then calls `savePartialApplication` (`src/routes/apply.tsx:216`). City landing pages call the same function (`src/components/site/CityHeroLeadForm.tsx:139`).

`savePartialApplication` (`src/lib/applications.functions.ts`, `export const savePartialApplication`) is anonymous. It looks up an existing row with two `.eq` queries, one on phone and one on email. It does not interpolate those values into a filter string.

- A matching email does not return a resume token and does not copy the submission onto the row. It records the attempt and sends the recovery email that already existed (`sendRecoveryLink`, `src/lib/applications.functions.ts:198`). A phone match with a different email is filed for staff review and sends nothing.
- No match inserts one row with `status: "partial"` and `current_step: "rental"` (`src/lib/applications.functions.ts:537`), then `issueResumeToken` (`src/lib/resume-tokens.server.ts:84`). The plaintext token is returned once. The browser navigates to `/thank-you?t=…`.

Later answers are saved by `updateApplicationStep` (`src/lib/applications.functions.ts:588`). The body carries the resume token, not an application id. `resolveResumeToken` turns the token into the row. The wizard autosaves the fields on the rental and driving steps (`src/components/site/ApplicationWizard.tsx:312`, using `fieldsFor` at `:100`) and writes the step when the applicant presses Next (`src/components/site/ApplicationWizard.tsx:385`). Part 1 landing on `submitted` promotes `partial` to `new`. Part 2 writes licence, insurance, gig, trip, and address fields, and registers uploaded files. Those are the only applicant writes.

## How a draft is resumed today

The credential is a hashed resume token (`application_resume_tokens`). `issueResumeToken` mints it (`src/lib/resume-tokens.server.ts:84`), `resolveResumeToken` checks a live token (`src/lib/resume-tokens.server.ts:167`), and `exchangeResumeToken` swaps a single-use recovery link for a session token (`src/lib/resume-tokens.server.ts:203`).

`useResumeToken` (`src/lib/resume-token.ts:79`) copies a `t` query param into `sessionStorage` and strips it from the address bar. On `/apply` the stash is ignored (`allowStashed: false` in `src/routes/apply.tsx`), whether or not the flag is on, so a shared device does not reopen the previous person's form. A `t` on `/apply` redirects to `/thank-you`.

`/thank-you` calls `openResumeLink` (`src/lib/applications.functions.ts:1428`), which runs `exchangeResumeToken`, then mounts `ApplicationWizard`.

`getApplicationForWizard` (`src/lib/applications.functions.ts:922`) loads the row by token and returns the answers the wizard shows: name, city, rental, driving, address, and document presence. It does not return storage paths, the policy number in full, email, phone, or the application id. The wizard copies that payload into its form and opens `phaseFrom(current_step)` (`src/components/site/ApplicationWizard.tsx:88` and the load effect at `:331`). Uploads show as already on file (`ApplicationWizard.tsx:1196`). That is the prefill.

A signed-in applicant can read their own row when `applications.user_id` equals `auth.uid()` (`supabase/migrations/20260713042527_1ae06c72-8a4f-4ca4-9c38-69778f0ff24f.sql:37`). That policy is SELECT only. The account link is written when a driver account is created (`src/lib/driver-account.server.ts:197`). Until that link exists, RLS returns no row. There is no applicant endpoint that mints a resume token from a login.

## What the flag turns on

`APPLICATION_RESUME_ENABLED` is declared once in `src/lib/application-resume-flag.ts`. Routes, the wizard, the waitlist panel, and portal access import that file. They do not import `application-resume.ts` until `=== true`.

With the flag on:

- A signed-in applicant's own draft is read with the RLS select above (`application-resume-client.ts`, `.eq("user_id", uid)`, explicit columns). A token left in the tab is not read. `/apply` keeps `allowStashed: false`.
- `/` and `/apply` show "Continue Your Application" with step X of 4 and the missing documents when that signed-in row is an open draft. The four steps are Your Info, Rental, Driving, and Documents. A step is incomplete when the same fields the wizard requires are empty. Documents match the wizard's five sections: Driver's Licence (photo and a valid answer), Insurance, Gig Profile, Trip History, and Your Address.
- An explicit resume link still opens `/thank-you`. With the flag on, the wizard starts on the first incomplete step with the saved answers and upload presence filled in. It does not write `current_step` just by opening. The banner does not send the visitor there from a stashed token.
- A signed-in applicant with no token sees the same progress and the saved answers on `/apply`, plus **Continue**. Continue calls `openMyApplication`, which mints a token for that account. It does not read the tab stash. The screen does not send email or SMS and does not call `savePartialApplication`.

Closed statuses (`approved`, `active`, `suspended`, `declined`, `closed`, `duplicate`, `complete`) and a finished document set do not get a banner.

## Waitlist promotion

From the live-path note in draft #166 (`docs/waitlist-current-state.md` on `74099fa8`). No new SQL and no email.

Promote already mints a resume token when it creates an application, and only then (`src/lib/waitlist.functions.ts`, `issueResumeToken`). Linking an existing application returns `token: null` and does not mint a second credential. With the flag on, a successful mint is shown once as **Resume Link For {name}** with **Copy Link**. `resumeLinkForPromotion` returns nothing when the promotion failed, needs identity review, minted no token, or has no name, and the panel clears any previous link before the request. The page does not send email or SMS. The plaintext is not stored.

The portal used to hide a promoted waitlist row (`src/lib/portal-access.functions.ts`, the `!promoted_application_id` filter) and send a verified person with no `user_id` application to bare `/apply` (`src/components/portal/ApplicantHome.tsx:50` and the waitlist card at `:190`). That starts a second application. `openMyApplication` only looked up `user_id` (`portal-access.functions.ts` `openMyApplication`).

With the flag on, a verified email whose waitlist row already has `promoted_application_id` sees that application only when `linkVerifiedApplication` would link it: exactly one unowned application for the email, no row owned by somebody else, and the promoted id is that row. `promotedApplicationLinkAllowed` is that refusal. A `review` result does not show the application and `openMyApplication` throws before `issueResumeToken`. When the linker does attach the row, **Continue Application** still calls `issueResumeToken` for the `user_id` application, the same write it already did. The portal does not call `promote_waitlist_entry` and does not insert an application. An unpromoted signup still has **Start My Application**.

## Gaps

- Saving another answer still goes through `updateApplicationStep` with the token `openMyApplication` just minted. This change does not add a second writer or send the recovery email.
- `getApplicationForWizard` does not return `status`, so a token for a decided application can still show a banner when answers are incomplete. The existing upload endpoint already refuses decided applications.
- `user_id` is null on a draft until a driver account is linked, so most anonymous applicants are invisible to the signed-in read until then. Their path remains the resume link.
- A resume token left in the tab does not open an application on `/` or `/apply`. `/apply` keeps `allowStashed: false` with the flag on. `/thank-you` still stashes a token that arrived in the URL so the wizard survives the address-bar strip and a refresh of that page.
- The admin copy link exists only for a promotion that created an application and only with that applicant's name. A failed or review result clears it. Linking an existing application does not mint a token. Leaving the screen drops it.
- The portal does not continue a promoted application that identity review would refuse, that is deleted, whose email no longer matches, or whose `user_id` belongs to someone else. It also does not promote a still-waiting signup, so **Start My Application** on that card still opens `/apply`.
- While the promoted application is the portal card, another unpromoted signup for the same email is not shown.
