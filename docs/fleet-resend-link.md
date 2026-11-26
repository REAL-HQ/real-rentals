# FLEET: Resend A Signing Link Or An Upload Link

`POST https://drivereal.com/api/public/fleet/resend-link` (Bearer `FLEET_API_KEY`, JSON)

```json
{ "kind": "signing", "lead_id": "…" }          // or "agreement_id"
{ "kind": "signing", "agreement_id": "…", "signer_id": "optional signer uuid", "channels": "email" }
{ "kind": "upload",  "lead_id": "…" }
```

`channels` is `email` or `email_and_sms` (the default). `email` sends no text.
Omit `signer_id` to resend to every signer who has not signed. Pass one signer
id to resend only that person's link.

Signer status (read-only, same Bearer key):

```json
POST /api/public/fleet/agreement-signers
{ "agreement_id": "…" }                        // or "lead_id"
```

**Off by default.** Nothing is sent until an Owner turns on
Back Office → Automations → **FLEET Link Resends** (`fleet_link_resends`).

## Signing link

The renter lost the link, or it went to the wrong place. Each signer keeps
their own link. A link that is still valid is sent again. An expired, revoked,
or unrecoverable link is replaced for that signer only — one signer's new link
is never written onto the others. Someone who has already signed is skipped.
The email and text are the same ones the staff **Resend** button sends. A
reissued link lasts 30 days. The link itself is never returned to FLEET or logged.

Refused when the agreement is not `sent` or `viewed` (a draft has never been
sent; `signing`, `signed` and `voided` are final), when it was prepared without
a required detail (staff void and prepare a new one), when it was sent or
resent under 4 hours ago (`429` with `retry_after`), or when FLEET already
resent it 3 times in 7 days (`429`, `reason: "resend_cap"`: staff should call).

Reply: `{ ok, kind, agreement_id, lead_id, email, sms, delivered, link_expires_at }`
where `email`/`sms` are `sent`, `failed` or `not_attempted` (no address, no
consent, or STOP). If neither went out, the agreement_delivery_failed webhook
follows (when lifecycle events are on).

## Upload link

For an open application (`partial`, `new`, `reviewing`, `complete`) that is
still missing something. Sends the approved Missing-Items step-1 message (the
same email and text the Missing Items Follow-Up sends), listing only what is
missing, with a fresh private 14-day link. Refused when nothing is missing
(`409`, `reason: "nothing_missing"`), the application is not open (`409`), or
any missing-items message went to them in the last 24 hours (`429`). The
message is logged as `missing_items_resend` and does not restart the
Follow-Up's reminders.

Reply: `{ ok, kind, lead_id, missing, email, sms, delivered }`.

## Always

- 8 AM to 9 PM Eastern for any text (`409`, `reason: "quiet_hours"`). `channels: "email"` is allowed outside that window and sends no text.
- Texts come from the 888 line through the normal sender: SMS consent and STOP
  are always checked.
- A person handed off to staff (`/fleet/handoff`) gets nothing: `423`,
  `reason: "staff_handling"`.
- Switch Off: `409`, `reason: "switched_off"`. Switches unreadable: `503`.
- Every resend is audited as FLEET (`document.resent` with `by: FLEET`, or
  `application.upload_link_resent`).
