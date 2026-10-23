# Security 0031 — reconciliation against the resealed package

Prepared 2026-10-23 by Claude Code. Read-only. **Installation stays blocked.**

## The resealed artifact could not be found

The reported resealed package SHA-256:

```
32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f
```

Searched for exhaustively and **not found**:

- Every blob reachable from every ref in this repository — **279 refs, 6,873
  unique blobs** — hashed; nothing matches.
- Google Drive full-text search for the hash: no results.
- `REAL-RENTALS-CLAUDE-HANDOFF-2026-10-22.zip`
  (sha256 `ed8e7e6cb728a7e8eb4a09b43e81227c8d9da5e0f222065557e6577532330b69`,
  14 files) contains no 0031 SQL at all; its own notes say "Security finding
  0031 stays with Lovable engineering."

The only 0031 package that exists anywhere available is the **22-receipt**
version on `codex/0031-isolated-sync`:

```
drizzle/migrations/0031_guarded_coordinator_containment.sql
sha256 479d44d3377103c78894ee46426621ca777dc9de68832918d5dcaf8fd6309f0a
```

So the reported seal is **not verified**, and is not claimed to be verified. It
cannot be checked against an artifact that is not here. Hand over the file and
the check takes one command.

## What was verified instead — and it settles the question the reseal exists for

A read-only `SELECT` against the live migration ledger
(`drizzle.__drizzle_migrations`, project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6`):

| | |
|---|---|
| live entries | **23** (max id 23) |
| sealed pin in the 22-receipt package | 22 |
| **live entries 1–22 vs the sealed pin** | **identical — id, hash and created_at, every row** |
| sealed entries missing from live | none |

One row was appended, nothing was rewritten:

```
id       23
hash     9ee4a1ced75ee787ab8647f67775ae4bb9c0bc7fc23d51acf17416e469948e11
applied  2026-10-19T11:22:59Z  (Oct 19, 7:22 AM ET)
file     drizzle/migrations/0022_waitlist_resolve_phone_conflict.sql
```

(Identified by hashing every `drizzle/migrations/*.sql` blob in history; drizzle
journal hashes are the SHA-256 of the migration file.)

### What this means

1. **The reseal was necessary.** The 22-entry pin would now raise
   `JOURNAL_DRIFT_OR_REPLAY` against production. That is the correct behaviour of
   the guard, not a fault.
2. **No history drift, no replay, no tampering.** Entries 1–22 match the seal
   byte for byte. The historical-migration audit in the 22-receipt package
   remains valid, and the two pins inside the migration (pre-flight and
   post-flight) are identical to each other.
3. **The reseal's whole legitimate content is one appended row.** Both journal
   pins must gain entry 23 exactly as above. Nothing else in the package needs
   to change: the approved inner SQL checksum
   `cf8d5572670cb3f865fc0911d623ff070e6a9be1ca8d254c87db8f2a5c3cd723`, the
   catalog seal `c753236ecd2c4067c9bce7262d7b4786f5c9ea8bcbb42ce531e8deba3db41446`,
   the five policies and every other guard are untouched by a new migration row.

**A resealed package that changes anything beyond those two pins is not a
reseal** and needs independent review before it is treated as the approved
package. This document does not reseal it — altering the approved SQL is not
something to do silently.

## Installation remains blocked, for the unchanged second reason

Appending entry 23 clears the journal blocker. It does **not** clear the other
one:

- `coordinator_identity_storage_containment` is a policy on **`storage.objects`**.
- `CREATE POLICY` requires superuser or table ownership. `BYPASSRLS` does not
  grant it (proved: `ERROR: must be owner of table objects`).
- Production `postgres` is **not** superuser and does **not** own
  `storage.objects` (owner: `supabase_storage_admin`).
- `supabase_storage_admin` cannot read `public.user_roles` and has no `USAGE` on
  `private`, so it cannot create this policy either — and a `private`-free
  rewrite does not help it.
- The only role that can is **`supabase_admin`**, which is not reachable from
  here.

Lovable Support has still not confirmed a privileged installation route. Until
the authority to create that one policy is established, installation stays
blocked — as instructed.

### Standing context on urgency

The fifth policy is **durability**, not current closure. All four identity
buckets' permissive SELECT policies already resolve to
`private.has_role(auth.uid(),'admin')` — Owner only. 24 storage policies exist,
0 restrictive. Coordinators cannot read identity objects today; the policy keeps
that true if a future permissive policy is added.

## Reproducing the ledger check

```sql
-- read-only
select id, hash, created_at from drizzle.__drizzle_migrations order by id;
```

Compare against the two `journal IS DISTINCT FROM '[...]'::jsonb` literals in
`drizzle/migrations/0031_guarded_coordinator_containment.sql`.
