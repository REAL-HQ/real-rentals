# FLEET Webhooks

The site sends FLEET one signed JSON POST per event. Nothing is sent until
`FLEET_WEBHOOK_URL` (https) and `FLEET_WEBHOOK_KEY` are set as server secrets.

## Events

| event | when |
|---|---|
| `lead_created` | a new application row (Step 1, waitlist promotion, staff-created) |
| `stage_changed` | `applications.status` changes (`previous_stage` included) |
| `quo_message_received` | a text comes in on either Quo line |
| `quo_call` | `call.completed`, `call.missed`, `call.recording.completed`, `call.summary.completed` |
| `quo_voicemail` | `call.voicemail.completed` |
| `quo_transcript` | `call.transcript.completed` |
| `agreement_signed_by_renter` | a renter signs a rental agreement (email link or portal), once per agreement |
| `application_ready_for_review` | an applicant is first submitted with the required documents on file (cron sweep, once per applicant; see docs/fleet-applicant-review.md) |

Lead events carry: `lead_id, name, phone (E.164), email, stage, previous_stage
(stage_changed only), current_stage, sms_consent, consent_timestamp, source,
docs {received, missing, optional_missing}, background_check_status,
reservation_fee_paid, agreement_signed, pickup_at, created_at, last_text_sent
{type, template, workflow_id, step_id, sent_at, status, from}`.

Quo events carry: `lead_id (null if no match), line {e164, phone_number_id,
label}, direction, from, to (E.164), body, transcript, recording_url,
voicemail_url, duration_seconds, occurred_at, received_at, quo {event_id, type,
resource_id, call_id, conversation_id}`. Unmatched numbers are forwarded too.

`agreement_signed_by_renter` carries: `agreement_id, lead_id, rental_id (null
before a rental exists), renter_name, vehicle {id, label, plate, unit_number},
signed_at, signed_via (email_link | portal), signed_pdf_ready, countersign
{required: false, status: "pre_applied_at_send", name, title, applied_at},
admin_url`. There is no countersign step to call: the company signature is
captured when the agreement is sent (Settings, Company eSign Signer) and is
already on the signed PDF. The queue row needs
`proposed/fleet-agreement-signed-event-v1.sql` applied first.

`application_ready_for_review` carries: `lead_id, name, phone, email, stage,
applied_at, ready_at, next, admin_url`. It needs
`proposed/fleet-applicant-review-v1.sql` applied first.

Every body also has `event`, `delivery_id` and `sent_at`.

## Headers

```
Content-Type: application/json
Authorization: Bearer <FLEET_WEBHOOK_KEY>      (header name: FLEET_WEBHOOK_AUTH_HEADER)
X-Real-Event: lead_created
X-Real-Delivery-Id: 6f1c…                       (same on every retry: dedupe on it)
X-Real-Timestamp: 1763150400                    (unix seconds)
X-Real-Signature: v1=<hex>
```

For a header other than `Authorization` the raw key is sent;
`FLEET_WEBHOOK_AUTH_SCHEME` overrides the prefix (`""` for none).

## Verifying

`secret` is `FLEET_WEBHOOK_SIGNING_SECRET`, or `FLEET_WEBHOOK_KEY` when that is not set.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, headers, secret) {
  const ts = headers["x-real-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // 5-minute window
  const expected = "v1=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const got = String(headers["x-real-signature"] ?? "");
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
```

Use the raw request body exactly as received (before JSON parsing).

## Delivery and retries

Rows live in `public.fleet_webhook_deliveries` (status `pending`, `delivered`,
`failed`, `skipped`; `attempts`, `last_status_code`, `last_error`,
`delivered_at`, and the exact `payload` sent). Any non-2xx or timeout (8 s)
retries after 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h, then stops as `failed`
after 8 attempts. Quo forwards are tried inline as the event arrives; lead
events are tried inline after Step 1 and by the every-minute cron
(`/api/public/cron/fleet-webhooks`).

## Quo lines

`QUO_INBOUND_NUMBER_IDS` (comma-separated) picks the accepted lines. Default:
`PNcX8a0PLJ` (+18132124174, Primary 813) and `PNrZULvFMn` (+18888338280,
REAL Rentals 888). Another line: `PNid|+1XXXXXXXXXX|Label`.
