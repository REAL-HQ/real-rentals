import type { FinanceSource, FinanceSourceRow, SourceSnapshot } from "./unified-finance-contract";
import type { ProviderIdentity } from "./unified-finance-reconciliation";
import type { FinanceEventKind, PaymentMethod } from "./unified-finance";

/** Injected transport contracts, not a production client or permissive raw-row cast. */
export type SourceActor = { userId: string | null; roles: readonly string[] };
export type SourceScope = { environment: ProviderIdentity["environment"]; account: string };
export type SourceFacts = {
  id: string; kind: FinanceEventKind; amountCents: number | null; currency: string | null;
  cashDate: string | null; recognitionDate: string | null; feeCents: number | null;
  status: "succeeded" | "pending" | "failed" | "canceled"; verified: boolean;
  method: PaymentMethod | null; customerId: string | null; rentalId: string | null;
  identities: ProviderIdentity[]; relatedEventId: string | null;
};
export type ProviderRow = SourceFacts & { object: "charge" | "refund" | "balance_transaction"; parentChargeId: string | null };
export type PaymentRow = SourceFacts & { paymentId: string; visibility: "operating" | "owner_only" };
export type LedgerRow = SourceFacts & {
  transactionId: string; posting: "proposed" | "confirmed" | "posted" | "reversed" | "corrected" | "discarded";
  direction: "in" | "out"; visibility: "operating" | "owner_only";
  reversesId: string | null; correctsId: string | null; paymentId: string | null; expenseId: string | null;
};
export type ExpenseRow = SourceFacts & { expenseId: string; visibility: "operating" | "owner_only" };
export type SettlementRow = { id: string; paymentId: string; obligationId: string; amountCents: number | null; currency: string | null; visibility: "operating" | "owner_only" };
export type RelationshipRow = { id: string; visibility: "operating" | "owner_only"; relationship: NonNullable<FinanceSourceRow["relationship"]> };
export type RawSources = { stripe: ProviderRow; payments: PaymentRow; ledger: LedgerRow; settlements: SettlementRow; expenses: ExpenseRow; relationships: RelationshipRow };
export type RawPage<T> = { rows: T[]; nextCursor: string | null; complete: boolean };
export type SourcePageReader<T> = (cursor: string | null, signal?: AbortSignal) => Promise<RawPage<T>>;
/** Caller-owned authenticated RLS transport. No admin option exists in this interface. */
export type AuthenticatedReadClient = {
  userId: string; authorization: "authenticated_rls";
  readCurrentRoles: (userId: string) => Promise<readonly string[]>;
  readPage: <S extends Exclude<FinanceSource, "stripe">>(source: S, cursor: string | null, signal?: AbortSignal) => Promise<RawPage<RawSources[S]>>;
};
export type MappedSource = { row: FinanceSourceRow | null; reasons: string[] };
export type IsolatedSourceResult = SourceSnapshot;
/** Exact source-column projections; absent facts must be supplied as null, never invented. */
export type OperationalPaymentProjection = {
  id: string; amount: string | number | null; status: string; paid_date: string | null;
  driver_id: string | null; rental_id: string | null; type: string;
  stripe_payment_intent_id: string | null; stripe_invoice_id: string | null;
};
export type C1Projection = {
  id: string; amount: string | number | null; currency: string | null;
  /** Required to classify expense rows; absent categories are never presumed operating. */
  category?: string | null;
  txn_type: string; status: LedgerRow["posting"]; direction: LedgerRow["direction"];
  sensitivity: "standard" | "owner_only"; recognition_date: string | null; cash_date: string | null;
  rental_id: string | null; payment_id: string | null; expense_id: string | null;
  reverses_id: string | null; corrects_id: string | null;
};
export type SourceEvidence = { customerId: string | null; verified: boolean; feeCents: number | null; currency: string | null;
  method: PaymentMethod | null; identities: ProviderIdentity[]; cashDate: string | null; kind: FinanceEventKind | null };
export type VehicleExpenseProjection = { id: string; amount: string | number | null; incurred_on: string | null; rental_id: string | null; category: string };
export type C1SettlementProjection = { id: string; obligation_id: string; payment_txn_id: string; amount: string | number | null; status: string };
export function requireSourceActor(actor: SourceActor): "owner" | "manager" {
  if (!actor.userId) throw new Error("Forbidden");
  if (actor.roles.includes("admin")) return "owner";
  if (actor.roles.includes("team")) return "manager";
  throw new Error("Forbidden");
}