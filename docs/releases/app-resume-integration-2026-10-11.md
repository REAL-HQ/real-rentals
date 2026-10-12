# Application Resume integration — draft, not publication approval

Sources: current main e468156d0587f81031ad595185d17a73c591a0c4; local release/app-resume 7be5adfe32eeb331079c578f83a80761254bc712; remote release/app-resume 01b2fb01cda48534093587dcb4c92ffd889e9973. The local-only commit repairs calendar-date display. Main now already uses shared date-format for applicant/staff pickup dates, and retains the contract minimum-term repair.

This is a selective forward integration, not a merge of the old release tree. It adds atomic recovery reservations, neutral email responses, recovery/session credential separation, transactional Identity Review resolution and role-limited review responses/controls. Reviewed 47954e1e authorization changes were applied as a three-file patch only; no hotfix history, generated types or old feature sources were merged. Main email identity footer, plain text and portal sign-in remain intact. Lockfiles, migrations journal, payment, Bookings and vehicle implementation are unchanged.

Existing application submission, duplicate handling, resume wizard, uploads and offline retry are already in main. Preserve accepted prior backup/restore, staging audit and recovery evidence; this PR does not claim those were rerun. Integration-specific checks cover the changed recovery/email/authorization paths and existing contract dates.

## Original integration blockers (superseded by release-candidate follow-up)

- Integrate the remaining reviewed 0030 application projections/document endpoint changes against current main; the older 17-file package cannot safely replace modern files wholesale. This draft's server review projection is restricted, but it does not claim all direct database/alternate endpoints are secured.
- Install reviewed 0032 in isolated staging after 0030 and rerun the specific NULL-ownership regression. Prior hosted Driver disclosure and Manager document 404 remain unresolved until verified.
- Finish authenticated applicant/staff pickup-date, role workflow and sanitized destination checks on the integrated artifact. Preserve all earlier accepted evidence, rerun only affected paths.
- Confirm production security containment, exact runtime bindings, old recovery-writer shutdown, journal receipts and reviewed forward repair before publication.

## Database execution package

Byte-preserved 0022/0025/0030/0032 are under scripts/app-resume-integration with checksums; deliberately not auto-registered. Production logical order: 0022 -> 0025 -> 0030 -> 0032, coordinated with separately approved 0031 containment. Verify compatibility of 0031 restrictions with 0030 before combined installation; do not blindly replay either. Existing 0000–0021 history unchanged. Staging already has 0022/0025/0030 per accepted receipts; verify then install only missing 0032 under separate approval using the existing private receipt ledger. Never create a second staging journal.

Future 0023/0024 entries must have execution timestamps later than the actual prior production entry despite lower filenames. No backdating, fabricated entries or implicit all-pending migration run. Installer/journal transaction is a separate reviewed release artifact. SQL here is not execution authorization.

Recovery: pause affected recovery writers; preserve token/recovery/audit data and post-release writes; forward repair. Never fall back to unreserved recovery code or destructive snapshot restoration. Application Resume does not require eSign, Bookings, Stripe or Manual Payments completion.

## Affected integration verification

TypeScript and production build passed (existing dependency warnings). Nine offline recovery/identity scenarios passed; recovery-email tests, resume payload guards, agreement guard/PDF, file-upload guard and contract minimum-term checks passed. Existing agreement-library test passed without changing eSign implementation. Synthetic tests only; no hosted authentication or email. Prior backup, migration and hosted evidence is preserved in the original release/evidence directories, not represented as fresh acceptance for this combined artifact.

Original draft assessment: development merge was NO-GO pending Coordinator endpoint integration and review; isolated hosted acceptance needs separate artifact and SQL approvals. This draft is a concrete review package, not a production candidate.

## Release-candidate follow-up

Authenticated application reads now use the reviewed 0030 masked projection, including Drivers, Overview, portal and related read consumers. Base-table writes and service-role authorization paths are retained. Readiness consumes non-sensitive on-file booleans. Identity Review uses its masked view; Coordinator document loading/controls are suppressed while server handlers still enforce denial. The reviewed NULL-safe 0032 body is unchanged and mandatory with 0030.

Local verification: 11 actual bundled authorization-handler checks; 16 browser role/cache/direct-API assertions; synthetic PostgreSQL/PostgREST tests for NULL/missing/wrong ownership, verified Owner/Manager/Driver access, revoked/expired/unverified sessions, guard-removal negative control, audit protection and journal rollback. Nine recovery scenarios and email/contract regressions pass. Provider Auth remains a harness adapter, not hosted acceptance. The migration fixtures are synthetic; do not describe them as a fresh complete production restore.

The older outstanding-integration bullet above is superseded for the reviewed projection consumers. Remaining release gates: full current-schema compatibility/read-consumer review, hosted Manager document signing (actual fixture existence/path), fresh role acceptance on the integrated private Worker, and exact target/receipt checks before separately approved staging 0032. Existing backup/restore evidence remains accepted; no repeat export.

Required staging approval: apply only byte-verified 0032 to bhpdppyxnkokzhlkgcsc after matching 0022/0025/0030 receipts, atomic next receipt; then separately deploy a reviewed private Worker artifact. No production 0031, eSign or payment migration included. Temporary synthetic password authentication, if needed, requires its own supervised approval and cleanup.
