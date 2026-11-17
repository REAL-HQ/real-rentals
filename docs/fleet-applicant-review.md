# FLEET: Review And Approve Applicants

FLEET reviews submitted applicants, approves the clean ones, and sends the rest
to staff. FLEET can never decline. Every call uses the same key and contract as
the payment-text pause:

- `POST`, `Content-Type: application/json`
- `Authorization: Bearer <FLEET_API_KEY>`
- Replies are JSON with `ok`. Errors: `400` bad input, `401` wrong key, `404` not
  found, `409` refused (blockers, or a conflicting idempotency key), `503` not
  configured or the database could not be read.

## 1. List applicants awaiting review

`POST https://drivereal.com/api/public/fleet/applicants`

```json
{ "action": "list", "ready_only": true, "limit": 50 }
```

"Awaiting review" means stage New, Reviewing or Complete, not deleted and not a
duplicate. With `ready_only` (the default) only applicants with the required
documents on file and no open Needs Staff flag are listed.

The required documents depend on the gig answer (`hardDocCategoriesFor`):

| Gig answer | Required before review |
| --- | --- |
| "Yes, already driving" (or blank) | license front + gig-profile screenshot |
| "Not yet, ready to start", "No", "Pending" | license front + proof of income (an income document or a trip/earnings screenshot) |

Until Nov 16 2026 the gig-profile screenshot was required from everyone, so
applicants who are not driving yet (and have no gig profile) never appeared
in this list and never got the alert. `ready_only: false` shows them with
`docs_missing` (usually `income`).

Reply: `{ ok, total, rows: [{ lead_id, name, status, applied_at, ready_for_review,
needs_staff_open, recommendation, hard_blockers[], escalations[], docs_missing[],
no_track_record, admin_url }] }`. The list is a summary; `get` is authoritative.

## 2. Get one applicant's review packet

```json
{ "action": "get", "lead_id": "…", "include_urls": false }
```

Reply `{ ok, packet }` with:

| key | what |
|---|---|
| `contacts` | every phone and email on the profile (`phones[]` / `emails[]`, with `is_primary`, `receives_messages`, and `sms_ok` per number). `answers.phone` / `answers.email` stay the primary |
| `answers` | the application answers (license number masked to the last 4; payment ids, consent text and card ids left out) |
| `documents[]` | every current vault document: category, file name, type, size, `review_status`, review note, upload time, expiry. `url` is null unless `include_urls: true`, then a signed link valid for 15 minutes (the back office's own signer) |
| `gig_evidence` | platforms, gig status, trips, rating, screenshot counts, gig-profile and trip-history document counts |
| `screening` | the staff screening record as recorded, or null |
| `checks` | `background_check_status`, `mvr_status`, `incident_count` as recorded |
| `insurance` | answer, status, coverage, whether a carrier and a document are on file, and `insurance_verified_by_staff`. Reported as recorded: nothing here is verified unless that last field is true |
| `analysis` | the application score (`ai_score`, `ai_tier`, `score_flags`, `score_summary`) and the readiness model (state, coverage, disqualifiers, attention, unknown) |
| `agreements[]` | status of any rental agreements |
| `fleet_review` | the open Needs Staff flag (if any) and past FLEET decisions |
| `readiness_blockers` / `assessment` | hard blockers, the default escalation checklist, notes, and `recommendation` (`approve`, `needs_staff` or `not_ready`) |

## 3. Decide

`POST https://drivereal.com/api/public/fleet/applicant-decision`

```json
{ "lead_id": "…", "decision": "approve", "reason": "Clean: 2,400 trips, 4.95, docs on file",
  "escalation_codes": [], "idempotency_key": "review-<lead_id>-1" }
```

- `decision` is `approve` or `needs_staff`. `decline` is refused (`400`): send
  `needs_staff` with the reason and staff decide.
- `reason` is required (5 to 1,000 characters). `escalation_codes` is optional
  (the checklist codes FLEET relied on).
- `idempotency_key` is optional. A repeat returns the first result with
  `duplicate: true`. Approving an already-approved applicant is also a no-op.
- `approval_text_sent: true` (optional, SOP D30): FLEET has sent its own
  approval text (P12), so the Approval Confirmation email is skipped
  (`approval_email: "bot_text"`). Without it the email goes as before.

**approve** runs the exact code path staff use when they press Approve:
the same status change, the `application.approved` audit entry (labelled
"FLEET (automated)" with the reason), the Stripe customer, and the one-time
Approval Confirmation email. It does not send an agreement and does not create
a login; those stay with the agreement and Reserved steps. It is refused (`409`
with `hard_blockers`) while any hard blocker exists. It never changes
insurance, screening, background-check or verification fields.

If the approval security package is ever installed on the database (it is not
today), approval needs a staff sign-in and FLEET's approve answers `409`; send
`needs_staff` instead.

**needs_staff** opens a flag that shows on the applicant as a red Needs Staff
badge and banner, and under Drivers → filter menu → Needs Staff. One open flag
per applicant (a repeat returns it). While it is open FLEET cannot approve that
applicant; a Manager clears it with Mark Handled after deciding.

Reply `201`: `{ ok, decision, lead_id, decision_id, admin_url }` (approve also
returns `approval_email`).

## Hard blockers (approve refused)

Not submitted (Partial), a stage other than New/Reviewing/Complete, already
approved, deleted, legal hold, a duplicate, no email, a missing required
document (license front, plus the gig-profile screenshot for gig drivers or
proof of income for applicants not driving yet), a document staff rejected and nobody
replaced, any readiness disqualifier (under 21, license not active, DUI, gig
account deactivated, card not in the driver's name, insurance name mismatch,
license reported invalid), screening marked disqualified, a background or MVR
result recorded as failed/flagged/consider, under 21 by date of birth, expired
license, and an open Needs Staff flag. With the RentID switch on
(`docs/fleet-rentid.md`), both checks must also be recorded as passed.

### Not driving for a gig app yet (Dolmar, t339u)

"Not yet" is no longer a reason to send to staff by itself. The 100-trip /
4.0-rating bar cannot apply to someone with no trips, so for these applicants
(`no_track_record: true`) it is replaced, not waived:

- proof of income is a required document (hard blocker `missing_income`);
- approve is strict: the server refuses it (409, with the escalations) while
  ANY escalation exists. So FLEET can approve only when the date of birth is on
  file and the driver is 25+, the license expiry is on file and more than 30
  days out, there are no analysis flags, no earlier declined/closed
  application, readiness is not Needs Attention, and background/MVR are
  pending or passed;
- a gig rating they do report still escalates if under 4.0.

Gig drivers are unchanged: escalations stay FLEET's call.

## Default escalation checklist (proposed; FLEET decides)

Send `needs_staff` when any of these is true:

1. Income proof missing (gig drivers: requested from the applicant, a note;
   not driving yet: a hard blocker).
2. Driver under 25, or no date of birth.
3. License expires within 30 days, or no expiration date.
4. Gig rating under 4.0, or fewer than 100 trips (Dolmar, Nov 16 2026; was 200).
   Unknown trips or rating: FLEET confirms 100+ and 4.0+ on the gig
   screenshot before approving, otherwise sends to staff.
5. The gig account is deactivated. (Not driving gig yet is no longer an
   escalation by itself; see "Not driving for a gig app yet".)
6. The application analysis raised flags.
7. Readiness says Needs Attention.
8. Applied more than once, or an earlier application with the same phone or
   email was declined or closed.
9. A background or MVR value other than pending/passed. A flagged, failed,
   "consider" or declined result is a hard blocker and always goes to staff
   (`screening_flagged: true`, `recommendation: needs_staff`); a clear result
   with the gig bar met FLEET may pass (Dolmar, t299s1618).
10. Insurance name does not match the license — only if staff recorded a
    personal policy whose name does not match. Renter insurance is not
    required (Real Rentals provides it). "No insurance" or "no full coverage"
    is never a flag, a blocker, or a missing item, and nobody is marked
    insured from this rule.
11. Anything in the documents or answers that does not line up (names, photos,
    screenshots), or anything FLEET is unsure about.

Notes (reported, not escalations): no screening interview yet (the call happens
after approval today), documents not yet reviewed by staff, unknown trip count,
and background/MVR still pending.

## Alert: application_ready_for_review

Sent once per applicant the first time they are submitted (New, Reviewing or
Complete) with the required documents on file (license front plus the
gig-profile screenshot, or plus proof of income when not driving yet). The every-minute FLEET cron looks at applications updated, and documents
added, in the last 3 hours. Payload: `lead_id, name, phone, email, stage,
applied_at, ready_at, next, admin_url`. Applicants who were ready before this
shipped do not get an alert; use `list`.

## Storage

`public.fleet_review_decisions` (`proposed/fleet-applicant-review-v1.sql`):
`application_id, decision (approved | needs_staff), reason, escalation_codes,
assessment, decided_by, idempotency_key, created_at, resolved_at, resolved_by,
resolution_note`. Only the server writes; staff can read.

## Changes (Nov 16, 2026, t298s1611)

- FLEET saves the date of birth and license expiry it reads off the license
  photo through `/api/public/fleet/license-facts` (docs/fleet-license-facts.md),
  labelled "Read by FLEET from license photo", never verified.
- Missing income proof no longer escalates (note `requested_income`).
- `resubmitted` is a note; only `prior_declined` (an earlier declined or closed
  application) escalates.
