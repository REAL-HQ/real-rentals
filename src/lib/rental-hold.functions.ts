import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = z.string().uuid();

async function managerAudit(userId: string) {
  const { requireManager } = await import("@/lib/roles.server");
  const actor = await requireManager(userId);
  const { logAudit } = await import("@/lib/audit.server");
  return { actorId: userId, audit: (e: any) => logAudit(actor, e) };
}

/** Put a Reserved rental On Hold instead of releasing it or calling it a no-show (Manager+). */
export const putReservationOnHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: UUID, reason: z.string().max(400) }).parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const deps = await managerAudit(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { putRentalOnHold } = await import("@/lib/rental-hold.server");
    const r = await putRentalOnHold(supabaseAdmin, data, deps);
    if (!r.ok) throw new Error(r.error);
    return { ok: true };
  });

export const resumeReservationFromHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: UUID, pickupDate: z.string().max(10), pickupTime: z.string().max(5).nullish() }).parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true; pickupDate: string }> => {
    const deps = await managerAudit(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resumeRentalFromHold } = await import("@/lib/rental-hold.server");
    const r = await resumeRentalFromHold(supabaseAdmin, data, deps);
    if (!r.ok) throw new Error(r.error);
    return r;
  });

export const convertReservationFeeToCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ paymentId: UUID, reason: z.string().max(300).nullish() }).parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true; creditId: string; amount: number }> => {
    const deps = await managerAudit(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { convertFeeToCredit } = await import("@/lib/rental-hold.server");
    const r = await convertFeeToCredit(supabaseAdmin, data, deps);
    if (!r.ok) throw new Error(r.error);
    return r;
  });

export const applyRenterCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ creditId: UUID, rentalId: UUID }).parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true; amount: number }> => {
    const deps = await managerAudit(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyCreditToRental } = await import("@/lib/rental-hold.server");
    const r = await applyCreditToRental(supabaseAdmin, data, deps);
    if (!r.ok) throw new Error(r.error);
    return r;
  });

export const offerReservationFeeCreditAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ paymentId: UUID.nullish(), applicationId: UUID.nullish(), note: z.string().max(400) }).parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true; creditId: string; amount: number; expiresAt: string; days: number }> => {
    if (!data.paymentId && !data.applicationId) throw new Error("Choose A Reservation Fee.");
    const deps = await managerAudit(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { offerReservationFeeCredit } = await import("@/lib/rental-hold.server");
    const r = await offerReservationFeeCredit(supabaseAdmin, data, deps);
    if (!r.ok) throw new Error(r.error);
    return r;
  });

export const voidRenterCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ creditId: UUID, reason: z.string().max(400) }).parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const deps = await managerAudit(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { voidCredit } = await import("@/lib/rental-hold.server");
    const r = await voidCredit(supabaseAdmin, data, deps);
    if (!r.ok) throw new Error(r.error);
    return { ok: true };
  });

export type RenterCreditRow = {
  id: string;
  applicationId: string;
  driverName: string | null;
  amount: number;
  reason: string | null;
  status: "available" | "applied" | "void" | "expired";
  appliedToRentalId: string | null;
  createdAt: string;
  sourcePaymentId: string | null;
  expiresAt: string | null;
};

export type ReservationFeeOffer = { paymentId: string; amount: number; expiresAt: string; days: number };

/** Renter credits for the back office (staff read). Empty when the table is not there yet. */
export const listRenterCredits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: UUID.nullish() }).parse(d ?? {}))
  .handler(async ({ context, data }): Promise<{ rows: RenterCreditRow[]; offer: ReservationFeeOffer | null }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cols = "id,application_id,source_payment_id,amount,reason,status,applied_to_rental_id,expires_at,created_at";
    let q = (supabaseAdmin as any).from("renter_credits").select(cols).order("created_at", { ascending: false }).limit(200);
    if (data.applicationId) q = q.eq("application_id", data.applicationId);
    let { data: rows, error } = await q;
    if (error && /expires_at|column/i.test(String(error.message))) {
      let again = (supabaseAdmin as any).from("renter_credits").select("id,application_id,source_payment_id,amount,reason,status,applied_to_rental_id,created_at").order("created_at", { ascending: false }).limit(200);
      if (data.applicationId) again = again.eq("application_id", data.applicationId);
      const second = await again;
      rows = second.data;
      error = second.error;
    }
    if (error) {
      if (/renter_credits/i.test(error.message)) return { rows: [], offer: null };
      throw new Error(error.message);
    }
    const list = (rows ?? []) as any[];
    const ids = [...new Set(list.map((r) => r.application_id))] as string[];
    const apps = ids.length ? await supabaseAdmin.from("applications").select("id,full_name,email").in("id", ids) : { data: [] as any[] };
    const by = new Map(((apps.data ?? []) as any[]).map((a) => [a.id, a.full_name ?? a.email ?? null]));
    let offer: ReservationFeeOffer | null = null;
    if (data.applicationId) {
      const { reservationFeeOfferPreview } = await import("@/lib/rental-hold.server");
      const preview = await reservationFeeOfferPreview(supabaseAdmin, data.applicationId);
      if (preview.ok) offer = { paymentId: preview.paymentId, amount: preview.amount, expiresAt: preview.expiresAt, days: preview.days };
    }
    return {
      offer,
      rows: list.map((r) => ({
        id: r.id,
        applicationId: r.application_id,
        driverName: by.get(r.application_id) ?? null,
        amount: Number(r.amount),
        reason: r.reason ?? null,
        status: r.status,
        appliedToRentalId: r.applied_to_rental_id ?? null,
        createdAt: r.created_at,
        sourcePaymentId: r.source_payment_id ?? null,
        expiresAt: r.expires_at ?? null,
      })),
    };
  });
