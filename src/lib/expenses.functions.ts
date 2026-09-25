import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager } from "@/lib/roles.server";
import { logAudit, diffFields } from "@/lib/audit.server";

// Vehicle expenses, receipts and per-vehicle P&L.
//
// Everything here is money, so every handler requires a Manager. A
// Coordinator calling these directly gets Forbidden, and the underlying
// tables refuse them too — the check here is for the paths that run through
// the service role and therefore bypass RLS.

export const EXPENSE_CATEGORIES = [
  { value: "registration", label: "Registration & tags" },
  { value: "insurance", label: "Insurance premium" },
  { value: "maintenance", label: "Routine maintenance" },
  { value: "repair", label: "Repair" },
  { value: "tires", label: "Tires" },
  { value: "fuel", label: "Fuel" },
  { value: "cleaning", label: "Cleaning & detailing" },
  { value: "towing", label: "Towing" },
  { value: "parking", label: "Parking & storage" },
  { value: "tolls", label: "Tolls (absorbed)" },
  { value: "finance", label: "Finance / lease payment" },
  { value: "purchase", label: "Purchase" },
  { value: "gps", label: "GPS & telematics" },
  { value: "other", label: "Other" },
] as const;

const CATEGORY_VALUES = EXPENSE_CATEGORIES.map((c) => c.value) as unknown as [string, ...string[]];

export type Expense = {
  id: string;
  vehicle_id: string;
  rental_id: string | null;
  vendor_id: string | null;
  category: string;
  description: string;
  amount: number;
  incurred_on: string;
  payment_method: string | null;
  reference: string | null;
  receipt_path: string | null;
  receipt_name: string | null;
  is_recurring: boolean;
  notes: string | null;
  created_at: string;
  vehicle_label?: string | null;
  vendor_name?: string | null;
  receipt_url?: string | null;
};

const expenseInput = z.object({
  vehicleId: z.string().uuid(),
  rentalId: z.string().uuid().nullish(),
  vendorId: z.string().uuid().nullish(),
  category: z.enum(CATEGORY_VALUES),
  description: z.string().trim().min(1).max(300),
  amount: z.number().nonnegative().max(1_000_000),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.string().trim().max(60).nullish(),
  reference: z.string().trim().max(120).nullish(),
  receiptPath: z.string().trim().max(400).nullish(),
  receiptName: z.string().trim().max(200).nullish(),
  receiptMime: z.string().trim().max(120).nullish(),
  isRecurring: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullish(),
});

function vehicleLabel(v: any): string {
  if (!v) return "Unknown vehicle";
  const plate = v.license_plate ? ` · ${v.license_plate}` : "";
  return `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() + plate;
}

// ------------------------------------------------------------------ listing

export const listExpenses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        vehicleId: z.string().uuid().optional(),
        category: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<Expense[]> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("vehicle_expenses")
      .select("*")
      .order("incurred_on", { ascending: false })
      .limit(data.limit ?? 300);
    if (data.vehicleId) q = q.eq("vehicle_id", data.vehicleId);
    if (data.category && data.category !== "all") q = q.eq("category", data.category);
    if (data.from) q = q.gte("incurred_on", data.from);
    if (data.to) q = q.lte("incurred_on", data.to);

    const { data: rows } = await q;
    if (!rows?.length) return [];

    const vehIds = Array.from(new Set(rows.map((r: any) => r.vehicle_id).filter(Boolean)));
    const vendorIds = Array.from(new Set(rows.map((r: any) => r.vendor_id).filter(Boolean)));
    const [{ data: vehicles }, { data: vendors }] = await Promise.all([
      vehIds.length
        ? supabaseAdmin.from("vehicles").select("id,year,make,model,license_plate").in("id", vehIds)
        : Promise.resolve({ data: [] as any[] }),
      vendorIds.length
        ? supabaseAdmin.from("vendors").select("id,name").in("id", vendorIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const vById = new Map((vehicles ?? []).map((v: any) => [v.id, v]));
    const venById = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));

    // Receipts live in a private bucket; hand back short-lived signed URLs so
    // the panel can show a thumbnail without making the bucket public.
    const out: Expense[] = [];
    for (const r of rows as any[]) {
      let receiptUrl: string | null = null;
      if (r.receipt_path) {
        const { data: signed } = await supabaseAdmin.storage
          .from("receipts")
          .createSignedUrl(r.receipt_path, 3600);
        receiptUrl = signed?.signedUrl ?? null;
      }
      out.push({
        ...r,
        amount: Number(r.amount ?? 0),
        vehicle_label: vehicleLabel(vById.get(r.vehicle_id)),
        vendor_name: r.vendor_id ? (venById.get(r.vendor_id) ?? null) : null,
        receipt_url: receiptUrl,
      });
    }
    return out;
  });

// ------------------------------------------------------------------ writing

export const createExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => expenseInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("vehicle_expenses")
      .insert({
        vehicle_id: data.vehicleId,
        rental_id: data.rentalId ?? null,
        vendor_id: data.vendorId ?? null,
        category: data.category,
        description: data.description,
        amount: data.amount,
        incurred_on: data.incurredOn,
        payment_method: data.paymentMethod ?? null,
        reference: data.reference ?? null,
        receipt_path: data.receiptPath ?? null,
        receipt_name: data.receiptName ?? null,
        receipt_mime: data.receiptMime ?? null,
        is_recurring: data.isRecurring ?? false,
        notes: data.notes ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (error || !row) return { ok: false, error: error?.message ?? "Could not save the expense." };

    const { data: veh } = await supabaseAdmin
      .from("vehicles")
      .select("year,make,model,license_plate")
      .eq("id", data.vehicleId)
      .maybeSingle();

    await logAudit(actor, {
      action: "expense.created",
      summary: `Recorded $${data.amount.toFixed(2)} ${data.category} on ${vehicleLabel(veh)} — ${data.description}`,
      entityType: "vehicle_expense",
      entityId: row.id,
      metadata: {
        vehicle_id: data.vehicleId,
        category: data.category,
        amount: data.amount,
        has_receipt: !!data.receiptPath,
      },
    });

    return { ok: true, id: row.id };
  });

export const updateExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    expenseInput.partial().extend({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: before } = await supabaseAdmin
      .from("vehicle_expenses")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) return { ok: false, error: "That expense no longer exists." };

    const patch: Record<string, unknown> = {};
    if (data.category !== undefined) patch.category = data.category;
    if (data.description !== undefined) patch.description = data.description;
    if (data.amount !== undefined) patch.amount = data.amount;
    if (data.incurredOn !== undefined) patch.incurred_on = data.incurredOn;
    if (data.vendorId !== undefined) patch.vendor_id = data.vendorId ?? null;
    if (data.rentalId !== undefined) patch.rental_id = data.rentalId ?? null;
    if (data.paymentMethod !== undefined) patch.payment_method = data.paymentMethod ?? null;
    if (data.reference !== undefined) patch.reference = data.reference ?? null;
    if (data.receiptPath !== undefined) patch.receipt_path = data.receiptPath ?? null;
    if (data.receiptName !== undefined) patch.receipt_name = data.receiptName ?? null;
    if (data.isRecurring !== undefined) patch.is_recurring = data.isRecurring;
    if (data.notes !== undefined) patch.notes = data.notes ?? null;

    const { error } = await supabaseAdmin.from("vehicle_expenses").update(patch as any).eq("id", data.id);
    if (error) return { ok: false, error: error.message };

    const changed = diffFields(before, { ...before, ...patch }, [
      "category",
      "description",
      "amount",
      "incurred_on",
      "vendor_id",
      "reference",
    ]);

    await logAudit(actor, {
      action: "expense.updated",
      summary: `Edited a ${before.category} expense of $${Number(before.amount).toFixed(2)}`,
      entityType: "vehicle_expense",
      entityId: data.id,
      metadata: { changed },
    });

    return { ok: true };
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: before } = await supabaseAdmin
      .from("vehicle_expenses")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();

    // Remove the receipt too, or the bucket fills with files nothing points at.
    if (before?.receipt_path) {
      await supabaseAdmin.storage.from("receipts").remove([before.receipt_path]);
    }
    await supabaseAdmin.from("vehicle_expenses").delete().eq("id", data.id);

    await logAudit(actor, {
      action: "expense.deleted",
      summary: before
        ? `Deleted a $${Number(before.amount).toFixed(2)} ${before.category} expense — ${before.description}`
        : `Deleted expense ${data.id}`,
      entityType: "vehicle_expense",
      entityId: data.id,
      // The whole row, because after a delete there is nothing else left to
      // reconstruct it from.
      metadata: { deleted_row: before ?? null },
    });

    return { ok: true };
  });

// ---------------------------------------------------------------------- P&L

export type VehiclePL = {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
  status: string | null;
  label: string;
  revenue: number;
  expenses: number;
  maintenance: number;
  net: number;
  days_on_rent: number;
  utilization: number | null;
};

export const getVehiclePL = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ from: z.string().nullish(), to: z.string().nullish() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ rows: VehiclePL[]; totals: Omit<VehiclePL, "vehicle_id" | "year" | "make" | "model" | "license_plate" | "status" | "label" | "utilization"> }> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin.rpc("vehicle_pl", {
      _from: data.from ?? null,
      _to: data.to ?? null,
    });
    if (error) {
      console.error("[expenses] vehicle_pl failed", error.message);
      return { rows: [], totals: { revenue: 0, expenses: 0, maintenance: 0, net: 0, days_on_rent: 0 } };
    }

    // Utilisation only means something against a window with a known length.
    let windowDays: number | null = null;
    if (data.from && data.to) {
      windowDays =
        Math.round(
          (new Date(data.to).getTime() - new Date(data.from).getTime()) / 86400_000,
        ) + 1;
    }

    const out: VehiclePL[] = ((rows ?? []) as any[]).map((r) => {
      const days = Number(r.days_on_rent ?? 0);
      return {
        vehicle_id: r.vehicle_id,
        year: r.year,
        make: r.make,
        model: r.model,
        license_plate: r.license_plate,
        status: r.status,
        label: vehicleLabel(r),
        revenue: Number(r.revenue ?? 0),
        expenses: Number(r.expenses ?? 0),
        maintenance: Number(r.maintenance ?? 0),
        net: Number(r.net ?? 0),
        days_on_rent: days,
        utilization: windowDays && windowDays > 0 ? Math.min(1, days / windowDays) : null,
      };
    });

    const totals = out.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenue,
        expenses: acc.expenses + r.expenses,
        maintenance: acc.maintenance + r.maintenance,
        net: acc.net + r.net,
        days_on_rent: acc.days_on_rent + r.days_on_rent,
      }),
      { revenue: 0, expenses: 0, maintenance: 0, net: 0, days_on_rent: 0 },
    );

    return { rows: out, totals };
  });
