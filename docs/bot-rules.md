# Bot Rules (FLEET, the phone assistant, the support bot)

Decided Nov 16 2026 (SOP D2, D3, D20, D28, D29, D30 and decision 7). These
rules are for the bots' own prompts and routines; the site enforces the parts
noted below.

## Which line (D1, D2)

Every applicant and renter text comes from the Main line (888) 833-8280,
including rent reminders. Already true: production rent reminders and
payment texts have all gone out from +1 888-833-8280 (checked read-only Nov 16
2026). A reply goes out on whichever line the person used.

## Quiet hours (D20)

Bot texts and calls only 8 AM to 9 PM Eastern. Exceptions: roadside and
accident replies, and team alerts to staff. The site already uses 8 AM–9 PM ET
for its own texts (follow-up workflow 21→8 quiet window; rent reminders;
pickup and agreement texts; the late-pickup text).

## Pause while staff are handling someone (D3, card t310s1681)

If a person on the team texts someone from the 888 or 813 Quo line, the bots
send that person nothing for 48 hours after the latest staff text (each new
staff text extends it; staff can add 48 hours or end it from the driver
profile). The same holds while the person is in an open FLEET hand-off. The
only exceptions are roadside or accident replies and team alerts.

The site enforces this for its own senders (missing-items messages and
auto-close, the Follow-Up, pickup and agreement reminders, rent and late-fee
notices, the Payment Failed Text, the late-pickup release message, FLEET
link resends) once the Automations
switch **Pause Bots When Staff Text** (`staff_text_pause`) is on. FLEET must
check `bots_paused` in `/api/public/fleet/status` before any text or call and
send nothing while it is true, and must send its own Quo texts as its own Quo
user so they are never mistaken for staff texts. Details:
[staff-text-pause.md](staff-text-pause.md). For payment deals the site also
has the payment-text pause (`/api/public/fleet/payment-text-pause`).

## Phone assistant (D28)

Every call starts with: "Hi, this is REAL RENTALS' automated assistant." If
the call is recorded, it says so right after. It offers a person whenever
asked ("Would you like me to have someone from our team call you back?") and
hands off (below).

## Hand-off to a person (D29)

A bot stops and hands the conversation to a person when:

- the person asks for a human;
- there is a complaint;
- someone is hurt;
- a payment is disputed;
- the request is outside the approved templates;
- the bot has no answer within 15 minutes in business hours.

The hand-off is `POST /api/public/fleet/team-alert` with
`{"kind":"bot_handoff","reason":"complaint|injury|payment_dispute|asked_for_person|outside_templates|no_answer", ...}`.
It emails team@drivereal.com and texts the field rep (switch `team_alerts.bot_handoff`, off by default).
The bot tells the person: "I'm getting someone from our team to help. They'll reach out shortly."

## Overnight roadside (D17)

From 6 PM to 6 AM ET a roadside request alerts the team the same way
(`kind: roadside_overnight`, switch `team_alerts.roadside_overnight`). The site
also alerts on a roadside issue the renter files in the portal overnight.

## No courtesy rides (decision 7)

We do not book or pay for rides. The support bot never offers one. Overnight
breakdown reply (P32, no ride offer):

> We've got your message, {first_name}, and we're on it. Our roadside help opens at 6 AM, and we're alerting our team now to help you tonight. Are you somewhere safe? Do you have someone who can pick you up?

## FLEET approval (D30)

When FLEET approves and sends its own approval text (P12), it passes
`"approval_text_sent": true` to `/api/public/fleet/applicant-decision`, and the
site does not send the Approval Confirmation email. Without that flag the email
goes as before.

## Reservation Fee and deposit wording (Dolmar, t309u)

- Never call the $50 Reservation Fee a "deposit", in any text, call or email.
  It is applied to rent (the first week). Say "Reservation Fee".
- A deposit is a different thing: the per-car security deposit, refunded at the
  end of the rental (when one is collected) and used to cover fees during it.
  Say "security deposit" only for that.
- Never ask for a card before the agreement is signed. After signing, the
  renter pays the $50 through the Stripe link in the Agreement Signed email, and
  that card is saved on file for the rental balance. Bots never take card
  numbers by text or phone.

## Late pickup (D25, 30 minutes per t309u)

The car is held until 30 minutes after the scheduled pickup time. After that
it may be released and the $50 Reservation Fee is kept. The site sends the
release text itself (Late Pickup Release switch, off until go-live); bots do
not send their own. Approved wording:

> Real Rentals: We held your car until 30 minutes after your 10:00 AM ET pickup, and it has now been released. Your $50 Reservation Fee is non-refundable for a missed pickup. To rebook, reply here or call (888) 833-8280. Reply STOP to opt out.

## Service area and GPS (t311u, card t310s1681)

Rentals stay within a 100-mile radius of Tampa. FLEET posts each tracker
reading to `/api/public/fleet/gps-readings` (twice a day); the site alerts the
team when a car is more than 100 miles from Tampa, a tracker has had no signal
for 24 hours, or a rented car has not moved for 48 hours (switch
`team_alerts.gps`, off until go-live).

## Background checks (D27, card t310s1681)

A pending background check or driving record is a note, never a blocker.
FLEET may pass clear checks; any flag goes to staff.

## Approved for later go-live (card t310s1681)

The day-2 email skip for complete applicants (`proposed/day2-email-skip-complete.sql`)
and the Rental Ended Notice (Automations switch, off) are approved; both stay
off until the publish Dolmar signs off on.
