# Missing-Items Outreach

Tells applicants exactly what they still owe us, with their private 14-day
upload link, so staff don't have to chase them. Built Off. Nothing sends until
an Owner turns a switch on in Back Office → Automations.

## What counts as missing (applicant-fixable only)

| Key | Email wording | When |
|---|---|---|
| application_details | A few quick answers about the car you want (about 2 minutes) | Rental or Driving page never answered (vehicle, pickup date, duration, gig status, full/part time) |
| license_front | A photo of the front of your driver's license | No current, non-rejected license_front document or upload |
| gig_profile | A screenshot of your gig app profile showing your rating and your number of trips or deliveries | Same, gig_profile |
| income | Proof of income from gig work or any other source, like a recent earnings summary, pay stub, or bank statement. This just helps us make sure the rental is a good fit and comfortable for your budget. | Same, income (new wizard upload) |

A current, non-rejected trip-history / gig earnings screenshot (vault category `trip_history`, or a saved `applications.trip_screenshots` path) counts as proof of income (Dolmar, t306s1653): those applicants are never asked for income.

Never asked: date of birth and license expiry (FLEET reads them from the
license photo), license back (optional), insurance (included), background check or
MVR (staff only), address and trip screenshots (not required by FLEET's review).

## Insurance line

Every message says insurance is now included in the weekly rental (step 1 opens
with it; reminders and the auto-close note carry one short line). Approved
wording only (`INSURANCE_LINE_*` in missing-items.ts): never "no extra cost" or
"no surprise fees", never a broker or carrier name. Copy lives in code, not
app_settings, so changing it needs a publish.

## Who

Statuses `new` and `reviewing` (configurable). Never partial (the Unfinished
Application emails cover it), complete, declined, closed, duplicate, approved,
active or suspended; never merged duplicates, legal holds, deleted or
disqualified applicants. Skipped while the New Applicant Follow-Up is running for
them, or if anything was sent to them in the last 48 hours (this covers the Step
1 thank-you and the gig-screenshot follow-up, which log to outbound_messages).

Email: anyone with a valid address. SMS: only with `sms_consent = true`, a valid
US number, no `sms_opt_out_at` and not in `sms_opt_outs`; sent by `sendSms`
(default sender: the 888 line), which re-checks consent and STOP. All texts end
"Reply STOP to opt out." Sends only 9 AM–8 PM ET.

## Ongoing schedule (switch "Missing Items Follow-Up", key missing_items_outreach)

Runs inside the 5-minute automations cron. It never starts a new sequence
(message 1) until the one-time message has gone out: at least one backfill row
in `applicant_outreach_log` and the One-Time switch back Off. Applicants who got
the one-time message are not re-chased for the same missing set; they move to
Auto-Close 14 days later. Defaults (app_settings
`missing_items_outreach`):

| Setting | Default | Meaning |
|---|---|---|
| waitHours | 24 | Hours since the applicant's last activity before message 1 |
| reminderDays | [3, 7] | Message 2 and 3, days after message 1; then it stops |
| minGapHours | 48 | No message if we sent them anything in this window |
| maxAgeDays | 60 | Don't start a sequence for older applications |
| maxSequences | 2 | A changed missing set starts a new sequence, at most twice |
| statuses | ["new","reviewing"] | Eligible statuses |
| email / sms | true / true | Channels |
| batchLimit | 25 | Per 5-minute run |
| smsHours | [9, 20] | ET sending window (both channels) |
| backfillMaxAgeDays | null | Optional age cap for the one-time message |
| autoCloseDays | 14 | Auto-close: days with no reply after the last message |

## One-time message (switch "Missing Items Message (One-Time)", key missing_items_backfill)

`POST /api/public/fleet/missing-items` (Bearer FLEET_API_KEY):

- `{"action":"preview"}` — dry run: counts, channel split, counts by item,
  ages and 3 redacted samples. Sends and writes nothing.
- `{"action":"backfill","confirm":"send-once","limit":50}` — sends message 1 to
  the next batch. Refused (409) unless the One-Time switch is on. Repeat until
  `eligible` is 0, then switch it off.

Once-only is enforced by the database: `applicant_outreach_log` has a unique
index allowing one `backfill` row per application, and every send is claimed
(inserted) before anything goes out. An applicant who got the one-time message
is not chased again by the ongoing rule for the same missing set.

## Auto-close (switch "Missing Items Auto-Close", key missing_items_autoclose)

No reply within autoCloseDays (14) of the LAST message (step 3, or the one-time
message) → status Closed (never Declined) and one "come back anytime" email/text
with their resume link. A reply is any sign of life after that message: the
link opened (application_resume_tokens.last_used_at), an upload (documents), an
inbound Quo event, or an inbound text from their number. Recorded in
`applicant_autoclose` (one open row per application). Opening the link reopens
the application to its prior status (only our own close; a staff close or
decline is never reopened). While the switch is on, the last message says
"If we don't hear from you in the next 14 days, we'll close your application."

## After they upload

The wizard writes the file path; `syncApplicationUploads` mirrors it into
`documents` (income → category `income`). FLEET's applicant list is computed
live, so the next `GET applicants` shows the new files and drops the
missing-income escalation. `sweepReadyForReview` fires the
ready-for-review alert the first time license front and gig profile are both on
file.

## Files

- `supabase/migrations/20261116040000_missing_items_outreach.sql` (column, log table, settings)
- `proposed/missing-items-outreach-switches.sql` (switches by SQL; the Automations page does the same)
- `src/lib/missing-items.ts` (rules and copy), `src/lib/missing-items-outreach.server.ts` (engine, FLEET endpoint)
