# Security 0031 — smallest safe execution correction (proposal; nothing executed in production)

## Is selective execution supported?

**Not through the migration tool.** `lov_database--migration` writes the submitted SQL as
the next Drizzle migration and runs the Drizzle migrator (drizzle-orm 0.45.4,
`pg-core/dialect.js` `migrate`): every journal entry whose `when` is newer than the
newest receipt runs, in journal order, in **one** transaction, each followed by its
receipt `(sha256(file), when)`. There is no option to run one entry. Production's journal
has `0023` pending (when 1792545492197 > newest receipt 1792408979135), so any submission
also runs 0023. The only selective path is Lovable Cloud's direct SQL execution (the
read-only preflight route), which is not the migration workflow, writes no receipt, and
is outside the approved route.

## Proposed correction: defer 0023 by one journal value

`0031-0023-deferral.diff` — one line in `drizzle/migrations/meta/_journal.json`:
0023's `when` 1792545492197 → 1792408979135 (the newest applied receipt). Journal sha256
4997458b… → d1b88aa5…. The 0023 SQL file (173e475c…) and `meta/0023_snapshot.json`
(38060a8e…) are untouched; no receipt, applied migration or other entry changes.

Rejected: deleting 0023's entry. drizzle-kit names the next migration
`idx = last idx + 1` and writes `meta/<idx>_snapshot.json`, so the new migration would
become `0023_…` and overwrite 0023's snapshot.

## Demonstrated on the disposable project (its ledger = production's 23 receipts; production's `drizzle/migrations` copied byte-identically)

| Demo | Journal | Probe saw (mid-transaction) | Meaning |
|---|---|---|---|
| 1 | as production | 24 receipts, newest = 0023's when, 0023 table + function present | reproduces the production failure |
| 2 | deferral applied | 23 receipts, no 0023 objects | the submitted SQL runs alone |
| 3 | deferral; harmless no-op submitted | file `0024_noop_probe.sql` (idx 24, new `0024_snapshot.json`); stored bytes = submitted bytes; receipt hash `70526fdf…` = sha256 of the submitted text; receipt created_at = journal when; 0023 snapshot unchanged | receipt is attributable to the exact bytes |
| 4 | 0023 re-dated to the current time | 25 receipts, newest = new when, 0023 objects present | 0023 remains installable later |

All failing probes rolled back; the disposable database is the only one touched.

## Consequences

- 0031 is recorded as `drizzle/migrations/0024_<name>.sql` + `meta/0024_snapshot.json` +
  journal idx 24; **Drizzle 23 → 24**, Supabase stays **105**. The receipt hash must equal
  `32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f`; the package's own
  journal pins (23 during the statement) still pass, since the receipt is written after.
- 0023 later: set its `when` to the time of its own approved install (> 0031's receipt).
  Restoring the original `when` would **not** run it — the migrator skips any entry older
  than the newest receipt, silently (the tool now warns).
- Any branch deployed later must carry the deferral and the 0024 entry; one that restores
  the old journal would show 0023 "pending" but the migrator would skip it.
- Lovable executes on submission (no confirmation): approval must precede submission.
- The agent re-types the SQL into the tool. Typos in executable parts are refused by the
  package's gates; the receipt hash is the after-the-fact proof of the whole file.
