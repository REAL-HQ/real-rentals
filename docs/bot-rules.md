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

Bot texts and calls only 8 AM to 9 PM Eastern. Applicant calls also stop at 6:00 PM ET. Exceptions: roadside and
accident replies, and team alerts to staff. The site already uses 8 AM–9 PM ET
for its own texts (follow-up workflow 21→8 quiet window; rent reminders;
pickup and agreement texts; the late-pickup text).

## Pause while staff are handling someone (D3)

If a staff member has the conversation (they replied in the last 24 hours, or
the person is flagged in a FLEET hand-off that is still open), the bots send
nothing to that person except roadside or accident replies. For payment deals
the site already has the payment-text pause (FLEET's
`/api/public/fleet/payment-text-pause`).

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
It emails team@drivereal.com anytime and texts the on-duty staff (Rosa during
her hours, via the other company Quo line; Dolmar otherwise; switch
`team_alerts.bot_handoff`, off by default). Injuries also text the field rep
at any hour. See docs/staff-coverage.md. The bot tells the person: "I'm
getting someone from our team to help. They'll reach out shortly."

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

## FLEET decline

FLEET may decline with `POST /api/public/fleet/applicant-decision` and
`{"decision":"decline","reason":"..."}`. The reason is required and is saved
on the profile Notes. The site sends the decline email and text unless
`"skip_notify": true`, which FLEET sets when it is sending its own apology.
Omitting the flag sends both. A profile note that is not a decision is
`POST /api/public/fleet/profile-note`. See docs/fleet-applicant-review.md.
Age rules for approve are unchanged.

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
