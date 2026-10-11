# eSign release package — existing implementation, no duplicate system

Verified main: e468156d0587f81031ad595185d17a73c591a0c4. No separate unmerged eSign feature branch was present in the remote branch inventory. Main already contains template library/versioning functions and UI, agreement numbering at send, merge/preview/build/import, typed/drawn signature adoption, PDF rendering, private document storage, signing lifecycle and archive retry. Code presence is not evidence of production publication or hosted success.

Completed source: agreement-library.ts, agreement-builder.ts, agreement-templates.functions.ts, agreements.functions.ts, esign.server.ts, esign-pdf.server.ts, SigningPanel and AgreementBuilder. The initial draft supplied migration-order documentation; the completed candidate below also carries the reviewed authorization handlers and tested numbered SQL packages.

Original draft blockers (see completed packaging below): assemble and test exact 0023 transaction (versioning + library) and 0024 with actual journal ordering; verify agreement table Coordinator policy; retain reviewed three-handler authorization patch (selective integration in Application Resume draft, not old hotfix wholesale); hosted PDF/storage/sign/void/archive-retry and role tests; company legal details, Service Area, approved template and legal review. Existing legal-review document may describe an older template and must be reconciled with actual approved wording, not treated as proof current terms are approved. Preserve contract minimum-term/date repair on main.

Independent release: eSign can proceed without Bookings, Stripe or Manual Payments. Shared security guards can be integrated separately if Application Resume is not ready; neither feature creates a business dependency on the other. Stop release on unauthorized document access, missing signatures/audit evidence, unverified migration state or unexpected production integration.

Recovery: stop new agreement sends/signing on a specific failure, preserve sent/signed content, numbers, documents and audit records; forward repair rendering/storage. Do not renumber signed agreements, reuse numbers or downgrade authorization. Production publication and SQL execution remain separately approved operations.

## Completed candidate packaging

Numbered 0023/0024 packages are under scripts/esign-release, outside automatic migration discovery. Original proposal files remain unchanged. 0023 combines versioning/library and adds minimal corrections: use existing private.is_manager() (public.has_role was removed by an existing migration), require verification actor/time/method, install the restrictive agreements boundary if absent, freeze template_key/insurance_snapshot/preview fingerprint/status-at-send alongside signed content. 0024 is byte-identical to the original numbering proposal. Checksums and execution preflight are included.

Reviewed three-file server authorization patch is included independently, without hotfix history. PR #23 carries the same guards; do not apply an older replacement file over either branch. Preserve current main's PR #21 contract dates.

Evidence: 38 existing eSign engine tests passed in the disposable PostgreSQL/PostgREST/in-memory Storage harness with the full 0023/0024 schema. The old Coordinator-read assertion was corrected to the approved denial model. Tests exercise signing concurrency, PDF bytes, archiving, storage outage/retry, delivery failure and real local RLS. Separate migration tests verify atomic journal failure, immutable signed/template fields, numbering concurrency, repeat-install refusal and data preservation. Four historical migrations were skipped by the existing harness replay; this is not proof of complete production-schema parity. A full baseline/journal preflight remains required. External communications were capture-only; no hosted storage used.

## Exact business/legal decisions before activation

- no_insurance: Vehicle Rental Agreement, display version 1.10.
- insurance_required: Vehicle Rental Agreement, display version 1.10.2 (Insurance Required).

Approve the exact stored version/body hash per family, effective date, company legal identity/address, Service Area, and applicable coverage/fees/deposit terms. Source-library versions are not evidence any database template is approved. The legacy/in-code v1.6 fallback is not implicitly approved. No wording or existing signed record was changed here; no approval flag was activated.

Remaining: provider-backed staged signing/download/retry acceptance, actual schema/ACL/journal preflight (reduced staging needs the real agreements baseline), template business/legal approval and separate publication authorization. Bookings/Stripe/Manual Payments are not prerequisites. Preserve numbers/signed PDFs/audit records during incidents, pause sends and forward repair; never execute the old proposal's destructive rollback comment.
