# Payments delete guard v1 (PROPOSED: not installed)

**Problem:**
- RLS "Managers manage payments" (ALL) lets any Manager delete a payment row.
- No trigger prevents it.
- The Payments screen offered **Delete**.

Payment rows are financial history: a charge is written before collection, revenue is `net_collected`, and refunds are recorded per row.

**Fix:**

| Part | Status | Change |
|---|---|---|
| App | On this branch | Payments → **Void (Entered In Error)** replaces Delete. It requires a reason (saved in `notes`) and isn't offered on paid, refunded or void rows. No source file deletes payments (`scripts/payment-delete-ui.test.mjs`, in `npm test`). |
| Database | This package; not installed | `payments_delete_guard_v1.sql`: a BEFORE DELETE trigger refusing deletes from `authenticated`, `anon` and `service_role` (`payments_are_financial_history_void_instead`). |

- Policies, grants, rows and ledgers are untouched.
- Rollback: `rollback.sql`.

**Local proof** (`node scripts/payments-delete-guard.db.test.mjs`, disposable Postgres on 127.0.0.1:55482 cloned from the production-order baseline): 9/9.
- Before the guard, a Manager can delete.
- After it, Manager, server code and anon are refused, and voiding still works.
- Parent deletes still set the link to null (the FKs are `ON DELETE SET NULL`).
- The database owner can still delete.
- Rollback removes exactly the trigger and the function.

**Before any production use (separate approval):**
1. Generate the guarded request with `scripts/sql-guard/gen-guard3.py`.
2. Add a read-only preflight (target identity, journals, 0031, no existing trigger) and a verify-after, as for the insurance packages.
3. Ship the app part first; the database part can follow at any time. Neither depends on the other.
