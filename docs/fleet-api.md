# FLEET API: Every Endpoint

All endpoints: `POST`, JSON body, `Authorization: Bearer <FLEET_API_KEY>`
(compared in constant time; under 24 characters means "not configured", `503`),
`Cache-Control: no-store` JSON replies. Every write is audited as
"FLEET (automated)". FLEET never declines anyone (it sends `needs_staff`),
never marks anyone insured or verified, and never touches billing. Renter
texts the site sends go from the 888 line, 8 AM to 9 PM ET, with consent and
STOP checked.

Base: `https://drivereal.com/api/public/fleet/`

| endpoint | does | doc |
|---|---|---|
| `status` | read: whole-journey digest, one lead's journey and next step, a renter's balance | [fleet-status.md](fleet-status.md) |
| `applicants` | read: review queue and one applicant's review packet | [fleet-applicant-review.md](fleet-applicant-review.md) |
| `applicant-decision` | approve (no hard blockers) or needs_staff | [fleet-applicant-review.md](fleet-applicant-review.md) |
| `license-facts` | save DOB / expiry / number / state read off the license photo (never "verified") | fleet-license-facts.md (PR 376) |
| `assign-vehicle` | list available cars; put one on an approved applicant at its listed rate | fleet-assign-vehicle.md (PR 377) |
| `send-agreement` | send the agreement after the renter confirmed terms (call or YES text) | [fleet-send-agreement.md](fleet-send-agreement.md) |
| `amend-agreement` | send an updated agreement to an ACTIVE rental (e.g. a new weekly rate the renter agreed to); generated from v1.14 with no Reservation Fee or new deposit; the rate changes only after they sign (switch, Off) | [fleet-amend-agreement.md](fleet-amend-agreement.md) |
| `pickup-slots` | open pickup slots; book one | [fleet-pickup-schedule.md](fleet-pickup-schedule.md) |
| `resend-link` | resend the signing link or the missing-files upload link (switch, Off) | [fleet-resend-link.md](fleet-resend-link.md) |
| `handoff` | hand a person to staff (complaint, injury, payment dispute, ...); bots pause | [fleet-handoff.md](fleet-handoff.md) |
| `missing-items` | preview / run the one-time missing-items message | [missing-items-outreach.md](missing-items-outreach.md) |
| `payment-text-pause` | pause rent texts for an approved payment deal; status; cancel | [fleet-payment-text-pause.md](fleet-payment-text-pause.md) |

Events the site sends FLEET (signed webhooks): [fleet-webhooks.md](fleet-webhooks.md).

## What FLEET still cannot do (staff only, by design)

- Decline, close or reopen an application; clear a Needs Staff flag or a handoff.
- Run or record a background check or MVR; verify insurance; verify a license.
- Charge, refund or waive anything; change a rate directly. (A new rate for an
  active rental goes only through `amend-agreement`: it is pending until the
  renter signs the updated agreement, and Stripe is never changed by FLEET.)
- Propose a weekly rate outside $200–$1,000 (staff only).
- Complete the pickup checklist, activate a rental, record a return, end a rental.
