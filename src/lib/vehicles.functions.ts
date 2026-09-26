import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff, requireManager } from "@/lib/roles.server";
import { logAudit, diffFields } from "@/lib/audit.server";
import { checkVin, normalizeVin } from "@/lib/vin";

// The vehicle record: creation, identity lookup and the profile aggregate.
//
// This does not own maintenance, inspections, rentals, documents or expenses —
// each already has a home, and the profile reads from them rather than keeping
// its own copy. The only new storage is the identity/ownership/GPS/keys
// columns on vehicles itself and the vehicle_media table for photography.

export const OWNERSHIP_TYPES = [
  { value: "owned", label: "Owned outright" },
  { value: "financed", label: "Financed" },
  { value: "leased", label: "Leased" },
  { value: "partner", label: "Partner vehicle" },
] as const;

export const BODY_TYPES = [
  "sedan", "suv", "xl", "truck", "van", "minivan",
  "coupe", "hatchback", "wagon", "convertible", "other",
] as const;

export const VEHICLE_STATUSES = [
  { value: "available", label: "Available" },
  { value: "rented", label: "Rented" },
  { value: "maintenance", label: "In maintenance" },
  { value: "reserved", label: "Reserved" },
  { value: "archived", label: "Archived" },
  { value: "sold", label: "Sold" },
  { value: "retired", label: "Retired" },
] as const;

/** States in which a vehicle has left the working fleet. */
const INACTIVE_STATUSES = ["archived", "sold", "retired"];

// ------------------------------------------------------------ unit numbers

export const suggestUnitNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ prefix: z.string().trim().max(8).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<{ suggestion: string }> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: next, error } = await supabaseAdmin.rpc("next_unit_number", {
      _prefix: data.prefix || "RR",
    });
    if (error) {
      console.error("[vehicles] unit number suggestion failed", error.message);
      // A suggestion is a convenience; failing it must not block creation.
      return { suggestion: "" };
    }
    return { suggestion: String(next ?? "") };
  });

// -------------------------------------------------------------- VIN decode

export type VinDecodeResult = {
  ok: boolean;
  /** Format/check-digit assessment, independent of the decoder. */
  formatValid: boolean;
  checkDigitValid: boolean | null;
  warning: string | null;
  /** Fields the decoder is confident about. Empty strings are omitted. */
  decoded: Record<string, string>;
  error?: string;
};

/** Which vPIC fields we surface, and what they map to on our record. */
const VPIC_FIELDS: Array<{ from: string; to: string; label: string }> = [
  { from: "ModelYear", to: "year", label: "Year" },
  { from: "Make", to: "make", label: "Make" },
  { from: "Model", to: "model", label: "Model" },
  { from: "Trim", to: "trim", label: "Trim" },
  { from: "BodyClass", to: "body_class", label: "Body style" },
  { from: "DriveType", to: "drivetrain", label: "Drivetrain" },
  { from: "EngineCylinders", to: "engine_cylinders", label: "Cylinders" },
  { from: "DisplacementL", to: "engine_displacement", label: "Displacement (L)" },
  { from: "FuelTypePrimary", to: "fuel_type", label: "Fuel" },
  { from: "Doors", to: "doors", label: "Doors" },
  { from: "Manufacturer", to: "manufacturer", label: "Manufacturer" },
  { from: "PlantCountry", to: "plant_country", label: "Built in" },
  { from: "Series", to: "series", label: "Series" },
];

/** vPIC returns "Not Applicable"/"" for anything it cannot determine. */
function meaningful(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^(not applicable|n\/a|unknown|null)$/i.test(s)) return null;
  return s;
}

/** Map a raw vPIC record onto our field names. Exported for testing. */
export function mapVpicRecord(rec: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of VPIC_FIELDS) {
    const v = meaningful(rec[f.from]);
    if (v) out[f.to] = v;
  }
  return out;
}

/** Map our body_class text onto the constrained body_type column. */
export function bodyClassToBodyType(bodyClass: string | undefined): string | null {
  const s = (bodyClass ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("pickup")) return "truck";
  if (s.includes("minivan")) return "minivan";
  if (s.includes("van")) return "van";
  if (s.includes("sport utility") || s.includes("suv") || s.includes("crossover")) return "suv";
  if (s.includes("hatchback")) return "hatchback";
  if (s.includes("wagon")) return "wagon";
  if (s.includes("convertible") || s.includes("roadster")) return "convertible";
  if (s.includes("coupe")) return "coupe";
  if (s.includes("sedan") || s.includes("saloon")) return "sedan";
  return "other";
}

export const decodeVin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vin: z.string().trim().min(1).max(40) }).parse(d))
  .handler(async ({ data, context }): Promise<VinDecodeResult> => {
    await requireStaff(context.userId);

    const check = checkVin(data.vin);
    if (!check.formatValid) {
      return {
        ok: false,
        formatValid: false,
        checkDigitValid: null,
        warning: null,
        decoded: {},
        error: check.problem ?? "That VIN is not valid.",
      };
    }

    try {
      // NHTSA vPIC. Public, free, no credential — which is why it is the
      // decoder here rather than a paid service needing a key nobody has set.
      const res = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(check.normalized)}?format=json`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        return {
          ok: false,
          formatValid: true,
          checkDigitValid: check.checkDigitValid,
          warning: check.problem,
          decoded: {},
          error: `The VIN decoder returned ${res.status}. Enter the details manually.`,
        };
      }
      const body = (await res.json()) as { Results?: Array<Record<string, unknown>> };
      const rec = body.Results?.[0];
      if (!rec) {
        return {
          ok: false, formatValid: true, checkDigitValid: check.checkDigitValid,
          warning: check.problem, decoded: {},
          error: "The decoder returned nothing for that VIN.",
        };
      }

      const decoded = mapVpicRecord(rec);
      const bodyType = bodyClassToBodyType(decoded.body_class);
      if (bodyType) decoded.body_type = bodyType;

      return {
        ok: Object.keys(decoded).length > 0,
        formatValid: true,
        checkDigitValid: check.checkDigitValid,
        warning: check.problem,
        decoded,
        error: Object.keys(decoded).length ? undefined : "The decoder had no details for that VIN.",
      };
    } catch (err) {
      console.error("[vehicles] VIN decode failed", err);
      return {
        ok: false, formatValid: true, checkDigitValid: check.checkDigitValid,
        warning: check.problem, decoded: {},
        error: "Could not reach the VIN decoder. Enter the details manually.",
      };
    }
  });

// ----------------------------------------------------------------- create

const createInput = z.object({
  unit_number: z.string().trim().max(40).nullish(),
  vin: z.string().trim().max(40).nullish(),
  year: z.number().int().min(1900).max(2100),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  trim: z.string().trim().max(60).nullish(),
  color: z.string().trim().max(40).nullish(),
  body_type: z.enum(BODY_TYPES).nullish(),
  current_odometer: z.number().int().min(0).max(2_000_000).nullish(),
  license_plate: z.string().trim().max(20).nullish(),
  plate_state: z.string().trim().max(4).nullish(),
  status: z.string().trim().max(30).default("available"),
  ownership_type: z.enum(["owned", "financed", "leased", "partner"]).nullish(),
  partner_id: z.string().uuid().nullish(),
  weekly_rate: z.number().min(0).max(100000).nullish(),
});

export const createVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; id: string; unit_number: string | null } | { ok: false; error: string; field?: string }> => {
    // Creating a fleet asset is a manager action: it carries rates and
    // ownership. The RLS policy on vehicles says the same thing, so this is
    // belt and braces for the service-role path rather than the only gate.
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const vin = data.vin ? normalizeVin(data.vin) : null;
    if (vin) {
      const check = checkVin(vin);
      if (!check.formatValid) return { ok: false, error: check.problem ?? "Invalid VIN.", field: "vin" };

      // Checked here as well as by the unique index, so the operator gets
      // "RR-004 already has that VIN" instead of a constraint name.
      const { data: dupe } = await supabaseAdmin
        .from("vehicles")
        .select("id,unit_number,year,make,model")
        .ilike("vin", vin)
        .maybeSingle();
      if (dupe) {
        const label = dupe.unit_number || `${dupe.year} ${dupe.make} ${dupe.model}`;
        return { ok: false, error: `${label} already has that VIN.`, field: "vin" };
      }
    }

    if (data.license_plate) {
      const { data: dupe } = await supabaseAdmin
        .from("vehicles")
        .select("id,unit_number,year,make,model")
        .ilike("license_plate", data.license_plate.trim())
        .maybeSingle();
      if (dupe) {
        const label = dupe.unit_number || `${dupe.year} ${dupe.make} ${dupe.model}`;
        return { ok: false, error: `${label} already has that plate.`, field: "license_plate" };
      }
    }

    if (data.unit_number) {
      const { data: dupe } = await supabaseAdmin
        .from("vehicles")
        .select("id")
        .ilike("unit_number", data.unit_number.trim())
        .maybeSingle();
      if (dupe) return { ok: false, error: `Unit ${data.unit_number} is already in use.`, field: "unit_number" };
    }

    const { data: row, error } = await supabaseAdmin
      .from("vehicles")
      .insert({
        unit_number: data.unit_number?.trim() || null,
        vin,
        year: data.year,
        make: data.make,
        model: data.model,
        trim: data.trim || null,
        color: data.color || null,
        body_type: data.body_type || null,
        current_odometer: data.current_odometer ?? null,
        license_plate: data.license_plate?.trim().toUpperCase() || null,
        plate_state: data.plate_state?.trim().toUpperCase() || null,
        status: data.status || "available",
        ownership_type: data.ownership_type || null,
        partner_id: data.partner_id || null,
        // Required by the table. Defaulted rather than demanded up front, so a
        // car can be recorded the moment it exists and priced later.
        weekly_rate: data.weekly_rate ?? 0,
      } as any)
      .select("id,unit_number")
      .single();

    if (error || !row) {
      const msg = String(error?.message ?? "");
      if (msg.includes("vehicles_vin_unique_idx")) return { ok: false, error: "Another vehicle already has that VIN.", field: "vin" };
      if (msg.includes("vehicles_plate_unique_idx")) return { ok: false, error: "Another vehicle already has that plate.", field: "license_plate" };
      if (msg.includes("vehicles_unit_number_unique_idx")) return { ok: false, error: "That unit number is already in use.", field: "unit_number" };
      console.error("[vehicles] create failed", msg);
      return { ok: false, error: msg || "Could not create the vehicle." };
    }

    await logAudit(actor, {
      action: "vehicle.created",
      summary: `Added ${row.unit_number ? row.unit_number + " — " : ""}${data.year} ${data.make} ${data.model}`,
      entityType: "vehicle",
      entityId: row.id,
      metadata: { vin, unit_number: row.unit_number, ownership_type: data.ownership_type ?? null },
    });

    return { ok: true, id: row.id, unit_number: row.unit_number };
  });

// ---------------------------------------------------------------- archive

export const archiveVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["archived", "sold", "retired"]),
      reason: z.string().trim().max(500).nullish(),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // A car on an active rental cannot quietly leave the fleet — the rental
    // would still be pointing at it.
    const { count } = await supabaseAdmin
      .from("rentals")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", data.id)
      .eq("status", "active");
    if ((count ?? 0) > 0) {
      return { ok: false, error: "This vehicle is on an active rental. End the rental first." };
    }

    const { data: before } = await supabaseAdmin
      .from("vehicles")
      .select("unit_number,year,make,model,status")
      .eq("id", data.id)
      .maybeSingle();

    // Archive, never delete: rentals, documents, inspections, expenses and
    // audit entries all reference this row and must stay readable.
    const { error } = await supabaseAdmin
      .from("vehicles")
      .update({ status: data.status, archived_at: new Date().toISOString(), archive_reason: data.reason ?? null } as any)
      .eq("id", data.id);
    if (error) return { ok: false, error: error.message };

    await logAudit(actor, {
      action: "vehicle.archived",
      summary: `${before?.unit_number ?? `${before?.year} ${before?.make} ${before?.model}`} marked ${data.status}`,
      entityType: "vehicle",
      entityId: data.id,
      metadata: { from_status: before?.status, to_status: data.status, reason: data.reason ?? null },
    });

    return { ok: true };
  });

// ---------------------------------------------------------------- profile

export type VehicleProfile = {
  vehicle: Record<string, any>;
  unitLabel: string;
  vinLast4: string;
  isActive: boolean;
  currentRental: { id: string; driver_name: string | null; application_id: string | null; start_date: string; end_date: string | null } | null;
  partnerName: string | null;
  counts: { documents: number; openMaintenance: number; inspections: number; rentals: number; photos: number };
  alerts: Array<{ what: string; expires_on: string; days: number }>;
  nextService: { item: string; due_date: string | null; due_mileage: number | null } | null;
  /** Manager and Owner only. Absent — not zeroed — for a Coordinator. */
  financials: { revenue: number; expenses: number; maintenance: number; net: number; days_on_rent: number } | null;
};

export const getVehicleProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VehicleProfile | null> => {
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: vehicle } = await supabaseAdmin.from("vehicles").select("*").eq("id", data.id).maybeSingle();
    if (!vehicle) return null;

    const v = vehicle as any;
    const isManager = actor.tier === "manager" || actor.tier === "owner";

    const [{ data: rental }, { data: partner }, docs, maint, insp, rentals, media] = await Promise.all([
      supabaseAdmin
        .from("rentals")
        .select("id,driver_id,application_id,start_date,end_date")
        .eq("vehicle_id", data.id).eq("status", "active")
        .maybeSingle(),
      v.partner_id
        ? supabaseAdmin.from("partners").select("name").eq("id", v.partner_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from("documents").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id).eq("is_current", true),
      supabaseAdmin.from("maintenance_records").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id).neq("status", "completed"),
      supabaseAdmin.from("inspections").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id),
      supabaseAdmin.from("rentals").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id),
      supabaseAdmin.from("vehicle_media").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id),
    ]);

    let driverName: string | null = null;
    if (rental?.application_id) {
      const { data: app } = await supabaseAdmin.from("applications").select("full_name").eq("id", rental.application_id).maybeSingle();
      driverName = app?.full_name ?? null;
    }

    // Expiry alerts reuse the dates already on the record rather than a
    // second set of fields.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const alerts: VehicleProfile["alerts"] = [];
    const pushAlert = (what: string, date: string | null) => {
      if (!date) return;
      const days = Math.round((new Date(date).getTime() - today.getTime()) / 86400_000);
      if (days <= 45) alerts.push({ what, expires_on: date, days });
    };
    pushAlert("Plate", v.plate_expires_on);
    pushAlert("Registration", v.registration_expires_on);
    pushAlert("Insurance", v.insurance_expires_on);

    const { data: schedule } = await supabaseAdmin
      .from("maintenance_schedules")
      .select("item,next_due_on,next_due_miles")
      .eq("vehicle_id", data.id)
      .order("next_due_on", { ascending: true })
      .limit(1)
      .maybeSingle();

    let financials: VehicleProfile["financials"] = null;
    if (isManager) {
      // The RPC is service-role only; a Coordinator never reaches this branch,
      // so no financial figure is computed for them, let alone returned.
      const { data: pl } = await supabaseAdmin.rpc("vehicle_pl", {});
      const row = ((pl ?? []) as any[]).find((p) => p.vehicle_id === data.id);
      if (row) {
        financials = {
          revenue: Number(row.revenue ?? 0),
          expenses: Number(row.expenses ?? 0),
          maintenance: Number(row.maintenance ?? 0),
          net: Number(row.net ?? 0),
          days_on_rent: Number(row.days_on_rent ?? 0),
        };
      }
    }

    // Strip the money-bearing columns for a Coordinator rather than trusting
    // the UI not to render them.
    const safeVehicle: Record<string, any> = { ...v };
    if (!isManager) {
      for (const k of ["purchase_price", "payoff_amount", "monthly_payment", "weekly_rate", "monthly_rate", "deposit", "loan_reference", "loan_maturity_date"]) {
        delete safeVehicle[k];
      }
    }

    return {
      vehicle: safeVehicle,
      unitLabel: v.unit_number || `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim(),
      vinLast4: v.vin ? String(v.vin).slice(-4) : "",
      isActive: !INACTIVE_STATUSES.includes(String(v.status ?? "")),
      currentRental: rental
        ? { id: rental.id, driver_name: driverName, application_id: rental.application_id, start_date: rental.start_date, end_date: rental.end_date }
        : null,
      partnerName: (partner as any)?.name ?? null,
      counts: {
        documents: docs.count ?? 0,
        openMaintenance: maint.count ?? 0,
        inspections: insp.count ?? 0,
        rentals: rentals.count ?? 0,
        photos: media.count ?? 0,
      },
      alerts: alerts.sort((a, b) => a.days - b.days),
      nextService: schedule
        ? { item: schedule.item, due_date: schedule.next_due_on, due_mileage: schedule.next_due_miles }
        : null,
      financials,
    };
  });

export { diffFields };
