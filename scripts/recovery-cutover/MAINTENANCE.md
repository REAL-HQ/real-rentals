# Recovery cutover maintenance — proposed, not activated

Base: recovery-control commit 0a61a7c937f9e916cb3473ed591b57a2cb523855 (PR29, depends on PR23).
No migration, provider setting, production configuration or hosted record is changed by this package.

## Entry boundaries

- `savePartialApplication`: `/apply` and city lead forms; check before duplicate lookup, insert, resubmission updates, token issuance and email.
- `promoteToApplicant`: staff Waitlist promotion; existing Manager authorization first, maintenance check before `promote_waitlist_entry` RPC, token issuance and audit write.
- `requestApplicationLink`: shared WelcomeBack public recovery; check before applicant lookup and delivery.

Maintenance returns a typed temporary-unavailability result. Both lead forms show the error before navigation or conversion events. WelcomeBack displays a persistent maintenance message. WaitlistPanel already displays `ok:false` errors without refreshing or claiming success. These imperative calls have no automatic retry loop. Existing forms retain entered values; explicit manual retry is possible after restoration.

No guard is added to payments, rental operations, staff sign-in, existing application edits, Waitlist enrollment or queue reordering. The separate token fence still restricts token mutation/exchange and other recovery writers as described in PR29. Existing valid tokens/history are not rewritten by this control; expiry continues normally.

## Configuration and release prerequisites

Use the existing `app_settings` row with key `recovery_cutover_maintenance`; JSON value must explicitly contain `mode: "open"` to admit requests. `mode: "paused"`, absent/malformed data and database errors all close these entry points. Reads are uncached. No public toggle endpoint is added.

Before any deployment, separately approve creation/verification of this one configuration row and verify actual production RLS/grants restrict modification to authorized administrators/service operators. The source baseline has an admin-only app_settings RLS policy; this is not live-policy evidence. Record the previous value or absence. Existing settings saves merge by their own keys, so unrelated settings updates do not reset this row. Do not deploy before this prerequisite: a missing row deliberately causes maintenance.

Deploy this guard to EVERY serving revision/origin before using it. A PR29/PR23-only candidate or the old production runtime does not contain this guard. Prepare a compatible pre-cutover application artifact and verify its database compatibility separately; this patch is not approval or evidence for deploying the full dependent feature tree.

## Activation, bounded drain and restoration

1. With separate authorization, verify source, configuration permissions, all serving origins, rollback candidate and provider access. Set the row to paused; read it back and check all three entry responses. Record activation time and configuration evidence. Do not install the token fence yet.
2. Pause the identified recovery scheduler and other recovery writers under the existing runbook. Account for requests/jobs admitted before maintenance, across all old/new revisions. The flag is admission control, not an atomic transaction spanning their database calls: an already-admitted operation may continue. Wait for verified completion or provider-confirmed quiescence. Do not kill and automatically replay an uncertain operation.
3. Once admitted submission/promotion requests are finished, install the accepted fence. Reconcile local/provider delivery metadata using PR29's gate: correlate provider IDs, terminal states, pending/retry/unknown cases. An empty dashboard alone is insufficient. Historical unknowns need explicit evidence of no pending execution/retry or remain blocking. No automatic resend, token deletion or history rewrite.
4. Use a 30-minute operational decision window from pause activation. This is an abort/escalation deadline, NOT a request or email lifetime. If any admitted execution, retry or unknown outcome is unaccounted for, STOP before migrations/publication; keep maintenance/fence closed pending an explicit safe restoration decision.
5. After the already-approved atomic migration procedure and separately approved publication, verify security, tokens and provider accounting with existing acceptance evidence plus affected checks. Remove the exact fence using its validated restoration script only after the drain gate passes. Read back fence removal and candidate identity. Set mode=open LAST, read back, then verify synthetic entry behavior. Resume each scheduler once at the recorded schedule; do not backfill or replay missed jobs blindly.
6. On interruption the persistent paused row remains closed; no timer automatically opens it. Reconstruct state from configuration, fence metadata and receipts. Never remove identity protections or rerun committed migrations. If publication fails, retain maintenance/fence until a schema-compatible, security-preserving candidate is verified. Do not restore a previous missing/malformed row expecting workflows to work: explicit open is required by this version.

## Lifetime evidence and unresolved bounds

Cloudflare's documented HTTP Worker lifetime has no hard wall-clock limit while the client stays connected. `waitUntil` allows up to 30 seconds after response/disconnect; it is NOT a total request lifetime. This describes the known staging Worker, not unverified Lovable production execution limits.

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/context/

Resend's webhook retries are immediate, then 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours and 10 hours after preceding failures (nominal 27h35m5s plus attempt durations). This bounds neither SMTP message retries nor manual replay. Do not substitute it for an email delivery bound.

- https://resend.com/docs/webhooks/retries-and-replays

The existing email fetch has no explicit abort deadline, and provider acceptance can be uncertain after a lost response. A local timeout would not prove cancellation at Resend. No verified production request/job lifetime or SMTP retry maximum is presently available. Require provider confirmation or authoritative per-request/job and per-message terminal accounting. Until then the production drain gate remains BLOCKED; elapsed time is not proof.

## Verification

Run `node scripts/recovery-cutover/maintenance.test.mjs`: real bundled entry handlers and helper with synthetic database/role dependencies. Closed, missing, malformed, query-error and interrupted reads admit no domain database access or RPC, so no application/token/queue/audit write can start. Explicit open reaches the next domain boundary; the next paused request closes again without cached admission. UI checks ensure maintenance precedes token navigation. These tests do not establish hosted RLS, provider drain, browser rendering or atomic quiescence of previously admitted work.

Existing 16 fence tests and accepted staging security/recovery tests are reused, not repeated. No hosted fixtures are touched.
