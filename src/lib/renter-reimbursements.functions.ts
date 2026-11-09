import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import {
  METHOD_VALUES,
  REASON_VALUES,
  methodLabel,
  parseReimbursementAmount,
  reasonLabel,
  reimbursementProblem,
} from "@/lib/renter-reimbursements";

// Renter reimbursements (Expenses → Renter Reimbursements). Money, so every
// handler requires a Manager; the table's RLS refuses everyone else too. The
// service role is used for reads that join names, after requireManager.
// Nothing here sends email or SMS, writes rent rows, or changes a rental.

export type RenterReimbursement = {
  id: string;
  application_id: string;
  rental_id: string | null;
  vehicle_id: string | null;
  paid_on: string;
  amount: number;
  method: string;
  method_label: string;
  reference: string | null;
  reason: string;
  reason_label: string;
  notes: string | null;
  receipt_url: string | null;
  receipt_name: string | null;
  renter_name: string;
  vehicle_label: string | null;
  created_at: string;
};

export type ReimbursementRenterChoice = {
  applicationId: string;
  rentalId: string;
  vehicleId: string | null;
  label: string;
  active: boolean;
};

function vehicleLabel(v: any): string | null {
  if (!v) return null;
  const head = [v.unit_number, `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim()].filter(Boolean).join(" · ");
  return v.license_plate ? `${head} · ${v.license_plate}` : head || null;
}

const listInput = z.object({ from: z.string().optional(), to: z.string().optional() });

export const listRenterReimbursements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<RenterReimbursement[]> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;
    let q = admin.from("renter_reimbursements").select("*").order("paid_on", { ascending: false }).limit(500);
    if (data.from) q = q.gte("paid_on", data.from);
    if (data.to) q = q.lte("paid_on", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    if (!rows?.length) return [];
    const appIds = [...new Set(rows.map((r: any) => r.application_id))];
    const vehIds = [...new Set(rows.map((r: any) => r.vehicle_id).filter(Boolean))];
    const [{ data: apps }, { data: vehs }] = await Promise.all([
      admin.from("applications").select("id,full_name").in("id", appIds),
      vehIds.length ? admin.from("vehicles").select("id,unit_number,year,make,model,license_plate").in("id", vehIds) : Promise.resolve({ data: [] }),
    ]);
    const nameById = new Map((apps ?? []).map((a: any) => [a.id, a.full_name as string]));
    const vehById = new Map((vehs ?? []).map((v: any) => [v.id, v]));
    const out: RenterReimbursement[] = [];
    for (const r of rows as any[]) {
      let receiptUrl: string | null = null;
      if (r.receipt_path) {
        const { data: signed } = await admin.storage.from("receipts").createSignedUrl(r.receipt_path, 3600);
        receiptUrl = signed?.signedUrl ?? null;
      }
      out.push({
        id: r.id,
        application_id: r.application_id,
        rental_id: r.rental_id ?? null,
        vehicle_id: r.vehicle_id ?? null,
        paid_on: r.paid_on,
        amount: Number(r.amount ?? 0),
        method: r.method,
        method_label: methodLabel(r.method),
        reference: r.reference ?? null,
        reason: r.reason,
        reason_label: reasonLabel(r.reason),
        notes: r.notes ?? null,
        receipt_url: receiptUrl,
        receipt_name: r.receipt_name ?? null,
        renter_name: String(nameById.get(r.application_id) ?? "Unknown Renter"),
        vehicle_label: vehicleLabel(vehById.get(r.vehicle_id)),
        created_at: r.created_at,
      });
    }
    return out;
  });

/** Renters who have (or had) a rental, newest first, for the form's picker. */
export const listReimbursementRenters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<ReimbursementRenterChoice[]> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;
    const { data: rentals, error } = await admin
      .from("rentals")
      .select("id,application_id,vehicle_id,status,start_date")
      .not("application_id", "is", null)
      .order("start_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const list = rentals ?? [];
    if (!list.length) return [];
    const appIds = [...new Set(list.map((r: any) => r.application_id))];
    const vehIds = [...new Set(list.map((r: any) => r.vehicle_id).filter(Boolean))];
    const [{ data: apps }, { data: vehs }] = await Promise.all([
      admin.from("applications").select("id,full_name").in("id", appIds),
      vehIds.length ? admin.from("vehicles").select("id,unit_number,year,make,model,license_plate").in("id", vehIds) : Promise.resolve({ data: [] }),
    ]);
    const nameById = new Map((apps ?? []).map((a: any) => [a.id, a.full_name as string]));
    const vehById = new Map((vehs ?? []).map((v: any) => [v.id, v]));
    return list
      .map((r: any) => ({
        applicationId: r.application_id,
        rentalId: r.id,
        vehicleId: r.vehicle_id ?? null,
        active: r.status === "active",
        label: [nameById.get(r.application_id) ?? "Unknown Renter", vehicleLabel(vehById.get(r.vehicle_id)), r.status === "active" ? null : "Ended"]
          .filter(Boolean)
          .join(" — "),
      }))
      .sort((a: ReimbursementRenterChoice, b: ReimbursementRenterChoice) => Number(b.active) - Number(a.active));
  });

const createInput = z.object({
  applicationId: z.string().uuid(),
  rentalId: z.string().uuid().nullish(),
  vehicleId: z.string().uuid().nullish(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.union([z.number(), z.string()]),
  method: z.enum(METHOD_VALUES),
  reference: z.string().trim().max(120).nullish(),
  reason: z.enum(REASON_VALUES),
  notes: z.string().trim().max(2000).nullish(),
  receiptPath: z.string().trim().max(400).nullish(),
  receiptName: z.string().trim().max(200).nullish(),
  receiptMime: z.string().trim().max(120).nullish(),
});

export const createRenterReimbursement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
    const actor = await requireManager(context.userId);
    const problem = reimbursementProblem(data);
    if (problem) return { ok: false, error: problem };
    const amount = parseReimbursementAmount(data.amount)!;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;

    // The rental, when given, must belong to the renter chosen.
    if (data.rentalId) {
      const { data: rental } = await admin.from("rentals").select("id,application_id").eq("id", data.rentalId).maybeSingle();
      if (!rental || rental.application_id !== data.applicationId) return { ok: false, error: "That Rental Is Not This Renter's" };
    }

    const { data: row, error } = await admin
      .from("renter_reimbursements")
      .insert({
        application_id: data.applicationId,
        rental_id: data.rentalId ?? null,
        vehicle_id: data.vehicleId ?? null,
        paid_on: data.paidOn,
        amount,
        method: data.method,
        reference: data.reference || null,
        reason: data.reason,
        notes: data.notes || null,
        receipt_path: data.receiptPath ?? null,
        receipt_name: data.receiptName ?? null,
        receipt_mime: data.receiptMime ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !row) return { ok: false, error: error?.message ?? "Could Not Save The Reimbursement." };

    await logAudit(actor, {
      action: "renter_reimbursement.created",
      summary: `Recorded $${amount.toFixed(2)} ${methodLabel(data.method)} reimbursement (${reasonLabel(data.reason)})`,
      entityType: "renter_reimbursement",
      entityId: row.id,
      metadata: { application_id: data.applicationId, rental_id: data.rentalId ?? null, amount, method: data.method, reason: data.reason },
    });
    return { ok: true, id: row.id };
  });

export const deleteRenterReimbursement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;
    const { data: before } = await admin.from("renter_reimbursements").select("*").eq("id", data.id).maybeSingle();
    if (!before) return { ok: false, error: "That Reimbursement No Longer Exists." };
    const { error } = await admin.from("renter_reimbursements").delete().eq("id", data.id);
    if (error) return { ok: false, error: error.message };
    await logAudit(actor, {
      action: "renter_reimbursement.deleted",
      summary: `Deleted $${Number(before.amount).toFixed(2)} reimbursement dated ${before.paid_on}`,
      entityType: "renter_reimbursement",
      entityId: data.id,
      metadata: { before },
    });
    return { ok: true };
  });
