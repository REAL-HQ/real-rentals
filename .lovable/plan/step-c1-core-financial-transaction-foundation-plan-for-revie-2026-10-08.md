# STEP C1 — Core Financial Transaction Foundation (Plan for Review)

Status: plan only. No migration run, no records changed, nothing published. C2–C6 not started.

## 1. Audit re-check against current production (Oct 8, 12:20 UTC)

The earlier Step C audit still matches, with these confirmed facts:

| Area | Current state | Rows |
|---|---|---|
| vehicle_expenses | single vehicle per expense, one `incurred_on` date, Manager-managed, partner read | 0 |
| fleet_service_transactions | one row per real invoice, `financial` JSON, Manager read | 6 |
| maintenance_records | service writes via maintenance.server.ts, links one expense | 0 |
| vehicle_finance | Owner-only (private.is_owner) — already locked down | 0 |
| fleet_import_finance_facts | Owner-only read | 3 |
| payments / refunds | Stripe charges, `net_collected`, `apply_payment_refund` | 0 |
| toll_charges, deposit_deductions, payouts | exist, separate | 0 |
| financial_* tables | none exist | — |

Changes since the earlier plan: Owner-only finance is already enforced (title/finance work), so C1 reuses `private.is_owner()` / `private.is_manager()` directly — no new helper. The state model below replaces the earlier draft/posted/voided set to match your required states.

## 2. What C1 builds (additive only)

Four new tables, database guard rules, and one server writer. No existing table, policy, Stripe logic, Fleet Inbox flow or UI changes. Nothing posts automatically.

1. **financial_transactions** — the one canonical record of money facts.
2. **financial_transaction_events** — append-only history (immutable audit trail).
3. **financial_transaction_evidence** — links a transaction to source documents / Fleet Inbox items / service transactions (provenance, many-to-many).
4. **financial_settlements** — links a payment to the invoice/obligation it pays (supports many payments per invoice; prevents double counting).

Shared vehicle allocations are prepared but not built: each transaction carries an optional `vehicle_hint_id` only; the allocations table is C3.

## 3. Transaction types and the double-count rule

`txn_type`: obligation, invoice, expense, payment, refund, deposit_received, deposit_returned, deposit_applied, capital_expenditure, financing_draw, financing_payment.

`basis` is derived from type and fixed by a constraint:
- **accrual-only**: obligation, invoice (recognized on `recognition_date`)
- **cash-only**: payment, refund, deposits, financing_draw, financing_payment (moves on `cash_date`)
- **both**: expense, capital_expenditure (a receipt paid on the spot)

Invoice + payment confirmation uploaded together → one `invoice` (accrual) + one `payment` (cash) joined by a settlement. Accrual reports count only the invoice; cash reports count only the payment. Never both in the same view. A payment cannot settle more than its own amount, and total settlements cannot exceed the invoice amount (enforced in the settle function under row locks).

Capital expenditure and financing principal are excluded from operating expense; financing interest is a separate `financing_payment` component (`interest_amount`). Driver rent revenue stays in `payments.net_collected`; a ledger row may reference a payment but is never summed as revenue.

## 4. State model

`proposed → confirmed → posted`, then `posted → reversed` (mirror entry) or `posted → corrected` (reversed + a new replacing row pointing back via `corrects_id`). `proposed`/`confirmed` may be `discarded`. Posted rows are never edited or deleted; every transition writes an event.

## 5. Technical details — exact schema (migration `fin_core_c1`)

```sql
CREATE TABLE public.financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_type text NOT NULL CHECK (txn_type IN ('obligation','invoice','expense','payment','refund',
    'deposit_received','deposit_returned','deposit_applied','capital_expenditure','financing_draw','financing_payment')),
  basis text NOT NULL CHECK (basis IN ('accrual','cash','both')),
  direction text NOT NULL CHECK (direction IN ('out','in')),
  category text NOT NULL,                        -- e.g. maintenance, insurance, toll, acquisition, make_ready
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','posted','reversed','corrected','discarded')),
  sensitivity text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','owner_only')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  interest_amount numeric(12,2) CHECK (interest_amount >= 0 AND interest_amount <= amount),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  document_date date, service_date date, due_date date,
  recognition_date date,                          -- accrual date
  cash_date date,                                 -- money-movement date
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  payee_raw text, reference_raw text, reference_norm text, payment_method text, memo text,
  vehicle_hint_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,   -- suggestion only (C3 allocates)
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,        -- reference, never revenue
  expense_id uuid REFERENCES public.vehicle_expenses(id) ON DELETE SET NULL,
  reverses_id uuid UNIQUE REFERENCES public.financial_transactions(id),
  corrects_id uuid UNIQUE REFERENCES public.financial_transactions(id),
  source_type text NOT NULL CHECK (source_type IN ('manual','fleet_inbox','service','expense','toll','deposit','stripe')),
  idempotency_key text NOT NULL UNIQUE,
  created_by uuid NOT NULL, confirmed_by uuid, confirmed_at timestamptz,
  posted_by uuid, posted_at timestamptz, closed_by uuid, closed_at timestamptz, close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT basis_matches_type CHECK (basis = CASE
    WHEN txn_type IN ('obligation','invoice') THEN 'accrual'
    WHEN txn_type IN ('expense','capital_expenditure') THEN 'both' ELSE 'cash' END),
  CONSTRAINT posted_dates CHECK (status NOT IN ('posted','reversed','corrected') OR (posted_at IS NOT NULL AND posted_by IS NOT NULL
    AND (basis = 'cash' OR recognition_date IS NOT NULL) AND (basis = 'accrual' OR cash_date IS NOT NULL))),
  CONSTRAINT owner_only_categories CHECK (category NOT IN ('acquisition','financing','lien','payoff')
    AND txn_type NOT IN ('financing_draw','financing_payment') OR sensitivity = 'owner_only'),
  CONSTRAINT closing_reason CHECK (status NOT IN ('reversed','corrected','discarded') OR close_reason IS NOT NULL)
);
CREATE INDEX fin_txn_accrual_idx ON public.financial_transactions (recognition_date) WHERE status = 'posted' AND basis <> 'cash';
CREATE INDEX fin_txn_cash_idx    ON public.financial_transactions (cash_date)        WHERE status = 'posted' AND basis <> 'accrual';
CREATE INDEX fin_txn_vehicle_idx ON public.financial_transactions (vehicle_hint_id, status);
CREATE INDEX fin_txn_dup_idx     ON public.financial_transactions (vendor_id, amount, document_date);
CREATE INDEX fin_txn_ref_idx     ON public.financial_transactions (reference_norm) WHERE reference_norm IS NOT NULL;
CREATE INDEX fin_txn_status_idx  ON public.financial_transactions (status, txn_type);

CREATE TABLE public.financial_transaction_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES public.financial_transactions(id),
  event text NOT NULL, from_status text, to_status text,
  actor uuid, before jsonb, after jsonb, reason text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX fin_evt_txn_idx ON public.financial_transaction_events (transaction_id, created_at);

CREATE TABLE public.financial_transaction_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.financial_transactions(id),
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  import_item_id uuid REFERENCES public.fleet_import_items(id) ON DELETE SET NULL,
  service_transaction_id uuid REFERENCES public.fleet_service_transactions(id) ON DELETE SET NULL,
  page int, raw_text text, field text, confidence text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (document_id IS NOT NULL OR import_item_id IS NOT NULL OR service_transaction_id IS NOT NULL));
CREATE INDEX fin_evd_txn_idx ON public.financial_transaction_evidence (transaction_id);
CREATE INDEX fin_evd_doc_idx ON public.financial_transaction_evidence (document_id);

CREATE TABLE public.financial_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.financial_transactions(id),   -- invoice/obligation
  payment_txn_id uuid NOT NULL REFERENCES public.financial_transactions(id),  -- payment/refund
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed')),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  reversed_by uuid, reversed_at timestamptz, reverse_reason text,
  CHECK (obligation_id <> payment_txn_id));
CREATE UNIQUE INDEX fin_settle_pair_idx ON public.financial_settlements (obligation_id, payment_txn_id) WHERE status = 'active';
CREATE INDEX fin_settle_pay_idx ON public.financial_settlements (payment_txn_id);

-- Grants: read for signed-in staff (RLS narrows), no direct writes, no anon.
GRANT SELECT ON public.financial_transactions, public.financial_transaction_events,
  public.financial_transaction_evidence, public.financial_settlements TO authenticated;
GRANT ALL ON public.financial_transactions, public.financial_transaction_events,
  public.financial_transaction_evidence, public.financial_settlements TO service_role;

-- RLS (all four tables enabled)
-- transactions: (sensitivity='standard' AND private.is_manager()) OR private.is_owner()
-- events / evidence / settlements: visible only when the parent transaction(s) are visible (EXISTS subquery)
-- Coordinators, drivers, partners, anon: no access.
```

**Guards (triggers):** DELETE refused on all four tables. Events are insert-only. On transactions: `proposed`/`confirmed` rows editable (each edit logged with before/after); `posted` rows allow only the status change to `reversed`/`corrected` inside the ledger functions (session flag); amount, dates, type, sensitivity never change after posting. Settlements: only `active → reversed`.

**Ledger functions** (SECURITY DEFINER, role checked inside, every call writes an event + audit_log; Owner required for owner_only rows; Manager for standard; Coordinator refused):
- `fin_propose(payload, idem)` → id (idempotent on key)
- `fin_confirm(id)`, `fin_post(id, recognition_date, cash_date)` (row lock, one winner)
- `fin_discard(id, reason)` — only proposed/confirmed
- `fin_reverse(id, reason, idem)` — posted mirror entry, original → reversed, active settlements reversed
- `fin_correct(id, payload, reason, idem)` — reverse + new posted replacement with `corrects_id`
- `fin_settle(obligation_id, payment_id, amount, idem)` — both posted, compatible types, locks both rows, sums ≤ each amount
- `fin_unsettle(settlement_id, reason)`

**Server code:** `src/lib/financial-ledger.ts` (pure rules: type→basis, categories, duplicate hints), `financial-ledger.server.ts` (only caller of the functions), `financial-ledger.functions.ts` (thin, requireSupabaseAuth). No UI in C1; Fleet Inbox is not wired (C2 will create **proposed** rows only, never posted).

## 6. Migration order
1. Tables → indexes → grants → enable RLS → policies (one migration).
2. Guard triggers (same migration, after tables).
3. Ledger functions + EXECUTE grants to authenticated (same migration, last).
No backfill: existing expenses/service/finance data stays where it is; C2 links them.

## 7. Permission implications
| Role | Standard rows | Owner-only rows (acquisition, financing) |
|---|---|---|
| Owner | read, propose, confirm, post, reverse, correct, settle | full |
| Manager | same as Owner | invisible; writes refused |
| Coordinator / Driver / Partner / signed-out | none | none |
No existing policy, grant or role changes.

## 8. Rollback
- Before any real posting: one follow-up migration drops the 4 tables and `fin_*` functions; server files reverted. Nothing else references them.
- After real postings: no drop. Revoke EXECUTE on `fin_*` to freeze writes and keep data for audit.

## 9. Verification (preview, no production records)
Removable fixtures only, deleted after: idempotent propose; concurrent post (one wins); posted row edit/delete refused; reverse nets to zero and can't repeat; correct links both rows; invoice+payment counted once per basis; over-settlement refused; two payments on one invoice; Manager cannot see/write owner_only; Coordinator/anon none; events immutable. Plus: existing payment/refund tests green, Stripe files unchanged, linter + fresh security scan, Test A/B and all counts unchanged. Then stop for review — no publish without approval.
