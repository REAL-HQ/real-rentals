import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TXN_TYPES, requiredSensitivity, normalizeReference } from "@/lib/financial-ledger";

/**
 * Step C1 ledger entry points. Every call runs as the signed-in user so the
 * database fin_* functions check Owner/Manager rights themselves; nothing here
 * uses admin access, and nothing posts automatically.
 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
const uuid = z.string().uuid().nullish();
const Payload = z.object({
  txn_type: z.enum(TXN_TYPES),
  direction: z.enum(["in", "out"]),
  category: z.string().trim().min(1).max(60),
  amount: z.number().positive().max(10_000_000),
  interest_amount: z.number().min(0).nullish(),
  document_date: date, service_date: date, due_date: date, recognition_date: date, cash_date: date,
  vendor_id: uuid, vehicle_hint_id: uuid, rental_id: uuid, payment_id: uuid, expense_id: uuid,
  payee_raw: z.string().max(200).nullish(), reference_raw: z.string().max(120).nullish(),
  payment_method: z.string().max(40).nullish(), memo: z.string().max(1000).nullish(),
  source_type: z.enum(["manual", "fleet_inbox", "service", "expense", "toll", "deposit", "stripe"]).default("manual"),
});
const Idem = z.string().min(8).max(200);

function shape(p: z.infer<typeof Payload>) {
  return { ...p, sensitivity: requiredSensitivity(p.txn_type, p.category), reference_norm: normalizeReference(p.reference_raw) };
}
async function rpc(ctx: any, fn: string, args: Record<string, unknown>) {
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export const proposeTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ payload: Payload, idempotencyKey: Idem }).parse(d))
  .handler(async ({ data, context }) => ({ id: await rpc(context, "fin_propose", { _p: shape(data.payload), _idem: data.idempotencyKey }) as string }));

export const confirmTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => ({ result: await rpc(context, "fin_confirm", { _id: data.id }) as string }));

export const postTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), recognitionDate: date, cashDate: date }).parse(d))
  .handler(async ({ data, context }) => ({ result: await rpc(context, "fin_post", { _id: data.id, _recognition: data.recognitionDate ?? null, _cash: data.cashDate ?? null }) as string }));

export const discardTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => ({ result: await rpc(context, "fin_discard", { _id: data.id, _reason: data.reason }) as string }));

export const reverseTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500), idempotencyKey: Idem }).parse(d))
  .handler(async ({ data, context }) => ({ reversalId: await rpc(context, "fin_reverse", { _id: data.id, _reason: data.reason, _idem: data.idempotencyKey }) as string }));

export const correctTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), payload: Payload, reason: z.string().trim().min(3).max(500), idempotencyKey: Idem }).parse(d))
  .handler(async ({ data, context }) => ({ id: await rpc(context, "fin_correct", { _id: data.id, _p: shape(data.payload), _reason: data.reason, _idem: data.idempotencyKey }) as string }));

export const settleTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ obligationId: z.string().uuid(), paymentId: z.string().uuid(), amount: z.number().positive(), idempotencyKey: Idem }).parse(d))
  .handler(async ({ data, context }) => ({ settlementId: await rpc(context, "fin_settle", { _obligation: data.obligationId, _payment: data.paymentId, _amount: data.amount, _idem: data.idempotencyKey }) as string }));

export const unsettleTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ settlementId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => ({ result: await rpc(context, "fin_unsettle", { _settlement: data.settlementId, _reason: data.reason }) as string }));

export const addTransactionEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), evidence: z.object({
    document_id: uuid, import_item_id: uuid, service_transaction_id: uuid,
    page: z.number().int().positive().nullish(), raw_text: z.string().max(2000).nullish(),
    field: z.string().max(60).nullish(), confidence: z.string().max(20).nullish(),
  }) }).parse(d))
  .handler(async ({ data, context }) => ({ id: await rpc(context, "fin_add_evidence", { _id: data.id, _e: data.evidence }) as string }));
