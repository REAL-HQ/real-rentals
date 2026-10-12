# Recovery cutover control — preparation only

Branch: `codex/recovery-cutover-control`, based on accepted PR23
`d925b449da2c5b35c62f84e8dd80cc825e237475`. No runtime source, existing SQL,
dependency, token storage, Auth or migration journal changes. Do not automatically
discover these `.prepared.sql` files as migrations.

## Mechanism

`pause.prepared.sql` installs two ENABLE ALWAYS triggers on the existing
`application_resume_tokens` table. They refuse INSERT, UPDATE, DELETE and TRUNCATE,
including service-role/BYPASSRLS and replica writes. Installation obtains an
exclusive table lock, waiting for preexisting token transactions or failing after
five seconds. The fence persists across process/connection failure. Repeated
installation stops without replacing an existing object. It creates no token store
or recovery system. Only a privileged administrator disabling the trigger can
bypass it; ordinary RLS bypass cannot.

This is temporary database DDL requiring separate approval, not an already-approved
numbered migration. Existing 0022–0032 files/receipts are untouched. The accepted
Resume transaction may run while the fence remains installed: it does not mutate
existing token rows. Runtime recovery reservation INSERTs fail atomically during
the pause, rather than returning a new credential.

`resume.prepared.sql` checks the function body and exact trigger shape, then removes
only these temporary objects in one transaction. It is NOT permission to resume:
first require successful publication, complete drain evidence and explicit approval.

Existing long-lived tokens remain readable. Best-effort last_used_at updates fail.
Short-lived token exchanges and staff reissues are temporarily unavailable without
consuming/revoking their token. Expiry is neither extended nor reset: a token can
naturally expire during maintenance. New submissions/promotions may have performed
earlier application writes before issuance fails; suspend those UI actions and do
not automatically retry them. This fence does not make those multi-request handlers
transactional. Token-dependent deletions/cascades also pause.

## Writer coverage and evidence scope

Inspected accepted candidate and recorded production baseline `5bc960c0`:

| Writer | Shared boundary |
| --- | --- |
| Hourly cron: 24h/72h/abandoned recovery | issueResumeUrl → issueResumeToken INSERT |
| Public recovery, duplicate-submission recovery | legacy issuance or 0022 reserve_application_recovery INSERT |
| Staff applicant-link reissue | revoke UPDATE, then issue INSERT; first write now fails |
| Staff document-request email | applicantResumeUrl → issueResumeToken INSERT |
| Initial submission, Waitlist promotion, portal openMyApplication | issueResumeToken INSERT |
| Short-lived recovery exchange | conditional UPDATE before new token INSERT |
| Trimming, failed-attempt revocation, deletion | token UPDATE/DELETE; refused during pause |

No token-writing bypass was found in those sources. This is not proof of the current
live server revision or all external jobs. A previously minted raw link already in
memory, a manual resend or provider retry does NOT need another token INSERT.

Existing delivery infrastructure is reused: sendEmail → Resend, email_deliveries
and signed delivery webhooks; public recovery also uses application_recovery_attempts.
There is no application retry loop in sendEmail. Tracking creation/finalization is
best-effort, and older senders may be untracked. A missing record is UNKNOWN, not
proof of no send. `accepted` is not `delivered`; a network exception is not proof
of failure. Do not resend an uncertain request.

Last accepted read-only scheduler inventory: job2 wizard-recovery-hourly active
at `15 * * * *`; job4 generic automations active but no active workflow steps.
Recheck at the approved execution window. Jobs3/5/6 are unrelated reminders,
late-fees and eSign retry; do not pause them without evidence of recovery linkage.
Reuse the previously prepared fingerprint-guarded job2 pause/resume scripts in
the release package; never unschedule/delete its history or rotate its secret.

## Deterministic production sequence (not executed)

1. Verify exact target `db.yuyzdsnrbfhkmfzpvhwx.supabase.co:5432/postgres`, source,
   script checksums, token-table schema and absence of conflicting fence objects.
   Approve this temporary SQL separately. Record existing scheduler state privately.
2. Commit the fence, verify both ALWAYS triggers, then pause exact job2 with the
   reviewed job fingerprint guard. Fence stays on if cron pause fails. Suspend
   application submission/promotion/reissue UI actions during maintenance.
3. Obtain all-origin/provider revision inventory and evidence that old request
   continuations/background tasks are quiescent. Inspect pg_net HTTP jobs and
   provider retry/pending states without exposing bodies, tokens or recipients.
   Reconcile every pre-pause recovery/document send to a provider terminal result.
   Do not delete queues or mark unknown outcomes failed to obtain a green result.
4. Run `python3 scripts/recovery-cutover/drain-gate.py evidence.json`. This offline
   gate checks operator evidence; it does not authenticate that evidence or query
   providers. Missing inputs, pending/retrying/unknown sends always block restart.
   Evidence refs should be local report IDs, never bearer URLs or credentials.
5. After drain verification and separate approval, retain/install0031 then execute
   the accepted atomic Resume migration package. Keep the fence on through publication.
6. Verify the exact published candidate and all aliases; ensure no old instances can
   resume sending. Review existing reminder markers and public recovery cooldowns.
7. After approved evidence review, run resume.prepared.sql, then restore job2 only
   if its recorded pre-pause state was active. Do not clear reminder flags, replay
   uncertain emails, rotate existing links or force a catch-up batch. Normal cron
   cadence resumes; inspect errors/duplicates before another intervention.

## Failure and interruption

Failure before fence commit rolls back. Failure after commit leaves the fence on,
even if the operator disconnects. Cron may still wake but cannot mint tokens.
Publication/migration failure leaves recovery paused; preserve0031/audit/history
and use a separately approved forward repair. Do not drop the fence as a timeout
fallback. Drift in the fence blocks its removal. Drain evidence must be recollected
after any new serving instance, writer, queue activity or publication change.

## Tests and remaining blocker

`test-control.py` ran16 checks against disposable local PostgreSQL17 with synthetic
rows and outbound network denied; database removed. Scope: shared storage boundary,
token/audit preservation, interruption, safe restart, drift and guard-removal
negative control, and fail-closed offline delivery-evidence decisions. These do not
prove actual provider drain or end-to-end absence of duplicate emails. Accepted
staging/security tests were not repeated; no application runtime files changed.

READY: isolated fence proposal and deterministic restart checks.
BLOCKED: authoritative live writer/origin inventory and provider in-flight/retry
accounting are unavailable. The DB fence resolves new issuance, not previously
minted/untracked email delivery. Need provider quiescence/terminal-delivery evidence
or a supported, durable, observable hold before declaring full cutover READY.

Approval needed next: review/push this isolated control branch if desired; separately
authorize target-bound temporary fence SQL and recovery-job pause, plus read-only
provider queue/request inspection. This is not publication or resume approval.
Resume must be separately approved after verified drain and exact publication.
