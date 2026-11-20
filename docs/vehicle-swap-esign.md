# E-Signed Vehicle Swap

Dolmar asked for this on Nov 20, 2026 (t532u). Staff use it to move an **active**
rental to a different car, for example when the car has a problem. The renter
e-signs a swap agreement for the new car, and staff then record the handover.

**Status: built, OFF.** The migration is not applied and the switch is not set.

## What It Does

1. **Swap Vehicle** (Bookings → an active rental → Vehicles card). Manager or Owner.
   - Pick the replacement car in the shared vehicle picker: thumbnail, plate,
     last 6 of the VIN, and no unit number. The list shows only Available,
     unarchived cars that are on no reserved, On Hold or active booking and
     not promised to another open swap. The server also checks that the car is
     Rental Ready (`vehicle_rental_ready_missing`).
   - Pick a reason (Upgrade, Downgrade, Maintenance, Damage, Replacement,
     Other) and write a short description.
   - Damage Waiver, Payment Schedule, Payment Method and Vehicle Owner carry
     over from the e-signed original. A paper original has none of these on
     record, so staff pick them, and Send is blocked until they do.
   - **Preview Agreement** renders the exact swap agreement and opens the PDF.
     **Send For E-Signature** sends that same agreement, and the server refuses
     it if anything changed after the preview (same fingerprint rule as every
     staff send).
2. **The agreement.** It is generated from the current default template
   (v1.15, `insurance_included_v115`) by the normal `prepareAgreement` /
   `issueAgreement` step, using the updated-agreement (amendment) path:
   - It names the **new** car: year, make, model, colour, plate and full VIN.
     The full VIN is required on contracts.
   - It keeps the rental's weekly rate and payment choices. It carries no
     Reservation Fee and no new deposit, and late-fee and rent terms are
     whatever the template says. Nothing changes them.
   - Home Address and every other `buildMergeData` blocker still apply.
   - A **Vehicle Swap** notice is printed at the top, in the same highlight
     box as an amendment notice. It names the agreement being replaced (the
     signed date and RRA number, or "your Rental Agreement on file" for
     paper) and the car being returned.
   - Title "Rental Agreement (Vehicle Swap)". The row's `rental_id` is set and
     `metadata.amendment.kind = "vehicle_swap"`.
   - It goes out through the existing e-sign flow (`deliverSigningLink`, by
     email and SMS).
3. **On signing** (`esign.server.ts completeSigning` → `onSwapSigned`):
   - The swap becomes `signed`.
   - The signed PDF is filed on the renter's Documents as
     `Rental Agreement — Swap (follows <original doc>)`. Agreement Filing uses
     the same label for its Swap role, so e-signed and paper swaps look alike.
   - The renter's "signed" email says the swap is signed and that rent is
     unchanged.
   - FLEET gets no first-signing event, and the reservation check is skipped.
   - The car does **not** move yet.
4. **Complete Swap** (handover, Manager or Owner):
   - Staff enter the return odometer and fuel (current car), the pickup
     odometer and fuel (new car), and where the returned car goes
     (Maintenance, the default, or Available, the same choice End Rental
     offers).
   - `complete_rental_vehicle_swap_tx` then does all of this in one
     transaction:
     - locks the rental, then both cars with the lower uuid first (NOWAIT,
       40001 on contention);
     - checks that the swap is signed and that the signed agreement names
       this rental and this car;
     - checks that the new car is still Available, free and Rental Ready;
     - checks the odometer readings the way End Rental does;
     - writes the swap's own odometer readings (`swap_return:<id>`,
       `swap_checkout:<id>`);
     - moves `rentals.vehicle_id` and `pickup_reading_id` to the new car, and
       `applications.vehicle_id` if it still named the old car;
     - sets the new car to Rented and the old car to Maintenance or Available;
     - writes one `audit_log` row (`rental.vehicle_swapped`).
   - It never touches payments, Stripe, autopay, deposits or the weekly rate.
   - Photos: run a Vehicle Inspection on each car. The return checklist is
     still off, so the swap does not store photos itself.
5. **Cancel Swap** works while a swap is open. An unsigned agreement is voided
   through `esign_void`. A signed but not-yet-completed swap is marked voided,
   and its signed agreement stays on file.

It works the same whether the original is e-signed (v1.14 or any other
version) or a paper agreement. A paper original must be filed in Agreement
Filing and **verified** first. The swap follows the newest signed e-agreement.
If there is none, it follows the newest verified paper agreement. If neither
exists, the send is refused.

James (rental `9108ea8c`) follows `RRA-20261116-2A4BBF` (e-signed v1.14). His
Damage Waiver (Declined) and payment choices (Weekly, Card Autopay) carry over.

## The Gate (Replaces `SWAP_ENABLED = false`)

The swap is on only when **both** of these are true. The server checks them
before every read-for-write and every write:

- the migration is installed: the table answers and the function exists (a
  side-effect-free probe), and
- `app_settings` key `vehicle_swap` is exactly `{"enabled": true}`.

If either is missing, the button is disabled and shows "Vehicle Swap is off…",
and every server function refuses with nothing written. Any error reading the
gate counts as off.

## How To Turn It On (Needs Dolmar's OK For Each Step)

1. Merge the PR and publish the site. This is safe while off: nothing changes
   for anyone.
2. Apply `supabase/migrations/20261120130000_rental_vehicle_swaps.sql` to
   production. Take the usual backup first. The migration is idempotent,
   creates only new objects, and switches nothing on.
3. Check:
   ```sql
   SELECT to_regclass('public.rental_vehicle_swaps') IS NOT NULL AS table_ok,
          to_regprocedure('public.complete_rental_vehicle_swap_tx(uuid,text,integer,integer,text,text,uuid)') IS NOT NULL AS fn_ok;
   ```
4. Switch it on:
   ```sql
   INSERT INTO public.app_settings(key, value, updated_at)
   VALUES ('vehicle_swap', '{"enabled": true}', now())
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   ```
5. To switch it off again, set `{"enabled": false}` (or delete the row). Open
   swaps stay on record. The rollback for the migration is at the bottom of
   the migration file (run it only if no swap was completed).

## Tests

- `bun test scripts/vehicle-swap-esign.test.ts`: gate, wording, store-then-send,
  refusals, paper originals, signing hook, handover validation, wiring.
- `node scripts/vehicle-swap-db.test.cjs`: applies the migration twice to a
  local Postgres, using production's guard triggers, odometer guard,
  `rental_mileage_reading` and `end_rental_tx` copied verbatim. It proves:
  grants, unique open swaps, refusals with no writes, 40001 on a held lock,
  the completed swap (billing unchanged), the replay, and End Rental afterwards.
  It skips if no Postgres binaries are found (set `PG_BIN`).

## Replaces

The M2 packet's swap (`proposed/m2-packet/19b.sql`,
`proposed/m2-with-approval-boundary/19c-agreement-contract.sql`,
`proposed/m2-packet/20.sql`) was never installed. It depends on about 20
earlier packet steps that production does not have: the assignment ledger,
`private.record_operations`, `private.approval_lock()` / `approval_actor()` and
the `rr_record_executor` role. Its sound parts were kept: lock order, the
pointer moving before the status writes, separate odometer evidence keys, one
audit row, and no billing writes. The M2 replacement-agreement module, its UI
and its tests are removed.
