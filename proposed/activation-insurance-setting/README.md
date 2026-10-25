# Activation insurance setting v1: Owner exception, audited setter, checked activation transaction

**Status: PREPARED, NOT APPROVED. Nothing here has run in production.** It was tested only on a
private local Postgres 17.6 (`en_US.UTF-8`, port 55482) and a local PostgREST 12.2.3 (port 55483).

This is a guarded direct-route package. It is **not** a file in `supabase/migrations` or
`drizzle/migrations`, because production has Drizzle 0023 pending, and the next Lovable
migration would apply 0023 implicitly. It writes no migration ledger.

## Artifacts

| Artifact | SHA-256 | Bytes |
|---|---|---|
| `activation_insurance_setting_v1.sql` (the package, one `DO` statement) | `670b5b5423af6d929bf25bab025da96e10b99902acad26191bf5a0079c5a2f87` | 31,511 |
| **`request-activation-insurance-setting.sql`** = guard v3 + the unchanged package | **`fca4ef6c79afb618a2a4088f48ce789557659241cd21ae81fd27ecc7d01a916c`** | 33,529 |
| Inner DDL (`src/inner.sql`, embedded, checked by the package) | `0c9089370ba8c837c08bddeda070b3a64dddb4bdcaad66c71e5224ab579014ae` | — |
| `preflight-readonly.sql` | `8854a276b76ec4dd3ca182e4da7df2e711a35622777a09da20cfc9ae146a9053` | 6,625 |
| `verify-after-readonly.sql` | `26615457910caf928f5bf367a79456f89d0f01d621843fe2434e7ae122e004f3` | 6,340 |
| `rollback.sql` (needs separate approval) | `a8bd36d537e66111c16726a39ef3992f9775881406d0148bd0104982fe07e9fc` | 14,155 |
| `request-rollback-activation-insurance-setting.sql` = guard v3 + rollback | `0d62fd76be4b5d5bf2fcd7d034dff666905ce7e9bd2da55322cd7b71823f2f07` | 16,150 |
| Function bodies (`prosrc`, checked after install) | wrapper `03d5108a…759a`, setter `39ff1d56…fd97`, guard `8723cbde…214e` | — |

- `src/build.py` generates every file above from `src/inner.sql` and `src/rollback-inner.sql`.
  Run `python3 proposed/activation-insurance-setting/src/build.py --check` to reproduce them
  byte for byte.
- The guard generator is `scripts/sql-guard/gen-guard3.py`. It is byte-identical to the reviewed
  generator (`2c8c8967…66f7`), the same file used for Security 0031, S1 and the M2 guarded
  requests.
- `sha256sum -c SHA256SUMS` checks every file.

## What it changes

1. **The setting.** The package adds one row to the existing `public.app_settings` table: key
   `rental_activation`, value `{"allow_activation_without_insurance_verification": false}`.
   - The default is OFF.
   - The app reads a missing row, a missing field, a non-boolean value or an unreadable row as
     OFF (`src/lib/rental-activation-settings.ts`).
2. **The Owner setter.** `public.set_rental_activation_insurance_exception(_allow boolean)` is
   `SECURITY DEFINER` with `SET search_path = ''`. `EXECUTE` is granted to `authenticated` only.
   - It refuses unless `auth.uid()` is set and `private.is_owner()` is true
     (`owner_required`, 42501).
   - It row-locks the setting and writes it. In the **same transaction** it writes the
     `settings.rental_activation_updated` audit row: actor, email, `from`, `to`, `changed_at`,
     and `from_row_present`.
   - The app calls it with the Owner's own JWT, from the server function
     `setAllowActivationWithoutInsuranceVerification`, after `requireOwner`.
3. **Every other writer is refused.**
   - The row trigger `private.rental_activation_setting_guard()` (`SECURITY INVOKER`) refuses
     any write to that key unless it comes from the setter. The setter sets a transaction-local
     flag and runs as the function owner. A client role (`authenticated`, `anon`,
     `service_role`) is refused even if it sets the flag itself.
   - Three `RESTRICTIVE` policies (INSERT, UPDATE and DELETE, `TO authenticated`) refuse direct
     writes of the key as a second layer. Other `app_settings` keys keep the existing Owner-only
     policy, unchanged.
4. **The checked activation.** `public.activate_rental_checked_tx(<the 10 activate_rental_tx
   arguments>, _insurance_exception_ack boolean)` is `SECURITY DEFINER`,
   `SET search_path = ''`, plpgsql. `EXECUTE` is granted to `service_role` only. In one
   transaction it:
   1. takes M2's shared release lock `pg_advisory_xact_lock(710026,2)`. This keeps M2's lock
      order (the lock comes before any row lock); `activate_rental_tx` takes it again
      re-entrantly once M2 Window 1 is installed.
   2. reads the setting `FOR SHARE`;
   3. locks the application `FOR UPDATE` (the same lock `activate_rental_tx` takes next, so
      there is no share-to-update upgrade deadlock). It locks the screening, the current
      insurance, licence and agreement documents, and the signed agreements `FOR SHARE`.
   4. computes the insurance status, with the same precedence as the app: **expired** (the
      application date or a current insurance document date is before today in
      America/New_York), then **verified** (`driver_screenings.insurance_verified`), then
      **missing** (no current, non-rejected insurance document), then **unverified**.
   5. re-checks the hard requirements it gates: licence front and back, and a signed agreement.
      A signed agreement is either an eSign rental agreement that is signed, not voided, and not
      yet linked to a rental, or a current, Verified paper agreement document with a matching
      Owner/Manager `document.verified` audit row (same document id, storage path and
      `reviewed_at`).
   6. refuses unless the insurance status is `verified`, or the setting is ON **and**
      `_insurance_exception_ack` is true. The errors are `insurance_not_verified:<status>` and
      `insurance_ack_required:<status>`.
   7. calls `public.activate_rental_tx` unchanged. Approval, vehicle readiness, double-booking,
      already-active and mileage are still enforced there.
   8. writes the `rental.activation_checked` audit row: actor, insurance status, whether the
      exception was used, the setting value it read, the acknowledgement, which kind of signed
      agreement it found, and the transaction id. The row commits atomically with the rental.
5. **Evidence.** The package writes one `security_migration_verified` audit row. A re-run is
   refused (`AIS_EVIDENCE_REPLAY`).

**What it does not change:** `activate_rental_tx`, `end_rental_tx`, migration 0021, vehicle
allocation, the Security 0031 policies, `driver_screenings`, documents, grants on any table,
and both ledgers. The package checks each of these before and after it runs, and refuses if
anything drifted.

Insurance is never set to verified by any path in this package or in the app.

## Transaction boundary: verified, and the limitations

All of the following was checked on the local Postgres (results are in `test-results.json`).

**Function shape.**
- Both functions are plpgsql `SECURITY DEFINER`, with no dblink, `pg_background`, `COMMIT` or
  `ROLLBACK`, and neither extension is installed (B1).
- The wrapper has no exception handler.
- `activate_rental_tx` has an `EXCEPTION WHEN unique_violation` block that re-raises. Its
  subtransaction therefore aborts the whole transaction; it does not swallow the error.

**PostgREST.** PostgREST wraps each RPC call in one transaction.
- A failing call (`vehicle_busy` raised inside `activate_rental_tx`) wrote nothing.
- A successful call wrote the rental and the wrapper's audit row together (T9f).

**Two connections.**
- *T9a.* While an activation transaction is open, the setting row lock is held:
  - `FOR UPDATE NOWAIT` fails with 55P03;
  - the Owner's setter blocks (`Lock/transactionid`, `pg_blocking_pids` names the activation);
  - the setter completes only after the activation commits, and its audit row is later than
    the activation's.
- *T9b.* An Owner change that is still uncommitted makes the activation wait. The activation
  then reads the committed OFF value and refuses.
- *T9c.* If the Owner commits OFF after the readiness read, the transaction's own read refuses.
- *T9d.* Insurance unverified, or a licence rejected after readiness, is re-checked in the
  transaction. A concurrent change to the locked screening or document waits until the
  activation commits.
- *T9e.* A failure inside `activate_rental_tx` rolls back the wrapper's audit row and every
  write, and releases the setting lock.

**Limitations (stated, not assumed):**
- Interview and pre-delivery inspection are soft blockers, overridden with a written reason.
  They are checked only in TypeScript, outside the transaction. Approval and vehicle readiness
  are re-checked by `activate_rental_tx`.
- `provisionDriverAccount` (auth user, driver role, `applications.user_id` link) runs before
  the transaction and is not rolled back if activation is then refused. It is idempotent and
  was already the case before this change.
- The `rental.activated` audit entry, with the override reason and insurance fields, is written
  by the server **after** the RPC returns, through `logAudit`, which swallows failures. It is
  therefore not atomic with the rental. The atomic record is the wrapper's
  `rental.activation_checked` row, and `rental.activated` links to it by
  `transaction_audit_id`.
- Welcome email, SMS and notifications still run after commit.
- If the wrapper is not installed (PostgREST `PGRST202`), the app fails closed: insurance must
  be verified, the exception is unavailable, and only then is `activate_rental_tx` called. In
  that mode the agreement and licence checks are TypeScript-only, as in Release A.
- Record Rental (M2 steps 3, 5 and 7, behind a disabled flag) calls `activate_rental_tx`
  directly. It records historical handovers and is not gated by this setting.
- Expiry uses the America/New_York date in both the database and the app. On the day a policy
  expires, a run near midnight could differ by one day between the readiness screen and the
  transaction. The transaction decides.
- Paper agreements: vault documents carry no agreement version, so the audit row records
  `agreement_version: null`, plus the document label and `content_sha256` when present. Whether
  the stored file actually exists in Storage is not re-checked at verification time; the
  document must have a storage path.
- `driver_screenings.insurance_verified` remains writable by any staff tier through the existing
  `"Staff manage screenings"` policy. That includes Coordinators, which is the current design for
  screening work. Who may *mark* insurance verified is outside this package.

## Production plan and ordering

All steps are owner-approved, one `query_database` call each to the pinned project.

1. Run the read-only `preflight-readonly.sql`. Every row must be `ok = true`. The informational
   rows record the M2 Window 1 and S1 state.
2. Submit exactly `request-activation-insurance-setting.sql`
   (`fca4ef6c…916c`), once.
3. Run the read-only `verify-after-readonly.sql`. Every row must be `ok = true`.
   - Run it before M2 Window 1. Once Window 1 replaces `activate_rental_tx`, the row
     `activate_rental_tx.unchanged_since_install` reads false *by design* (test O1); the
     wrapper calls the new function.
4. The app can ship before or after the SQL:
   - **Before:** the app gets `PGRST202`, so insurance verification is required and the setting
     cannot be changed (`SETTING_NOT_INSTALLED`).
   - **After:** the setting is OFF until the Owner turns it on in **Settings → Rentals → Rental
     Terms → Rental Activation**.

**Ordering versus the other pending database work.** All of these were tested on separate
clones of the production-order baseline:

| Order | Result |
|---|---|
| This package → M2 Window 1 + 2 | M2 preflight is clean with this installed, 31 writes, verifies true; activation rules hold (O1) |
| M2 Window 1 + 2 → this package | Preflight is clean, the package installs and the rules hold. With Window 2's `approval_serialize` lock held, activation returns **40001 `approval_write_busy_retry`**, nothing is written, and a retry succeeds; the app maps this to `write_busy_retry` (O2) |
| Security S1 → this package, and this package → S1 | Both install in either order; S1's client-only trigger does not affect the `SECURITY DEFINER` path (O3, O4) |
| Pending Drizzle 0023 | Independent. The ledger check pins the 23 known receipts as a *prefix*, so a later receipt does not refuse |

Recommended: install after S1 and before M2 Window 2. It is independent of both, but this order
keeps each verify step simple. Security 0031 is not touched; its policy md5 `d3387761…`
is checked before and after.

**Rollback.** Needs separate approval. Submit `request-rollback-activation-insurance-setting.sql`.
- It removes exactly the two functions, the trigger and its function, the three policies and
  the setting row.
- It keeps the audit history and leaves `activate_rental_tx` byte-identical.
- The app falls back to the fail-closed `PGRST202` path (RB1, RB2, T10).

## Local test database (port 55482 only)

These are the steps of `real-rentals/scripts/record-rental-harness/up.sh`, run against a private
cluster (data directory `/tmp/wt-pr2-pg`, running as uid 65534).

```
setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/tmp/wt-pr2-pg /opt/pg17/bin/initdb -D /tmp/wt-pr2-pg/data -U postgres -A trust --locale=en_US.UTF-8
setpriv ... /opt/pg17/bin/pg_ctl -D /tmp/wt-pr2-pg/data -o "-p 55482 -k /tmp/wt-pr2-pg -c listen_addresses=127.0.0.1" start
git -C /home/user/real-rentals archive origin/review/m2-packet-29d47ee3 proposed scripts supabase/migrations drizzle/migrations | tar -x -C /tmp/wt-pr2-packet
psql .../rr -f stubs.sql; (cd /tmp/wt-pr2-packet && RR_HARNESS_DB_URL=.../rr node rr-apply.mjs 143); psql .../rr -f security-0031-policies.sql
CREATE DATABASE rr_tpl TEMPLATE rr;
bun scripts/activation-insurance-setting.db.test.ts      # 36 passed, 0 failed
```

The template carries the 23 production Drizzle receipts (journal md5 `5cfa7e88…`) and the 0031
policy md5 `d3387761…`. The app-level rules are tested without a database by
`scripts/activation-readiness.test.mjs`, which runs as part of `npm test`.
