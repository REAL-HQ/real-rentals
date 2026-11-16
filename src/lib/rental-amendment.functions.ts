// Back office: Send Updated Agreement on an active rental (Bookings → the
// rental → Send Updated Agreement). Manager or Owner. Same server path as
// FLEET's /api/public/fleet/amend-agreement (rental-amendment.server.ts), with
// staff-recorded consent; no Automations switch, no bot-hours or handoff gate
// (a person is choosing to send it). The new rate starts only after the
// renter signs, from the effective date or the next rent week.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SendInput = z.object({
  rentalId: z.string().uuid(),
  newWeeklyRate: z.number().positive().max(100000),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().trim().min(5).max(1000),
  consent: z
    .object({
      channel: z.enum(["sms", "call", "in_person", "email"]),
      receivedAt: z.string().min(10).max(40),
      quote: z.string().trim().min(2).max(1000),
      messageId: z.string().max(120).optional(),
      callId: z.string().max(120).optional(),
    })
    .optional(),
  outOfBoundsAck: z.boolean().optional(),
  terms: z
    .object({
      damageWaiver: z.enum(["accepted", "declined"]).optional(),
      paymentSchedule: z.enum(["weekly", "every_4_weeks"]).optional(),
      paymentMethod: z.string().max(40).optional(),
      vehicleOwner: z.string().trim().max(160).optional(),
    })
    .optional(),
  idempotencyKey: z.string().min(8).max(120),
});

export const sendUpdatedAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SendInput.parse(d))
  .handler(async ({ data, context }) => {
    const { requireTier } = await import("@/lib/roles.server");
    const actor = await requireTier(context.userId, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");
    const { proposeRentalAmendment } = await import("@/lib/rental-amendment.server");
    const label = `${actor.email || "Staff"} (staff)`;
    const r = await proposeRentalAmendment(
      supabaseAdmin,
      {
        rentalId: data.rentalId,
        termsRaw: data.terms
          ? { damage_waiver: data.terms.damageWaiver, payment_schedule: data.terms.paymentSchedule, payment_method: data.terms.paymentMethod || undefined, vehicle_owner: data.terms.vehicleOwner || undefined }
          : null,
        newWeeklyRate: data.newWeeklyRate,
        effectiveDate: data.effectiveDate ?? null,
        reason: data.reason,
        consentRaw: data.consent
          ? { channel: data.consent.channel, received_at: data.consent.receivedAt, quote: data.consent.quote, message_id: data.consent.messageId ?? null, call_id: data.consent.callId ?? null }
          : null,
        source: "staff",
        requestedBy: label,
        requestedByUser: context.userId,
        outOfBoundsAck: data.outOfBoundsAck === true,
        idempotencyKey: data.idempotencyKey,
      },
      { audit: (e) => logAudit(actor, e), now: new Date() },
    );
    // The signing link is never returned to the browser here.
    const b = r.body as Record<string, any>;
    return {
      status: r.status,
      ok: b.ok === true,
      error: typeof b.error === "string" ? b.error : null,
      reason: typeof b.reason === "string" ? b.reason : null,
      amendmentId: typeof b.amendment_id === "string" ? b.amendment_id : null,
      agreementId: typeof b.agreement_id === "string" ? b.agreement_id : null,
      effectiveDate: typeof b.effective_date === "string" ? b.effective_date : null,
      delivered: typeof b.delivery?.delivered === "boolean" ? (b.delivery.delivered as boolean) : null,
    };
  });

export const listUpdatedAgreements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireTier } = await import("@/lib/roles.server");
    await requireTier(context.userId, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listRentalAmendments } = await import("@/lib/rental-amendment.server");
    const r = await listRentalAmendments(supabaseAdmin, data.rentalId);
    const b = r.body as Record<string, any>;
    const rows = (Array.isArray(b.amendments) ? b.amendments : []) as Record<string, unknown>[];
    return {
      ok: b.ok === true,
      error: typeof b.error === "string" ? b.error : null,
      amendments: rows.map((a) => ({
        id: String(a.id),
        status: String(a.status),
        oldWeeklyRate: Number(a.old_weekly_rate),
        newWeeklyRate: Number(a.new_weekly_rate),
        effectiveDate: String(a.effective_date ?? ""),
        applyOn: a.apply_on ? String(a.apply_on) : null,
        agreementId: a.agreement_id ? String(a.agreement_id) : null,
        stripeUpdateRequired: a.stripe_update_required === true,
        createdAt: String(a.created_at ?? ""),
      })),
    };
  });
