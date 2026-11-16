# Bot Rules (FLEET, the phone assistant, the support bot)

## Pause while staff are handling someone (D3, card t310s1681)

If a person on the team texts someone from the 888 or 813 Quo line, the bots
send that person nothing for 48 hours after the latest staff text (each new
staff text extends it; staff can add 48 hours or end it from the driver
profile). The same holds while the person is in an open FLEET hand-off. The
only exceptions are roadside or accident replies and team alerts.

The site enforces this for its own senders (missing-items messages and
auto-close, the Follow-Up, pickup and agreement reminders, rent and late-fee
notices, the Payment Failed Text, FLEET link resends) once the Automations
switch **Pause Bots When Staff Text** (`staff_text_pause`) is on. FLEET must
check `bots_paused` in `/api/public/fleet/status` before any text or call and
send nothing while it is true, and must send its own Quo texts as its own Quo
user so they are never mistaken for staff texts. Details:
[staff-text-pause.md](staff-text-pause.md). For payment deals the site also
has the payment-text pause (`/api/public/fleet/payment-text-pause`).
