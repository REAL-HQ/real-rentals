# Drivers List: Inline Active Workflow (Review Only)

## Scope And Truth

- The Drivers row's existing status dropdown now includes **Active** as a distinct action, not an application enum write. Owner/Manager only; an actual open rental disables it.
- The action opens the existing `ActivateRentalDialog` directly above the list. Its same server readiness and `activateRental` transaction re-checks are unchanged. No insurance setting, activation transaction, schema, history contract or migration is changed by this feature.
- One next requirement action replaces the dialog body with the existing document vault, insurance decision form, interview, vehicle section editor, agreement preparation or pre-delivery inspection runner. No profile navigation or extra dashboard is introduced.
- Insurance is never auto-verified. The existing audited decision is only called after staff explicitly choose Yes. Owner-exception acknowledgement stays separate and truthful.
- Agreement preparation explicitly saves and confirms the same selected vehicle, rate, deposit amount and dates through the existing lifecycle writer before preparing its contract. It never marks a payment collected, sends an agreement or activates on opening.
- A narrowly scoped new Manager-only email action fills an empty application email. It cannot overwrite an existing email, change a linked login, stage or insurance. Linked logins must already match; conditional updates protect concurrent changes. No account creation, credential or notification is involved.
- Failed readiness reads fail closed with a visible retry; activation failures preserve all entered fields. A synchronous request latch protects rapid repeats, with the existing transaction still providing the authoritative race guard. Already-active responses refresh the same actual-rental sets and list counts, never manufacture a successful activation.
- Keyboard focus stays in the activation dialog, returns to the row on close, and Escape closes an owned popup before its dialog.

## Stack And Release Boundary

Local feature branch `feat/drivers-inline-active` is stacked on PR 322's head `87a57619344af81c130442b0dc97ee232c0da0a3`; PRs 320/321/322 themselves are untouched. The parent stack includes the separate proposed vehicle-readiness migration. Nothing in this work applies it. Its approval/application/release plan remains independent and mandatory before anyone deploys that migration.

No production data, renter activation, verification decision, upload, email/text, migration, merge or publication was performed. Every executed browser/server write used synthetic local state only. Shared existing upload components are reused, not changed; t180 stays separate.

## Validation

- `PG_BIN=/tmp/pgbin npm test`: passed, including existing server and PostgreSQL activation/readiness constraints.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `node scripts/driver-list-activation.test.mjs`: 60 checks (menu roles, legacy stored Active, actual-rental protection, prerequisite routing, contract draft bounds, real email endpoint/role checks, readback, concurrent writes and failures).
- `PLAYWRIGHT_MODULE=/workspace/toolbar-layout-tools/node_modules/playwright/index.mjs node scripts/driver-list-activation-browser.test.mjs`: 15 scenarios using the actual DriversPanel, actual activation dialog and real inline resolver components. Covers success at 390/1024/1280px, direct insurance resolution/draft retention, network/permission/read failures, race/already-active counts, Coordinator denial, busy vehicle, focus/keyboard, white inspection popup, email, approval and inline agreement preparation.

Offline browser candidate: `.inline-activation-browser/drivers.html` (self-contained; all service/query responses are simulated). URL hashes `#insurance`, `#blocked`, `#readfailure`, `#coordinator`, `#inspection`, `#email`, `#approval`, `#agreement` select synthetic scenarios after reload. Screenshots live alongside it. Human-browser review remains pending; this is not live end-to-end verification.

## Preserved Queue

Next: t184 compact native-zoom Vehicles toolbar; t179 app-wide explicit Title Case/white menu work remains in `/workspace/app-ui-labels`; t180 existing-upload drag/drop remains an independent workstream. PR 320's review head remains stable.
