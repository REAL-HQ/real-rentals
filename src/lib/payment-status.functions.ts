/* eslint-disable @typescript-eslint/no-explicit-any -- the service-role client is used untyped here, as in rentals.functions.ts */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requiredTier, targetStatus, type PaymentStatusAction } from "@/lib/payment-status-rules";

// Staff status changes on a payment row: Change Status (between open statuses), Mark as Paid,
// Waive and Void. Rules live in payment-status-rules.ts. Each change needs a reason, applies only
// if the row still has the status the screen showed, and is recorded in the immutable audit_log
// with actor, before/after and reason. If the audit row can't be written the change is undone.

export const changePaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        paymentId: z.string().uuid(),
        action: z.enum(["set_open_status", "mark_paid", "waive", "void"]),
        expectedStatus: z.string().min(1).max(40),
        toStatus: z.string().max(40).nullable().optional(),
        reason: z.string().trim().min(3).max(500),
        method: z.string().trim().max(60).nullable().optional(),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; status: string } | { error: string }> => {
    const { requireTier } = await import("@/lib/roles.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const action = data.action as PaymentStatusAction;

    const need = requiredTier(action, data.expectedStatus);
    if (!need) return { error: `A ${data.expectedStatus} charge can't be changed this way.` };
    let actor;
    try {
      actor = await requireTier(context.userId, need);
    } catch {
      return { error: need === "owner" ? "Only the Owner can do this." : "Only a Manager or the Owner can do this." };
    }
    const to = targetStatus(action, data.expectedStatus, data.toStatus);
    if (!to) return { error: "Choose a different open status." };
    if (action === "mark_paid" && !data.method) return { error: "Say how the money was received." };

    const { data: row } = await admin
      .from("payments")
      .select("id, status, amount, balance_due, paid_date, payment_method, notes, driver_id, rental_id")
      .eq("id", data.paymentId)
      .maybeSingle();
    if (!row) return { error: "Payment not found." };
    if (row.status !== data.expectedStatus)
      return { error: "This charge changed since the list loaded, so nothing was changed. Reload Payments and check it." };

    const today = new Date().toISOString().slice(0, 10);
    const label = { set_open_status: `Status ${row.status} → ${to}`, mark_paid: `Marked paid (${data.method})`, waive: "Waived", void: "Voided" }[action];
    const patch: Record<string, unknown> = {
      status: to,
      notes: [row.notes, `${label}: ${data.reason}`].filter(Boolean).join("\n"),
      ...(action === "mark_paid" ? { paid_date: today, balance_due: 0, payment_method: data.method } : {}),
    };
    const { data: changed, error: upErr } = await admin
      .from("payments")
      .update(patch)
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id");
    if (upErr) return { error: "Could not save the change. Nothing was changed." };
    if (!changed?.length)
      return { error: "This charge changed since the list loaded, so nothing was changed. Reload Payments and check it." };

    const { error: auditErr } = await admin.from("audit_log").insert({
      actor_user_id: actor.userId,
      actor_email: actor.email ?? null,
      actor_role: actor.role,
      action: `payment.${action}`,
      entity_type: "payment",
      entity_id: row.id,
      summary: `${label}: $${Number(row.amount ?? 0).toFixed(2)}`,
      metadata: {
        from: row.status,
        to,
        reason: data.reason,
        method: data.method ?? null,
        amount: row.amount,
        balance_due_before: row.balance_due,
        paid_date_before: row.paid_date,
        driver_id: row.driver_id,
        rental_id: row.rental_id,
      },
    });
    if (auditErr) {
      // Undo, only if nothing else has changed the row since.
      await admin
        .from("payments")
        .update({ status: row.status, notes: row.notes, paid_date: row.paid_date, balance_due: row.balance_due, payment_method: row.payment_method })
        .eq("id", row.id)
        .eq("status", to);
      return { error: "Could not record the change in the audit log, so it was undone." };
    }
    return { ok: true, status: to };
  });
