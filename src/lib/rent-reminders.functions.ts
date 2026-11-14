import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import {
  DEFAULT_TEMPLATES,
  MANUAL_METHODS,
  RENT_REMINDER_STAGES,
  easternParts,
  lateFeeFor,
  mergeTemplates,
  money,
  templateProblem,
  type RentReminderTemplates,
} from "@/lib/rent-reminders";

// Active Rentals → Late Fee column, Record Payment, Waive Late Fee; and
// Settings → Automations → Rent Reminder Templates. Nothing here sends a
// message or charges a card. Late fees are shown and requested, never charged.

export type RentalLateFeeStatus = {
  rentalId: string;
  mode: "stripe" | "manual";
  dueDate: string | null;
  owing: boolean;
  rentOwed: number;
  daysLate: number;
  lateFee: number;
  waived: boolean;
  balance: number;
};

export const getRentalLateFees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: RentalLateFeeStatus[]; errors: number }> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadBillingStates } = await import("@/lib/rent-reminders.server");
    const today = easternParts(new Date()).date;
    const { states, errors } = await loadBillingStates(supabaseAdmin as any, {}, today);
    const rows = states.map((s) => {
      const fee = s.owing && s.dueDate ? lateFeeFor({ dueDate: s.dueDate, today, waivers: s.waivers }) : { daysLate: 0, fee: 0, waived: false };
      return {
        rentalId: s.rentalId, mode: s.mode, dueDate: s.dueDate, owing: s.owing, rentOwed: s.rentOwed,
        daysLate: fee.daysLate, lateFee: fee.fee, waived: fee.waived,
        balance: Math.round((s.rentOwed + fee.fee) * 100) / 100,
      };
    });
    return { rows, errors };
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const recordRentPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    rentalId: z.string().uuid(),
    amount: z.number().positive().max(10000),
    method: z.enum(MANUAL_METHODS.map((m) => m.value) as [string, ...string[]]),
    reference: z.string().max(200).nullable(),
    paidOn: isoDate,
  }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordManualRentPayment } = await import("@/lib/rent-reminders.server");
    const res = await recordManualRentPayment(supabaseAdmin as any, data);
    await logAudit(actor, {
      action: "rent_payment.recorded",
      summary: `Recorded ${money(data.amount)} ${data.method} rent payment${res.covered ? `; next due ${res.nextDue}` : ""}`,
      entityType: "rental",
      entityId: data.rentalId,
      metadata: { ...data, payment_id: res.paymentId, covered: res.covered, next_due: res.nextDue },
    });
    return { ok: true, ...res };
  });

export const waiveLateFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    rentalId: z.string().uuid(),
    dueDate: isoDate,
    wholeWeek: z.boolean(),
    reason: z.string().min(1).max(500),
    amountWaived: z.number().min(0).max(100000).nullable(),
  }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { waiveRentLateFee } = await import("@/lib/rent-reminders.server");
    const today = easternParts(new Date()).date;
    const waivedThrough = data.wholeWeek ? null : (today < data.dueDate ? data.dueDate : today);
    const res = await waiveRentLateFee(supabaseAdmin as any, {
      rentalId: data.rentalId, dueDate: data.dueDate, waivedThrough, reason: data.reason, amountWaived: data.amountWaived,
    }, { userId: actor.userId, email: actor.email ?? null });
    await logAudit(actor, {
      action: "rent_late_fee.waived",
      summary: `Waived late fee for week due ${data.dueDate}${waivedThrough ? ` through ${waivedThrough}` : " (whole week)"}`,
      entityType: "rental",
      entityId: data.rentalId,
      metadata: { ...data, waived_through: waivedThrough, waiver_id: res.id },
    });
    return { ok: true, id: res.id, waivedThrough };
  });

export const getRentReminderTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ templates: RentReminderTemplates; defaults: RentReminderTemplates }> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadReminderTemplates } = await import("@/lib/rent-reminders.server");
    return { templates: await loadReminderTemplates(supabaseAdmin as any), defaults: DEFAULT_TEMPLATES };
  });

const stageT = z.object({ sms: z.string(), subject: z.string(), email: z.string() }).strict();
const modeT = z.object(Object.fromEntries(RENT_REMINDER_STAGES.map((s) => [s, stageT])) as Record<string, typeof stageT>).strict();

export const saveRentReminderTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ stripe: modeT, manual: modeT, manualInstructions: z.string().max(600) }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const t = data as unknown as RentReminderTemplates;
    for (const mode of ["stripe", "manual"] as const) {
      for (const stage of RENT_REMINDER_STAGES) {
        const problem = templateProblem(mode, stage, t[mode][stage]);
        if (problem) throw new Error(`${mode === "stripe" ? "Autopay" : "Manual"} ${stage.replace("_", " ")}: ${problem}`);
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { RENT_REMINDER_TEMPLATES_KEY } = await import("@/lib/rent-reminders.server");
    const value = mergeTemplates(t);
    const at = new Date().toISOString();
    const { error } = await (supabaseAdmin as any).from("app_settings").upsert({ key: RENT_REMINDER_TEMPLATES_KEY, value, updated_at: at });
    if (error) throw new Error("Could not save. Nothing was changed.");
    await logAudit(actor, {
      action: "rent_reminder_templates.saved",
      summary: "Saved rent reminder templates",
      entityType: "app_settings",
      entityId: RENT_REMINDER_TEMPLATES_KEY,
      metadata: {},
    });
    return { ok: true };
  });
