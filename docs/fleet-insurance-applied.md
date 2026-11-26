# FLEET: Mark Insurance Quote "Applied"

Once insurance has been applied for, FLEET checks off the profile's Insurance
Quote row. It turns **yellow — Applied · Awaiting Quote**. When the quote email
comes back, upload the quote file and the row turns **green — Quote On File**.

This records receipt of a step only. It never marks anyone insured: Insurance
Setup is still verified by staff, and nothing else on the application changes.

## Endpoint

`POST https://drivereal.com/api/public/fleet/insurance-applied`

Headers: `Authorization: Bearer <FLEET_API_KEY>`, `Content-Type: application/json`

```json
{ "lead_id": "<application id>", "note": "Applied with the commercial program 11/18", "idempotency_key": "ins-applied-<lead_id>" }
```

- `lead_id` is the application id. The application must be Approved (or Active); anything else is refused with `409` and nothing is written.
- `note` is optional (up to 300 characters). Do not put carrier, broker or rep names in it.
- `idempotency_key` is optional. A repeat with the same key returns `duplicate: true` and writes nothing new.
- Reply `201`: `{ ok, lead_id, applied_at, shows_as, next }`.
- What it writes: one `audit_log` row, action `application.insurance_quote_applied`, by `FLEET (automated)`.

## Turning it green

Upload the quote with `POST /api/public/fleet/driver-document` and
`category: "insurance_quote"` (see docs/fleet-api.md), or staff upload it on the
profile. A current, not-rejected quote file is the only thing that completes it.

Staff can undo a mistaken mark by clicking the row (Mark Not Applied); a staff
correction made after FLEET's mark wins.
