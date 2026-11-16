# Pickup Reminders And Agreement Sign Texts

Code: `src/lib/renter-reminders.server.ts`, cron route
`/api/public/cron/renter-reminders` (every 5 minutes once
`proposed/renter-reminders-v1.sql` is run).

Two switches in Back Office -> Automations, both OFF until an Owner turns
them on: **Pickup Reminders** (`pickup_reminders`) and **Agreement Sign
Texts** (`agreement_sign_texts`).

| Step | When | Channel |
| --- | --- | --- |
| Booked | within 12 hours of the booking, if pickup is more than 2 hours away | text only (the booking email already has the details) |
| Evening before | 6-9 PM ET the night before pickup (not if booked less than 2 hours earlier) | text, email if no SMS consent |
| 2 hours before | 2 hours to 1 hour before pickup | text, email if no SMS consent |
| Agreement, 4 hours | 4-6 hours after it was sent, still unsigned | text, email if no SMS consent |
| Agreement, next morning | 9-11 AM ET the day after it was sent, still unsigned | text, email if no SMS consent |

Rules:

- Texts go from (888) 833-8280 through `sendSms`, which refuses anyone without
  SMS consent or who replied STOP. Every text ends "Reply STOP to opt out."
- No text before 8 AM or after 9 PM ET. A step whose window passes is skipped,
  never sent late (so a 9:30 AM pickup gets its "2 hours before" text at 8 AM).
- Each step is claimed once in `renter_reminder_sends` before sending. No
  table, nothing sent.
- The copy never states a late-arrival rule (none is decided).
