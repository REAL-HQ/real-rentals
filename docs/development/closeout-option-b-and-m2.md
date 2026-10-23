# Rental Closeout Option B × M2 — ordering, and the post-M2 proposal

2026-10-23. Read-only. Nothing installed, no packet file edited.

Option B is already **Ready for Approval** on its own: proposal
`proposed/end-rental-returns-approved-v2.sql`, evidence in
`docs/rental-closeout-readiness.md` (23/23 in a throwaway cluster, plus a
mutation check that fails in both layers without the `AND status = 'active'`
guard), both on `claude/ops-2026-10-23`. That stands. This document is only
about what M2 does to it.

## The collision

**HOSTED-INSTALL step 4 is `proposed/m2-packet/02.sql`, and it does
`CREATE OR REPLACE FUNCTION public.end_rental_tx`** — the function Option B v2
patches. Step 4 reduces `end_rental_tx` to a four-line wrapper:

```sql
outcome := public.end_rental_safe_v1(_rental_id,_end,_vehicle_status,_return_miles,_actor,'safe-release-v1');
```

and carries the write Option B replaces into `end_rental_safe_v1`, at
`02.sql:143`:

```sql
UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;
```

So:

| Order | Result |
|---|---|
| Option B v2, then M2 | **Step 4 reverts Option B.** The driver closes again. Silent — no verify fails, because step 4 is supposed to replace that function. |
| M2, then Option B v2 | **Worse.** v2 replaces `end_rental_tx` and destroys step 4's wrapper, taking the safe-release contract, the manager check, the advisory lock and the mileage guards with it. |

Neither order works with v2 alone. This is the whole finding.

## The resolution

Two proposals, and **never both**:

| Target database | File |
|---|---|
| No M2 (today) | `proposed/end-rental-returns-approved-v2.sql` — approved, 23/23 |
| HOSTED-INSTALL step 4 installed | `proposed/closeout-option-b/end-rental-safe-returns-approved-v3.sql` |

v3 is **step 4's `end_rental_safe_v1`, with one statement changed and nothing
else**, derived mechanically from `02.sql` by
`scripts/closeout-option-b-v3.mjs`. The packet file is read, never written.
`scripts/closeout-option-b-v3.test.mjs` asserts the derivation: exactly one line
removed (the `'closed'` write), exactly the two Option B lines added, the guard
present, `end_rental_tx` untouched, one transaction, one `COMMIT`. A rollback is
derived the same way and must round-trip to step 4's function exactly.

**Recommendation: install Option B after M2, using v3 only.** Installing v2
first buys nothing — step 4 undoes it — and leaves a window where the two
disagree.

## Verified on PostgreSQL 16.15

| Check | Result |
|---|---|
| v3 creates cleanly (plpgsql bodies are syntax-checked at `CREATE`) | **pass** |
| Its rollback creates cleanly | **pass** |
| After the rollback, `SET status = 'closed'` is back in the live `pg_get_functiondef` | **pass** — round trip proven on a database, not only in text |
| `prosecdef` and `search_path` after the replace | **`t`** and **`search_path=""`** — the attributes every per-step verify from step 4 onward asserts for this signature |
| ACL before vs after `CREATE OR REPLACE` by the owner | **identical**: `{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}` — exactly the string step 29's verify expects, so **v3 does not break step 29** |
| Control: a deliberately broken plpgsql body | **refused** (`missing expression at or near "THEN"`), so the passes above are not vacuous |

## The recorded-rental path needs no change

`public.close_recorded_rental_v2` (`proposed/m2-packet/04.sql`) **never writes
`applications.status`** — it only takes `FOR UPDATE NOWAIT` on the row. Across
the entire packet, the only `applications.status` writes on the rental lifecycle
are the two in `02.sql`: `activate_rental_tx` setting `'active'` and
`end_rental_safe_v1` setting `'closed'`. `record_existing_rental_tx` sets it at
all.

So a recorded rental leaves the driver wherever they were — `'approved'` — which
is Option B's outcome already. Only the legacy closeout path needs the change,
which is why there is one v3 file and not two. The test asserts `04.sql` still
has no `applications.status` write, so if that ever changes the test says so.

## Where this sits

| | |
|---|---|
| Option B design decision | made (Option B, 2026-10-23) |
| Pre-M2 proposal | approved-ready, 23/23, not installed |
| Post-M2 proposal | prepared and derived, attributes and ACL proven, **not installed** |
| Order | **after M2, v3 only** |
| Approval needed | one migration approval, separate from M2's |

Unchanged from the readiness note: `END_RENTAL_PRESERVES_APPLICATION_ENABLED`
is a hard `false`, and the flag's name understates the behaviour. Renaming it
touches `DriversPanel`, `application-status.ts` and two tests, and is not part
of either migration.
