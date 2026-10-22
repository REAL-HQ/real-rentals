# Owner database queue

Nothing here has been run on production. Checked against the open pull-request heads on 22 Oct 2026. RC15 is `c46354b0`. M2 #190 is `29d47ee3` (guard `fd402d5c`). M3 #232 is `69a2001d`. The preflight-guard re-review passed. Production row counts, live grants, and lock times were not measured. The scratch rehearsals below used local clones and then dropped them.

## #173 Waitlist claim (`08dc1778`)
Adds `claim_token_hash` and rewrites waitlist grants. The rate file then refuses a sixth signup from the same email in one hour, and that limit is live as soon as the file is saved. The claim link stays off (`WAITLIST_CLAIM_ENABLED` is false). Coming Soon still sends the same 12 columns. Promote-skip is notes only. Landing-length is a separate applications check.
`proposed/waitlist-coming-soon-rate-v1.sql` grants execute to anon and authenticated so the trigger can fire. That grant is benign: the function is trigger-only, a direct call is refused, and the call returns no waitlist row. #232 step 2 (`69a2001d`) revokes that execute as housekeeping. The limit is the same. Approving #173 installs this file and leaves #232 step 2 uninstalled.
The index is not concurrent, so it locks waitlist writes. The file sets `lock_timeout` to 5 seconds. Re-running it keeps one index. A live lock duration was not measured. Live grants were not read. Order: set `WAITLIST_CLAIM_SECRET` before the link.
Rollback: `proposed/waitlist-claim-rollback.sql` drops the rate trigger, function, and index, restores the waitlist grants, and drops `claim_token_hash`. Scratch `rb173`: `lock_timeout` was 5s, a second apply left one index, the anon direct call was refused as a trigger function, and the rollback left the function, trigger, and index absent with the waitlist grants matching the clone. An M3 step 2 install is undone with #232 `proposed/m3-rollback/02-waitlist-coming-soon-rate.sql`. Landing-length undo is the ROLLBACK section of `proposed/application-landing-length-v1.sql`.
Approve with its feature. Save the rate trigger only when you want that live limit.

## #231 Mileage allowance (`590ef69e`)
Adds read-only `agreement_mileage_allowance(agreements)` for service_role. It reads the mileage phrase and writes nothing. The Active column stays off (`ACTIVE_MILEAGE_OVERAGE_ENABLED` is false). Unblocks that column.
No other dependency. This file is under `supabase/migrations`, so a deploy of this branch would run it. It does not rewrite agreements.
Lock: one function create. Each later call reads one agreement body. Not measured.
Rollback: `proposed/rollback/agreement-mileage-allowance.sql` drops the function. It is not a migration. Scratch `rb_queue`: the function was absent, the migration created it with execute for service_role only, and the rollback left it absent.
Approve with its feature.

## #178 Linked maintenance in vehicle P&L (`e8a97ba8`)
Replaces live `vehicle_pl`. Expenses already include a linked service, and maintenance adds `company_share` again. On this branch `company_share` is numeric, not null, default 0. The proposal skips a service when a `vehicle_expenses` row names it. Managers see the new net the next time P&L opens. There is no flag.
No dependency. Install replaces the function and does not rewrite a table. A cost can drop out of both columns when the expense date and the service date fall on opposite sides of the window. Hosted rows were not counted.
Rollback: `proposed/rollback/vehicle-pl-linked-maintenance-v1.sql` restores the function copied from `supabase/migrations/20261006020456_cf3a2cce-fa6e-4f72-85b9-c95c5d634bb4.sql`. The function only. Leave that migration unchanged. That migration also drops a storage policy. Scratch `rb_queue`: the proposal changed the body, the rollback matched `pg_get_functiondef` to the clone, and the rollback file has no storage statement. The named photo policy was already absent on the clone.
Approve now.

## #226 Driver doc TNC (`e01ef62f`)
Adds two empty dates on applications: when the Uber approval expires, and when the Lyft approval expires. Existing rows are not rewritten. The Documents column stays off (`DRIVER_DOC_EXPIRY_ENABLED` and `DRIVER_DOC_EXPIRY_SEPARATE_TNC` are false).
`proposed/driver-doc-expiry-tnc.sql` sets `lock_timeout` to 5 seconds and can be run again. A second apply keeps the same two columns. There is no function, so there is no execute grant. anon cannot select the new dates. authenticated can select them only because that role can already select applications, and the existing row policies still apply. Same columns are M3 step 1 on #232 (`69a2001d`), in a different file that sets a 2 second lock timeout. Install one copy.
Lock: an applications alter. A live lock duration was not measured. Rollback: `proposed/rollback/driver-doc-expiry-tnc.sql` drops only those two dates. `license_expiration` and `insurance_expires_on` stay. Scratch `rb226`: `lock_timeout` was 5s, a second apply left both columns, anon was refused with permission denied, and the rollback matched the clone. #232 has `proposed/m3-rollback/01-tnc-approval-expiry.sql`.
Approve with its feature, using one copy.

## #191 Vehicle swap (`a8828886`)
`proposed/vehicle-swap-v1.sql` is a pointer. Do not run it. The SQL is #190 (`29d47ee3`) `proposed/m2-packet/20.sql`, step 26. It adds swap tables and a column on `booking_vehicle_assignments`. The file sets `lock_timeout` to 5 seconds and can be run again. The screen stays off (`SWAP_ENABLED` is false). Unblocks vehicle swap.
Order: after the M2 objects named in that file. Those tables are not in the RC15 migrations. After step 23, swap and extend can go in either order.
Install locks `booking_vehicle_assignments` for the new column. A swap uses no-wait locks. A live lock duration was not measured. Rollback: `proposed/rollback/20-vehicle-swap.sql` on #190 and on #191. Same file.
Grants. The two private functions execute for `rr_record_executor` only. `swap_rental_vehicle_tx` executes for authenticated and that executor. anon and service_role do not. That authenticated grant is the staff path: a direct anon call was permission denied, and an authenticated call outside the gateway raised `trusted_authentication_context_required` and returned no row. A real session still has to be admin or team before the function will swap a car. `list_assignment_history_v1` executes for authenticated only. anon was permission denied. An authenticated call with a rental id raised `staff_required` and returned no row. The read runs only for admin, team, or coordinator. Neither grant is anon, and neither returned a row to a non-staff caller.
Scratch `rbfeat`: local steps 1 through 25, then this file. `lock_timeout` was 5s, a second apply matched the first schema dump, and the rollback matched the pre-step dump. The clone was dropped.
Approve with its feature, only as M2 step 26.

## Backfill assignment intervals (`a8828886`, on #191)
`proposed/backfill-assignment-intervals.sql` inserts nothing. It raises `backfill_refused_live_records_unread`. It does not change rentals, vehicles, payments, or agreements. Nothing visible. It would unblock history for cars changed before assignments existed.
Order: after M2 step 26, and only from rows an owner has read. The ids in the file are still marked unread.
No lock. It stops before any insert. Rollback file: missing. None applies until a later revision writes rows.
Defer.

## #181 Extend rental (`68c59c1b`)
`proposed/extend-rental-v1.sql` is a pointer. Do not run it. `proposed/m2-packet/extend.sql` matches #190 (`29d47ee3`) step 27. It adds a private operations table and `extend_rental_tx`, which updates `rentals.end_date` and does not call Stripe. The file sets `lock_timeout` to 5 seconds and can be run again. The button stays off (`EXTEND_RENTAL_ENABLED` is false). The handler refuses a Stripe write.
Order: after M2 steps 1, 5, and 23. Not from RC15 alone. Either order with swap after step 23.
Install creates a new private table. An extend uses no-wait locks. A live lock duration was not measured. Execute is service_role only. anon and authenticated are not granted. A direct anon call and a direct authenticated call were permission denied. A service_role call with no actor raised `manager_required` and returned no row. Rollback: `proposed/rollback/extend-rental.sql` on #190 and on #181. Same file.
Scratch `rbfeat`: after the swap undo, this file set `lock_timeout` to 5s, a second apply matched the first schema dump, and the rollback matched the pre-step dump. The clone was dropped.
Approve with its feature, only as M2 step 27.

## #183 JV partner statement (`a02628f3`)
`proposed/jv-statement-v1.sql` creates nothing. The statement is app code, off while `FINANCE_JV_STATEMENT_ENABLED` is false. It counts each expense once and does not change `vehicle_pl`. A refund larger than its payment leaves the partner share blank. It unblocks no database feature.
No install order. Live P&L stays on the old double-count until #178.
No lock. Rollback file: missing. There is nothing to undo.
Defer. Nothing to run.

## #203 Incident Board claims (`4373fec2`)
Creates `incidents_log_v1` and `incidents_log_v1_links` for a recovered amount and one document or inspection link. Managers can select. The app does not insert into these tables, so both stay unknown. The board stays off (`INCIDENT_BOARD_ENABLED` is false).
No dependency on the other items. The foreign keys lock incidents, documents, and inspections briefly. Duration not measured.
Rollback file: missing.
Defer until there is an undo and a way to store a recovered amount.

## #218 Vehicle compliance (`99f1b5ef`)
`proposed/vehicle-compliance-inspection.sql` creates nothing. Registration, insurance, and plate dates already exist. Inspection stays unknown until `maintenance_due_v1` or `maintenance_log_v1`, and this file says to install at most one of those. The column stays off (`VEHICLE_COMPLIANCE_ENABLED` is false).
No dependency. This file takes no lock.
Rollback comments in the file drop those other tables. This pull request does not install them.
Defer. No database change is required for the dates that already exist.
