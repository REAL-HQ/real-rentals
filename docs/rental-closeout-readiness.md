# Rental closeout correction — readiness evidence

Prepared 2026-10-23 by Claude Code. Read-only against production; all behavioural
testing in a throwaway PostgreSQL 16 cluster. **No migration was installed.**

Subject: `proposed/end-rental-preserves-application-v1.sql` — stop ending a
rental from closing the renter's application.

## 1. The proposal matches what is actually installed

`scripts/end-rental-preserves-application.test.mjs` compares the proposal against
the *migration file*. That leaves open whether the migration file is still what
production runs. It is. A read-only `pg_get_functiondef` on
`public.end_rental_tx` was diffed against both halves of the proposal:

| Check | Result |
|---|---|
| ROLLBACK block vs the live function | **identical** (normalized) |
| Forward change vs the live function | **one line removed**, nothing else |

The only semantic difference is the removal of:

```sql
UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;
```

The remaining diff is cosmetic header formatting that `pg_get_functiondef`
normalizes (`DEFAULT NULL` vs `DEFAULT NULL::integer`, clause line wrapping).

## 2. No other path closes the application

- Functions whose body touches `applications` + `status` + `update`:
  `activate_rental_tx`, `end_rental_tx`, `promote_waitlist_entry`,
  `resolve_waitlist_phone_conflict`. Only `end_rental_tx` is on the closeout path.
- Triggers on `public.rentals`: `guard_rental_lifecycle`, `rentals_set_updated_at`.
  **Neither writes to `applications`.**
- Triggers on `public.applications`: `applications_active_guard`,
  `applications_updated_at`.

So removing that one line is sufficient. Nothing else re-closes the row.

## 3. Behavioural evidence — `scripts/closeout-harness/run.sh`

A throwaway cluster, the live `private.application_active_guard` copied verbatim,
and both function versions run against it. **18/18 checks pass.**

```
A. installed function (control: it closes the application)
  ok  end_rental_tx returns closed
  ok  application is closed by the installed function
B. proposed function
  ok  end_rental_tx returns closed
  ok  application status is PRESERVED
  ok  rental is closed            ok  rental end_date is set
  ok  autopay is off              ok  vehicle is available
  ok  automation is cancelled     ok  cancel reason kept
  ok  application notes untouched
C. the active guard after the rental ended
  ok  an edit to the still-active application succeeds
  ok  the edit landed
  ok  guard still refuses a new Active with no rental        <- negative control
  ok  cannot hand-edit back to Active after the rental ended <- negative control
D. rollback restores today's behaviour
  ok  application closes again after rollback
```

Section A is the control: it proves the harness can see the closing write, so
section B's "PRESERVED" is not vacuous. The two controls in C prove the guard is
live in the harness rather than silently absent.

### What C establishes

`private.application_active_guard` only fires on the **transition into**
`active` (`TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active'`). It does
not police a row that stays `active`. So after the change the application sits at
`active` with no running rental, the guard tolerates it, and the row stays
editable. Nothing errors.

## 4. The argument for installing it, which is stronger than "preserve the status"

Today's behaviour does not merely lose information — it **traps the renter's
record**. `applicationStatusChoiceDisabled` (`src/lib/application-status.ts:155`)
disables `closed → approved` for **every tier, including Owner**, by design:
Approved must go through `approveApplication` after an Owner or Manager reopens
the row. And a Coordinator cannot leave `closed` at all
(`canReopenClosedApplication`, line 139).

So a driver who simply finishes a rental lands in `closed`, and putting them back
in a car takes an Owner or Manager reopening the row and re-approving it. With
the proposal the application stays `active`, and `active → approved` is open —
which is the path the Application Resume work assumes.

## 5. Open decision for the owner

After the change the application reads **Active** for a driver with no car, until
someone moves it. The guard means that once moved off Active it cannot be set
back by hand — only `activate_rental_tx` (a new rental) can.

Two readings of "preserve the driver's application status":

- **(a) Leave it `active`** — what the proposal does. Nothing else to build.
  Cost: the Drivers list shows Active drivers with no vehicle.
- **(b) Return it to `approved`** — matches "ready to rent again". Needs one more
  line in the function and a separate decision; **not** in the proposal and not
  written.

The proposal as it stands is (a). Say which you want before the migration is
approved; (b) changes the SQL and would need re-review.

## 6. Status

| | |
|---|---|
| Proposal verified against live | yes |
| Behaviour proven, rollback proven | yes, 18/18 |
| App-side flag correct | yes — `END_RENTAL_PRESERVES_APPLICATION_ENABLED` is a hard `false`; with it on, `DriversPanel` correctly skips the local `onSaved({status:"closed"})` patch so the screen matches the database |
| Installed | **no — needs owner migration approval** |
| Release status | **Ready for Approval** (blocked only on the owner, and on decision 5) |

Run the harness:

```
scripts/closeout-harness/run.sh <datadir> <port>   # throwaway cluster only
```
