# Team Alerts (Dolmar, t299s1618)

One email to team@drivereal.com and one text to the field rep
(+18134768508, a constant in `src/lib/team-alerts.ts`; alert code never takes
a phone number from a renter, an applicant, a request or a setting, and removes
anything shaped like a phone number from the alert text).

| Kind | When | Built in |
| --- | --- | --- |
| `gps` | Outside service area, tracker offline, no movement 48 hours | docs/gps-alerts.md |
| `roadside_overnight` | A roadside request (portal Roadside form, or a bot) between 6 PM and 6 AM ET, until a tow partner is added (D17) | driver-issue-alert.server.ts, fleet-team-alert.server.ts |
| `late_pickup` | A reservation released 15 minutes after a missed pickup | late-pickup.server.ts — always sent when "Late Pickup Release" is on (that switch governs it; a release never happens without telling staff) |
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
