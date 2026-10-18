import { assertPeriod, eventDate, validFinanceDate, type FinanceBasis, type FinanceEvent } from "./unified-finance";

/** Pure source-identity reconciliation; never creates or edits C1 or operational records. */
export type ProviderIdentity = {
  provider: string;
  environment: "synthetic" | "test" | "live";
  account: string;
  object: "charge" | "invoice" | "payment_intent" | "refund" | "balance_transaction" | "transfer" | "dispute";
  id: string;
};
export type Representation = {
  /** An invented/source row id, not a display Customer/Booking number. */
  id: string;
  source: "provider" | "operational" | "c1" | "manual";
  event: FinanceEvent;
  /** Child adjustments merge only by their own money-event identity, never parent aliases. */
  identities: ProviderIdentity[];
  operationalPaymentId?: string | null;
  c1TransactionId?: string | null;
  /** Stable verified transfer reference, scoped to provider/account (not a fuzzy memo/hash). */
  manualIdentity?: { method: string; account: string; reference: string } | null;
  evidenceHash?: string | null;
};
export type ReconciliationState = "Matched" | "Unmatched" | "Conflict" | "Incomplete";
export type ReconciledEvent = {
  id: string;
  state: ReconciliationState;
  representationIds: string[];
  event: FinanceEvent | null;
  reasons: string[];
};
export type ReconciliationResult = {
  groups: ReconciledEvent[];
  /** Events with trustworthy identities/facts only; consumers must also inspect complete. */
  events: FinanceEvent[];
  complete: boolean; // source/fact completeness only, not attribution
  attributionComplete: { customer: boolean; booking: boolean; vehicle: boolean };
  counts: Record<ReconciliationState, number>;
};

export function providerIdentityKey(identity: ProviderIdentity): string {
  if ([identity.provider, identity.account, identity.id].some(s => !s.trim())) throw new Error("Incomplete provider identity");
  return JSON.stringify([identity.provider, identity.environment, identity.account, identity.object, identity.id]);
}
function keys(r: Representation): string[] {
  const scope = r.event.kind;
  // Validate all identities, including parent links, but parents cannot merge independent children.
  for (const identity of r.identities) providerIdentityKey(identity);
  const childObject = scope === "refund" ? "refund" : scope === "chargeback" ? "dispute" : scope === "processing_fee" ? "balance_transaction" : null;
  const out = r.identities.filter(i => !childObject || i.object === childObject).map(i => `${scope}:provider:${providerIdentityKey(i)}`);
  if (r.operationalPaymentId && !childObject) out.push(`${scope}:operational:${r.operationalPaymentId}`);
  if (r.c1TransactionId) out.push(`${scope}:c1:${r.c1TransactionId}`);
  if (r.manualIdentity) {
    const { method, account, reference } = r.manualIdentity;
    if (!method.trim() || !account.trim() || !reference.trim()) throw new Error("Incomplete manual identity");
    out.push(`${scope}:manual:${JSON.stringify([method, account, reference])}`);
  }
  return out;
}

/** Deterministic connected components, not first-arrival-wins or amount/date matching. */
export function reconcileFinance(rows: readonly Representation[], options: { basis?: FinanceBasis } = {}): ReconciliationResult {
  const basis = options.basis ?? "cash";
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const parent = ordered.map((_, i) => i);
  const root = (i: number): number => {
    let at = i;
    while (parent[at] !== at) at = parent[at];
    return at;
  };
  const keyOwner = new Map<string, number>();
  const invalid = new Set<number>();
  ordered.forEach((r, i) => {
    let identities: string[];
    try { identities = keys(r); } catch { invalid.add(i); identities = []; }
    // Repeated source row ids also join so contradictory retries cannot both count.
    identities.push(`row:${r.source}:${r.id}`);
    for (const key of identities) {
      const prior = keyOwner.get(key);
      if (prior === undefined) keyOwner.set(key, i);
      else parent[root(i)] = root(prior);
    }
  });
  const components = new Map<number, number[]>();
  ordered.forEach((_, i) => { const at = root(i); components.set(at, [...(components.get(at) ?? []), i]); });
  const groups: ReconciledEvent[] = [];
  for (const indexes of components.values()) {
    const members = indexes.map(i => ordered[i]);
    const first = members[0];
    if (!first) continue;
    const reasons: string[] = [];
    let conflict = false;
    const fields: Array<keyof FinanceEvent> = ["kind", "amountCents", "currency", "status", "cashDate", "recognitionDate", "method", "feeCents", "relatedEventId", "disputeStage", "customerId", "bookingId", "vehicleId"];
    const merged: FinanceEvent = { ...first.event };
    for (const field of fields) {
      const facts = members.map(m => m.event[field]).filter(v => v !== undefined && v !== null);
      const normalize = (v: unknown) => field === "currency" && typeof v === "string" ? v.toUpperCase() : v;
      const unique = [...new Set(facts.map(normalize))];
      if (unique.length > 1) { conflict = true; reasons.push(`Conflicting ${field}`); }
      else if (unique.length === 1) Object.assign(merged, { [field]: unique[0] });
    }
    // An invoice or PaymentIntent is not a safe merge key for multiple actual charges.
    const charges = new Set(indexes.filter(i => !invalid.has(i)).flatMap(i => ordered[i].identities.filter(identity => identity.object === "charge").map(providerIdentityKey)));
    if (charges.size > 1) { conflict = true; reasons.push("Multiple Charge identities claim the same event"); }
    const c1 = new Set(members.map(m => m.c1TransactionId).filter(Boolean));
    if (c1.size > 1) { conflict = true; reasons.push("Multiple C1 transactions claim the same event"); }
    const childObject = merged.kind === "refund" ? "refund" : merged.kind === "chargeback" ? "dispute" : merged.kind === "processing_fee" ? "balance_transaction" : null;
    const children = new Set(indexes.filter(i => !invalid.has(i)).flatMap(i => ordered[i].identities.filter(identity => identity.object === childObject).map(providerIdentityKey)));
    if (children.size > 1) { conflict = true; reasons.push("Multiple child money-event identities claim the same event"); }

    // A corroborating verified representation may supply evidence, but no amount/date inference.
    merged.evidence = members.some(m => m.event.evidence === "verified") ? "verified" : members.some(m => m.event.evidence === "unverified") ? "unverified" : "missing";
    const identityKnown = members.some(m => {
      try { return keys(m).length > 0; } catch { return false; }
    });
    const date = eventDate(merged, basis);
    const invalidDate = !date || !validFinanceDate(date) || [merged.cashDate, merged.recognitionDate].some(d => d != null && !validFinanceDate(d));
    const invalidFee = merged.kind === "collection" && (merged.feeCents == null || !Number.isSafeInteger(merged.feeCents) || merged.feeCents < 0);
    const missingParent = (merged.kind === "refund" || merged.kind === "chargeback") && !merged.relatedEventId?.trim();
    const incomplete = indexes.some(i => invalid.has(i)) || !identityKnown || !merged.id.trim() || merged.amountCents === null || !Number.isSafeInteger(merged.amountCents) || (merged.amountCents ?? -1) < 0 || !merged.currency ||
      merged.evidence !== "verified" || invalidDate || invalidFee || missingParent;
    if (invalidDate) reasons.push(`No valid ${basis} reporting date or malformed supplied date`);
    if (invalidFee) reasons.push("Actual collection processing fee unknown or invalid; explicit zero required");
    if (missingParent) reasons.push("Adjustment collection relationship missing");
    if (!identityKnown) reasons.push("No authoritative event identity; similar amount/date/evidence hash is not proof");
    if (incomplete) reasons.push("Required identity, money, date or verification evidence incomplete");
    const state: ReconciliationState = conflict ? "Conflict" : incomplete ? "Incomplete" :
      members.length > 1 && Boolean(merged.customerId || merged.bookingId) ? "Matched" : "Unmatched";
    if (state === "Unmatched") reasons.push("Verified event awaiting corroboration or customer/booking linkage");
    const id = first.id;
    groups.push({ id, state, representationIds: members.map(m => m.id), event: conflict || incomplete ? null : { ...merged, id }, reasons });
  }
  groups.sort((a, b) => a.id.localeCompare(b.id));
  // Adjustment references may point at any representation's event id. Resolve to the canonical id.
  const canonical = new Map<string, string>();
  for (const group of groups) {
    for (const r of ordered.filter(r => group.representationIds.includes(r.id))) {
      canonical.set(r.event.id, group.id);
      canonical.set(r.id, group.id);
    }
  }
  for (const group of groups) if (group.event?.relatedEventId) {
    group.event = { ...group.event, relatedEventId: canonical.get(group.event.relatedEventId) ?? group.event.relatedEventId };
  }
  // A nonblank parent reference is not proof: resolve aliases and require a compatible receipt.
  const collections = new Map(groups.flatMap(g => g.event?.kind === "collection" ? [[g.id, g.event] as const] : []));
  for (const group of groups) {
    const e = group.event;
    if (!e || (e.kind !== "refund" && e.kind !== "chargeback")) continue;
    const parentEvent = e.relatedEventId ? collections.get(e.relatedEventId) : undefined;
    if (!parentEvent || parentEvent.status !== "succeeded" || parentEvent.currency?.toUpperCase() !== e.currency?.toUpperCase()) {
      group.state = "Incomplete";
      group.event = null;
      group.reasons.push("Referenced collection missing, incomplete or incompatible");
    }
  }
  const counts: Record<ReconciliationState, number> = { Matched: 0, Unmatched: 0, Conflict: 0, Incomplete: 0 };
  for (const g of groups) counts[g.state]++;
  const complete = counts.Conflict === 0 && counts.Incomplete === 0;
  const events = groups.flatMap(g => g.event ? [g.event] : []);
  const attributionComplete = {
    customer: complete && events.every(e => Boolean(e.customerId?.trim())),
    booking: complete && events.every(e => Boolean(e.bookingId?.trim())),
    vehicle: complete && events.every(e => Boolean(e.vehicleId?.trim())),
  };
  return { groups, events, complete, attributionComplete, counts };
}

export type DatedVehicleAllocation = { vehicleId: string; from: string; to: string; amountCents: number; swapId?: string | null };
/** Explicit allocations, never current-vehicle inference; half-open dates and exact cents. */
export function validateVehicleAllocations(amountCents: number, period: { from: string; to: string }, allocations: readonly DatedVehicleAllocation[]): { state: ReconciliationState; reasons: string[] } {
  assertPeriod(period);
  const reasons: string[] = [];
  const sorted = [...allocations].sort((a, b) => a.from.localeCompare(b.from));
  if (!sorted.length) return { state: "Incomplete", reasons: ["No dated allocations"] };
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) return { state: "Conflict", reasons: ["Invalid total cents"] };
  let cursor = period.from;
  let total = 0;
  for (const a of sorted) {
    if (!validFinanceDate(a.from) || !validFinanceDate(a.to) || a.from < cursor || a.from >= a.to || a.to > period.to || !Number.isSafeInteger(a.amountCents) || a.amountCents < 0 || !a.vehicleId) reasons.push("Overlapping, out-of-range or invalid allocation");
    if (a.from > cursor) reasons.push("Unallocated date gap");
    total += a.amountCents;
    cursor = a.to;
  }
  if (cursor < period.to) reasons.push("Unallocated date gap");
  if (total !== amountCents) reasons.push("Allocation cents do not reconcile exactly");
  return { state: reasons.length ? "Conflict" : "Matched", reasons };
}