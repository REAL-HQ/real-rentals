import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit.server";
import { checkVin, normalizeVin } from "@/lib/vin";
import { BODY_TYPES } from "@/lib/vehicles.functions";

// Bringing a fleet in from a spreadsheet.
//
// Two passes, always. The preview says what would happen to every row and
// changes nothing; the commit does exactly what the preview described. An
// importer that creates twelve cars and then reports a problem with row
// thirteen has left someone a mess to unpick by hand.
//
// Duplicates are checked twice over, because the two kinds fail differently:
// against the fleet (this VIN is already RR-004) and within the file itself
// (rows 3 and 19 are the same plate), which the database's unique indexes
// would only catch one at a time, mid-run.
//
// The indexes remain the real guarantee. Two operators importing at the same
// moment will not see each other's rows here, so the commit still handles a
// constraint violation as a skip rather than a crash.

export type RowVerdict = {
  /** 1-based, counting the header, so it matches what the spreadsheet shows. */
  line: number;
  action: "create" | "skip" | "error";
  label: string;
  reason?: string;
  warnings: string[];
  /** The row as it would be written. Scalars only — this crosses the wire. */
  values: Record<string, string | number | null>;
};

export type ImportPreview = {
  rows: RowVerdict[];
  summary: { create: number; skip: number; error: number };
};

const rawRow = z.record(z.string(), z.string());
const previewInput = z.object({ rows: z.array(rawRow).min(1).max(500) });

const STATUSES = new Set([
  "available",
  "rented",
  "maintenance",
  "reserved",
  "archived",
  "sold",
  "retired",
]);

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Turn one spreadsheet row into a verdict. Pure apart from the lookups passed in. */
function assess(
  raw: Record<string, string>,
  line: number,
  seen: { vins: Map<string, number>; plates: Map<string, number>; units: Map<string, number> },
  existing: { vins: Map<string, string>; plates: Map<string, string>; units: Map<string, string> },
): RowVerdict {
  const warnings: string[] = [];
  const values: Record<string, string | number | null> = {};

  const year = num(raw.year);
  const make = (raw.make ?? "").trim();
  const model = (raw.model ?? "").trim();
  const label =
    (raw.unit_number ?? "").trim() ||
    [year, make, model].filter(Boolean).join(" ") ||
    (raw.vin ? `VIN ${raw.vin.slice(-6)}` : `Row ${line}`);

  const fail = (reason: string): RowVerdict => ({
    line,
    action: "error",
    label,
    reason,
    warnings,
    values,
  });

  if (!make) return fail("No make.");
  if (!model) return fail("No model.");
  if (year === null) return fail("No year.");
  if (year < 1900 || year > 2100) return fail(`Year ${raw.year} is not a year.`);
  values.year = Math.trunc(year);
  values.make = make;
  values.model = model;

  if (raw.vin) {
    const vin = normalizeVin(raw.vin);
    const c = checkVin(vin);
    if (!c.formatValid) return fail(c.problem ?? "That VIN is not valid.");
    if (c.checkDigitValid === false)
      warnings.push("VIN check digit does not match — normal for some imports.");
    const dupLine = seen.vins.get(vin);
    if (dupLine)
      return {
        line,
        action: "skip",
        label,
        reason: `Same VIN as row ${dupLine} in this file.`,
        warnings,
        values,
      };
    const owner = existing.vins.get(vin);
    if (owner)
      return {
        line,
        action: "skip",
        label,
        reason: `${owner} already has this VIN.`,
        warnings,
        values,
      };
    seen.vins.set(vin, line);
    values.vin = vin;
  } else {
    warnings.push(
      "No VIN. The vehicle can be created, but nothing will catch a duplicate of it later.",
    );
  }

  if (raw.license_plate) {
    const plate = raw.license_plate.trim().toUpperCase();
    const dupLine = seen.plates.get(plate);
    if (dupLine)
      return {
        line,
        action: "skip",
        label,
        reason: `Same plate as row ${dupLine} in this file.`,
        warnings,
        values,
      };
    const owner = existing.plates.get(plate);
    if (owner)
      return {
        line,
        action: "skip",
        label,
        reason: `${owner} already has plate ${plate}.`,
        warnings,
        values,
      };
    seen.plates.set(plate, line);
    values.license_plate = plate;
  }

  if (raw.unit_number) {
    const unit = raw.unit_number.trim();
    const key = unit.toUpperCase();
    const dupLine = seen.units.get(key);
    if (dupLine)
      return {
        line,
        action: "skip",
        label,
        reason: `Same unit number as row ${dupLine} in this file.`,
        warnings,
        values,
      };
    const owner = existing.units.get(key);
    if (owner)
      return {
        line,
        action: "skip",
        label,
        reason: `Unit ${unit} is already in use by ${owner}.`,
        warnings,
        values,
      };
    seen.units.set(key, line);
    values.unit_number = unit;
  }

  if (raw.trim) values.trim = raw.trim.trim();
  if (raw.color) values.color = raw.color.trim();

  if (raw.body_type) {
    const b = raw.body_type.trim().toLowerCase();
    if ((BODY_TYPES as readonly string[]).includes(b)) values.body_type = b;
    else warnings.push(`Body type "${raw.body_type}" is not one we recognise — left blank.`);
  }
  if (raw.plate_state) values.plate_state = raw.plate_state.trim().toUpperCase().slice(0, 4);

  const odo = num(raw.current_odometer);
  if (odo !== null) {
    if (odo < 0 || odo > 2_000_000)
      warnings.push(`Odometer ${raw.current_odometer} looks wrong — left blank.`);
    else values.current_odometer = Math.trunc(odo);
  }

  const rate = num(raw.weekly_rate);
  if (rate !== null && rate >= 0) values.weekly_rate = rate;
  else {
    // weekly_rate is NOT NULL. Defaulted rather than refused, so a car can be
    // recorded now and priced later — same rule as adding one by hand.
    values.weekly_rate = 0;
    if (raw.weekly_rate)
      warnings.push(`Weekly rate "${raw.weekly_rate}" could not be read — set to 0.`);
    else warnings.push("No weekly rate — set to 0, price it before listing.");
  }

  if (raw.status) {
    const st = raw.status.trim().toLowerCase();
    if (STATUSES.has(st)) values.status = st;
    else warnings.push(`Status "${raw.status}" is not one we use — set to available.`);
  }
  if (!values.status) values.status = "available";

  return { line, action: "create", label, warnings, values };
}

/** Everything already in the fleet that could collide, keyed for comparison. */
async function loadExisting(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id,unit_number,vin,license_plate,year,make,model");
  const vins = new Map<string, string>();
  const plates = new Map<string, string>();
  const units = new Map<string, string>();
  for (const v of data ?? []) {
    const label = v.unit_number || `${v.year} ${v.make} ${v.model}`;
    if (v.vin) vins.set(String(v.vin).toUpperCase(), label);
    if (v.license_plate) plates.set(String(v.license_plate).toUpperCase(), label);
    if (v.unit_number) units.set(String(v.unit_number).toUpperCase(), label);
  }
  return { vins, plates, units };
}

export const previewVehicleImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => previewInput.parse(d))
  .handler(async ({ data, context }): Promise<ImportPreview> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const existing = await loadExisting(supabaseAdmin);
    const seen = {
      vins: new Map<string, number>(),
      plates: new Map<string, number>(),
      units: new Map<string, number>(),
    };

    const rows = data.rows.map((r, i) => assess(r, i + 2, seen, existing));
    return {
      rows,
      summary: {
        create: rows.filter((r) => r.action === "create").length,
        skip: rows.filter((r) => r.action === "skip").length,
        error: rows.filter((r) => r.action === "error").length,
      },
    };
  });

export const commitVehicleImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => previewInput.parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ created: number; skipped: number; failed: number; rows: RowVerdict[] }> => {
      const actor = await requireManager(context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Re-assessed rather than trusting a preview the browser sends back: the
      // fleet may have changed since, and the preview is advice, not authority.
      const existing = await loadExisting(supabaseAdmin);
      const seen = {
        vins: new Map<string, number>(),
        plates: new Map<string, number>(),
        units: new Map<string, number>(),
      };
      const assessed = data.rows.map((r, i) => assess(r, i + 2, seen, existing));

      const results: RowVerdict[] = [];
      let created = 0;

      for (const row of assessed) {
        if (row.action !== "create") {
          results.push(row);
          continue;
        }

        const { error } = await supabaseAdmin.from("vehicles").insert({
          ...row.values,
          // Required by the table and not something a spreadsheet carries.
          fuel_type: "gas",
          oil_interval_miles: 5000,
        } as any);

        if (error) {
          const msg = String(error.message);
          // A unique index firing here means another import or operator got
          // there first. That is a skip, not a failure of this row's data.
          const dup = msg.includes("vehicles_vin_unique_idx")
            ? "A vehicle with this VIN was created moments ago."
            : msg.includes("vehicles_plate_unique_idx")
              ? "A vehicle with this plate was created moments ago."
              : msg.includes("vehicles_unit_number_unique_idx")
                ? "That unit number was taken moments ago."
                : null;
          results.push(
            dup
              ? { ...row, action: "skip", reason: dup }
              : { ...row, action: "error", reason: msg },
          );
          continue;
        }
        created++;
        results.push(row);
      }

      const skipped = results.filter((r) => r.action === "skip").length;
      const failed = results.filter((r) => r.action === "error").length;

      if (created || skipped || failed) {
        await logAudit(actor, {
          action: "vehicle.imported",
          summary:
            `Imported ${created} vehicle${created === 1 ? "" : "s"} from a spreadsheet` +
            (skipped ? `, skipped ${skipped}` : "") +
            (failed ? `, ${failed} failed` : ""),
          entityType: "vehicle",
          metadata: {
            created,
            skipped,
            failed,
            // Named so the trail says which rows did not make it, without
            // restating the whole spreadsheet.
            not_created: results
              .filter((r) => r.action !== "create")
              .map((r) => ({ line: r.line, label: r.label, reason: r.reason })),
          },
        });
      }

      return { created, skipped, failed, rows: results };
    },
  );
