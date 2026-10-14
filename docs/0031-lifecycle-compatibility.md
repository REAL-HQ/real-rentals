# 0031 lifecycle UPDATE compatibility

Base: main 2213d118c25a5e64bd845677b43cb45762b60ec6.

## Scope and boundaries

DriversPanel's generic application UPDATE now calls updateApplicationLifecycle.
The server resolves staff roles before accessing applications and accepts only
an explicit field allowlist. Coordinator writes are limited to status,
first-contact stamping, phone, city and state. Coordinator lifecycle changes
are limited to new/reviewing/declined/closed on undecided or closed/declined
applications; suspension and changing approved/suspended applications require
Manager. A Coordinator cannot set approval, active rental status, screening
results, identity fields, document pointers, money or review decisions.

Owner/Manager profile edits retain the existing editable fields. Approval stays
with approveApplication; rental activation/ending stay with their existing
transaction functions. Neither approved nor active is a generic status choice.
Existing database checks/triggers remain in effect. An active rental prevents
lifecycle rewrites; failed reads fail closed. The update checks the previously
read status and first-contact timestamp, excludes deleted records, requires
exactly one returned row, and audits the actor, field names and lifecycle
change without copying identity values into audit metadata.

UI state changes only after a confirmed response. Approval, rental ending,
card removal and document-request callbacks update already-saved UI state;
they no longer make a redundant generic database write. Contact Status and
its server function are unchanged. No Auth, grants, RLS or migrations change.

## 0031 compatibility and verification limits

The prior disposable PostgreSQL reproduction established that 0031 causes
Coordinator direct UPDATE-by-id to affect zero rows, while Manager/Owner still
update one row. This repair uses the existing service-role client (which bypasses
RLS), with explicit staff/field/transition authorization before the write. It
therefore does not depend on Coordinator SELECT grants before or after 0031.
No live database test or SQL execution was performed for this PR.

Passed: 31 synthetic executable handler/security checks, guard-removal negative
control, TypeScript, production build, Contact Status, Drivers list access,
identity authorization, agreement PDF access and contract minimum-term tests.
The handler tests exercise the real validator, handler and role resolver;
framework transport/database/audit I/O are stubbed. Hosted Coordinator acceptance
before/after containment remains a separately authorized release gate.

## Claude handoff (0030 read compatibility)

No Admin notifications, Overview, Hot Prospects, applications.functions.ts,
drivers-list.functions.ts or shared package configuration changes are included.
The only existing runtime file edited is DriversPanel.tsx: one import, lifecycle
status choices, update/markContacted helpers, and saved-action callbacks in
DriverDetail. Its read/fetch path is untouched. Claude should retain these write
hunks when integrating any DriversPanel read changes; neither branch should
replace the whole component from an older revision. Verify the combined diff
and rerun lifecycle + read-path tests only if that file overlaps.

## Release gates

Review/merge and publication require separate approval. Publish the compatible
writer before 0031; do not relax 0031 to restore direct table access. Preserve
an operational rollback that retains both this writer and the reviewed security
handlers. Runtime binding attestation and controlled Coordinator acceptance are
still required for production 0031 execution. No changes to the frozen hotfix.
