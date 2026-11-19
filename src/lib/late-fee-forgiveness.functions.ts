import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager, requireOwner } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import { FORGIVE_REASONS, forgiveReasonLabel, type Ledger, type LedgerPolicy } from "@/lib/late-fee-ledger";

// Manage Late Fees (Bookings > Active Overdue cell, Payments Late Fees cell,
// driver profile Payments). Manager and above forgive; Owner can undo.
// Nothing here sends a message, calls Stripe or touches a collected charge.

export type LateFeeLedgerResponse = {
  rentalId: string;
  mode: "stripe" | "manual";
  rentOwed: number;
  ledger: Ledger;
  policy: LedgerPolicy;
  storage: "table" | "waivers";
  today: string;
  canUndo: boolean;
};

export const getLateFeeLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }): Promise<LateFeeLedgerResponse> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readRentalLedger } = await import("@/lib/late-fee-forgiveness.server");
    const { easternParts } = await import("@/lib/rent-reminders");
    const read = await readRentalLedger(supabaseAdmin as any, data.rentalId, easternParts(new Date()).date);
    return {
      rentalId: read.rentalId, mode: read.mode, rentOwed: read.rentOwed, ledger: read.ledger, policy: read.policy,
      storage: read.storage, today: read.today, canUndo: actor.tier === "owner" && read.storage === "table",
    };
  });

const reasonEnum = z.enum(FORGIVE_REASONS.map((r) => r.value) as [string, ...string[]]);

export const forgiveRentalLateFees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    rentalId: z.string().uuid(),
    mode: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("all") }).strict(),
      z.object({ kind: z.literal("selected"), feeIds: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/)).min(1).max(400) }).strict(),
      z.object({ kind: z.literal("amount"), amount: z.number().positive().max(100000) }).strict(),
    ]),
    reason: reasonEnum,
    note: z.string().max(500).nullable(),
    expectedOpen: z.number().min(0).max(1000000).nullable(),
  }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    if (data.reason === "other" && !data.note?.trim()) throw new Error("Add A Note For Other.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { forgiveLateFees } = await import("@/lib/late-fee-forgiveness.server");
    const res = await forgiveLateFees(supabaseAdmin as any, {
      rentalId: data.rentalId, mode: data.mode as any, reason: data.reason, note: data.note, expectedOpen: data.expectedOpen,
    }, { userId: actor.userId, email: actor.email ?? null });
    const feeIds = res.allocations.map((a) => `${a.dueDate}|${a.feeDate}`);
    await logAudit(actor, {
      action: "late_fee.forgiven",
      summary: `Forgave $${res.total.toFixed(2)} in late fees (${res.allocations.length} fee${res.allocations.length === 1 ? "" : "s"}): ${forgiveReasonLabel(data.reason)}`,
      entityType: "rental",
      entityId: data.rentalId,
      metadata: {
        mode: data.mode.kind, requested_amount: data.mode.kind === "amount" ? data.mode.amount : null,
        total: res.total, fee_ids: feeIds, allocations: res.allocations, reason: data.reason, note: data.note?.trim() || null,
        storage: res.storage, forgiveness_ids: res.forgivenessIds, waiver_ids: res.waiverIds, payment_updates: res.paymentUpdates,
        open_before: res.openBefore, open_after: res.openAfter, warnings: res.warnings,
        actor_email: actor.email ?? null, stripe_touched: false, renter_notified: false,
      },
    });
    return { ok: true as const, total: res.total, count: res.allocations.length, warnings: res.warnings, storage: res.storage };
  });

export const undoRentalLateFeeForgiveness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ forgivenessId: z.string().uuid(), note: z.string().max(500).nullable() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { undoLateFeeForgiveness } = await import("@/lib/late-fee-forgiveness.server");
    const res = await undoLateFeeForgiveness(supabaseAdmin as any, data, { userId: actor.userId, email: actor.email ?? null });
    await logAudit(actor, {
      action: "late_fee.forgiveness_undone",
      summary: `Undid $${res.amount.toFixed(2)} late fee forgiveness (week due ${res.dueDate}${res.feeDate ? `, ${res.feeDate}` : ""})`,
      entityType: "rental",
      entityId: res.rentalId,
      metadata: { forgiveness_id: res.id, amount: res.amount, due_date: res.dueDate, fee_date: res.feeDate, restored_to_row: res.restoredToRow, note: data.note?.trim() || null, actor_email: actor.email ?? null },
    });
    return { ok: true as const, amount: res.amount };
  });
