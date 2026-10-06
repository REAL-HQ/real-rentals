# Backlog

Known work that is deliberately not in the change that found it.

## Duplicate applications can form chains instead of a flat group

`mergeDuplicateApplications` in `src/lib/applications.functions.ts`.

Admin-only, manually triggered, and pre-existing — it is not part of the
Part 1 / Part 2 change, and was left out of that PR on purpose.

**What goes wrong.** The function groups applications by phone and, separately,
by email, then elects a primary per group with
`rows.find(r => !r.primary_application_id)`. That reads the in-memory snapshot
taken before any linking, so a row linked while processing the phone group is
still seen as unlinked when the email group is processed.

Given A(phone P1, email E1), B(phone P1, email E2), C(phone P2, email E2):

  - the phone group links B to A
  - the email group then elects B as primary and links C to B

C now points at B, which points at A. Nothing resolves that transitively.
`DriversPanel` lists with `.neq("status", "duplicate")`, so B has vanished from
the list and C groups under a key whose primary is not shown — it renders as
orphaned history. `resubmission_count` is also incremented on a row nobody can
see.

**The fix it needs.** Union-find (connected components) over the phone and
email edges, computing one canonical primary per component before writing
anything, then linking every other member of the component directly to it —
never to an intermediate. Resolve existing chains in the same pass so the data
already in production is flattened rather than merely stopped from growing.

**Related, same area, also backlog.** Duplicate *detection* in
`savePartialApplication` matches on exact string equality, so `8135551234` and
`(813) 555-1234` are different people, as are `karen@example.com` and
`Karen@Example.com`. A returning applicant who formats their number differently
gets a second application row. The durable fix is generated normalized columns
— last-ten digits of the phone, lowercased email — with indexes, matched on
those instead. It is a migration with a backfill, which is why it is here and
not inline.

## The admin modals are not dialogs

`AddVehicleDialog`, plus the inline modals in `TeamPanel`, `ShopsPanel`,
`ExpensesPanel`, `MaintenancePanel`, `WebsitesPanel` and `VehicleProfile`.

Pre-existing, untouched by the Part 1 / Part 2 change, and found by the
dashboard probe when it tried to dismiss the Add Vehicle dialog.

Each is a hand-rolled `<div className="fixed inset-0 bg-black/50 z-50 …">`
with no `role="dialog"`, no `aria-modal`, no focus trap, no initial focus and
no Escape handler. A screen reader announces the page behind it, Tab walks out
of it into that page, and the only way out is the X button. `DocumentViewer`
is the one that does it properly and can serve as the shape to copy.

**The fix it needs.** One shared `<Modal>` — role, aria-modal, labelled by its
own heading, focus moved in on open and restored on close, Escape and
backdrop-click to dismiss, `inert` or `aria-hidden` on the page behind — and
then the seven call sites moved onto it. Worth doing as one change rather than
seven, which is why it is here.

## Images between 15 and 25 MB reach the bucket

`src/lib/image-optimize.ts` and the `license-uploads` /
`profile-screenshots` buckets.

A bucket has one `file_size_limit`, and PDFs need 25 MB, so that is what both
buckets are set to. The 15 MB image ceiling is only the client-side check in
`uploadApplicantFile`, which is honest about being a UX check — it gives a good
message before a long upload rather than being the control. Anyone driving the
signed URL directly can therefore store a 24 MB JPEG.

Bounded, not free: the URL is one-time, issuance is capped at 40 per
application per hour, and the MIME allowlist still applies — so the worst case
is roughly a gigabyte an hour against one application's folder. Nothing here is
a security boundary, only storage cost.

**The fix it needs.** Separate buckets per document type so images can carry
their own 15 MB ceiling, or a storage-side check on `metadata->>'size'`. Both
are bucket surgery with a path migration, which is why it is not inline.


## Pre-existing database linter warnings (12) — deferred

Recorded during Phase 0 final closure; not repaired on purpose.

- RLS enabled, no policy (Info) ×2
- Security definer view (Error-level in linter) ×1
- Public can execute SECURITY DEFINER function (Warn) ×4
- Signed-in users can execute SECURITY DEFINER function (Warn) ×5

The vehicle-photos public-read finding was fixed separately.

## Shops vs Vendors — data merge deferred

Phase 0.5 presents both under one "Vendors" nav entry (All Vendors | Repair Shops toggle). The `shops` and `vendors` tables remain separate; merging them (vendor type = Repair Shop) needs a migration and is deferred.

## Future: Admin/Renter view + "View as Renter" (not built)

Plug-in point: the account menu in the shell header (src/routes/admin.tsx), gated to Owner/Manager via nav-config. Requirements when built: server-authorized short-lived read-only support session, audited start/stop, persistent "Viewing as [Name] — Exit" banner, no password/credential exposure, no URL-ID trust, and staff actions never recorded as the renter's. No generic Renter View exists today, so no switch is shown.

## Test infrastructure (found Phase 1 closure, 2026-10-06)
- `bunx vitest run` reports 22 files / 0 tests: the `scripts/*.test.*` files are standalone node/bun assertion scripts (custom `ok()` harness, `process.exit`), not vitest-native suites. Vitest discovers them by filename but finds no `describe/it`.
- The real runner is `npm test` (chained scripts). It currently stops at `scripts/grants.test.mjs` because the `pg` package is not installed, so later scripts in the chain do not run unless invoked individually.
- `scripts/client-chunks.test.mjs` SKIPs without a production build (`.output/public/assets`).
- `.ts` scripts (vehicle-readiness, fleet-inbox, esign-engine, admin-shell-roles) are run with `bun scripts/<name>.test.ts`; they are not in `npm test`.
