// Usage: node --import tsx scripts/stripe-reconcile-dry-run.ts /secure/minimized-export.json
// Reads an approved local export only. Prints counts, never record identifiers.
import { readFileSync } from 'node:fs';
import { reconcileStripe } from '../src/lib/stripe-reconciliation';
import { z } from 'zod';
const id = z.string().min(1).max(200), cents = z.number().int().nonnegative().safe();
const schema = z.object({
  complete: z.literal(true),
  subscriptions: z.array(z.object({ id, customerId: id }).strict()),
  rentals: z.array(z.object({ id, subscriptionId: id.nullable(), customerId: id.nullable() }).strict()),
  invoices: z.array(z.object({ id, subscriptionId: id, paidCents: cents, paymentIntentId: id.nullable() }).strict()),
  paymentIntents: z.array(z.object({ id, receivedCents: cents }).strict()),
  financialRecords: z.array(z.object({ id, paymentId: id.nullable(), collectedCents: cents }).strict()),
  refunds: z.array(z.object({ paymentIntentId: id, amountCents: cents }).strict()),
  payments: z.array(z.object({ id, invoiceId: id.nullable(), rentalId: id.nullable(), paymentIntentId: id.nullable(), collectedCents: cents, refundedCents: cents }).strict()),
}).strict();
try {
  if (process.argv.length !== 3) throw new Error();
  const report = reconcileStripe(schema.parse(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
  const issues: Record<string,number> = {};
  for (const issue of report.issues) issues[issue.kind] = (issues[issue.kind] ?? 0) + 1;
  console.log(JSON.stringify({ dryRun: true, counts: report.counts, issues }, null, 2));
} catch { console.error('Dry run refused: supply one valid, complete minimized export. No changes made.'); process.exitCode = 1; }
