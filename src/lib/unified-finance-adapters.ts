import { assertPeriod, eventDate, validFinanceDate } from "./unified-finance";
import { validateVehicleAllocations, type Representation } from "./unified-finance-reconciliation";
import { FINANCE_SOURCES, type AdapterResult, type FinanceSnapshots, type FinanceSourceRow, type UnifiedFinanceRequest } from "./unified-finance-contract";

/** Pure normalization. Whitelisted DTOs + injected snapshots only; no I/O or accounting writes. */
export function adaptFinanceSnapshots(snapshots: FinanceSnapshots, request: UnifiedFinanceRequest, tier: "owner" | "manager"): AdapterResult {
  const issues: string[] = [];
  const result: AdapterResult = { verified: [], posted: [], issues, complete: true,
    attributionComplete: { customer: true, rental: true, vehicle: true }, settlements: [] };
  const rows = FINANCE_SOURCES.flatMap(source => snapshots[source].rows.map(row => ({ source, row })));
  // Defense in depth: the mock readers also filter sensitive DTOs before returning them.
  const visible = rows.filter(({ row }) => {
    if (row.visibility !== "operating" && row.visibility !== "owner_only") {
      result.complete = false;
      if (!issues.includes("Unknown source visibility")) issues.push("Unknown source visibility");
      return false;
    }
    return row.visibility === "operating" || tier === "owner";
  });
  const relationships = visible.flatMap(({ row }) => row.relationship ? [row.relationship] : []);
  const lookup = new Map<string, FinanceSourceRow>();
  for (const { source, row } of visible) if (source === "ledger" && row.representation) lookup.set(row.id, row);
  const reversed = new Set<string>();
  for (const { source, row } of visible) {
    if (source !== "ledger" || !row.reversesId) continue;
    const original = lookup.get(row.reversesId);
    const a = original?.representation?.event, b = row.representation?.event;
    // Cancellation is safe only for explicit equal-fact same-period reversal pairs.
    const ad = a ? eventDate(a, request.basis) : null, bd = b ? eventDate(b, request.basis) : null;
    if (row.posting !== "posted" || original?.posting !== "reversed" || !a || !b || (a.kind !== "operating_expense" && a.kind !== "earned_revenue") ||
      b.relatedEventId !== a.id || a.evidence !== "verified" || b.evidence !== "verified" || a.status !== "succeeded" || b.status !== "succeeded" ||
      a.customerId !== b.customerId || a.bookingId !== b.bookingId || a.kind !== b.kind || a.amountCents !== b.amountCents || a.currency !== b.currency ||
      !ad || !bd || ad < request.period.from || ad >= request.period.to || bd < request.period.from || bd >= request.period.to) {
      result.complete = false; issues.push(`Unsupported or inconsistent ledger reversal: ${row.id}`);
    } else { reversed.add(original.id); reversed.add(row.id); }
  }
  const settlementClaims = new Set<string>();
  for (const { source, row } of visible) {
    if (row.settlement) {
      const s = row.settlement, payment = lookup.get(s.paymentId), obligation = lookup.get(s.obligationId);
      const pe = payment?.representation?.event, oe = obligation?.representation?.event;
      const claim = JSON.stringify([s.paymentId, s.obligationId, s.amountCents, s.currency]);
      const duplicate = settlementClaims.has(claim); settlementClaims.add(claim);
      if (!pe || !oe || payment?.posting !== "posted" || obligation?.posting !== "posted" || pe.kind !== "collection" || oe.kind !== "earned_revenue" ||
        duplicate || pe.evidence !== "verified" || pe.status !== "succeeded" || oe.status !== "succeeded" ||
        !pe.customerId || !pe.bookingId || pe.customerId !== oe.customerId || pe.bookingId !== oe.bookingId ||
        !Number.isSafeInteger(s.amountCents) || s.amountCents < 0 || s.currency !== "USD" || pe.currency !== s.currency || oe.currency !== s.currency ||
        pe.amountCents === null || oe.amountCents === null || s.amountCents > pe.amountCents || s.amountCents > oe.amountCents) {
        result.complete = false; issues.push(`Invalid settlement: ${row.id}`);
      } else result.settlements.push({ id: row.id, amountCents: s.amountCents });
      continue; // Links never become additional money events.
    }
    if (!row.representation || source === "relationships") continue;
    if (source === "ledger" && (row.posting !== "posted" || reversed.has(row.id) || row.reversesId)) {
      if (row.posting === "reversed" && !reversed.has(row.id)) { result.complete = false; issues.push(`Missing reversal evidence: ${row.id}`); }
      continue;
    }
    if (row.correctsId) {
      const old = lookup.get(row.correctsId)?.representation?.event, replacement = row.representation.event;
      if (!reversed.has(row.correctsId) || !old || replacement.relatedEventId !== old.id || replacement.kind !== old.kind ||
        replacement.currency !== old.currency || replacement.customerId !== old.customerId || replacement.bookingId !== old.bookingId) {
        result.complete = false; issues.push(`Unproven correction: ${row.id}`); continue;
      }
    }
    const original = row.representation;
    const rep: Representation = { ...original, id: `${source}:${row.id}`, event: { ...original.event }, identities: [...original.identities] };
    // Link expense/C1 representations through the same immutable expense UUID, never invoice text.
    if (row.expenseId && rep.event.kind === "operating_expense") rep.operationalPaymentId = `expense:${row.expenseId}`;
    const matches = relationships.filter(r => r.eventId === original.event.id);
    const relation = matches[0];
    if (matches.length > 1 && matches.some(r => JSON.stringify(r) !== JSON.stringify(relation))) { result.complete = false; issues.push(`Conflicting historical relationship: ${row.id}`); }
    if (relation) {
      if ((rep.event.customerId && rep.event.customerId !== relation.customerId) || (rep.event.bookingId && rep.event.bookingId !== relation.rentalId)) {
        result.complete = false; issues.push(`Conflicting customer/rental relationship: ${row.id}`);
      }
      rep.event.customerId = relation.customerId; rep.event.bookingId = relation.rentalId;
    }
    if (!rep.event.customerId) result.attributionComplete.customer = false;
    if (!rep.event.bookingId) result.attributionComplete.rental = false;
    // Never infer historical vehicle from a current rental/vehicle field.
    rep.event.vehicleId = null;
    let vehicleKnown = false;
    if (relation?.servicePeriod && rep.event.amountCents !== null) {
      try {
        assertPeriod(relation.servicePeriod);
        const check = validateVehicleAllocations(rep.event.amountCents, relation.servicePeriod, relation.allocations);
        if (check.state === "Matched" && relation.allocations.length === 1) {
          rep.event.vehicleId = relation.allocations[0]?.vehicleId ?? null; vehicleKnown = Boolean(rep.event.vehicleId);
        } else if (check.state === "Matched") issues.push(`Split-vehicle allocation needs explicit fee/adjustment allocation: ${row.id}`);
        else issues.push(`Invalid dated allocation: ${row.id}`);
      } catch { issues.push(`Invalid historical service period: ${row.id}`); }
    }
    if (!vehicleKnown) result.attributionComplete.vehicle = false;
    const scoped = Boolean(request.customerId || request.rentalId || request.vehicleId);
    if ((request.customerId && !rep.event.customerId) || (request.rentalId && !rep.event.bookingId) || (request.vehicleId && !vehicleKnown)) {
      result.complete = false; issues.push(`Scope attribution unavailable: ${row.id}`);
    }
    const selected = (!request.customerId || request.customerId === rep.event.customerId) && (!request.rentalId || request.rentalId === rep.event.bookingId) && (!request.vehicleId || request.vehicleId === rep.event.vehicleId);
    if (scoped && !selected) continue;
    const d = eventDate(rep.event, request.basis);
    if (!d || !validFinanceDate(d)) { result.complete = false; issues.push(`Invalid reporting date: ${row.id}`); }
    if (rep.event.currency !== "USD") { result.complete = false; issues.push(`Missing or unsupported currency: ${row.id}`); }
    if (source === "ledger") result.posted.push(rep);
    // Posted status alone never proves receipt movement or verifies an invoice as cash.
    if (rep.event.kind !== "earned_revenue" && (source !== "ledger" || rep.event.evidence === "verified")) result.verified.push(rep);
  }
  // Settlements cannot over-allocate even when each individual link is within its cap.
  const totals = new Map<string, number>();
  for (const { row } of visible) if (row.settlement) {
    for (const id of [row.settlement.paymentId, row.settlement.obligationId]) totals.set(id, (totals.get(id) ?? 0) + row.settlement.amountCents);
  }
  for (const [id, amount] of totals) {
    const cap = lookup.get(id)?.representation?.event.amountCents;
    if (cap == null || !Number.isSafeInteger(amount) || amount > cap) { result.complete = false; issues.push(`Settlement allocation exceeds source: ${id}`); }
  }
  return result;
}