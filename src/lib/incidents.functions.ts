import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Incidents, insurance claims and deposit disposition.
//
// Deposit disposition is the part that gets fudged in practice: a car comes
// back, somebody eyeballs the damage, and a number gets picked. Here the
// deposit is settled from itemised deductions that each point at the toll or
// incident they came from, so the renter can be shown the evidence rather
// than a figure.

// Delegates to the shared tier check rather than repeating the role list.
// Everything in this file is money, so the bar is Manager — a Coordinator is
// staff but is refused here, exactly as the RLS policies refuse them the
// underlying tables. Returns the actor so callers can attribute an audit entry
// without a second lookup.
async function assertStaff(_supabase: any, userId: string) {
  const { requireManager } = await import("@/lib/roles.server");
  return requireManager(userId);
}

export const INCIDENT_TYPES = [
  { value: "accident", label: "Accident" },
  { value: "damage", label: "Damage" },
  { value: "theft", label: "Theft" },
  { value: "vandalism", label: "Vandalism" },
  { value: "breakdown", label: "Breakdown" },
  { value: "tow", label: "Tow" },
  { value: "other", label: "Other" },
] as const;

export type Incident = {
  id: string;
  vehicle_id: string;
  rental_id: string | null;
  application_id: string | null;
  incident_type: string;
  occurred_at: string;
  location: string | null;
  description: string | null;
  at_fault: string;
  injuries: boolean;
  drivable: boolean | null;
  police_report_number: string | null;
  other_party: string | null;
  severity: string;
  status: string;
  claim_number: string | null;
  insurance_carrier: string | null;
  deductible: number;
  estimated_cost: number;
  actual_cost: number;
  insurance_payout: number;
  driver_responsible_amount: number;
  vendor_id: string | null;
  notes: string | null;
  created_at: string;
  vehicle_label?: string | null;
  driver_name?: string | null;
};

export const listIncidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ status: z.string().optional(), vehicleId: z.string().uuid().optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<Incident[]> => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("incidents")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(200);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.vehicleId) q = q.eq("vehicle_id", data.vehicleId);

    const { data: rows } = await q;
    if (!rows?.length) return [];

    const appIds = Array.from(new Set(rows.map((r: any) => r.application_id).filter(Boolean)));
    const vehIds = Array.from(new Set(rows.map((r: any) => r.vehicle_id).filter(Boolean)));
    const [{ data: apps }, { data: vehicles }] = await Promise.all([
      appIds.length
        ? supabaseAdmin.from("applications").select("id,full_name").in("id", appIds)
        : Promise.resolve({ data: [] as any[] }),
      vehIds.length
        ? supabaseAdmin.from("vehicles").select("id,year,make,model,license_plate").in("id", vehIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const appById = new Map((apps ?? []).map((a: any) => [a.id, a.full_name]));
    const vehById = new Map(
      (vehicles ?? []).map((v: any) => [
        v.id,
        [[v.year, v.make, v.model].filter(Boolean).join(" "), v.license_plate]
          .filter(Boolean)
          .join(" · "),
      ]),
    );

    return rows.map((r: any) => ({
      ...r,
      deductible: Number(r.deductible ?? 0),
      estimated_cost: Number(r.estimated_cost ?? 0),
      actual_cost: Number(r.actual_cost ?? 0),
      insurance_payout: Number(r.insurance_payout ?? 0),
      driver_responsible_amount: Number(r.driver_responsible_amount ?? 0),
      driver_name: r.application_id ? (appById.get(r.application_id) ?? null) : null,
      vehicle_label: vehById.get(r.vehicle_id) ?? null,
    }));
  });

export const saveIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        vehicleId: z.string().uuid(),
        rentalId: z.string().uuid().nullable().optional(),
        incidentType: z.string().max(40).default("accident"),
        occurredAt: z.string().min(10),
        location: z.string().max(240).nullable().optional(),
        description: z.string().max(4000).nullable().optional(),
        atFault: z.enum(["driver", "third_party", "none", "unknown"]).default("unknown"),
        injuries: z.boolean().default(false),
        drivable: z.boolean().nullable().optional(),
        policeReportNumber: z.string().max(120).nullable().optional(),
        otherParty: z.string().max(400).nullable().optional(),
        severity: z.enum(["minor", "moderate", "major", "total_loss"]).default("minor"),
        status: z.enum(["open", "in_claim", "repairing", "closed", "written_off"]).default("open"),
        claimNumber: z.string().max(120).nullable().optional(),
        insuranceCarrier: z.string().max(120).nullable().optional(),
        deductible: z.number().min(0).max(1000000).optional(),
        estimatedCost: z.number().min(0).max(10000000).optional(),
        actualCost: z.number().min(0).max(10000000).optional(),
        insurancePayout: z.number().min(0).max(10000000).optional(),
        driverResponsibleAmount: z.number().min(0).max(1000000).optional(),
        vendorId: z.string().uuid().nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
        /** Take the vehicle off the road while this is open. */
        markVehicleDown: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Attribute to whoever had the car, unless the caller said otherwise.
    let rentalId = data.rentalId ?? null;
    let applicationId: string | null = null;
    if (!rentalId) {
      const { data: found } = await supabaseAdmin.rpc("rental_at_time", {
        _vehicle_id: data.vehicleId,
        _at: data.occurredAt,
      });
      rentalId = (found as string | null) ?? null;
    }
    if (rentalId) {
      const { data: rental } = await supabaseAdmin
        .from("rentals")
        .select("application_id")
        .eq("id", rentalId)
        .maybeSingle();
      applicationId = (rental?.application_id as string) ?? null;
    }

    const payload = {
      vehicle_id: data.vehicleId,
      rental_id: rentalId,
      application_id: applicationId,
      incident_type: data.incidentType,
      occurred_at: data.occurredAt,
      location: data.location ?? null,
      description: data.description ?? null,
      at_fault: data.atFault,
      injuries: data.injuries,
      drivable: data.drivable ?? null,
      police_report_number: data.policeReportNumber ?? null,
      other_party: data.otherParty ?? null,
      severity: data.severity,
      status: data.status,
      claim_number: data.claimNumber ?? null,
      insurance_carrier: data.insuranceCarrier ?? null,
      deductible: data.deductible ?? 0,
      estimated_cost: data.estimatedCost ?? 0,
      actual_cost: data.actualCost ?? 0,
      insurance_payout: data.insurancePayout ?? 0,
      driver_responsible_amount: data.driverResponsibleAmount ?? 0,
      vendor_id: data.vendorId ?? null,
      notes: data.notes ?? null,
    };

    let id = data.id;
    if (id) {
      const { error } = await supabaseAdmin
        .from("incidents")
        .update(payload as any)
        .eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await supabaseAdmin
        .from("incidents")
        .insert({ ...payload, created_by: context.userId })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      id = row.id as string;
    }

    if (data.markVehicleDown) {
      await supabaseAdmin
        .from("vehicles")
        .update({ status: "maintenance" })
        .eq("id", data.vehicleId);
    }

    return { id: id as string, attributed: !!rentalId };
  });

export const deleteIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("incidents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ------------------------------------------------- deposit disposition

export type DepositDeduction = {
  id: string;
  reason: string;
  amount: number;
  toll_charge_id: string | null;
  incident_id: string | null;
  notes: string | null;
  created_at: string;
};

export type DepositSummary = {
  rentalId: string;
  depositAmount: number;
  depositHeld: boolean;
  depositStatus: string;
  deductions: DepositDeduction[];
  deductionTotal: number;
  refundDue: number;
  /** Charges and incidents not yet turned into deductions. */
  suggestions: Array<{
    kind: "toll" | "incident";
    id: string;
    label: string;
    amount: number;
  }>;
  settledAt: string | null;
};

export const getDepositSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<DepositSummary> => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id,deposit_amount,deposit_held,deposit_status,deposit_settled_at")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental) throw new Error("Rental not found");

    const { data: deductions } = await supabaseAdmin
      .from("deposit_deductions")
      .select("*")
      .eq("rental_id", data.rentalId)
      .order("created_at");

    const rows: DepositDeduction[] = (deductions ?? []).map((d: any) => ({
      ...d,
      amount: Number(d.amount ?? 0),
    }));
    const deductionTotal = rows.reduce((s, d) => s + d.amount, 0);
    const depositAmount = Number(rental.deposit_amount ?? 0);

    // Anything chargeable on this rental that has not already been deducted.
    const usedTolls = new Set(rows.map((d) => d.toll_charge_id).filter(Boolean));
    const usedIncidents = new Set(rows.map((d) => d.incident_id).filter(Boolean));

    const [{ data: tolls }, { data: incidents }] = await Promise.all([
      supabaseAdmin
        .from("toll_charges")
        .select("id,charge_type,amount,admin_fee,occurred_at,status")
        .eq("rental_id", data.rentalId)
        .in("status", ["assigned", "rebilled"]),
      supabaseAdmin
        .from("incidents")
        .select("id,incident_type,driver_responsible_amount,occurred_at")
        .eq("rental_id", data.rentalId)
        .gt("driver_responsible_amount", 0),
    ]);

    const suggestions: DepositSummary["suggestions"] = [];
    for (const t of tolls ?? []) {
      if (usedTolls.has(t.id)) continue;
      const amt = Number(t.amount ?? 0) + Number(t.admin_fee ?? 0);
      if (amt <= 0) continue;
      suggestions.push({
        kind: "toll",
        id: t.id as string,
        label: `${String(t.charge_type).replace(/_/g, " ")} on ${new Date(t.occurred_at).toLocaleDateString()}`,
        amount: amt,
      });
    }
    for (const i of incidents ?? []) {
      if (usedIncidents.has(i.id)) continue;
      suggestions.push({
        kind: "incident",
        id: i.id as string,
        label: `${String(i.incident_type).replace(/_/g, " ")} on ${new Date(i.occurred_at).toLocaleDateString()}`,
        amount: Number(i.driver_responsible_amount ?? 0),
      });
    }

    return {
      rentalId: rental.id as string,
      depositAmount,
      depositHeld: Boolean(rental.deposit_held),
      depositStatus: (rental.deposit_status as string) ?? "none",
      deductions: rows,
      deductionTotal,
      // Never negative: a deposit cannot refund more than was held. Anything
      // beyond it is collected separately, not netted off.
      refundDue: Math.max(0, depositAmount - deductionTotal),
      suggestions,
      settledAt: (rental.deposit_settled_at as string) ?? null,
    };
  });

export const addDepositDeduction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rentalId: z.string().uuid(),
        reason: z.string().min(2).max(240),
        amount: z.number().positive().max(1000000),
        tollChargeId: z.string().uuid().nullable().optional(),
        incidentId: z.string().uuid().nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("deposit_settled_at")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (rental?.deposit_settled_at) {
      throw new Error(
        "This deposit has already been settled — reopen it before changing deductions.",
      );
    }

    const { error } = await supabaseAdmin.from("deposit_deductions").insert({
      rental_id: data.rentalId,
      reason: data.reason,
      amount: data.amount,
      toll_charge_id: data.tollChargeId ?? null,
      incident_id: data.incidentId ?? null,
      notes: data.notes ?? null,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("rentals")
      .update({ deposit_status: "pending_disposition" })
      .eq("id", data.rentalId);
    return { ok: true };
  });

export const removeDepositDeduction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("deposit_deductions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Close out a deposit: freeze the deductions, record the refund and tell the
 * renter what was withheld and why.
 */
export const settleDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rentalId: z.string().uuid(),
        notes: z.string().max(2000).nullable().optional(),
        notifyDriver: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id,deposit_amount,application_id,deposit_settled_at")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental) throw new Error("Rental not found");
    if (rental.deposit_settled_at) throw new Error("This deposit is already settled.");

    const { data: deductions } = await supabaseAdmin
      .from("deposit_deductions")
      .select("reason,amount")
      .eq("rental_id", data.rentalId);

    const total = (deductions ?? []).reduce((s: number, d: any) => s + Number(d.amount ?? 0), 0);
    const depositAmount = Number(rental.deposit_amount ?? 0);
    const refund = Math.max(0, depositAmount - total);

    const status =
      refund === depositAmount && depositAmount > 0
        ? "refunded"
        : refund === 0
          ? "forfeited"
          : "partially_refunded";

    const { error } = await supabaseAdmin
      .from("rentals")
      .update({
        deposit_status: status,
        deposit_refund_amount: refund,
        deposit_settled_at: new Date().toISOString(),
        deposit_notes: data.notes ?? null,
      })
      .eq("id", data.rentalId);
    if (error) throw new Error(error.message);

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: "deposit.settled",
      summary: `Settled a $${depositAmount.toFixed(2)} deposit as ${status.replace("_", " ")} — refunding $${refund.toFixed(2)}`,
      entityType: "rental",
      entityId: data.rentalId,
      metadata: {
        deposit_amount: depositAmount,
        withheld: total,
        refund,
        status,
        // The itemisation, because deductions can be edited afterwards and
        // this is the record of what the decision was actually based on.
        deductions: deductions ?? [],
      },
    });

    if (data.notifyDriver !== false && rental.application_id) {
      try {
        const { data: app } = await supabaseAdmin
          .from("applications")
          .select("full_name,email")
          .eq("id", rental.application_id)
          .maybeSingle();
        if (app?.email) {
          const { sendEmail } = await import("@/lib/email.server");
          const lines = (deductions ?? [])
            .map(
              (d: any) =>
                `<tr><td style="padding:4px 12px 4px 0;color:#555">${escapeHtml(d.reason)}</td>` +
                `<td style="padding:4px 0;text-align:right">-$${Number(d.amount).toFixed(2)}</td></tr>`,
            )
            .join("");
          await sendEmail({
            to: app.email as string,
            subject: `Your deposit — $${refund.toFixed(2)} refunded`,
            html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
              <h1 style="font-size:19px">Deposit settled</h1>
              <p style="font-size:15px;line-height:1.6">Deposit held: <strong>$${depositAmount.toFixed(2)}</strong></p>
              ${lines ? `<table style="width:100%;border-top:1px solid #eee;border-bottom:1px solid #eee;margin:12px 0;font-size:14px">${lines}</table>` : "<p style='font-size:15px'>No deductions were made.</p>"}
              <p style="font-size:16px"><strong>Refunding: $${refund.toFixed(2)}</strong></p>
              ${data.notes ? `<p style="font-size:14px;color:#555">${escapeHtml(data.notes)}</p>` : ""}
              <p style="color:#888;font-size:12px;margin-top:18px">Questions about a deduction? Reply to this email and we'll walk you through it.</p>
            </div>`,
            replyTo: "team@drivereal.com",
          });
        }
      } catch (e) {
        console.error("[deposit] settle notice failed", e);
      }
    }

    return { ok: true, refund, deductionTotal: total, status };
  });

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
