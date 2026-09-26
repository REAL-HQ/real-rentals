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

    // Ownership type is financing data and lives in the manager-only table.
    // Recorded after the vehicle exists because it is keyed by vehicle_id, and
    // best-effort because a car that is on the lot is a fact whether or not we
    // managed to write down how it is held.
    if (data.ownership_type) {
      const { error: finErr } = await supabaseAdmin
        .from("vehicle_finance")
        .upsert({ vehicle_id: row.id, ownership_type: data.ownership_type, updated_by: actor.userId } as any, {
          onConflict: "vehicle_id",
        });
      if (finErr) console.error("[vehicles] ownership type not recorded", finErr.message);
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
  /**
   * Acquisition and financing, from the manager-only vehicle_finance table.
   * Null for a Coordinator because the row is not theirs to read — the
   * database says so, not this function.
   */
  finance: Record<string, any> | null;
  /** Writing to vehicles is manager-only at the RLS layer; the UI hides what the server would refuse. */
  canEdit: boolean;
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

    let finance: VehicleProfile["finance"] = null;
    if (isManager) {
      const { data: fin } = await supabaseAdmin
        .from("vehicle_finance")
        .select("*")
        .eq("vehicle_id", data.id)
        .maybeSingle();
      finance = (fin as Record<string, any> | null) ?? null;
    }

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

    // No stripping happens here any more, and that is the point. The
    // acquisition and financing columns no longer exist on this table — they
    // live in vehicle_finance behind private.is_manager() — so a Coordinator
    // could not receive them even if this code tried to hand them over.
    //
    // Nor is pricing removed. weekly_rate, monthly_rate and deposit are
    // printed on drivereal.com; hiding them from a Coordinator withheld
    // nothing from anyone and made the fleet list read wrongly.

    return {
      vehicle: v,
      finance,
      canEdit: isManager,
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

// ============================================================ section edits
//
// The profile is a record to read, not a form to fill in, so editing happens
// one domain at a time through a drawer. Each drawer patches exactly the
// columns its section owns.
//
// The whitelist is the point. A drawer sends a section name and a bag of
// values; anything not listed for that section is dropped before the update is
// built, so the GPS drawer cannot set a rate and the Keys drawer cannot change
// a plate — whatever the browser sends. Writing to vehicles is manager-only at
// the RLS layer too; this runs through the service role, so the check below is
// the gate, not a courtesy.

export const VEHICLE_SECTIONS = {
  identity: [
    "unit_number", "year", "make", "model", "trim", "color", "body_type",
    "seats", "doors", "mpg", "miles_per_tank", "fuel_type", "description",
    "status", "partner_id", "current_odometer", "internal_notes",
    "weekly_rate", "monthly_rate", "deposit",
  ],
  insurance: [
    "insurance_carrier", "insurance_policy_number", "insurance_coverage",
    "insurance_expires_on", "insurance_status",
    "insurance_agent_name", "insurance_agent_phone", "insurance_agent_email",
  ],
  dmv: [
    "vin", "license_plate", "plate_state", "plate_expires_on",
    "registration_number", "registration_state", "registration_expires_on",
    "title_status", "title_number",
  ],
  gps: [
    "gps_provider", "gps_device_id", "gps_serial", "gps_imei", "gps_sim",
    "gps_status", "gps_installed_on", "gps_tracking_url",
    "gps_geofence_status", "gps_install_notes",
  ],
  keys: [
    "key_count", "spare_key", "key_type", "key_tag", "key_location", "key_notes",
  ],
} as const;

export type VehicleSection = keyof typeof VEHICLE_SECTIONS;

/** Fields that are always stored upper-cased, so lookups and the case-insensitive unique indexes agree. */
const UPPERCASE_FIELDS = new Set(["vin", "license_plate", "plate_state", "registration_state"]);

/** Numeric columns — an empty form field means "not recorded", not zero. */
const NUMERIC_FIELDS = new Set([
  "year", "seats", "doors", "mpg", "miles_per_tank", "current_odometer",
  "weekly_rate", "monthly_rate", "deposit", "key_count",
]);

const SECTION_LABEL: Record<VehicleSection, string> = {
  identity: "details",
  insurance: "insurance",
  dmv: "registration and title",
  gps: "GPS",
  keys: "keys",
};

/** Field names a human recognises, for the audit summary. */
const FIELD_LABEL: Record<string, string> = {
  unit_number: "unit number", body_type: "body type", current_odometer: "odometer",
  internal_notes: "internal notes", weekly_rate: "weekly rate", monthly_rate: "monthly rate",
  partner_id: "partner", miles_per_tank: "range", fuel_type: "fuel",
  insurance_carrier: "carrier", insurance_policy_number: "policy number",
  insurance_coverage: "coverage", insurance_expires_on: "policy expiry",
  insurance_status: "insurance status", insurance_agent_name: "agent",
  insurance_agent_phone: "agent phone", insurance_agent_email: "agent email",
  license_plate: "plate", plate_state: "plate state", plate_expires_on: "plate expiry",
  registration_number: "registration number", registration_state: "registration state",
  registration_expires_on: "registration expiry", title_status: "title status",
  title_number: "title number",
  gps_provider: "GPS provider", gps_device_id: "device ID", gps_serial: "serial",
  gps_imei: "IMEI", gps_sim: "SIM", gps_status: "GPS status",
  gps_installed_on: "install date", gps_tracking_url: "tracking link",
  gps_geofence_status: "geofence", gps_install_notes: "install notes",
  key_count: "key count", spare_key: "spare key", key_type: "key type",
  key_tag: "key tag", key_location: "key location", key_notes: "key notes",
};

export const updateVehicleSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      section: z.enum(["identity", "insurance", "dmv", "gps", "keys"]),
      // Shapes differ per section and the whitelist below is what actually
      // constrains this, so the values are validated by column rather than by
      // a schema that would have to be kept in sync with the table twice.
      values: z.record(z.string(), z.unknown()),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string; field?: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const allowed: readonly string[] = VEHICLE_SECTIONS[data.section as VehicleSection];

    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (!(key in data.values)) continue;
      let v = data.values[key];

      if (typeof v === "string") {
        v = v.trim();
        if (UPPERCASE_FIELDS.has(key)) v = (v as string).toUpperCase();
        if (v === "") v = null;
      }
      if (NUMERIC_FIELDS.has(key) && v !== null && v !== undefined) {
        const n = Number(v);
        if (!Number.isFinite(n)) return { ok: false, error: `${FIELD_LABEL[key] ?? key} must be a number.`, field: key };
        v = n;
      }
      patch[key] = v ?? null;
    }

    if (!Object.keys(patch).length) return { ok: true };

    // weekly_rate is NOT NULL on the table. Clearing it would fail with a
    // constraint name nobody can act on, so say what is wrong instead.
    if ("weekly_rate" in patch && (patch.weekly_rate === null || patch.weekly_rate === undefined)) {
      return { ok: false, error: "A weekly rate is required.", field: "weekly_rate" };
    }

    const { data: before } = await supabaseAdmin
      .from("vehicles")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) return { ok: false, error: "That vehicle no longer exists." };

    // A status field in a drawer is still a way out of the fleet, so it has to
    // obey the same rule as the Archive button rather than being a quieter
    // route around it: a car on an active rental cannot leave, because the
    // rental would still be pointing at it.
    if (typeof patch.status === "string" && patch.status !== before.status) {
      const leaving = INACTIVE_STATUSES.includes(patch.status);
      if (leaving) {
        const { count } = await supabaseAdmin
          .from("rentals")
          .select("id", { count: "exact", head: true })
          .eq("vehicle_id", data.id)
          .eq("status", "active");
        if ((count ?? 0) > 0) {
          return { ok: false, error: "This vehicle is on an active rental. End the rental first.", field: "status" };
        }
        // Stamped here too, so a car archived from the drawer and one archived
        // from the button are the same row afterwards.
        if (!before.archived_at) patch.archived_at = new Date().toISOString();
      } else if (before.archived_at) {
        // Coming back into service: the archive stamp would otherwise linger
        // and keep the car out of the public projection.
        patch.archived_at = null;
        patch.archive_reason = null;
      }
    }

    // Identity clashes are checked here as well as by the unique indexes, so
    // the operator gets "RR-004 already has that VIN" rather than the name of
    // a constraint.
    if (typeof patch.vin === "string" && patch.vin) {
      const vin = normalizeVin(patch.vin);
      const check = checkVin(vin);
      if (!check.formatValid) return { ok: false, error: check.problem ?? "Invalid VIN.", field: "vin" };
      patch.vin = vin;
      const { data: dupe } = await supabaseAdmin
        .from("vehicles").select("id,unit_number,year,make,model").ilike("vin", vin).neq("id", data.id).maybeSingle();
      if (dupe) {
        return { ok: false, error: `${dupe.unit_number || `${dupe.year} ${dupe.make} ${dupe.model}`} already has that VIN.`, field: "vin" };
      }
    }
    for (const [col, field, label] of [
      ["license_plate", "license_plate", "plate"],
      ["unit_number", "unit_number", "unit number"],
    ] as const) {
      if (typeof patch[col] === "string" && patch[col]) {
        const { data: dupe } = await supabaseAdmin
          .from("vehicles").select("id,unit_number,year,make,model").ilike(col, String(patch[col])).neq("id", data.id).maybeSingle();
        if (dupe) {
          return {
            ok: false,
            error: `${dupe.unit_number || `${dupe.year} ${dupe.make} ${dupe.model}`} already has that ${label}.`,
            field,
          };
        }
      }
    }

    const { error } = await supabaseAdmin.from("vehicles").update(patch as any).eq("id", data.id);
    if (error) {
      const msg = String(error.message);
      if (msg.includes("vehicles_vin_unique_idx")) return { ok: false, error: "Another vehicle already has that VIN.", field: "vin" };
      if (msg.includes("vehicles_plate_unique_idx")) return { ok: false, error: "Another vehicle already has that plate.", field: "license_plate" };
      if (msg.includes("vehicles_unit_number_unique_idx")) return { ok: false, error: "That unit number is already in use.", field: "unit_number" };
      console.error("[vehicles] section update failed", data.section, msg);
      return { ok: false, error: msg };
    }

    const changed = diffFields(before as any, patch, Object.keys(patch));
    const changedKeys = Object.keys(changed);
    if (changedKeys.length) {
      const label = before.unit_number || `${before.year} ${before.make} ${before.model}`;

      // A status move is the thing people scan the activity list for, so it
      // gets its own entry rather than hiding inside "details updated".
      if (changed.status) {
        await logAudit(actor, {
          action: "vehicle.status.changed",
          summary: `${label} moved from ${String(changed.status.from ?? "—")} to ${String(changed.status.to ?? "—")}`,
          entityType: "vehicle",
          entityId: data.id,
          metadata: { from: changed.status.from, to: changed.status.to },
        });
      }

      const rest = changedKeys.filter((k) => k !== "status");
      if (rest.length) {
        const metadata: Record<string, unknown> = {};
        for (const k of rest) metadata[k] = changed[k];
        await logAudit(actor, {
          action: `vehicle.${data.section}.updated`,
          summary: `Updated ${SECTION_LABEL[data.section as VehicleSection]} for ${label} — ${rest
            .map((k) => FIELD_LABEL[k] ?? k.replace(/_/g, " "))
            .join(", ")}`,
          entityType: "vehicle",
          entityId: data.id,
          metadata,
        });
      }
    }

    return { ok: true };
  });

// ============================================================== share sheet
//
// "Send me the details on the car" is a real request from a real person — an
// adjuster, a shop, a driver, an Uber inspection station — and the answer has
// always been someone retyping fields into a message and getting one wrong.
//
// The payload is assembled here, not in the browser, and the toggles can only
// ever narrow it. Four categories are absent from this function entirely
// rather than defaulted off, because a toggle is a thing that can be flipped:
//
//   financing        purchase price, payoff, loan — a Coordinator cannot even
//                    read these, so they certainly do not leave the building
//   keys             how many, what type, and where they hang
//   GPS credentials  IMEI, SIM, serial, device ID, tracking link — handing
//                    these out is handing over the tracker
//   internal notes   written for us, about them, sometimes about both
//
// What remains is what you would tell someone standing next to the car.

export type VehicleShare = {
  title: string;
  unitLabel: string;
  generatedAt: string;
  sections: Array<{ heading: string; rows: Array<{ label: string; value: string }> }>;
  photos: string[];
  /** Named so the sender can see what the recipient will get. */
  included: string[];
};

const shareInput = z.object({
  id: z.string().uuid(),
  includeVin: z.boolean().default(true),
  includeRegistration: z.boolean().default(true),
  includeInsurance: z.boolean().default(true),
  /** Off by default: the carrier and expiry answer most questions on their own. */
  includePolicyNumber: z.boolean().default(false),
  includeRates: z.boolean().default(false),
  includePhotos: z.boolean().default(true),
});

export const getVehicleShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => shareInput.parse(d))
  .handler(async ({ data, context }): Promise<VehicleShare | null> => {
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: v } = await supabaseAdmin
      .from("vehicles")
      .select(
        "id,unit_number,year,make,model,trim,color,body_type,seats,doors,mpg,miles_per_tank," +
          "fuel_type,uber_eligibility,status,current_odometer,photos,description,weekly_rate," +
          "monthly_rate,deposit,vin,license_plate,plate_state,plate_expires_on,registration_number," +
          "registration_state,registration_expires_on,insurance_carrier,insurance_policy_number," +
          "insurance_coverage,insurance_expires_on",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (!v) return null;

    const row = v as Record<string, any>;
    const name = `${row.year ?? ""} ${row.make ?? ""} ${row.model ?? ""}${row.trim ? " " + row.trim : ""}`.trim();
    const unitLabel = row.unit_number || name || "Vehicle";
    const sections: VehicleShare["sections"] = [];
    const included: string[] = ["Vehicle & specifications"];

    const fmtDate = (d: string | null) =>
      d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
    const rows = (pairs: Array<[string, unknown]>) =>
      pairs
        .filter(([, val]) => val !== null && val !== undefined && String(val).trim() !== "")
        .map(([label, val]) => ({ label, value: String(val) }));

    sections.push({
      heading: "Vehicle",
      rows: rows([
        ["Unit", row.unit_number],
        ["Year", row.year],
        ["Make", row.make],
        ["Model", row.model],
        ["Trim", row.trim],
        ["Color", row.color],
        ["Body type", row.body_type],
        ["Status", row.status],
        ...(data.includeVin ? ([["VIN", row.vin]] as Array<[string, unknown]>) : []),
      ]),
    });
    if (data.includeVin) included.push("VIN");

    sections.push({
      heading: "Specifications",
      rows: rows([
        ["Seats", row.seats],
        ["Doors", row.doors],
        ["Fuel", row.fuel_type],
        ["MPG", row.mpg],
        ["Range per tank", row.miles_per_tank ? `${row.miles_per_tank} miles` : null],
        ["Odometer", row.current_odometer ? `${Number(row.current_odometer).toLocaleString()} miles` : null],
        ["Platforms", Array.isArray(row.uber_eligibility) && row.uber_eligibility.length ? row.uber_eligibility.join(", ") : null],
      ]),
    });

    if (data.includeRegistration) {
      sections.push({
        heading: "Registration & plate",
        rows: rows([
          ["Plate", row.license_plate],
          ["Plate state", row.plate_state],
          ["Plate expires", row.plate_expires_on ? fmtDate(row.plate_expires_on) : null],
          ["Registration #", row.registration_number],
          ["Registration state", row.registration_state],
          ["Registration expires", row.registration_expires_on ? fmtDate(row.registration_expires_on) : null],
        ]),
      });
      included.push("Registration & plate");
    }

    if (data.includeInsurance) {
      sections.push({
        heading: "Insurance",
        rows: rows([
          ["Carrier", row.insurance_carrier],
          ["Coverage", row.insurance_coverage],
          ["Expires", row.insurance_expires_on ? fmtDate(row.insurance_expires_on) : null],
          ...(data.includePolicyNumber ? ([["Policy number", row.insurance_policy_number]] as Array<[string, unknown]>) : []),
        ]),
      });
      included.push(data.includePolicyNumber ? "Insurance incl. policy number" : "Insurance (no policy number)");
    }

    if (data.includeRates) {
      sections.push({
        heading: "Rates",
        rows: rows([
          ["Weekly", row.weekly_rate != null ? `$${Number(row.weekly_rate).toFixed(2)}` : null],
          ["Monthly", row.monthly_rate != null ? `$${Number(row.monthly_rate).toFixed(2)}` : null],
          ["Deposit", row.deposit != null ? `$${Number(row.deposit).toFixed(2)}` : null],
        ]),
      });
      included.push("Rates");
    }

    if (row.description) {
      sections.push({ heading: "Description", rows: [{ label: "", value: String(row.description) }] });
    }

    const photos = data.includePhotos ? ((row.photos as string[] | null) ?? []).filter(Boolean).slice(0, 6) : [];
    if (photos.length) included.push(`${photos.length} photo${photos.length === 1 ? "" : "s"}`);

    // Worth recording: this is the moment vehicle details left the building.
    await logAudit(actor, {
      action: "vehicle.info.shared",
      summary: `Shared vehicle info for ${unitLabel} — ${included.join(", ")}`,
      entityType: "vehicle",
      entityId: data.id,
      metadata: { included },
    });

    return {
      title: name || unitLabel,
      unitLabel,
      generatedAt: new Date().toISOString(),
      sections: sections.filter((s) => s.rows.length),
      photos,
      included,
    };
  });
