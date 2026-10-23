# Reconciling the three historical Stripe payments — smallest safe path

2026-10-23. Read-only inspection plus local tests. No production SQL, no Stripe
call, no financial write.

## The finding that reorders the work

**Both** candidate paths require a rental row to exist, and production has
**zero rentals**.

| Path | Requires a rental? | Evidence |
|---|---|---|
| **Link to Rental** (`96bc898a`, dark) | **yes** | `runUnmatchedLink` reads `rentals` by id and returns *"That rental was not found."* |
| **Stripe reconciliation 0033** (proposed) | **yes** | `stripe_rental_links.rental_id NOT NULL REFERENCES rentals(id)`; `stripe_operations.rental_id PRIMARY KEY REFERENCES rentals(id)`. Its own header: *"Requires existing rentals/payments/refunds"* |
| **Unified Payments** | n/a | `getUnifiedFinanceReport` is a **read-only report**, not a write path |

So the blocker is **not** the payment plumbing. It is that the three Stripe
payments have no rental to attach to. **P1 depends on P2 (Record Rental).**

`payments.rental_id` is nullable, so rows *could* be imported unattached — but
that would create payment records belonging to no rental, which neither
existing implementation does and which would need new code. Rejected: the brief
is to integrate completed work, not rebuild.

## The existing work is sound — verified, not assumed

| Suite | Result |
|---|---|
| `scripts/stripe-reconciliation/provider.test.mjs` | **29 pass** |
| `scripts/stripe-reconciliation/database.test.mjs` (installs 0033 into a throwaway Postgres) | **44 pass** |
| `scripts/stripe-unmatched-link.test.ts` (Link to Rental) | **22 pass** |

Among the 44, directly covering the stated requirements:

- *migration replay refuses and rolls back instead of modifying existing evidence*
- *direct charge verification uses existing rows without duplicate ledger*
- *unverified Stripe collection excluded from snapshot*
- *installation failure rolls back all new objects*
- anon / authenticated / Coordinator all denied; actor spoofing denied

### Against the six requirements

| Requirement | Met by |
|---|---|
| Never charge again | Both paths are read + record only. Reconciliation is `list`/`retrieve` snapshots; Link to Rental re-reads a **paid** invoice |
| Preserve Stripe IDs and history | `stripe_invoice_id`, `stripe_payment_intent_id`, `stripe_subscription_id` carried through; 0033 keeps `stripe_event_receipts` |
| Prevent duplicate records | Existing unique indexes on invoice id and payment intent, asserted by 0033 before install; Link to Rental refuses a known invoice or intent |
| Historical import vs webhook ingestion | **This is 0033's design** — separate flag, pinned environment and Stripe account, its own receipts table, distinct from the webhook path |
| Preserve refund / failed / manual behaviour | 0033 reuses `apply_payment_refund` and does not replace the ledger; the webhook's manual-paid preservation is untouched |
| Financial writes stay disabled | `STRIPE_RECONCILIATION_ENABLED` is env-gated and off, `stripe_ingest` is **not installed**, and Link to Rental's flag is a hard `false` |

## Recommended order

1. **Record Rental (P2)** — the M2 packet creates the rental records. Owner
   migration approval.
2. **Then** attach the three payments. Prefer **Link to Rental** for a one-off
   of three invoices: it is already cherry-picked, tested and dark, and needs no
   migration. 0033 is the right tool for ongoing reconciliation, not for three
   historical rows.
3. Keep 0033 for continuous reconciliation, approved separately.

**Nothing to build.** The work exists and passes 95 tests between the three
suites. The gap is rentals.

## Blocked on

- Rentals existing at all → Record Rental / M2 packet (owner approval).
- Enabling either path → owner approval; both write financial records.
