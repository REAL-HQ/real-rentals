# eSign staging installation package

**PREPARATION ONLY. Nothing in here has been run against any hosted database.**

Target: the verified staging backend `bhpdppyxnkokzhlkgcsc`. The installer is
bound to it and has no override flag.

## This package is not executable end to end through the staging connection

`03_storage_policy.privileged.sql` creates a policy on `storage.objects`.
Postgres requires superuser or ownership of that table to do so, and the
staging connection runs as `postgres`, which is neither a superuser nor a
member of the owner `supabase_storage_admin`:

| checked read-only, 2026-10-13 | |
| --- | --- |
| `storage.objects` owner | `supabase_storage_admin` |
| member of `supabase_storage_admin` | false |
| `is_superuser` | false |
| can `INSERT storage.buckets` | true |

So the bucket is within reach and the policy is not. `install.sh` does not
drive `03`, does not claim it can, and `stage10` refuses to run until the
policy is already present — because a bucket without it is a partial
installation of the reviewed design, and this package refuses partial
installations.

The privileged path has **not been identified or reviewed yet**. Candidates,
none chosen: the Supabase Dashboard Storage policy editor; the provider
migration pipeline that applied the ten existing storage policies; a session
as a role that owns `storage.objects`, if the provider grants one. Nothing
here escalates — no ownership change, no role grant, no `ALTER TABLE … OWNER
TO`, and the test asserts their absence from every executable line.

## Order

| # | what | run by |
| --- | --- | --- |
| 0 | `03_storage_policy.privileged.sql` | **the privileged path — not this installer** |
| 10 | `stage10_agreements_baseline` = `01_agreements_baseline.sql` + `02_private_storage.sql` (bucket only) | `install.sh` |
| 11 | `stage11_esign_0023` = `../esign-release/0023_esign_template_versioning_library.sql` | `install.sh` |
| 12 | `stage12_esign_0024` = `../esign-release/0024_esign_agreement_numbering.sql` | `install.sh` |

Then `verify.sql` for acceptance. Every row must read PASS.

## Before it will run: pin the nine existing receipts

> **Status: BLOCKED.** The nine values could not be read from this
> environment. The network policy denies
> `bhpdppyxnkokzhlkgcsc.supabase.co:443` (403 CONNECT at the egress proxy),
> the only Supabase credentials present are production's, and the one
> reachable database has no `private.staging_install_receipts` at all. So the
> manifest is still UNPOPULATED, and it was not filled in with anything.


`private.staging_install_receipts` (`stage`, `sha256`, `installed_at`) holds
nine rows through Stage 09. `baseline-receipts.json` **ships UNPOPULATED** and
the installer stops before opening a transaction while it is.

The nine values were read during verification and were not included in the
correction brief, so they are not known to this package. They are deliberately
not guessed: a made-up stage name or checksum would make the comparison pass
against a ledger nobody checked, which is worse than no comparison. The
read-only query that captures them is in that file's own header, and
`seal-manifest.sh` runs it:

```
bash scripts/esign-staging/seal-manifest.sh capture "<staging connection>"
bash scripts/esign-staging/seal-manifest.sh validate
```

`capture` issues one SELECT, writes the file and then validates its own
output. It is bound to the staging project, like the installer.

`validate` needs no database, so a reviewer holding only the file can run it.
It refuses an unpopulated manifest, a count that is not nine, ordinals with a
gap or a duplicate, a checksum that is not 64 lowercase hex, a checksum that
is one repeated character (a placeholder, not a hash), a stage name ending in
`_synthetic` (the test fixture's, not staging's), and any of the nine named
`stage10/11/12`.

Once populated, the comparison does two jobs:

- **preservation** — names, checksums and install order are compared as one
  string before the payload and again after it, so a payload that rewrote a
  historical receipt rolls back rather than committing silently;
- **target binding** — a ledger that reproduces all nine is the verified
  staging backend. A hostname is not evidence of that; it can be tunnelled or
  copied. The connection-string check in `install.sh` is the weaker first half.

## What stops a stage

Each stage is one transaction: `BEGIN → preflight → payload → receipt →
postflight → COMMIT`. Any failure rolls back the work *and* its receipt, so a
stage is installed completely or not at all.

Refusals: an unpopulated manifest · a connection that is not the verified
target · a wrong database name · a ledger of the wrong shape · the nine
differing in name, checksum or order · a receipt count that is not what the
sequence expects · a stage already recorded · a second installer running
concurrently (transaction-scoped advisory lock, plus `NOWAIT` on the ledger) ·
a missing prerequisite table, enum or function · columns the partner policy
reads missing from `public.documents` · RLS off on `storage.objects` · a
storage policy other than the reviewed partner read reaching the bucket · the
privileged policy absent · partial agreements schema · agreements tables
present with no receipt accounting for them · a backdated receipt · any
postflight check failing.

## Verification

`bash scripts/esign-staging-install.test.sh` — a disposable PostgreSQL cluster
in a temp directory, destroyed at the end. No hosted database, no network, no
production object. It covers clean installation, exact receipt preservation,
concurrent-execution refusal, six kinds of drift, atomic rollback, the
storage-policy privilege failure *and* its privileged success, correct journal
receipts, and `verify.sql` itself.

The nine receipts it seeds are **synthetic**, for the reason above. What is
tested is the comparison mechanism, against a manifest produced by the exact
query `baseline-receipts.json` documents.
