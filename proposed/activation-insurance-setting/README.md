# Activation insurance setting v1: Owner exception, audited setter, checked activation transaction

**Status: PREPARED, NOT APPROVED. Nothing here has run in production.** It was tested only on a
private local Postgres 17.6 (`en_US.UTF-8`, port 55482) and a local PostgREST 12.2.3 (port 55483).

This is a guarded direct-route package. It is **not** a file in `supabase/migrations` or
`drizzle/migrations`, because production has Drizzle 0023 pending and the next Lovable migration
would apply it implicitly. It writes no migration ledger.

The companion package `../insurance-verification-authority/` (Manager/Owner-only insurance
verification) is a separate, independently installable and reviewable unit. Neither package needs
the other.

> **Superseded hashes:** the hashes reported for commit `5a60c6fe` (`670b5b54…`, `fca4ef6c…`) are
> superseded. The wrapper now also writes `rental.activated` itself, checks the actor, and re-checks
> overrides. Use the table below.

## Artifacts

| Artifact | SHA-256 | Bytes |
|---|---|---|
| `activation_insurance_setting_v1.sql` (the package, one `DO` statement) | `1e94cac995a3b44f58ddec5adb67b9857e383a886bfb5d3770a1177357b8bfca` | 35,744 |
| **`request-activation-insurance-setting.sql`** = guard v3 + the unchanged package | **`b80babcc275bea4682bc9b69ba3ce11d5f2833ced848c9682b00979311765505`** | 37,762 |
| Inner DDL (`src/inner.sql`, embedded, checked by the package) | `ec415d3a617224857044f15a194b73f24e887b42d2b79b9faa27f06537915c17` | — |
| `preflight-readonly.sql` | `17bad7a1bc7bddfef3e804fddbe0e1378db01049ab5a3c636e22c27d779ef50b` | 6,988 |
| `verify-after-readonly.sql` | `1d7062e5f76f29649df1f90c60f5dfd8c72dd9a30e3736e43cb0d9bb77d371b6` | 6,347 |
| `rollback.sql` (needs separate approval) | `31fed9cfb393d1f6344dc358e1a7cc0916e0e547d66102ddb4e5af933573b9e5` | 14,205 |
| `request-rollback-activation-insurance-setting.sql` | `57498a8277f66d23ca6b2a18800bed243295cb9a6979c8063e75945dbc384893` | 16,200 |
| Function bodies (`prosrc`, checked after install) | wrapper `66933837…298a`, setter `39ff1d56…fd97`, guard `8723cbde…214e` | — |

- `src/build.py` regenerates every file. Run it with `--check` to reproduce them byte for byte.
- The guard is `scripts/sql-guard/gen-guard3.py`, byte-identical to the reviewed generator
  (`2c8c8967…66f7`).
- `sha256sum -c SHA256SUMS` checks every file.

## What it changes

1. **The setting.** It adds one row to the existing `public.app_settings` table: key
   `rental_activation`, value `{"allow_activation_without_insurance_verification": false}`.
   - The default is OFF.
   - The app reads a missing row, a missing field, a non-boolean value or an unreadable row as OFF.
   - In the UI it is **Settings → Rentals → Rental Terms → "Allow Activation Without Insurance
     Verification"**.
2. **The Owner setter.** `public.set_rental_activation_insurance_exception(boolean)` is
   `SECURITY DEFINER` with `search_path=''`, and `EXECUTE` is granted to `authenticated` only.
   - It refuses unless `private.is_owner()` holds for the caller's own JWT.
   - It writes `settings.rental_activation_updated` (actor, from, to, time) in the same
     transaction.
3. **Only the setter can write that key.**
   - A row trigger (`SECURITY INVOKER`) refuses every other writer, including `service_role` and
     an Owner writing the table directly.
   - Three `RESTRICTIVE` policies are a second layer against direct writes from `authenticated`.
   - Other `app_settings` keys are unchanged.
4. **The checked activation.** `public.activate_rental_checked_tx` takes the 10 arguments of
   `activate_rental_tx`, plus `_insurance_exception_ack boolean` and `_audit jsonb`. It is
   `SECURITY DEFINER`, `search_path=''`, plpgsql, with `service_role`-only `EXECUTE`. In **one
   transaction** it runs these steps:
   1. It takes M2's release lock `pg_advisory_xact_lock(710026,2)` first. This is the M2 Window 2
      lock order; `activate_rental_tx` takes the same lock again after Window 2.
   2. It checks that `_actor` is a Manager or Owner in `user_roles` (`actor_not_manager`). So even
      a compromised service path cannot activate as a Coordinator.
   3. It reads the setting `FOR SHARE`. It locks the application `FOR UPDATE`. It locks the
      following `FOR SHARE`: the screening, the current insurance, licence and agreement
      documents, the signed agreements, and the passed pre-delivery inspections.
   4. It decides insurance with the same precedence as the app: expired > verified > missing >
      unverified. Unless insurance is verified, it refuses, with two exceptions: the setting is ON
      **and** the acknowledgement was given.
   5. It re-checks, with no override possible:
      - licence front and back;
      - a signed agreement: an eSign agreement, or a paper agreement with an audited
        Owner/Manager verification of that exact file.
   6. It re-checks the soft blockers. Only `no_interview` and `no_passed_inspection` may be
      overridden, and only with a reason of at least 5 characters. Every soft blocker that is
      unmet at that moment must be covered (`override_required`, `override_not_allowed`,
      `override_reason_required`).
   7. It calls `public.activate_rental_tx`, unchanged.
   8. It writes the required **`rental.activated`** audit row itself, with the same payload the app
      used to write afterwards:
      - actor, email, role, ip and user agent;
      - summary, vehicle, application, driver and `account_created`;
      - the overrides (blockers, reason, by, at), as AGENTS.md requires;
      - insurance: status, exception used, setting value read, acknowledgement and time;
      - the checks and the transaction id.

      The rental and its audit evidence therefore commit together or not at all. The app no longer
      writes this entry when the wrapper is installed.
5. **Evidence.** It writes one `security_migration_verified` row. A re-run is refused.

**Unchanged:**
- `activate_rental_tx` and `end_rental_tx`;
- migration 0021 and vehicle allocation;
- Security 0031, S1 and M2;
- grants and every other policy;
- both ledgers.

The package checks these before and after, and refuses if anything drifted. Insurance is never set
to verified by any path here.

## Atomicity when the wrapper is not installed (app fallback, PGRST202)

The app ships before the SQL, so without the wrapper it behaves like this:

- **Fail closed.** Insurance must be verified, and the Owner exception is unavailable. **Overrides
  are refused**, because their audit must commit with the rental.
- **Then** it calls `activate_rental_tx`, and right after that writes `rental.activated` with a
  strict insert, not the swallowing `logAudit`.
  - These two steps are **not atomic**.
  - If the audit write fails, the activation result carries `auditError`. The dialog shows a
    persistent error ("The rental started, but its audit entry could not be written. Tell the
    Owner…"), and the server logs `REQUIRED AUDIT WRITE FAILED`. Nothing is swallowed.
- The stricter alternative is to refuse every activation until the wrapper is installed. That is
  an owner decision; see the PR report.

## Transaction boundary: verified, and the limitations

Results are in `test-results.json`, from `scripts/activation-insurance-setting.db.test.ts`
(61 passed).

**Shape (B1).**
- Both functions are plpgsql `SECURITY DEFINER`, with no dblink, `pg_background`, `COMMIT` or
  `ROLLBACK`.
- The wrapper has no exception handler.
- `activate_rental_tx` re-raises out of its `unique_violation` block.

**PostgREST.** PostgREST runs each RPC call as one transaction (T9f).

**Two connections.**
- *T9a.* During an open activation:
  - `FOR UPDATE NOWAIT` on the setting fails with 55P03;
  - the Owner's setter blocks on `Lock/transactionid`, with the activation as blocker;
  - the setter completes only after the activation commits.
- *T9b and T9c.* An Owner OFF that commits first is the value the activation's own read sees.
- *T9d.* A concurrent change to the screening or a licence waits until the activation commits.
- *V7.* A Manager's insurance revocation that commits first makes the waiting activation refuse.

**Failure.**
- *T9e.* A failure inside `activate_rental_tx` rolls back the wrapper's reads, locks and audit row.
- *A3.* An injected failure of the `rental.activated` insert leaves no rental, and the application
  and vehicle are unchanged. On success, both the rental and the audit row are present.

**Limitations:**
- `provisionDriverAccount` (auth user, driver role, application link) runs before the
  transaction. It is idempotent, but it is not rolled back on a refusal.
- Welcome email, SMS and notifications still run after commit.
- The approval check and the vehicle checks happen inside `activate_rental_tx`.
- Record Rental (dark, M2 steps 3, 5 and 7) calls `activate_rental_tx` directly. It records
  historical handovers, and this setting does not gate it.
- Expiry uses the America/New_York date. The transaction is the one that decides.
- Paper agreements: vault documents have no version field, so the audit row records
  `agreement_version: null`.

## Production plan and ordering

1. Run `preflight-readonly.sql`. Every row must be `ok`.
2. Submit exactly `request-activation-insurance-setting.sql` (`b80babcc…5505`) once.
3. Run `verify-after-readonly.sql`. Every row must be `ok`.
   - After M2 **Window 2**, the row `activate_rental_tx.unchanged_since_install` reads false *by
     design*: Window 2's step 4 replaces `activate_rental_tx`, and the wrapper calls the new one.
   - Note: the 5a60c6fe README said Window 1. That was wrong; it is Window 2, step 4.

**Compatibility.** Each order was run on its own clone of the production-order baseline with
Security 0031. The real artifacts were used unmodified; only the local target profile was
substituted.

| Order | Result |
|---|---|
| C1: S1 → this → IVA → S1 verify → W1 → W2 → rules | S1 `verify-after` all_gates true after both packages. The W1 preflight is clean. W2's 29 files apply and verify. Rules hold, and the W2 `approval_serialize` lock gives 40001 with nothing written; a retry succeeds. |
| C1 rollbacks: M2 → S1 → 0031 → IVA → this | Each succeeds. This package's verify is all ok again after the M2 rollback. |
| C2: this → IVA → S1 → S1 verify → W1 → W2 → rules | All pass. |
| C2 rollbacks: IVA → this → M2 → S1 | Each succeeds. |
| C3: W1 → this → IVA → W2 → rules | All pass. |
| C3 rollbacks: this → IVA (with W2 installed), then M2 | Each succeeds. |
| C4: W1 → W2 → IVA → this | Both preflights are clean and the rules hold. |
| Drizzle 0023 pending | Independent. The 23 known receipts are pinned as a prefix. |

- The rollback accepts Security 0031 either as installed or fully rolled back.
- The install requires 0031 exactly as installed.
- S1 must precede M2 Window 2. That constraint is S1's own: its trigger-set gate. These packages
  add nothing to `public.applications`.

**Recommended order:** S1, then this package and IVA (either order), then M2 Window 1 and Window 2.
Any order in the table above works.

**Rollback:** `request-rollback-activation-insurance-setting.sql`, with separate approval.
- It removes exactly what v1 added and keeps the audit history.
- The app then falls back to the fail-closed PGRST202 path.

## Local test database (port 55482 only)

```
initdb (pg17, en_US.UTF-8) as uid 65534 in /tmp/wt-pr2-pg; pg_ctl -o "-p 55482 -k /tmp/wt-pr2-pg -c listen_addresses=127.0.0.1"
git -C /home/user/real-rentals archive origin/review/m2-packet-29d47ee3 proposed scripts supabase/migrations drizzle/migrations | tar -x -C /tmp/wt-pr2-packet
stubs.sql; (cd /tmp/wt-pr2-packet && RR_HARNESS_DB_URL=.../rr node rr-apply.mjs 143); security-0031-policies.sql; CREATE DATABASE rr_tpl TEMPLATE rr
bun scripts/activation-insurance-setting.db.test.ts     # 61 passed, 0 failed (also tests ../insurance-verification-authority)
```
