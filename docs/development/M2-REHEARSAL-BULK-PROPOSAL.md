# Proposal — checksum-gated staging for the M2 rehearsal

2026-10-23. **PROPOSAL ONLY. Nothing below is built.** You asked for the
smallest restricted, temporary mechanism and its cleanup guarantees before any
faster bulk method is used, and ruled out a generic `SECURITY DEFINER`
arbitrary-SQL endpoint. This is not one: no SQL is ever executed over HTTP.

Scope: the disposable rehearsal project `nhcgrevnanuzroudxpux` only. Never
production.

## Why it is needed, not just faster

Remaining: 63 baseline migrations (287 KB), the M2 packet and boundary files
(257 KB), 31 rollbacks and the verify files.

**Hand relay cannot prove checksums.** Every statement I relay is retyped
through tool arguments. Catalog checks catch gross errors, but nothing proves a
relayed file is byte-identical to the repo. You asked me to fail on mismatched
checksums and to preserve the packet's. For the packet in particular, "the
approved SQL passed the rehearsal" is only a true sentence if the bytes that ran
are the approved bytes. Relay cannot deliver that; this mechanism can.

## The mechanism

### 1. Allowlist — seeded out-of-band, never reachable over HTTP

`private.rehearsal_allowlist(filename text PRIMARY KEY, sha256 text NOT NULL)`

Seeded through the privileged `query_database` channel with the SHA-256 of
**exactly** the files the rehearsal needs, computed locally from the repo: the
63 remaining migrations, `proposed/rehearsal/drizzle-prerequisites.sql`, every
packet and boundary file, the 31 rollbacks, the two `proposed/m2-verify/` files
and `proposed/backfill-document-content-sha.sql`. Nothing else can be named.

### 2. Stage table — the only HTTP-writable object

`public.rehearsal_stage(filename text PRIMARY KEY, body text NOT NULL)`

- RLS on. **One** policy: `INSERT` for `anon`, `WITH CHECK
  public.rehearsal_body_allowed(filename, body)`.
- `GRANT INSERT (filename, body)` to `anon`. **No `SELECT`, `UPDATE` or
  `DELETE`** for `anon` or `authenticated`.
- `public.rehearsal_body_allowed(text, text) RETURNS boolean` is the one
  `SECURITY DEFINER` object. It **executes nothing**; it returns true only when
  `encode(sha256(convert_to(body,'UTF8')),'hex')` equals the allowlisted hash for
  that filename.

So the only thing anyone holding the publishable key can do is insert a
byte-exact copy of a file already in the repo. An altered file, an unknown name
or a second copy is refused by the database.

### 3. Upload — no transcription

From this session: `curl --data-binary` of a `jq`-built JSON body per file to
`/rest/v1/rehearsal_stage`. The bytes go from the repo to the database without
passing through my output, which is the whole point.

### 4. Execution — never over HTTP

Only through the privileged `query_database` channel, one file per call, as an
anonymous `DO` block that **re-checks the hash** against the allowlist and then
`EXECUTE`s the staged body. There is **no persistent executor**: no function,
no RPC, nothing callable by `anon` or `authenticated`.

- `-1` packet files: the call is the transaction, exactly as `psql -1`.
- Own-transaction files (steps 2, 3, 9, 14, 25, which each hold exactly one
  `BEGIN;` and one `COMMIT;`, counted): those two lines are removed **inside the
  database** after the hash check, with an assertion that exactly one of each
  was found. A whole `DO` block is one transaction, so the semantics are
  identical. Recorded per file in the ledger.
- Every call ends with `IF (SELECT count(*) FROM cron.job) <> 0 THEN RAISE`.
  The five baseline files that call `cron.schedule` at drivereal.com (60, 62,
  68, 69, 92) therefore **cannot commit a job**: `cron.job` is transactional,
  verified, and the scheduler never sees an uncommitted row. Those files run
  byte-exact and the job is unscheduled before commit; a missed unschedule rolls
  the whole file back.

### 5. Ledger

Each executed file's ledger row records the hash the database itself computed
from the bytes it ran. That is the checksum proof hand relay cannot give.

## Feasibility — probed on the rehearsal project, harmlessly

| Property the design depends on | Result |
|---|---|
| PL/pgSQL `EXECUTE` runs a multi-statement string | **yes** |
| Dollar-quoted function bodies survive inside `EXECUTE` | **yes** |
| Database `sha256(convert_to(t,'UTF8'))` equals `sha256sum` of the same bytes | **yes** (`abc\n` → `edeaaff3…18cb` both ways) |
| A `cron.schedule` inside a rolled-back transaction leaves `cron.job` empty | **yes** |

Nothing from the mechanism was created; the probes used temporary objects only.

## Cleanup guarantees

1. **The HTTP write path closes before the packet runs.** Upload everything
   first. Then, before step 1: drop the policy, revoke the `anon` grant, drop
   `public.rehearsal_body_allowed`. From that point nothing reachable by `anon`
   or `authenticated` remains. The packet's preflight and per-step verifies run
   against a catalog with no rehearsal objects that any role could reach.
2. **At the end:** drop `public.rehearsal_stage` and
   `private.rehearsal_allowlist`. A closing query must return `t`:
   both tables, the function and the policy absent, and no `anon` `INSERT`
   grant on any public table beyond the baseline's own column grants.
3. **Abort at any point:** the same drop script runs unconditionally. It is
   idempotent (`IF EXISTS`).
4. **Ultimate guarantee:** the project is disposable. Deleting it removes every
   trace, and nothing in it is shared with production.

## Exposure, honestly

During the upload window — minutes — anyone with the rehearsal project's
publishable key could insert a byte-exact copy of a repo file. They gain nothing:
the files are what is already being staged, execution is never triggered over
HTTP, and the database holds no real data. Outside that window there is no
`anon` write path at all.

## What I need

Approval to build exactly this, on `nhcgrevnanuzroudxpux` only. Until then the
baseline relay continues in verified batches, and the packet is **not** run by
hand relay — I will not report a packet result whose bytes I cannot prove.
