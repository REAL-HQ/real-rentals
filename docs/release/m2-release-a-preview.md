# Release A — Preview acceptance checklist

Branch `release/m2-app-flags-off`. Both M2 flags `false`. The claim being tested
is **inertness**: Release A must approve applications and store documents exactly
as live release #266 does.

Passing this checklist is **not** permission to publish.

## Before you start

Confirm the preview is built from `release/m2-app-flags-off`, and that the
branch tip is `67b62664` plus the M2 port only. Automated already: typecheck,
build, the full suite, and `npm run test:m2`.

## Known preview failures that are NOT regressions

Carried over from #266 and unchanged by this port. Preview has no
`SUPABASE_SERVICE_ROLE_KEY` and no Stripe secret, so these fail in preview and
work in production:

- Lead Priorities
- Recent Applications
- Revenue
- Stripe Collections

Fleet Snapshot does work in preview (browser-side read with the bundled
publishable key). Treat only a *new* failure as a finding.

## The six checks

### 1. Approve one application — the critical check

**Why:** this is the one new failure mode in Release A, and **neither flag gates
it.** `approveThroughPacket` now reads `applications.approval_evidence_version`
before anything else. That column does not exist until packet step 3, so the
read errors on every approval. Only PostgREST `42703` — and `PGRST204` naming
that column — is tolerated; any other code **refuses an approval that #266 would
have completed.** The code path is pinned by
`scripts/m2-release-a-inert.test.ts`, but the actual error code the hosted stack
returns can only be confirmed here.

**Do:** approve one test application from the admin screen.

**Pass:** the application moves to Approved, the agreement sends, the portal
account is created, and an `application.approved` row appears in the audit log —
the same outcome as today.

**Fail:** any approval error. Stop. Do not publish. This is the hardening
decision in the summary below.

### 2. Re-approve an already-approved application

**Why:** this is a **real behavioural change with the flags off.** #266 rewrote
`status` and logged a *second* `application.approved` audit entry on a repeat
call. Release A skips both and still re-sends the agreement.

**Pass:** the agreement re-sends, `status` is unchanged, and **no second**
`application.approved` audit row is written.

### 3. Upload a driver document as staff

**Pass:** the upload confirms, the document appears in the vault, the previous
current document in that category is superseded, and `documents.content_sha256`
is **null**. Null is correct here — the hash arrives with Release B.

### 4. Upload through the applicant wizard

**Pass:** licence front, licence back and a trip screenshot all register. The
registered count matches the number of files. No file is silently dropped —
with the flag off the wizard sync does **not** swallow registration errors.

### 5. The Verify Identity control is not visible

**Pass:** open an applicant's Documents panel. There is **no** Verify Identity
button and no "Record the identity decision" row. It renders nothing while
`IDENTITY_VERIFICATION_ENABLED` is false.

### 6. No new error noise on approve or upload

**Why:** with the flags off, every approval makes two extra calls that are
*expected* to fail — the version read (`42703`) and `approve_application_checked`
(`PGRST202`). Both are handled, but they will appear in logs.

**Pass:** nothing user-visible, and the only new log lines are those two
expected codes. A `content_sha256_function_missing` or
`record_uploaded_content_sha is not installed` line should **not** appear, since
the flag is off and the hasher returns before any call.

## What this checklist does not cover

Content hashing, identity verification and the approval boundary are all
flag-off or not-installed here. They are Release B and the packet steps, and
each needs its own approval.
