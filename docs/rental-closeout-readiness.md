# Rental closeout correction (Option B) — readiness evidence

Prepared 2026-10-23 by Claude Code. Read-only against production; all
behavioural testing in a throwaway PostgreSQL 16 cluster.
**No production SQL was installed.**

Owner decision 2026-10-23: **Option B** — a rental that ends successfully
returns the driver to **Approved**, not Active and not Closed.

Proposal: `proposed/end-rental-returns-approved-v2.sql`.
`proposed/end-rental-preserves-application-v1.sql` (Option A) is marked
**SUPERSEDED** and kept only for the record.

## 1. The schema and the derived-Active logic, verified first

You asked that this be checked before touching the function. It was, and the
answer has two halves — both matter.

**`applications.status` really does store `'active'`.** `activate_rental_tx`
(read live via `pg_get_functiondef`) ends with:

```sql
UPDATE public.applications SET status = 'active', vehicle_id = _vehicle_id
  WHERE id = _application_id;
```

and it refuses to start unless the application is already `approved` or
`active` (`IF v_app.status NOT IN ('approved','active') THEN RAISE 'not_approved'`).
`private.application_active_guard` then refuses any move *into* `'active'`
without a running rental.

**But the Active list and count are derived, not read from that column.**
`applicationFilterCount` (`src/lib/application-status.ts:340`) answers the
`active` key from `activeIds` — built by `activeFilterApplicationIds` /
`openRentalApplicationIds` from rentals whose `status = 'active'`. Every *other*
filter matches `driver.status === key`.

Live confirmation: **zero** applications currently sit at `'active'`, and no
application has a running rental — consistent with the column only holding
`'active'` while a rental is open.

### Why that settles the design

| After a successful closeout the stored status is… | Active list | Any other filter |
|---|---|---|
| `'closed'` (today) | gone (derived) | **Closed** — and `closed → approved` is disabled for *every* tier by design (`applicationStatusChoiceDisabled:155`), so re-renting needs an Owner/Manager reopen plus re-approval. A Coordinator cannot do it at all. |
| `'active'` (Option A) | gone (derived) | **none — the driver matches no filter and is invisible in every tab** |
| `'approved'` (Option B) | gone (derived) | **Approved** — which is exactly what `activate_rental_tx` requires to start the next rental |

So Option B is the only one of the three where the driver both leaves Active
*and* lands somewhere that means "ready to rent again".

## 2. The change

Vs. the function installed in production, **one statement changes**:

```sql
-- installed
UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;
-- proposed
UPDATE public.applications SET status = 'approved'
  WHERE id = r.application_id AND status = 'active';
```

`AND status = 'active'` is load-bearing, not decoration. `'active'` is what a
running rental means, so that is the state a normal closeout unwinds. If a
person moved the driver to **suspended** or **declined** during the rental, that
is an eligibility decision — and without the guard, returning a car would
silently clear a suspension. Section 4 proves both halves.

Everything else is untouched: approval and vetting history, documents, payment
history, rental history, odometer history, and the application's own columns
(including `vehicle_id`, which the installed activation sets and the installed
closeout already leaves alone). Automation cancellation is unchanged.

## 3. Verified against what is actually installed

The text test compares the proposal to the *migration file*; that leaves open
whether the migration file is still what production runs. It is — checked by
read-only `pg_get_functiondef`:

| Check | Result |
|---|---|
| Rollback half vs the live function | identical (modulo `CREATE OR REPLACE`, see below) |
| Forward half vs the live function | the one statement above, nothing else |
| Other functions that write `applications.status` | `activate_rental_tx`, `promote_waitlist_entry`, `resolve_waitlist_phone_conflict` — none on the closeout path |
| Triggers on `public.rentals` | `guard_rental_lifecycle`, `rentals_set_updated_at` — neither writes `applications` |

**Defect found and fixed while testing:** the installed migration declares
`CREATE FUNCTION`, not `CREATE OR REPLACE`. A rollback block copied verbatim
from it fails with *"function already exists with same argument types"* — the
function necessarily exists by the time anyone rolls back. The v2 rollback now
says `CREATE OR REPLACE`, and both the text test and the harness assert it.

## 4. Behavioural evidence — `scripts/closeout-harness/run.sh`

Throwaway cluster, `private.application_active_guard` copied verbatim from
production, both function versions run for real. **23/23 pass.**

```
A. installed function (control: it closes the application)
  ok  end_rental_tx returns closed
  ok  application is CLOSED today
  ok  and today the driver CANNOT re-rent
B. proposed v2 — Option B
  ok  end_rental_tx returns closed      ok  application RETURNS TO APPROVED
  ok  the driver CAN re-rent            ok  rental is closed
  ok  rental end_date is set            ok  autopay is off
  ok  vehicle is available              ok  automation is cancelled
  ok  cancel reason kept                ok  vetting notes untouched
  ok  rental history kept               ok  odometer history kept
C. eligibility decisions made during the rental are NOT overwritten
  ok  a 'suspended' driver stays 'suspended' after the rental ends
  ok  a 'declined'  driver stays 'declined'  after the rental ends
  ok  a 'reviewing' driver stays 'reviewing' after the rental ends
D. the active guard
  ok  application is approved, no running rental
  ok  cannot hand-edit back to Active with no rental     <- negative control
  ok  guard still refuses a new Active with no rental    <- negative control
E. Active is derived, so the driver leaves the Active list either way
  ok  no active rental remains for this application
F. rollback restores today's behaviour
  ok  application closes again after rollback
```

Section A is the control: it proves the harness sees the closing write *and*
that today's behaviour genuinely blocks a re-rental, so B's two headline rows
are not vacuous. "CAN / CANNOT re-rent" is the real precondition from
`activate_rental_tx` (`status IN ('approved','active')`), not a restatement of
the status.

**Mutation check.** Deleting `AND status = 'active'` from the proposal:

- the text test fails, and
- the harness fails with `a 'suspended' driver stays 'suspended' … got 'approved'`
  and the same for `'declined'`.

So the guard is covered by a test that fails without it, in both layers.

**Harness hardening.** An earlier run lost the cluster mid-way and printed 23
failed assertions that looked like findings. The harness now refuses to start
without a reachable server and aborts with exit 2 if it loses the connection
mid-run — a dead cluster can never be mistaken for a result. (Keep `PGDATA`
outside the session scratchpad: its parent directory's permissions are
re-tightened periodically, which is what killed that run.)

## 5. Status

| | |
|---|---|
| Schema and derived-Active logic verified first | yes |
| Proposal verified against the live function | yes |
| Behaviour proven, rollback proven | yes, 23/23 + mutation check |
| App-side flag | `END_RENTAL_PRESERVES_APPLICATION_ENABLED` is a hard `false`; with it on, `DriversPanel` correctly skips the local `onSaved({status:"closed"})` patch so the screen matches the database |
| Installed | **no — needs your separate migration approval** |
| Release status | **Ready for Approval** |

```
scripts/closeout-harness/run.sh <datadir> <port>   # throwaway cluster only
node scripts/end-rental-preserves-application.test.mjs
```

## 6. One note, not a question

The flag's name now understates what it does — it reads "preserves application"
but the behaviour is "returns to Approved". Renaming it touches `DriversPanel`,
`application-status.ts` and two tests. Not done, because you asked for the
smallest compatible change and the name is not part of the migration. Worth
doing in a later cleanup.
