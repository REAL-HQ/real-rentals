# Contact Status (Phase 1A) — production execution package

Three files, prepared from main `31ed33055614705c978f638728d06f0931dee3c1`
for project `yuyzdsnrbfhkmfzpvhwx`. Nothing here has been executed.

| File | What it is |
|---|---|
| `20261011180000_contact_status.install.sql` | the atomic installer: preflight, the reviewed migration verbatim, postflight, two receipts — one transaction |
| `20261011180000_contact_status.verify.sql` | SELECT-only post-installation verification; every row must read PASS |
| `../migrations/20261011180000_contact_status.sql` | the reviewed migration itself, sha256 `400e1071856e7c4e62fc2a13822afd14ee98b31525b1ebf999f6bf486d6c710e` |

`bash scripts/contact-status-installer.check.sh` proves all of the above on a
throwaway Postgres — never the hosted backend.

## Order

1. Run the installer, as one script, through psql or the Supabase SQL editor.
2. Run the verify script. Every row must read PASS.
3. Publish main. (Until step 1 the UI reads "Not Enabled" rather than failing,
   so publishing first is survivable — it just leaves Rosa waiting.)

## If it stops

It is designed to. A `STOP:` means something of ours already exists or the
database is not the one that was verified; a `STOP ON DRIFT:` means the table
is no longer the shape that was reviewed — most likely because 0031 landed
first and changed the policy set. Read the message, satisfy yourself the
deviation is expected, then set `ccs.allow_drift` to `'1'` at the top of the
installer and run it again. The deviation is written into the receipt either
way.

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

Independent, in both orders. This installer creates no policy, no grant, no
role and no trigger — nothing 0031 governs — and 0031 changes no column this
migration adds. Proven both ways in the harness, including an install run
after a 0031-shaped policy change, which it leaves untouched.
