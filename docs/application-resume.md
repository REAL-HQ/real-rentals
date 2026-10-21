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

`useResumeToken` (`src/lib/resume-token.ts:79`) copies a `t` query param into `sessionStorage` and strips it from the address bar. On `/apply` the stash is ignored while the flag is off (`src/routes/apply.tsx:79`), so a shared device does not reopen the previous person's form. A `t` on `/apply` redirects to `/thank-you` (`src/routes/apply.tsx:88`).

`/thank-you` calls `openResumeLink` (`src/lib/applications.functions.ts:1428`), which runs `exchangeResumeToken`, then mounts `ApplicationWizard`.

`getApplicationForWizard` (`src/lib/applications.functions.ts:922`) loads the row by token and returns the answers the wizard shows: name, city, rental, driving, address, and document presence. It does not return storage paths, the policy number in full, email, phone, or the application id. The wizard copies that payload into its form and opens `phaseFrom(current_step)` (`src/components/site/ApplicationWizard.tsx:88` and the load effect at `:331`). Uploads show as already on file (`ApplicationWizard.tsx:1196`). That is the prefill.

A signed-in applicant can read their own row when `applications.user_id` equals `auth.uid()` (`supabase/migrations/20260713042527_1ae06c72-8a4f-4ca4-9c38-69778f0ff24f.sql:37`). That policy is SELECT only. The account link is written when a driver account is created (`src/lib/driver-account.server.ts:197`). Until that link exists, RLS returns no row. There is no applicant endpoint that mints a resume token from a login.

## What the flag turns on

`APPLICATION_RESUME_ENABLED` lives in `src/lib/application-resume.ts` and is duplicated in `src/routes/index.tsx`, `src/routes/apply.tsx`, and `ApplicationWizard.tsx`. The routes do not import the module until `!== true` has returned.

With the flag on:

- A signed-in applicant's own draft is read with the RLS select above (`application-resume-client.ts`, `.eq("user_id", uid)`, explicit columns). The signed-in row wins over a token left in the tab.
- Otherwise this tab's resume token is read with `getApplicationForWizard`. That is the existing resume endpoint. No new token is minted.
- `/` and `/apply` show "Continue Your Application" with step X of 4 and the missing documents. The four steps are Your Info, Rental, Driving, and Documents. A step is incomplete when the same fields the wizard requires are empty. Documents match the wizard's five sections: Driver's Licence (photo and a valid answer), Insurance, Gig Profile, Trip History, and Your Address.
- A token in this tab opens `/thank-you`, and the wizard starts on that first incomplete step with the saved answers and upload presence filled in. It does not write `current_step` just by opening.
- A signed-in applicant with no token sees the same progress and the saved answers on `/apply`. The screen does not send email or SMS and does not call `savePartialApplication`.

Closed statuses (`approved`, `active`, `suspended`, `declined`, `closed`, `duplicate`, `complete`) and a finished document set do not get a banner.

## Gaps

- Saving another answer still requires a resume token. Login plus RLS can show the draft. It cannot call `updateApplicationStep`, and this change does not add a writer or send the recovery email.
- `getApplicationForWizard` does not return `status`, so a token for a decided application can still show a banner when answers are incomplete. The existing upload endpoint already refuses decided applications.
- `user_id` is null on a draft until a driver account is linked, so most anonymous applicants are invisible to the signed-in read until then. Their path remains the resume link.
- The flag-on stash read on `/apply` will open whatever application this tab's token belongs to. The flag-off page does not.
