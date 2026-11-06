# Release A — Preview inspection, and what must not run there

Branch `release/m2-app-flags-off`. Both M2 flags `false`.

Owner decision 2026-10-23: **Preview testing only, no production publish.** And:
anything that approves, re-approves or uploads a real document must run against
a disposable database, **not** the live database Preview uses.

## Preview is production data — read-only only

Established, not assumed. Every committed env file names one Supabase project:

```
.env               SUPABASE_URL = https://yuyzdsnrbfhkmfzpvhwx.supabase.co
                   VITE_SUPABASE_URL = https://yuyzdsnrbfhkmfzpvhwx.supabase.co
.env.development   no SUPABASE_URL
.env.production    no SUPABASE_URL
```

That is the production project, and the `VITE_` pair is bundled into the client,
so a Preview build reads and writes production. There is no second project
anywhere in the repo.

**So Preview is for read-only inspection.** No approving, no re-approving, no
uploading. Those move to the rehearsal database (`docs/development/M2-CUTOVER-AND-RECOVERY.md`,
section 4).

## A. What Preview can safely show

All four are read-only: load a page and look.

1. **The Verify Identity control is absent.** Open an applicant's Documents
   panel. No Verify Identity button, no "Record the identity decision" row.
   `IDENTITY_VERIFICATION_ENABLED` is false, so it renders nothing.
2. **The admin screens load unchanged** — Applications list, an applicant's
   detail view, the document vault listing. Release A changes no read path.
3. **Existing documents still display**, with their metadata, and the current
   document in each category is still the current one.
4. **No new console or server error on page load.** The compatibility gate below
   does not run until somebody presses Approve, so an inspection pass should
   produce no new log line at all.

### Not regressions

Carried from #266, unchanged by this port. Preview has no
`SUPABASE_SERVICE_ROLE_KEY` and no Stripe secret:

- Lead Priorities · Recent Applications · Revenue · Stripe Collections

Fleet Snapshot does work (browser-side read with the bundled publishable key).
Treat only a *new* failure as a finding.

## B. What must run on a disposable database

These change data, so they are out of scope for Preview:

- Approve one application end to end.
- Re-approve an already-approved application.
- Upload a document as staff, and through the applicant wizard.

They belong to the rehearsal environment, where they also exercise the real
`storage.objects` the content hash depends on.

## C. The compatibility gate, and what is already proven without a database

The owner asked for a fail-safe gate rather than error-code handling. It is
implemented in `src/lib/approval-rpc.server.ts` and covered by
`scripts/m2-approval-compat-gate.test.ts` (`npm run test:m2`).

`applications.approval_evidence_version` and `approve_application_checked` are
both created by `00-approval-boundary.sql`, HOSTED-INSTALL step 3, **in one
transaction**. So they are present together or absent together, and the version
read is a gate on the whole packet rather than on one column.

| Database state | Path taken | Proven by |
|---|---|---|
| Column absent (`42703`) | **Legacy** — today's write. The RPC is **not called at all.** | `missing column: the RPC is never called` |
| Column absent (`PGRST204` naming it) | Legacy | `PGRST204 naming the column means not installed` |
| Version read fails any **other** way (`PGRST100`, no code, transport) | **Legacy.** No error code can refuse an approval the accepted release would have completed. | `unreadable column: approval succeeds` |
| Legacy write itself fails | Refused, with the legacy message. Unchanged rule. | `a failing legacy write still refuses` |
| Column present, function unreachable | **Refused, and the legacy write does not run.** Step 3 creates both together, so this is a stale PostgREST schema cache; the message says to reload it. Falling back here would hit `approval_rpc_required` from the triggers that arrived with the column. | `stale cache: the message names the schema cache` |
| Both present | RPC, with the real version. A refusal is returned as-is and never retried as legacy. | `installed: the real version is sent` |
| RPC reports `42883` | Still not a fallback. Rule unchanged. | `42883 is still not a fallback` |

**Business rules are unchanged.** The legacy path writes the same `status`, the
same `contacted_at` and the same `application.approved` audit entry as #266. The
packet path validates exactly as it does on an installed database.

**Side effect worth noting:** the gate removes a round trip. Before it, an
approval on today's production made two calls that were expected to fail — the
version read and the RPC. Now the RPC is skipped when the column is absent, so
there is one.

**Still a real change with the flags off:** re-approving an already-approved
application no longer rewrites `status` and no longer logs a second
`application.approved` entry. The agreement still re-sends. Pinned by
`scripts/m2-release-a-inert.test.ts`; confirm it in B, not in Preview.

## What this does not cover

Content hashing, identity verification and the approval boundary are flag-off or
not installed. They are Release B and the packet steps, each with its own
approval.
