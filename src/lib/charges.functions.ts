import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { parseTollStatement, normalizePlate } from "@/lib/toll-import";

// Tolls, citations and the rebilling of them.
//
// Attribution is the whole job: a toll is charged to the registered owner, so
// it lands on the company and has to be traced back to whoever actually had
// the car at that moment. rental_at_time() in the database is the single
// definition of that, and anything it cannot attribute stays unassigned for
// review rather than being billed to a guess.

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "team"])
    .limit(1);
  if (!data || data.length === 0) throw new Error("Forbidden");
}

export const CHARGE_TYPES = [
  { value: "toll", label: "Toll" },
  { value: "citation", label: "Citation" },
  { value: "red_light", label: "Red light camera" },
  { value: "speeding", label: "Speeding" },
  { value: "parking", label: "Parking" },
  { value: "impound", label: "Impound" },
  { value: "admin_fee", label: "Admin fee" },
  { value: "other", label: "Other" },
] as const;

export type TollCharge = {
  id: string;
  vehicle_id: string;
  rental_id: string | null;
  application_id: string | null;
  charge_type: string;
  occurred_at: string;
  amount: number;
  admin_fee: number;
  agency: string | null;
  location: string | null;
  reference_number: string | null;
  status: string;
  source: string;
  payment_id: string | null;
  notes: string | null;
  created_at: string;
  driver_name?: string | null;
  vehicle_label?: string | null;
};

/**
 * Work out who had the car when a charge happened and stamp it on the row.
 * Returns the rental and application, or nulls when it cannot be attributed
 * (the car was between rentals, or on the lot).
 */
async function attribute(
  admin: any,
  vehicleId: string,
  occurredAt: string,
): Promise<{ rentalId: string | null; applicationId: string | null }> {
  const { data: rentalId, error } = await admin.rpc("rental_at_time", {
    _vehicle_id: vehicleId,
    _at: occurredAt,
  });
  if (error || !rentalId) return { rentalId: null, applicationId: null };

  const { data: rental } = await admin
    .from("rentals")
    .select("id,application_id")
    .eq("id", rentalId)
    .maybeSingle();
  return {
    rentalId: (rental?.id as string) ?? null,
    applicationId: (rental?.application_id as string) ?? null,
  };
}

export const listTollCharges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        status: z.string().optional(),
        unassignedOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<TollCharge[]> => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("toll_charges")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.unassignedOnly) q = q.is("rental_id", null);

    const { data: rows } = await q;
    if (!rows?.length) return [];

    // Decorate with names so the table is readable without another round trip.
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
      amount: Number(r.amount ?? 0),
      admin_fee: Number(r.admin_fee ?? 0),
      driver_name: r.application_id ? (appById.get(r.application_id) ?? null) : null,
      vehicle_label: vehById.get(r.vehicle_id) ?? null,
    }));
  });

export const createTollCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        chargeType: z.string().max(40).default("toll"),
        occurredAt: z.string().min(10),
        amount: z.number().min(0).max(100000),
        adminFee: z.number().min(0).max(10000).optional(),
        agency: z.string().max(120).nullable().optional(),
        location: z.string().max(240).nullable().optional(),
        referenceNumber: z.string().max(120).nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { rentalId, applicationId } = await attribute(
      supabaseAdmin,
      data.vehicleId,
      data.occurredAt,
    );

    const { data: row, error } = await supabaseAdmin
      .from("toll_charges")
      .insert({
        vehicle_id: data.vehicleId,
        rental_id: rentalId,
        application_id: applicationId,
        charge_type: data.chargeType,
        occurred_at: data.occurredAt,
        amount: data.amount,
        admin_fee: data.adminFee ?? 0,
        agency: data.agency ?? null,
        location: data.location ?? null,
        reference_number: data.referenceNumber || null,
        notes: data.notes ?? null,
        status: rentalId ? "assigned" : "new",
        source: "manual",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) {
      if (String(error.message).includes("toll_charges_reference_idx")) {
        throw new Error("A charge with that reference number is already recorded.");
      }
      throw new Error(error.message);
    }
    return { id: row.id as string, attributed: !!rentalId };
  });

export type ImportOutcome = {
  imported: number;
  duplicates: number;
  unattributed: number;
  failed: Array<{ row: number; reason: string }>;
  unknownPlates: string[];
  unmappedHeaders: string[];
};

/**
 * Import a toll statement pasted straight out of the agency's portal.
 *
 * Rows are matched to vehicles by plate, attributed by time, and skipped when
 * the agency reference is already on file — re-importing an overlapping
 * statement is normal and must not double-bill anyone.
 */
export const importTollStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        text: z.string().min(10).max(2_000_000),
        chargeType: z.string().max(40).default("toll"),
        agency: z.string().max(120).nullable().optional(),
        adminFeePerCharge: z.number().min(0).max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ImportOutcome> => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const parsed = parseTollStatement(data.text);
    const outcome: ImportOutcome = {
      imported: 0,
      duplicates: 0,
      unattributed: 0,
      failed: [],
      unknownPlates: [],
      unmappedHeaders: parsed.unmappedHeaders,
    };

    // Plate -> vehicle, normalised the same way on both sides.
    const { data: vehicles } = await supabaseAdmin
      .from("vehicles")
      .select("id,license_plate")
      .not("license_plate", "is", null);
    const byPlate = new Map<string, string>();
    for (const v of vehicles ?? []) {
      const key = normalizePlate(v.license_plate as string);
      if (key) byPlate.set(key, v.id as string);
    }

    const unknown = new Set<string>();

    for (const r of parsed.rows) {
      if (r.errors.length || r.occurredAt == null || r.amount == null || r.plate == null) {
        outcome.failed.push({
          row: r.row,
          reason: r.errors.join(", ") || "incomplete row",
        });
        continue;
      }
      const vehicleId = byPlate.get(r.plate);
      if (!vehicleId) {
        unknown.add(r.plate);
        outcome.failed.push({ row: r.row, reason: `no vehicle with plate ${r.plate}` });
        continue;
      }

      // The errors guard above already proved these are present; naming them
      // here is what lets the compiler agree.
      const occurredAt: string = r.occurredAt;
      const amount: number = r.amount;

      const { rentalId, applicationId } = await attribute(supabaseAdmin, vehicleId, occurredAt);

      const { error } = await supabaseAdmin.from("toll_charges").insert({
        vehicle_id: vehicleId,
        rental_id: rentalId,
        application_id: applicationId,
        charge_type: data.chargeType,
        occurred_at: occurredAt,
        amount: Math.abs(amount),
        admin_fee: data.adminFeePerCharge ?? 0,
        agency: r.agency || data.agency || null,
        location: r.location,
        reference_number: r.reference || null,
        status: rentalId ? "assigned" : "new",
        source: "import",
        created_by: context.userId,
      });

      if (error) {
        if (String(error.message).includes("toll_charges_reference_idx")) {
          outcome.duplicates++;
        } else {
          outcome.failed.push({ row: r.row, reason: error.message });
        }
        continue;
      }

      outcome.imported++;
      if (!rentalId) outcome.unattributed++;
    }

    outcome.unknownPlates = Array.from(unknown);
    return outcome;
  });

/** Re-run attribution, e.g. after a rental's dates were corrected. */
export const reattributeCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        // An explicit override wins over the time-based lookup.
        rentalId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: charge } = await supabaseAdmin
      .from("toll_charges")
      .select("id,vehicle_id,occurred_at,status")
      .eq("id", data.id)
      .maybeSingle();
    if (!charge) throw new Error("Charge not found");
    if (charge.status === "rebilled" || charge.status === "paid") {
      throw new Error("This charge has already been rebilled — void the payment first.");
    }

    let rentalId: string | null;
    let applicationId: string | null;
    if (data.rentalId !== undefined && data.rentalId !== null) {
      const { data: rental } = await supabaseAdmin
        .from("rentals")
        .select("id,application_id")
        .eq("id", data.rentalId)
        .maybeSingle();
      if (!rental) throw new Error("Rental not found");
      rentalId = rental.id as string;
      applicationId = (rental.application_id as string) ?? null;
    } else {
      const res = await attribute(supabaseAdmin, charge.vehicle_id, charge.occurred_at);
      rentalId = res.rentalId;
      applicationId = res.applicationId;
    }

    const { error } = await supabaseAdmin
      .from("toll_charges")
      .update({
        rental_id: rentalId,
        application_id: applicationId,
        status: rentalId ? "assigned" : "new",
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, attributed: !!rentalId };
  });

export type RebillResult = {
  ok: boolean;
  billed: number;
  totalAmount: number;
  skipped: Array<{ id: string; reason: string }>;
};

/**
 * Raise one payment per driver covering their outstanding charges.
 *
 * Grouped per driver rather than per charge so a renter gets a single line to
 * settle instead of fourteen $1.75 ones.
 */
export const rebillCharges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        chargeIds: z.array(z.string().uuid()).min(1).max(500),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<RebillResult> => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: charges } = await supabaseAdmin
      .from("toll_charges")
      .select(
        "id,application_id,rental_id,vehicle_id,amount,admin_fee,status,charge_type,occurred_at",
      )
      .in("id", data.chargeIds);

    const result: RebillResult = { ok: true, billed: 0, totalAmount: 0, skipped: [] };
    const byDriver = new Map<string, any[]>();

    for (const c of charges ?? []) {
      if (!c.application_id) {
        result.skipped.push({ id: c.id, reason: "not attributed to a renter" });
        continue;
      }
      if (c.status === "rebilled" || c.status === "paid") {
        result.skipped.push({ id: c.id, reason: "already rebilled" });
        continue;
      }
      if (c.status === "disputed" || c.status === "written_off") {
        result.skipped.push({ id: c.id, reason: `charge is ${c.status}` });
        continue;
      }
      const list = byDriver.get(c.application_id) ?? [];
      list.push(c);
      byDriver.set(c.application_id, list);
    }

    const due = data.dueDate ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    for (const [applicationId, list] of byDriver) {
      const total = list.reduce(
        (sum, c) => sum + Number(c.amount ?? 0) + Number(c.admin_fee ?? 0),
        0,
      );
      if (total <= 0) {
        for (const c of list) result.skipped.push({ id: c.id, reason: "zero amount" });
        continue;
      }

      const kinds = Array.from(new Set(list.map((c) => c.charge_type)));
      const { data: payment, error } = await supabaseAdmin
        .from("payments")
        .insert({
          driver_id: applicationId,
          rental_id: list[0].rental_id ?? null,
          vehicle_id: list[0].vehicle_id ?? null,
          amount: total,
          balance_due: total,
          type: "toll",
          reason: `${list.length} ${kinds.join("/")} charge${list.length === 1 ? "" : "s"}`,
          status: "pending",
          due_date: due,
        })
        .select("id")
        .single();
      if (error) {
        for (const c of list) result.skipped.push({ id: c.id, reason: error.message });
        continue;
      }

      await supabaseAdmin
        .from("toll_charges")
        .update({ status: "rebilled", payment_id: payment.id })
        .in(
          "id",
          list.map((c) => c.id),
        );

      result.billed += list.length;
      result.totalAmount += total;

      // Tell the renter what they are being charged for, and why.
      try {
        const { data: app } = await supabaseAdmin
          .from("applications")
          .select("full_name,email,phone")
          .eq("id", applicationId)
          .maybeSingle();
        if (app?.email) {
          const { sendEmail } = await import("@/lib/email.server");
          const lines = list
            .map(
              (c) =>
                `<tr><td style="padding:4px 12px 4px 0;color:#555">${new Date(c.occurred_at).toLocaleDateString()}</td>` +
                `<td style="padding:4px 12px 4px 0;color:#555">${String(c.charge_type).replace(/_/g, " ")}</td>` +
                `<td style="padding:4px 0;text-align:right">$${(Number(c.amount) + Number(c.admin_fee)).toFixed(2)}</td></tr>`,
            )
            .join("");
          await sendEmail({
            to: app.email as string,
            subject: `Tolls & charges on your rental — $${total.toFixed(2)}`,
            html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
              <h1 style="font-size:19px">Charges on your rental</h1>
              <p style="font-size:15px;line-height:1.6">These were incurred on the vehicle while it was rented to you and are now due.</p>
              <table style="width:100%;border-top:1px solid #eee;border-bottom:1px solid #eee;margin:12px 0;font-size:14px">${lines}</table>
              <p style="font-size:16px"><strong>Total due: $${total.toFixed(2)}</strong> by ${due}</p>
              <a href="https://drivereal.com/portal" style="display:inline-block;background:#D03020;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">View In Portal</a>
              <p style="color:#888;font-size:12px;margin-top:18px">Think one of these is not yours? Reply to this email and we'll look into it.</p>
            </div>`,
            replyTo: "team@drivereal.com",
          });
        }
      } catch (e) {
        console.error("[charges] rebill notice failed", e);
      }
    }

    return result;
  });

export const updateChargeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["new", "assigned", "rebilled", "paid", "disputed", "written_off"]),
        notes: z.string().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { status: data.status };
    if (data.notes !== undefined) patch.notes = data.notes;
    const { error } = await supabaseAdmin
      .from("toll_charges")
      .update(patch as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: charge } = await supabaseAdmin
      .from("toll_charges")
      .select("status")
      .eq("id", data.id)
      .maybeSingle();
    if (charge?.status === "rebilled" || charge?.status === "paid") {
      throw new Error("This charge has been rebilled — write it off instead of deleting it.");
    }
    const { error } = await supabaseAdmin.from("toll_charges").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** The renter's own view of what they have been charged. */
export const getMyCharges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TollCharge[]> => {
    const { data: apps } = await context.supabase
      .from("applications")
      .select("id")
      .eq("user_id", context.userId);
    const appIds = (apps ?? []).map((a: any) => a.id as string);
    if (!appIds.length) return [];

    const { data } = await context.supabase
      .from("toll_charges")
      .select("*")
      .in("application_id", appIds)
      // A renter has no business seeing a charge still being worked out.
      .in("status", ["rebilled", "paid", "disputed"])
      .order("occurred_at", { ascending: false })
      .limit(200);

    return (data ?? []).map((r: any) => ({
      ...r,
      amount: Number(r.amount ?? 0),
      admin_fee: Number(r.admin_fee ?? 0),
    }));
  });
