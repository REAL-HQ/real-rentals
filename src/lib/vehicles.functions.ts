import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff, requireManager, type Actor } from "@/lib/roles.server";
import { logAudit, diffFields } from "@/lib/audit";
import { checkVin, normalizeVin } from "@/lib/vin";
import { notReadyMessage, hasValidRate } from "@/lib/vehicle-readiness";
import { normalizeDisplayText } from "@/lib/display-normalize";
import { fmtDate as formatDate } from "@/lib/date-format";

async function loadVehicleDocPresence(sb: any, vehicleId: string, includeFinance: boolean) {
  const m = await import("@/lib/vehicle-doc-presence.server");
  return m.loadVehicleDocPresence(sb, vehicleId, includeFinance);
}

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
  "sedan",
  "suv",
  "xl",
  "truck",
  "van",
  "minivan",
  "coupe",
  "hatchback",
  "wagon",
  "convertible",
  "other",
] as const;

export const VEHICLE_STATUSES = [
  { value: "onboarding", label: "Needs Setup" },
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
  .inputValidator((d: unknown) =>
    z.object({ prefix: z.string().trim().max(8).optional() }).parse(d ?? {}),
  )
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
          ok: false,
          formatValid: true,
          checkDigitValid: check.checkDigitValid,
          warning: check.problem,
          decoded: {},
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
        ok: false,
        formatValid: true,
        checkDigitValid: check.checkDigitValid,
        warning: check.problem,
        decoded: {},
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
  deposit: z.number().min(0).max(100000).nullish(),
  monthly_rate: z.number().min(0).max(400000).nullish(),
  /** Quick Add "Save & Make Available" — an explicit human choice. */
  make_available: z.boolean().optional(),
});

export const createVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { ok: true; id: string; unit_number: string | null }
      | { ok: false; error: string; field?: string }
    > => {
      // Creating a fleet asset is a manager action: it carries rates and
      // ownership. The RLS policy on vehicles says the same thing, so this is
      // belt and braces for the service-role path rather than the only gate.
      const actor = await requireManager(context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const vin = data.vin ? normalizeVin(data.vin) : null;
      if (vin) {
        const check = checkVin(vin);
        if (!check.formatValid)
          return { ok: false, error: check.problem ?? "Invalid VIN.", field: "vin" };

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
        if (dupe)
          return {
            ok: false,
            error: `Unit ${data.unit_number} is already in use.`,
            field: "unit_number",
          };
      }

      // Canonical Vehicle Defaults: explicit value → company default for the
      // body type → Not Set. Copied onto the car (snapshot, never retroactive).
      const { resolveForCreate } = await import("@/lib/vehicle-defaults.server");
      const priced = await resolveForCreate(data.body_type, {
        weekly_rate: data.weekly_rate, monthly_rate: data.monthly_rate, deposit: data.deposit,
      });

      const { data: row, error } = await supabaseAdmin
        .from("vehicles")
        .insert({
          unit_number: data.unit_number?.trim() || null,
          vin,
          year: data.year,
          make: normalizeDisplayText(data.make),
          model: normalizeDisplayText(data.model),
          trim: data.trim ? normalizeDisplayText(data.trim) : null,
          color: data.color ? normalizeDisplayText(data.color) : null,
          body_type: data.body_type || null,
          current_odometer: data.current_odometer ?? null,
          license_plate: data.license_plate?.trim().toUpperCase() || null,
          plate_state: data.plate_state?.trim().toUpperCase() || null,
          // Available only when a human explicitly asked for it (Quick Add's
          // "Save & Make Available") AND the car is Rental Ready — the status
          // trigger re-checks this server-side. Otherwise Needs Setup.
          status: ["available", "reserved"].includes(data.status || "available")
            ? data.make_available && vin && hasValidRate(priced.weekly_rate) ? "available" : "onboarding"
            : data.status,
          partner_id: data.partner_id || null,
          // Unknown stays unknown: null means "Not Set", never $0.
          weekly_rate: priced.weekly_rate,
          monthly_rate: priced.monthly_rate,
          // No hard-coded deposit: explicit, configured company default, or Not Set.
          deposit: priced.deposit,
        } as any)
        .select("id,unit_number")
        .single();

      if (error || !row) {
        const msg = String(error?.message ?? "");
        if (msg.includes("vehicles_vin_unique_idx"))
          return { ok: false, error: "Another vehicle already has that VIN.", field: "vin" };
        if (msg.includes("vehicles_plate_unique_idx"))
          return {
            ok: false,
            error: "Another vehicle already has that plate.",
            field: "license_plate",
          };
        if (msg.includes("vehicles_unit_number_unique_idx"))
          return { ok: false, error: "That unit number is already in use.", field: "unit_number" };
        console.error("[vehicles] create failed", msg);
        return { ok: false, error: msg || "Could not create the vehicle." };
      }

      // Ownership type is financing data and lives in the manager-only table.
      // Recorded after the vehicle exists because it is keyed by vehicle_id, and
      // best-effort because a car that is on the lot is a fact whether or not we
      // managed to write down how it is held.
      if (data.ownership_type && actor.tier === "owner") {
        const { error: finErr } = await supabaseAdmin.from("vehicle_finance").upsert(
          {
            vehicle_id: row.id,
            ownership_type: data.ownership_type,
            updated_by: actor.userId,
          } as any,
          {
            onConflict: "vehicle_id",
          },
        );
        if (finErr) console.error("[vehicles] ownership type not recorded", finErr.message);
      }

      await logAudit(actor, {
        action: "vehicle.created",
        summary: `Added ${row.unit_number ? row.unit_number + " — " : ""}${data.year} ${data.make} ${data.model}`,
        entityType: "vehicle",
        entityId: row.id,
        metadata: {
          vin,
          unit_number: row.unit_number,
          ownership_type: data.ownership_type ?? null,
        },
      });

      return { ok: true, id: row.id, unit_number: row.unit_number };
    },
  );

// ---------------------------------------------------------------- archive
//
// Archive hides a car from the active fleet and keeps every linked record.
// Sold and Retired are separate operational statuses (set in the drawer);
// Archive is only ever "archived", with a required written reason.

export const archiveVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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
      .select("unit_number,year,make,model,status,archived_at")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) return { ok: false, error: "Vehicle not found." };
    if ((before as any).status === "archived") return { ok: false, error: "This vehicle is already archived." };

    // Conditional on the status we just read, so two clicks archive once.
    const { data: rows, error } = await supabaseAdmin
      .from("vehicles")
      .update({ status: "archived", archived_at: new Date().toISOString(), archive_reason: data.reason } as any)
      .eq("id", data.id)
      .eq("status", (before as any).status)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!rows?.length) return { ok: false, error: "This vehicle changed while you were archiving it. Refresh and try again." };

    await logAudit(actor, {
      action: "vehicle.archived",
      summary: `${before.unit_number ?? `${before.year} ${before.make} ${before.model}`} archived`,
      entityType: "vehicle",
      entityId: data.id,
      metadata: { from_status: (before as any).status, to_status: "archived", reason: data.reason },
    });
    return { ok: true };
  });

/** Restore always returns to Onboarding; a human makes it Available later. */
export const restoreVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(
    async ({ data, context }): Promise<{ ok: boolean; error?: string; previousStatus?: string | null; missing?: string[] }> => {
      const actor = await requireManager(context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: before } = await supabaseAdmin
        .from("vehicles")
        .select("unit_number,year,make,model,status,archive_reason")
        .eq("id", data.id)
        .maybeSingle();
      if (!before) return { ok: false, error: "Vehicle not found." };
      if ((before as any).status !== "archived") return { ok: false, error: "This vehicle is not archived." };

      const { data: last } = await supabaseAdmin
        .from("audit_log")
        .select("metadata")
        .eq("entity_type", "vehicle")
        .eq("entity_id", data.id)
        .eq("action", "vehicle.archived")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const previousStatus = ((last as any)?.metadata?.from_status as string | undefined) ?? null;

      const { data: rows, error } = await supabaseAdmin
        .from("vehicles")
        .update({ status: "onboarding", archived_at: null, archive_reason: null } as any)
        .eq("id", data.id)
        .eq("status", "archived")
        .select("id");
      if (error) return { ok: false, error: error.message };
      if (!rows?.length) return { ok: false, error: "This vehicle was already restored." };

      await logAudit(actor, {
        action: "vehicle.restored",
        summary: `${before.unit_number ?? `${before.year} ${before.make} ${before.model}`} restored to Onboarding`,
        entityType: "vehicle",
        entityId: data.id,
        metadata: {
          from_status: "archived",
          to_status: "onboarding",
          previous_status: previousStatus,
          archive_reason: (before as any).archive_reason ?? null,
        },
      });

      const { data: missing } = await supabaseAdmin.rpc("vehicle_rental_ready_missing", { _vehicle_id: data.id } as any);
      return { ok: true, previousStatus, missing: (missing as string[] | null) ?? [] };
    },
  );

async function countDependencies(sb: any, id: string) {
  const { VEHICLE_DEPENDENCIES } = await import("@/lib/vehicle-lifecycle");
  return Promise.all(
    VEHICLE_DEPENDENCIES.map(async (d) => {
      const { count, error } = await sb.from(d.table).select("*", { count: "exact", head: true }).eq(d.column, id);
      // A failed count is treated as a blocker, never as zero.
      return { label: d.label, count: error ? -1 : (count ?? 0) };
    }),
  );
}

/** Owner-only: what a permanent delete would remove, and what blocks it. */
export const getVehicleDeleteCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: v } = await supabaseAdmin
      .from("vehicles")
      .select("id,unit_number,year,make,model,vin,status")
      .eq("id", data.id)
      .maybeSingle();
    if (!v) return { ok: false as const, error: "Vehicle not found." };
    const counts = await countDependencies(supabaseAdmin, data.id);
    return {
      ok: true as const,
      vehicle: { unit_number: v.unit_number, year: v.year, make: v.make, model: v.model, vinLast6: (v.vin ?? "").slice(-6), status: v.status },
      blockers: counts.filter((c) => c.count !== 0),
    };
  });

/** Owner-only permanent delete: archived, zero linked records, typed unit number. */
export const deleteVehiclePermanently = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), confirm: z.string().max(40) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { confirmMatches } = await import("@/lib/vehicle-lifecycle");

    const { data: v } = await supabaseAdmin
      .from("vehicles")
      .select("id,unit_number,year,make,model,vin,status,archive_reason")
      .eq("id", data.id)
      .maybeSingle();
    if (!v) return { ok: false, error: "Vehicle not found." };
    if (v.status !== "archived") return { ok: false, error: "Archive the vehicle before deleting it permanently." };
    if (!confirmMatches(v.unit_number, data.confirm)) return { ok: false, error: "The unit number you typed does not match." };

    const blockers = (await countDependencies(supabaseAdmin, data.id)).filter((c) => c.count !== 0);
    if (blockers.length) {
      return { ok: false, error: `Blocked by linked records: ${blockers.map((b) => b.label).join(", ")}.` };
    }

    // Audit first, so the record exists even if the delete is then refused.
    await logAudit(actor, {
      action: "vehicle.deleted_permanently",
      summary: `${v.unit_number} ${v.year} ${v.make} ${v.model} permanently deleted`,
      entityType: "vehicle",
      entityId: data.id,
      metadata: { unit_number: v.unit_number, vin_last6: (v.vin ?? "").slice(-6), archive_reason: v.archive_reason },
    });

    const { data: rows, error } = await supabaseAdmin
      .from("vehicles")
      .delete()
      .eq("id", data.id)
      .eq("status", "archived")
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!rows?.length) return { ok: false, error: "The vehicle was not deleted." };
    return { ok: true };
  });

// ---------------------------------------------------------------- profile

export type VehicleProfile = {
  vehicle: Record<string, any>;
  /**
   * Paperwork facts about the title, separate from what the title says.
   * Non-sensitive and identical for every staff tier; the number and the
   * status remain Owner-only on `vehicle`.
   */
  title: { documentOnFile: boolean; metadataRecorded: boolean };
  unitLabel: string;
  vinLast4: string;
  isActive: boolean;
  currentRental: {
    id: string;
    driver_name: string | null;
    application_id: string | null;
    start_date: string;
    end_date: string | null;
  } | null;
  partnerName: string | null;
  counts: {
    /** Distinct physical documents applicable to this car (direct + Fleet Inbox links). */
    documents: number;
    /** Of those, shared with other vehicles (e.g. one fleet insurance PDF). */
    sharedDocuments: number;
    openMaintenance: number;
    inspections: number;
    rentals: number;
    photos: number;
    publishedPhotos: number;
  };
  profileContext: { docKinds: string[]; maintenanceCount: number; inspectionCount: number; photoCount: number; title: { documentOnFile: boolean; metadataRecorded: boolean } };
  alerts: Array<{ what: string; expires_on: string; days: number }>;
  nextService: { item: string; due_date: string | null; due_mileage: number | null } | null;
  /** Manager and Owner only. Absent — not zeroed — for a Coordinator. */
  financials: {
    revenue: number;
    expenses: number;
    maintenance: number;
    net: number;
    days_on_rent: number;
  } | null;
  /**
   * Acquisition and financing, from the manager-only vehicle_finance table.
   * Null for a Coordinator because the row is not theirs to read — the
   * database says so, not this function.
   */
  finance: Record<string, any> | null;
  /** Writing to vehicles is manager-only at the RLS layer; the UI hides what the server would refuse. */
  /** Owner only: acquisition, lender, lien, payoff. */
  canSeeFinance: boolean;
  canEdit: boolean;
  /** Read-only facts for the display-only Vehicle Readiness checklist (Phase A). */
  readinessFacts: import("@/lib/vehicle-readiness").ReadinessFacts;
};

export const getVehicleProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VehicleProfile | null> => {
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!vehicle) return null;

    const v = vehicle as any;
    const isManager = actor.tier === "manager" || actor.tier === "owner";
    const isOwnerView = (await import("@/lib/experience.server")).ownerView(actor);

    const [{ data: rental }, { data: partner }, publishedMedia, maint, insp, rentals, media] =
      await Promise.all([
        supabaseAdmin
          .from("rentals")
          .select("id,driver_id,application_id,start_date,end_date")
          .eq("vehicle_id", data.id)
          .eq("status", "active")
          .maybeSingle(),
        v.partner_id
          ? supabaseAdmin.from("partners").select("name").eq("id", v.partner_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabaseAdmin
          .from("vehicle_media")
          .select("id", { count: "exact", head: true })
          .eq("vehicle_id", data.id)
          .eq("published", true),
        supabaseAdmin
          .from("maintenance_records")
          .select("id", { count: "exact", head: true })
          .eq("vehicle_id", data.id)
          .neq("status", "completed"),
        supabaseAdmin
          .from("inspections")
          .select("id", { count: "exact", head: true })
          .eq("vehicle_id", data.id),
        supabaseAdmin
          .from("rentals")
          .select("id", { count: "exact", head: true })
          .eq("vehicle_id", data.id),
        supabaseAdmin
          .from("vehicle_media")
          .select("id", { count: "exact", head: true })
          .eq("vehicle_id", data.id),
      ]);

    // Canonical document presence: direct + Fleet Inbox links, one physical
    // document counted once. Finance paperwork is hidden from Coordinators.
    const presence = await loadVehicleDocPresence(supabaseAdmin, data.id, isOwnerView);

    let driverName: string | null = null;
    if (rental?.application_id) {
      const { data: app } = await supabaseAdmin
        .from("applications")
        .select("full_name")
        .eq("id", rental.application_id)
        .maybeSingle();
      driverName = app?.full_name ?? null;
    }

    // Expiry alerts reuse the dates already on the record rather than a
    // second set of fields.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
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
    // Acquisition, lender, lien and payoff data: Owner only (DB policy matches).
    if (isOwnerView) {
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

    // Title number and lien-type title status are Owner View only; others see "on file" style metadata.
    // Title identifiers live in the Owner-only vehicle_titles table (RLS: private.is_owner()).
    let ownerTitle: { title_number: string | null; title_status: string | null } | null = null;
    if (isOwnerView) {
      const { data: t } = await supabaseAdmin.from("vehicle_titles").select("title_number,title_status").eq("vehicle_id", data.id).maybeSingle();
      ownerTitle = t ?? null;
    }
    const shapedVehicle = isOwnerView
      ? { ...v, title_number: ownerTitle?.title_number ?? null, title_status: ownerTitle?.title_status ?? null }
      : { ...v, title_number: null, title_status: (v as any).title_on_file ? "on_file" : null };

    // Three separate facts about a title, because conflating them had the DMV
    // tab saying "Not On File" for a vehicle whose title scan was linked while
    // the Fleet Profile checklist ticked Title as done, on the same screen.
    //
    //   documentOnFile   a title scan is filed or linked. Comes from the
    //                    document slots, so Fleet Inbox uploads count.
    //   metadataRecorded a title number or status is in Owner-only
    //                    vehicle_titles. vehicles.title_on_file tracks exactly
    //                    this and nothing else.
    //   status/number    what the title says. Owner-only, never inferred from
    //                    the presence of a document.
    //
    // The first two are booleans about paperwork, not identifiers, so every
    // staff tier gets the same answer.
    const { presentSlots } = await import("@/lib/vehicle-doc-presence");
    const titleFacts = {
      documentOnFile: presentSlots(presence.kinds).has("title"),
      metadataRecorded: !!(v as any).title_on_file,
    };
    return {
      vehicle: shapedVehicle,
      title: titleFacts,
      finance,
      canSeeFinance: isOwnerView,
      canEdit: isManager,
      unitLabel: v.unit_number || `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim(),
      vinLast4: v.vin ? String(v.vin).slice(-4) : "",
      isActive: !INACTIVE_STATUSES.includes(String(v.status ?? "")),
      currentRental: rental
        ? {
            id: rental.id,
            driver_name: driverName,
            application_id: rental.application_id,
            start_date: rental.start_date,
            end_date: rental.end_date,
          }
        : null,
      partnerName: (partner as any)?.name ?? null,
      counts: {
        documents: presence.documentCount,
        sharedDocuments: presence.sharedCount,
        openMaintenance: maint.count ?? 0,
        inspections: insp.count ?? 0,
        rentals: rentals.count ?? 0,
        photos: media.count ?? 0,
        publishedPhotos: publishedMedia.count ?? 0,
      },
      // For the non-blocking Fleet Profile checklist only.
      profileContext: await (async () => {
        const { count: maintAll } = await supabaseAdmin
          .from("maintenance_records").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id);
        return {
          docKinds: presence.kinds,
          maintenanceCount: maintAll ?? 0,
          inspectionCount: insp.count ?? 0,
          photoCount: media.count ?? 0,
          title: titleFacts,
        };
      })(),
      alerts: alerts.sort((a, b) => a.days - b.days),
      nextService: schedule
        ? {
            item: schedule.item,
            due_date: schedule.next_due_on,
            due_mileage: schedule.next_due_miles,
          }
        : null,
      financials,
      readinessFacts: await (async () => {
        // Read-only lookups; no finance/title data. Each is a narrow per-vehicle query.
        const [insp, sched, iss, inc] = await Promise.all([
          supabaseAdmin.from("inspections").select("completed_at")
            .eq("vehicle_id", data.id).eq("inspection_type", "pre_delivery").eq("status", "passed")
            .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
          supabaseAdmin.from("maintenance_schedules").select("item,next_due_on,next_due_miles")
            .eq("vehicle_id", data.id).eq("is_active", true).limit(200),
          supabaseAdmin.from("issues").select("title,severity,status")
            .eq("vehicle_id", data.id).not("status", "in", "(resolved,closed)").limit(100),
          supabaseAdmin.from("incidents").select("incident_type,severity,status,drivable")
            .eq("vehicle_id", data.id).not("status", "in", "(closed,written_off)").limit(100),
        ]);
        return {
          lastPreDeliveryPassedAt: (insp.data as any)?.completed_at ?? null,
          schedules: ((sched.data ?? []) as any[]).map((s) => ({ item: s.item, next_due_on: s.next_due_on, next_due_miles: s.next_due_miles })),
          openIssues: ((iss.data ?? []) as any[]).map((i) => ({ title: i.title, severity: i.severity })),
          openIncidents: ((inc.data ?? []) as any[]).map((i) => ({ type: i.incident_type, severity: i.severity, drivable: i.drivable })),
          hasActiveRental: !!rental,
        };
      })(),
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
    "unit_number",
    "year",
    "make",
    "model",
    "trim",
    "color",
    "body_type",
    "seats",
    "doors",
    "mpg",
    "miles_per_tank",
    "fuel_type",
    "description",
    "status",
    "partner_id",
    "current_odometer",
    "internal_notes",
    "weekly_rate",
    "monthly_rate",
    "deposit",
    "badges",
    "uber_eligibility",
  ],
  insurance: [
    "insurance_carrier",
    "insurance_policy_number",
    "insurance_coverage",
    "insurance_effective_on",
    "insurance_expires_on",
    "insurance_status",
    "insurance_agent_name",
    "insurance_agent_phone",
    "insurance_agent_email",
  ],
  dmv: [
    "vin",
    "license_plate",
    "plate_state",
    "plate_expires_on",
    "registration_number",
    "registration_state",
    "registration_expires_on",
    "title_status",
    "title_number",
  ],
  gps: [
    "gps_provider",
    "gps_device_id",
    "gps_serial",
    "gps_imei",
    "gps_sim",
    "gps_status",
    "gps_installed_on",
    "gps_tracking_url",
    "gps_geofence_status",
    "gps_install_notes",
    // A reading, not a setting. Editable only so a bad one can be corrected;
    // the editor shows it apart from the device fields and says as much.
    "gps_odometer",
  ],
  // Service intervals and toll accounts had no home once the old editor went.
  service: [
    "maintenance_status",
    "oil_interval_miles",
    "last_oil_change_miles",
    "last_tire_date",
    "last_brake_inspection_date",
    "toll_transponder_id",
    "toll_account",
  ],
  keys: ["key_count", "spare_key", "key_type", "key_tag", "key_location", "key_notes"],
} as const;

export type VehicleSection = keyof typeof VEHICLE_SECTIONS;

/** Fields that are always stored upper-cased, so lookups and the case-insensitive unique indexes agree. */
const UPPERCASE_FIELDS = new Set(["vin", "license_plate", "plate_state", "registration_state"]);

/** Numeric columns — an empty form field means "not recorded", not zero. */
const NUMERIC_FIELDS = new Set([
  "year",
  "seats",
  "doors",
  "mpg",
  "miles_per_tank",
  "current_odometer",
  "weekly_rate",
  "monthly_rate",
  "deposit",
  "key_count",
  "gps_odometer",
  "oil_interval_miles",
  "last_oil_change_miles",
]);

const SECTION_LABEL: Record<VehicleSection, string> = {
  identity: "details",
  insurance: "insurance",
  dmv: "registration and title",
  gps: "GPS",
  keys: "keys",
  service: "service intervals and tolls",
};

/** Field names a human recognises, for the audit summary. */
const FIELD_LABEL: Record<string, string> = {
  unit_number: "unit number",
  body_type: "body type",
  current_odometer: "odometer",
  internal_notes: "internal notes",
  weekly_rate: "weekly rate",
  monthly_rate: "monthly rate",
  partner_id: "partner",
  miles_per_tank: "range",
  fuel_type: "fuel",
  insurance_carrier: "carrier",
  insurance_policy_number: "policy number",
  insurance_coverage: "coverage",
  insurance_expires_on: "policy expiry",
  insurance_effective_on: "effective date",
  insurance_status: "insurance status",
  insurance_agent_name: "agent",
  insurance_agent_phone: "agent phone",
  insurance_agent_email: "agent email",
  license_plate: "plate",
  plate_state: "plate state",
  plate_expires_on: "plate expiry",
  registration_number: "registration number",
  registration_state: "registration state",
  registration_expires_on: "registration expiry",
  title_status: "title status",
  title_number: "title number",
  gps_provider: "GPS provider",
  gps_device_id: "device ID",
  gps_serial: "serial",
  gps_imei: "IMEI",
  gps_sim: "SIM",
  gps_status: "GPS status",
  gps_installed_on: "install date",
  gps_tracking_url: "tracking link",
  gps_geofence_status: "geofence",
  gps_install_notes: "install notes",
  gps_odometer: "reported odometer",
  key_count: "key count",
  spare_key: "spare key",
  key_type: "key type",
  key_tag: "key tag",
  key_location: "key location",
  key_notes: "key notes",
  uber_eligibility: "platforms",
  maintenance_status: "maintenance status",
  oil_interval_miles: "oil interval",
  last_oil_change_miles: "last oil change",
  last_tire_date: "last tyre date",
  last_brake_inspection_date: "last brake inspection",
  toll_transponder_id: "transponder",
  toll_account: "toll account",
};

type SectionResult = { ok: boolean; error?: string; field?: string };

/**
 * Apply one section's values to a vehicle.
 *
 * The single write path into public.vehicles. Both the per-section drawers on
 * the profile and the whole-vehicle editor come through here, so the
 * whitelist, the identity checks, the archive guard and the audit entries
 * cannot differ between them — which is the whole reason the editor was not
 * given a save of its own.
 */
async function applySection(
  supabaseAdmin: any,
  actor: Actor,
  data: { id: string; section: VehicleSection; values: Record<string, unknown> },
): Promise<SectionResult> {
  {
    const allowed: readonly string[] = VEHICLE_SECTIONS[data.section as VehicleSection];

    const patch: Record<string, unknown> = {};
    // Title identifiers are Owner-only (public.vehicle_titles). Only the Owner
    // view may write them, and they go straight to that table, never vehicles.
    const canTitle = (await import("@/lib/experience.server")).ownerView(actor);
    const TITLE_KEYS = ["title_number", "title_status"];
    if (canTitle && TITLE_KEYS.some((k) => k in data.values)) {
      const clean = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
      const row: Record<string, unknown> = { vehicle_id: data.id, updated_by: actor.userId, updated_at: new Date().toISOString() };
      for (const k of TITLE_KEYS) if (k in data.values) row[k] = clean(data.values[k]);
      const { error: tErr } = await supabaseAdmin.from("vehicle_titles").upsert(row, { onConflict: "vehicle_id" });
      if (tErr) throw new Error("Could not save title details");
      const { data: t } = await supabaseAdmin.from("vehicle_titles").select("title_number,title_status").eq("vehicle_id", data.id).maybeSingle();
      await supabaseAdmin.from("vehicles").update({ title_on_file: !!(t?.title_number || t?.title_status) }).eq("id", data.id);
      // Values deliberately omitted: Managers can read the audit log.
      await logAudit(actor, { action: "vehicle.title_updated", summary: "Updated Owner-only title details", entityType: "vehicle", entityId: data.id, metadata: { fields: TITLE_KEYS.filter((k) => k in data.values) } });
    }
    for (const key of allowed) {
      if (!(key in data.values)) continue;
      if (TITLE_KEYS.includes(key)) continue;
      let v = data.values[key];

      if (typeof v === "string") {
        v = v.trim();
        if (UPPERCASE_FIELDS.has(key)) v = (v as string).toUpperCase();
        if (v === "") v = null;
      }
      if (NUMERIC_FIELDS.has(key) && v !== null && v !== undefined) {
        const n = Number(v);
        if (!Number.isFinite(n))
          return { ok: false, error: `${FIELD_LABEL[key] ?? key} must be a number.`, field: key };
        v = n;
      }
      patch[key] = v ?? null;
    }

    if (!Object.keys(patch).length) return { ok: true };

    // weekly_rate may be null ("Not Set"). The database refuses Available /
    // Reserved without Rental Ready; that message is translated below.

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
      // Archive and Restore have their own audited actions (required reason,
      // restore-to-Onboarding); the drawer is not a quieter route around them.
      if (patch.status === "archived" || before.status === "archived") {
        return {
          ok: false,
          error: patch.status === "archived" ? "Use Archive Vehicle to archive." : "Use Restore Vehicle to bring this vehicle back.",
          field: "status",
        };
      }
      const leaving = INACTIVE_STATUSES.includes(patch.status);
      if (leaving) {
        const { count } = await supabaseAdmin
          .from("rentals")
          .select("id", { count: "exact", head: true })
          .eq("vehicle_id", data.id)
          .eq("status", "active");
        if ((count ?? 0) > 0) {
          return {
            ok: false,
            error: "This vehicle is on an active rental. End the rental first.",
            field: "status",
          };
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
      if (!check.formatValid)
        return { ok: false, error: check.problem ?? "Invalid VIN.", field: "vin" };
      patch.vin = vin;
      const { data: dupe } = await supabaseAdmin
        .from("vehicles")
        .select("id,unit_number,year,make,model")
        .ilike("vin", vin)
        .neq("id", data.id)
        .maybeSingle();
      if (dupe) {
        return {
          ok: false,
          error: `${dupe.unit_number || `${dupe.year} ${dupe.make} ${dupe.model}`} already has that VIN.`,
          field: "vin",
        };
      }
    }
    for (const [col, field, label] of [
      ["license_plate", "license_plate", "plate"],
      ["unit_number", "unit_number", "unit number"],
    ] as const) {
      if (typeof patch[col] === "string" && patch[col]) {
        const { data: dupe } = await supabaseAdmin
          .from("vehicles")
          .select("id,unit_number,year,make,model")
          .ilike(col, String(patch[col]))
          .neq("id", data.id)
          .maybeSingle();
        if (dupe) {
          return {
            ok: false,
            error: `${dupe.unit_number || `${dupe.year} ${dupe.make} ${dupe.model}`} already has that ${label}.`,
            field,
          };
        }
      }
    }

    const { error } = await supabaseAdmin
      .from("vehicles")
      .update(patch as any)
      .eq("id", data.id);
    if (error) {
      const msg = String(error.message);
      const notReady = notReadyMessage(msg);
      if (notReady) return { ok: false, error: notReady, field: "status" };
      if (msg.includes("vehicles_vin_unique_idx"))
        return { ok: false, error: "Another vehicle already has that VIN.", field: "vin" };
      if (msg.includes("vehicles_plate_unique_idx"))
        return {
          ok: false,
          error: "Another vehicle already has that plate.",
          field: "license_plate",
        };
      if (msg.includes("vehicles_unit_number_unique_idx"))
        return { ok: false, error: "That unit number is already in use.", field: "unit_number" };
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
  }
}

export const updateVehicleSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        section: z.enum(["identity", "insurance", "dmv", "gps", "keys", "service"]),
        // Shapes differ per section and the whitelist is what actually
        // constrains this, so values are validated by column rather than by a
        // schema that would have to be kept in sync with the table twice.
        values: z.record(z.string(), z.unknown()),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<SectionResult> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return applySection(supabaseAdmin, actor, {
      id: data.id,
      section: data.section as VehicleSection,
      values: data.values,
    });
  });

/**
 * Save several sections at once, for the whole-vehicle editor.
 *
 * Sections apply in order and the first failure stops the run, naming the
 * section and field so the editor can open it and point at the input. Earlier
 * sections stay applied: they were valid, the operator fixes one field and
 * saves again, and nothing silently reverts underneath them. There is no
 * transaction spanning these calls, and faking one by rewriting the old values
 * back would be its own way of producing wrong data.
 *
 * The editor sends only the fields it changed, so a mileage correction carries
 * a mileage correction — not the whole record, and not an audit entry about a
 * weekly rate nobody touched.
 */
export const updateVehicleSections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        sections: z.record(
          z.enum(["identity", "insurance", "dmv", "gps", "keys", "service"]),
          z.record(z.string(), z.unknown()),
        ),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; error?: string; field?: string; section?: string }> => {
      const actor = await requireManager(context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Registration first: a VIN or plate clash is the failure most likely to
      // abandon a save, so it should be reported before anything is written.
      const ORDER: VehicleSection[] = ["dmv", "identity", "insurance", "gps", "keys", "service"];

      for (const section of ORDER) {
        const values = (data.sections as Record<string, Record<string, unknown>>)[section];
        if (!values || !Object.keys(values).length) continue;
        const res = await applySection(supabaseAdmin, actor, { id: data.id, section, values });
        if (!res.ok) return { ok: false, error: res.error, field: res.field, section };
      }
      return { ok: true };
    },
  );

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
    const name =
      `${row.year ?? ""} ${row.make ?? ""} ${row.model ?? ""}${row.trim ? " " + row.trim : ""}`.trim();
    const unitLabel = row.unit_number || name || "Vehicle";
    const sections: VehicleShare["sections"] = [];
    const included: string[] = ["Vehicle & specifications"];

    const fmtDate = (d: string | null) =>
      d
        ? formatDate(d)
        : "—";
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
        [
          "Odometer",
          row.current_odometer ? `${Number(row.current_odometer).toLocaleString()} miles` : null,
        ],
        [
          "Platforms",
          Array.isArray(row.uber_eligibility) && row.uber_eligibility.length
            ? row.uber_eligibility.join(", ")
            : null,
        ],
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
          [
            "Registration expires",
            row.registration_expires_on ? fmtDate(row.registration_expires_on) : null,
          ],
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
          ...(data.includePolicyNumber
            ? ([["Policy number", row.insurance_policy_number]] as Array<[string, unknown]>)
            : []),
        ]),
      });
      included.push(
        data.includePolicyNumber ? "Insurance incl. policy number" : "Insurance (no policy number)",
      );
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
      sections.push({
        heading: "Description",
        rows: [{ label: "", value: String(row.description) }],
      });
    }

    const photos = data.includePhotos
      ? ((row.photos as string[] | null) ?? []).filter(Boolean).slice(0, 6)
      : [];
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
