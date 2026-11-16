# Staff Texting Someone Pauses The Bots

Approved by Dolmar (card t310s1681): "auto-pause the bots when staff text
someone from Quo". Code: `src/lib/staff-text-pause.server.ts`.

**Off by default.** Back Office → Automations → **Pause Bots When Staff Text**
(`staff_text_pause`). Storage: `public.bot_text_pauses`
(`proposed/staff-text-pause-v1.sql`, not applied). Tuning:
`proposed/staff-text-pause-on.sql` (app_settings `staff_text_pause`, not
applied). Until the table exists every check answers "not paused".

## What it does

When a person on the team texts someone from the REAL Rentals 888 line
(`PNrZULvFMn`) or the Primary 813 line (`PNcX8a0PLJ`), the site holds its own
automatic outreach to that person for **48 hours after the latest staff
text**. Every further staff text pushes the end out again. Staff can also add
48 hours by hand, or end it now, from the driver profile (grey **Bots Paused**
bar: **+48 Hours**, **Resume Bots**; any staff member). A pause never lasts
more than 14 days from the last change.

It is a light pause, not a red Needs Staff handoff: no flag, no alert, and
FLEET's next step does not change.

Held while paused (text and email from these senders):

| sender | while paused |
|---|---|
| Missing-items one-time message and steps 1–3 | skipped, not claimed; goes on a later run once the pause ends |
| Missing-items auto-close and come-back message | not closed while paused |
| New Applicant Follow-Up workflow | the next step waits until the pause ends (`next_run_at` = pause end) |
| Pickup reminders, agreement-signing texts | skipped, not claimed; sent if the pause ends inside the step's window |
| Rent reminders and late-fee notices (due, late, overdue, daily) | skipped, nothing claimed; the stage owed goes out after the pause |
| Payment Failed Text | not sent (`staff_text_pause`) |
| Late Pickup Release text/email | the car is still released and staff still get the team alert; the renter is not messaged (staff tell them) |
| FLEET `resend-link` | `423`, `reason: "staff_texting"` |
| FLEET's own Quo texts and calls | FLEET reads `bots_paused` in `/fleet/status` and sends nothing |

Never held: staff texts (site or Quo), receipts and confirmations, team
alerts, roadside replies, STOP/HELP replies, anything staff trigger by hand
(send agreement, activation notice, vehicle share). `sendSms` also refuses any
automatic bot kind (`automation`, `missing_items*`, `rent_reminder_*`,
`payment_failed`, `pickup_reminder_*`, `agreement_sign_*`, `late_pickup_release`) to a paused number
as a backstop (`reason: "bot_paused"`, logged as skipped).

## Staff text or bot text?

Quo sends the site `message.delivered` for every outgoing text on our lines,
with the Quo message id, the text, and `context.userId` (who sent it). Quo
attributes API texts to the line's owner unless the sender names another user,
so the user id alone cannot tell the owner texting from the app apart from an
API text. The site decides in this order and stops at the first answer:

1. **Our own send log.** Every text the site sends is written to
   `outbound_messages` *before* Quo is called, then stamped with Quo's message
   id. A delivered text whose id, or whose recipient + exact wording within 30
   minutes, is in that log is ours, so it is a **bot** text (missing-items,
   follow-ups, reminders, rent and late-fee notices, FLEET link resends,
   receipts...). The one exception: kind `staff_message` (Messages → Text in
   the back office) is a **staff** text.
2. **Quo's sender.** No user, or a Quo system actor (`SYU…`, e.g. Sona), is a
   **bot**. A user listed in `bot_user_ids` (the Quo user FLEET sends as) is a
   **bot**.
3. **Automated wording.** A text containing "Reply STOP to opt out" is a
   **bot** text: every automated template carries it and people do not type it.
4. **Staff**, only when configured: the user is in `staff_user_ids`; or, with
   no staff list, `bot_user_ids` is set and this user is not on it. With
   neither list set the answer is "unknown" and **nothing pauses**.

A read failure while deciding means "do not pause" (bots keep today's
behaviour). A pause that exists but cannot be read holds the senders (the same
rule as the payment-text pause).

Tests: `scripts/staff-text-pause.test.ts` sends 52 real missing-items texts
and every other bot kind through the real `sendSms` (Quo mocked), plays each
one back through the real webhook as the line owner, and checks nobody is
paused; plus FLEET user, Sona, template wording, switch Off, unconfigured
lists, and the race where Quo's delivery beats the id update.

## Before turning it on

1. Apply `proposed/staff-text-pause-v1.sql`.
2. Make sure the Quo webhook includes `message.delivered`.
3. Get the Quo user ids: the people who text from the 888 / 813 lines
   (`staff_user_ids`) and the user FLEET sends as (`bot_user_ids`; FLEET must
   send with `senderUserId` set to it). Fill them into
   `proposed/staff-text-pause-on.sql` and apply it.
4. Turn on **Pause Bots When Staff Text** in Back Office → Automations.

Off again: turn the switch Off. Existing pauses run out on their own, or staff
click **Resume Bots**.
