# Owner database queue

Nothing here has been run on production. Checked against the open pull-request heads on 22 Oct 2026. RC15 is `c46354b0`. M2 #190 is `3be1805f`. M3 #232 is `4650e460`. Production row counts, live grants, and lock times were not measured.

## #173 Waitlist claim (`35dc3e9e`)
Adds `claim_token_hash` and rewrites waitlist grants. The rate file then refuses a sixth signup from the same email in one hour, and that limit is live as soon as the file is saved. The claim link stays off (`WAITLIST_CLAIM_ENABLED` is false). Coming Soon still sends the same 12 columns. #232's rate file is different and does not grant execute. Promote-skip is notes only. Landing-length is a separate applications check.
Order: set `WAITLIST_CLAIM_SECRET` before the link. Install one rate file only. The new index is not concurrent, so it locks waitlist writes. Duration not measured. Live grants were not read.
Rollback: `proposed/waitlist-claim-rollback.sql`. Landing-length undo is the ROLLBACK section of `proposed/application-landing-length-v1.sql`.
Approve with its feature. Save the rate trigger only when you want that live limit.

## #231 Mileage allowance (`fdce2b15`)
Adds read-only `agreement_mileage_allowance(agreements)` for service_role. It reads the mileage phrase and writes nothing. The Active column stays off (`ACTIVE_MILEAGE_OVERAGE_ENABLED` is false). Unblocks that column.
No other dependency. This file is under `supabase/migrations`, so a deploy of this branch would run it. It does not rewrite agreements.
Lock: one function create. Each later call reads one agreement body. Not measured. Rollback file: missing.
Approve with its feature.

## #178 Linked maintenance in vehicle P&L (`b97faf7a`)
Replaces live `vehicle_pl`. Expenses already include a linked service, and maintenance adds `company_share` again. On this branch `company_share` is numeric, not null, default 0. The proposal skips a service when a `vehicle_expenses` row names it. Managers see the new net the next time P&L opens. There is no flag.
No dependency. Install replaces the function and does not rewrite a table. A cost can drop out of both columns when the expense date and the service date fall on opposite sides of the window. Hosted rows were not counted.
Rollback file: missing. Do not re-run `supabase/migrations/20261006020456_cf3a2cce-fa6e-4f72-85b9-c95c5d634bb4.sql`. That file also drops a storage policy.
Approve now.

## #226 Driver doc TNC (`fe58e9d6`)
Adds two empty dates on applications: when the Uber approval expires, and when the Lyft approval expires. Existing rows are not rewritten. The Documents column stays off (`DRIVER_DOC_EXPIRY_ENABLED` and `DRIVER_DOC_EXPIRY_SEPARATE_TNC` are false).
Same columns are M3 step 1 on #232 (`4650e460`), in a different file that sets a 2 second lock timeout. Install one copy.
Lock: an applications alter. This file sets no lock timeout. Duration not measured. Rollback is commented in `proposed/driver-doc-expiry-tnc.sql`, not a separate file. #232 has `proposed/m3-rollback/01-tnc-approval-expiry.sql`.
Approve with its feature, using one copy.

## #191 Vehicle swap (`d3f4cb17`)
`proposed/vehicle-swap-v1.sql` is a pointer. Do not run it. The SQL is #190 `proposed/m2-packet/20.sql`, step 26. It adds swap tables and a column on `booking_vehicle_assignments`. The screen stays off (`SWAP_ENABLED` is false). History calls check for staff. Unblocks vehicle swap.
Order: after the M2 objects named in that file. Those tables are not in the RC15 migrations. After step 23, swap and extend can go in either order.
Install locks `booking_vehicle_assignments` for the new column. A swap uses no-wait locks. Duration not measured. Rollback: `proposed/rollback/20-vehicle-swap.sql` on #190. Missing on #191.
Approve with its feature, only as M2 step 26.

## Backfill assignment intervals (`d3f4cb17`, on #191)
`proposed/backfill-assignment-intervals.sql` inserts nothing. It raises `backfill_refused_live_records_unread`. It does not change rentals, vehicles, payments, or agreements. Nothing visible. It would unblock history for cars changed before assignments existed.
Order: after M2 step 26, and only from rows an owner has read. The ids in the file are still marked unread.
No lock. It stops before any insert. Rollback file: missing. None applies until a later revision writes rows.
Defer.

## #181 Extend rental (`088032ff`)
`proposed/extend-rental-v1.sql` is a pointer. Do not run it. `proposed/m2-packet/extend.sql` matches #190 step 27. It adds a private operations table and `extend_rental_tx`, which updates `rentals.end_date` and does not call Stripe. The button stays off (`EXTEND_RENTAL_ENABLED` is false). The handler refuses a Stripe write.
Order: after M2 steps 1, 5, and 23. Not from RC15 alone. Either order with swap after step 23.
Install creates a new private table. An extend uses no-wait locks. Duration not measured. Rollback: `proposed/rollback/extend-rental.sql` on #190. Missing on #181.
Approve with its feature, only as M2 step 27.

## #183 JV partner statement (`d51182c5`)
`proposed/jv-statement-v1.sql` creates nothing. The statement is app code, off while `FINANCE_JV_STATEMENT_ENABLED` is false. It counts each expense once and does not change `vehicle_pl`. It unblocks no database feature.
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
