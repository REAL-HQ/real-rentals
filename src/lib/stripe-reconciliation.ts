// Offline, read-only reconciliation over minimized, complete exports.
// No credentials, email matching, network requests or mutation capability.
export type ReconciliationInput = {
  complete: boolean;
  subscriptions: { id: string; customerId: string }[];
  rentals: { id: string; subscriptionId: string | null; customerId: string | null }[];
  invoices: { id: string; subscriptionId: string; paidCents: number; paymentIntentId: string | null }[];
  paymentIntents: { id: string; receivedCents: number }[];
  financialRecords: { id: string; paymentId: string | null; collectedCents: number }[];
  refunds: { paymentIntentId: string; amountCents: number }[];
  payments: { id: string; invoiceId: string | null; rentalId: string | null; paymentIntentId: string | null; collectedCents: number; refundedCents: number }[];
};
export function reconcileStripe(input: ReconciliationInput) {
  if (input.complete !== true) throw new Error('Complete exports required; partial input cannot prove reconciliation');
  const issues: { kind: string; reference: string }[] = [];
  const flag = (kind: string, reference: string) => issues.push({ kind, reference });
  for (const rows of [input.subscriptions, input.rentals, input.invoices, input.payments, input.paymentIntents, input.financialRecords]) {
    if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Duplicate source identifiers');
  }
  for (const sub of input.subscriptions) {
    const matches = input.rentals.filter(r => r.subscriptionId === sub.id);
    if (matches.length !== 1) flag(matches.length ? 'ambiguous_subscription' : 'unmatched_subscription', sub.id);
    else if (!matches[0].customerId || matches[0].customerId !== sub.customerId) flag('customer_mismatch', sub.id);
  }
  for (const rental of input.rentals) {
    if (rental.subscriptionId && !input.subscriptions.some(s => s.id === rental.subscriptionId)) flag('missing_stripe_subscription', rental.id);
  }
  for (const invoice of input.invoices) {
    const rows = input.payments.filter(p => p.invoiceId === invoice.id);
    const rentals = input.rentals.filter(r => r.subscriptionId === invoice.subscriptionId);
    if (rows.length !== 1) { flag(rows.length ? 'duplicate_invoice' : 'missing_invoice', invoice.id); continue; }
    const payment = rows[0];
    if (rentals.length !== 1 || payment.rentalId !== rentals[0].id) flag('invoice_rental_mismatch', invoice.id);
    if (payment.collectedCents + payment.refundedCents !== invoice.paidCents) flag('collection_mismatch', invoice.id);
    if (invoice.paymentIntentId !== payment.paymentIntentId) flag('payment_intent_mismatch', invoice.id);
  }
  for (const intent of input.paymentIntents) {
    const rows = input.payments.filter(p => p.paymentIntentId === intent.id);
    if (!rows.length) flag('unmatched_payment_intent', intent.id);
    else if (rows.reduce((s,p) => s+p.collectedCents+p.refundedCents,0) !== intent.receivedCents) flag('payment_intent_amount_mismatch', intent.id);
  }
  for (const record of input.financialRecords) {
    const payment = input.payments.find(p => p.id === record.paymentId);
    if (!payment) flag('unmatched_financial_record', record.id);
    else if (record.collectedCents !== payment.collectedCents) flag('ledger_collection_mismatch', record.id);
  }
  for (const payment of input.payments) {
    if (input.financialRecords.filter(r => r.paymentId === payment.id).length > 1) flag('multiple_ledger_links', payment.id);
  }
  // Compare refunds once per intent, including combined-payment allocations.
  const intents = new Set([...input.refunds.map(r => r.paymentIntentId), ...input.payments.map(p => p.paymentIntentId).filter((x): x is string => !!x)]);
  for (const id of intents) {
    const expected = input.refunds.filter(r => r.paymentIntentId === id).reduce((s,r) => s+r.amountCents,0);
    const actual = input.payments.filter(p => p.paymentIntentId === id).reduce((s,p) => s+p.refundedCents,0);
    if (actual !== expected) flag('refund_mismatch', id);
  }
  return { dryRun: true as const, issues, counts: { subscriptions: input.subscriptions.length, invoices: input.invoices.length, payments: input.payments.length } };
}
