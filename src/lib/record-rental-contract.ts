// PROPOSAL ONLY. No UI activation, provider call, or automatic retry.
import { z } from 'zod';
export const RECORD_RENTAL_CONTRACT_ENABLED = false;
const cents = z.number().finite().nonnegative().max(100000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7, 'Use at most two decimal places');
export const recordRequest = z.object({
  operationId: z.string().uuid(), applicationId: z.string().uuid(), vehicleId: z.string().uuid(),
  // An explicit offset is mandatory; never manufacture a midnight historical handover.
  startedAt: z.string().datetime({ offset: true }), weeklyRate: cents.refine(n => n > 0),
  deposit: cents.nullable(), pickupMileage: z.number().int().min(0).max(2000000).nullable(),
  subscriptionEvidenceId: z.string().uuid().nullable(), reason: z.string().min(5).max(500),
}).strict();
export const recordResult = z.object({
  status: z.literal('recorded'), rentalId: z.string().uuid(),
  customerNumber: z.number().int().positive().safe(), bookingNumber: z.number().int().positive().safe(),
  recovered: z.boolean(), billing: z.literal('unchanged'), paymentsImported: z.literal(0),
}).strict();
export function recordRpcArgs(input: unknown) {
  const v = recordRequest.parse(input);
  return { _operation_id: v.operationId, _application_id: v.applicationId, _vehicle_id: v.vehicleId,
    _started_at: v.startedAt, _weekly_rate: v.weeklyRate, _deposit: v.deposit, _pickup_miles: v.pickupMileage,
    _subscription_evidence_id: v.subscriptionEvidenceId, _reason: v.reason };
}
// Future existing handler: requireSupabaseAuth + requireManager, then code-owned gate;
// call context.supabase.rpc with these args; parse response. Never supabaseAdmin for writes.
// Preserve operation + exact request in actor/application-scoped recovery storage.
// A lost response stays UNKNOWN; user-initiated same-operation recovery only.
// SQLSTATE 40001/55P03 after a confirmed rollback: at most two whole-transaction retries,
// using the SAME operation/payload, with bounded backoff. Never replay external effects.
// Missing RPC, auth/evidence denial and unverified rollback are NOT automatic retries.
