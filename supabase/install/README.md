# Contact Status (Phase 1A) — production execution package

Three files, prepared from main `31ed33055614705c978f638728d06f0931dee3c1`
for project `yuyzdsnrbfhkmfzpvhwx`. Nothing here has been executed.

| File | What it is |
|---|---|
| `20261011180000_contact_status.install.sql` | the atomic installer: preflight, the reviewed migration verbatim, postflight, two receipts — one transaction |
| `20261011180000_contact_status.verify.sql` | SELECT-only post-installation verification; every row must read PASS |
| `../../scripts/contact-status-fingerprint.sql` | read-only; prints the state fingerprint the installer compares against |
| `../migrations/20261011180000_contact_status.sql` | the reviewed migration itself, sha256 `400e1071856e7c4e62fc2a13822afd14ee98b31525b1ebf999f6bf486d6c710e` |

`bash scripts/contact-status-installer.check.sh` proves all of the above on a
throwaway Postgres — never the hosted backend.

## Order

1. Run the installer, as one script, through psql or the Supabase SQL editor.
2. Run the verify script. Every row must read PASS.
3. Publish main. (Until step 1 the UI reads "Not Enabled" rather than failing,
   so publishing first is survivable — it just leaves Rosa waiting.)

## Two recognised states, and no general override

The installer runs only if `public.applications` matches a fingerprint that
has been reviewed:

    <column count>|<md5 of every policy DEFINITION>|<trigger:function pairs>

- **STATE A** — production as verified read-only on 2026-10-11, before 0031:
  `120|40a44e65dceca27b52195ac5ba665ff1|applications_active_guard:application_active_guard, applications_updated_at:set_updated_at`
- **STATE B** — the inventory after Codex's 0031. **Not defined.** That
  package is not in this repository, not on any branch reachable from it and
  not in the production ledger, and a fingerprint nobody has reviewed is not
  a state worth accepting.

Anything else stops, and there is deliberately **no "proceed anyway" switch**
— an escape hatch that accepts arbitrary drift turns a preflight into
decoration. To add State B, read the current state with
`scripts/contact-status-fingerprint.sql` against the post-0031 database, put
the result in `c_state_b`, and have the amended installer approved: editing
it changes its checksum, which is the point.

The policy part is a hash of each policy's **whole definition** — name,
command, permissive, roles, USING and WITH CHECK. A 0031 that rewrites
`Staff view applications` to be manager-only keeps the name and changes the
rule, and a name list would not notice. This does.

## If it stops

It is designed to. `STOP:` means something of ours already exists, the ledger
already records this version, RLS is off, or the table is not in a recognised
state — and the message prints what it found next to what it accepts.

Nothing is ever left half-applied: one transaction, and every postflight
failure rolls the whole thing back.

## Receipts

- `supabase_migrations.schema_migrations`: version `20261011180000`, name
  `contact_status`, `idempotency_key = sha256:400e1071…`. That column is
  UNIQUE, so a second install is refused by the database itself even if the
  preflight were edited out.
- `public.audit_log`: `action = 'migration.applied'`, `entity_id =
  '20261011180000'`, with the checksum, the source commit, the applicant
  count before and after, and any recorded drift. `audit_log` has no INSERT
  policy or grant for `authenticated`, so the record cannot be forged or
  erased from a browser session.

## Rollback

Not needed for safety: the app reads the columns through `readContactStatus`
and degrades to "Not Enabled" if they are absent, so nothing breaks either
way. If the change is to be removed anyway:

```sql
BEGIN;
ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_contact_status_check,
  DROP COLUMN IF EXISTS contact_status,
  DROP COLUMN IF EXISTS contact_status_note,
  DROP COLUMN IF EXISTS contact_follow_up_on,
  DROP COLUMN IF EXISTS contact_status_at,
  DROP COLUMN IF EXISTS contact_status_by;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011180000';
COMMIT;
```

That drops staff's contact notes and follow-up dates with the columns. The
audit receipt is deliberately left behind: it is the record that the install
happened, and removing the columns does not un-happen it.

## Relationship to 0031

**Technically independent:** this installer creates no policy, no grant, no
role and no trigger — nothing 0031 governs — and 0031 changes no column this
migration adds. Neither needs the other to succeed.

**Operationally ordered, by choice:** because State B is undefined, the
installer will refuse to run after 0031 until its reviewed fingerprint is
added. So either install Contact Status **first**, while production is in
State A, or add State B to the installer, re-approve it, and install after.
The harness proves both halves: it stops after a 0031-shaped policy change,
and it installs once that state is declared.

| Recorded in the receipt | |
|---|---|
| `preflight_state` | `A` or `B` — which reviewed state was recognised |
| `preflight_fingerprint` | the exact fingerprint at install time |
