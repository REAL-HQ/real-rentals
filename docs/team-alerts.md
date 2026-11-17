# Team Alerts (Dolmar, t299s1618)

One email to team@drivereal.com (anytime) and one text. For `bot_handoff`,
the text follows staff coverage: the other company Quo line during Rosa's
hours, or the field-rep numbers from the Pickup Schedule settings otherwise
(docs/staff-coverage.md). Injuries also go to the field rep at any hour.
GPS, late pickup and overnight roadside still text the field-rep numbers.
Alert code never takes a phone number from a renter, an applicant or a
request, and removes anything shaped like a phone number from the alert text.

| Kind | When | Built in |
| --- | --- | --- |
| `gps` | Outside the service area (more than 100 miles from Tampa), tracker offline (no signal for 24 hours), no movement 48 hours | docs/gps-alerts.md |
| `roadside_overnight` | A roadside request (portal Roadside form, or a bot) between 6 PM and 6 AM ET, until a tow partner is added (D17) | driver-issue-alert.server.ts, fleet-team-alert.server.ts |
| `late_pickup` | A reservation released 30 minutes after a missed pickup (Dolmar t309u; was 15) | late-pickup.server.ts — always sent when "Late Pickup Release" is on (that switch governs it; a release never happens without telling staff) |
| `bot_handoff` | A bot hands a person to staff: complaint, injury, payment dispute, asked for a person, outside the approved templates, no answer in 15 minutes (D29) | fleet-team-alert.server.ts |

Switch: `app_settings.team_alerts` = `{ "<kind>": { "enabled": true|false } }`.
**Every kind is off** until Dolmar approves it (`proposed/team-alerts-v1.sql`
creates the table and the all-off row; `proposed/team-alerts-on.sql` turns kinds on).
No row, a malformed row, or an unreadable row is off.

Each alert is claimed once in `public.team_alert_sends` (key = kind + dedupe
key) before anything is sent. No table: nothing is sent.

## Bots: `POST /api/public/fleet/team-alert` (Bearer FLEET_API_KEY)

```json
{ "kind": "bot_handoff", "reason": "payment_dispute", "summary": "Says he was charged twice for this week",
  "lead_id": "…", "dedupe_key": "<quo message id>" }
{ "kind": "roadside_overnight", "summary": "Flat tire on I-4 eastbound, not drivable", "rental_id": "…" }
```

`roadside_overnight` is refused (409) from 6 AM to 6 PM ET. Reply
`{ ok, key, status: sent | partial | duplicate | off | failed | no_table }`.

## Approved applicant to call (`kind: "applicant_approved"`, Nov 17 2026)

FLEET texts an approved applicant that a team member will reach out, then:

```
POST /api/public/fleet/team-alert   (Bearer FLEET_API_KEY)
{ "kind": "applicant_approved", "lead_id": "<application id>",
  "line_id": "<PN id of the line FLEET texted them on>",
  "approval_texted_at": "<ISO time of that text>" }
```

- Text: during Rosa's hours to the other company Quo line (she picks it up in
  Quo); otherwise to the field-rep numbers (Dolmar). Only 8 AM-9 PM ET;
  outside that the alert is email-only, and calling again in the daytime sends
  the text once.
- Email: team@drivereal.com always, plus rosa@drivereal.com during her hours.
- One alert per lead. Off until `team_alerts.applicant_approved` is on
  (proposed/team-alerts-applicant-approved-on.sql).

## Wording (all kinds)

Subject: `<STATUS>: <First Last> - <Action>`. Text: `REAL: <subject> <link>`.

| Kind | Subject |
| --- | --- |
| applicant_approved | APPROVED: Briana Palmer - Call To Review Terms |
| bot_handoff complaint | COMPLAINT: <Name> - Call Back |
| bot_handoff injury | URGENT INJURY: <Name> - Call Now |
| bot_handoff payment_dispute | PAYMENT DISPUTE: <Name> - Call Back |
| bot_handoff asked_for_person | ASKED FOR A PERSON: <Name> - Call Back |
| bot_handoff outside_templates | NEEDS A PERSON: <Name> - Reply To Them |
| bot_handoff no_answer | UNANSWERED: <Name> - Reply To Them |
| roadside_overnight | AFTER-HOURS ROADSIDE: <Name> - Call Now |
| gps | GPS OFFLINE / GPS OUTSIDE AREA / GPS NO MOVEMENT 48H: <Unit> - Check Tracker |
| late_pickup | PICKUP RELEASED: <Name> - Rebook If Needed |

The email body: the subject as heading, one gray status line where there is
one (approved: "Approval texted 9:38 AM · No reply yet · Agreement not sent"),
the details once, then buttons. The approved email has a tap-to-call button
built from the application row; the number never goes in a subject or a text.
Phone numbers in free text are removed without a placeholder.
