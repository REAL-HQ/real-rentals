# Staff Coverage For Handoffs

When a bot or FLEET hands a conversation to a person, calls and texts go to
Rosa DeJesus during her Real Rentals hours, and to Dolmar Cross the rest of
the time. Emails to team@drivereal.com can go anytime.

Hours are stored in `public.staff_schedules` and
`public.staff_schedule_exceptions` (America/New_York), not hardcoded in the
send path. Owners can edit the rows; staff can read them. The migration is
`supabase/migrations/20261117030000_staff_schedules.sql` (ships with this PR,
not applied until approved).

## Hours (seeded)

| Person | Role | Weekly windows (ET) | How to reach them |
| --- | --- | --- | --- |
| Rosa DeJesus | coverage | Mon 2:00–6:00 PM, Tue 9:00 AM–3:00 PM, Wed 9:00 AM–3:00 PM, Fri 9:00 AM–1:00 PM. Off Thu, Sat, Sun. | The other company Quo line |
| Dolmar Cross | after_hours, field_rep | (whenever Rosa is not on duty) | Pickup Schedule `notify.sms` numbers |

Windows are start-inclusive and end-exclusive: 2:00 PM is on; 6:00 PM is off.
An `off` exception (holiday) wins over the weekly window. An `on` exception
covers a normally off day; set `start_time` and `end_time` or leave both
empty for the whole calendar day.

## Quo line-to-line

The company has two Quo inboxes (allowlisted in `sms-provider.server.ts`):
the Main 888 line and the Primary 813 line. When the bot is already on one
line with a renter, a handoff **text** is sent from that line to the other
line's E.164 number, so the person on duty can pick it up in the shared Quo
account.

Quo's public API (version 2026-03-30) can send that SMS (`POST /messages`
from a PN id to an E.164 number). It **cannot** place a human-to-human or
internal line-to-line call: the Calls surface is list and retrieve only.
The older v1 "Create a call" endpoint is a Sona (AI agent) call, not a way
to ring staff. Closest working option: the staff-alert text on the other
line, then staff call the renter back from Quo.

A line-to-line text is ignored by the inbound webhook so it is not treated
as a renter message (no opt-out, no lead match, no FLEET forward).

Staff and renter personal phone numbers are never stored in this code. Field
rep numbers come from the Pickup Schedule setting. Company line numbers are
the existing Quo allowlist.

## Rules that stay the same

- Injuries and accidents still text the field rep at any hour, and also the
  other company line when Rosa is on duty.
- Bot texts to renters stay 8 AM–9 PM ET.
- Non-urgent `/fleet/handoff` staff texts wait for those hours
  (`staff_alert: "quiet_hours"`). Team-alert emails and team-alert texts to
  staff may go anytime (bot-rules D20).
- No applicant calls after 6:00 PM ET (`mayPlaceApplicantCall`).
- Auto-pause while an open handoff flag exists is unchanged. "Pause if a
  staff member texted from Quo in the last 24 hours" remains a bot rule
  (D3); the site does not yet auto-detect those Quo staff texts.

## FLEET

`POST /api/public/fleet/handoff` and `/fleet/team-alert` accept `line_id`
(a PN id or the line's E.164) so the other line can be chosen. The digest
from `/fleet/status` includes `staff_coverage` (who is on duty, which line
to use). It never returns a personal phone number.
