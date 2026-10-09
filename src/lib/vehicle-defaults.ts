// Vehicle Defaults — the single rule for pre-filling pricing on NEW vehicles.
//
// Priority: explicit value for this vehicle → company default for its body
// type → Not Set (null). A default never overwrites an explicit value, and an
// explicit $0 is a real value. Defaults are copied onto the vehicle at
// creation (a snapshot); changing a default later never touches saved cars.

export const DEFAULT_FIELDS = ["weekly_rate", "monthly_rate", "deposit"] as const;
export type DefaultField = (typeof DEFAULT_FIELDS)[number];
export type VehicleDefault = { body_type: string } & Record<DefaultField, number | null>;

export const DEFAULT_FIELD_LABELS: Record<DefaultField, string> = {
  weekly_rate: "Weekly Rate",
  monthly_rate: "Monthly Rate",
  deposit: "Deposit",
};

/** Display labels for the canonical body_type values (stored value unchanged). */
export const BODY_TYPE_LABELS: Record<string, string> = {
  sedan: "Sedan", suv: "SUV", xl: "Minivan (XL)", minivan: "Minivan", truck: "Truck", van: "Van",
  coupe: "Coupe", hatchback: "Hatchback", wagon: "Wagon", convertible: "Convertible", other: "Other",
};
export const bodyTypeLabel = (t: string | null | undefined) => (t ? BODY_TYPE_LABELS[t] ?? t : "—");

export type Explicit = Partial<Record<DefaultField, number | null | undefined>>;
export type Resolved = Record<DefaultField, number | null> & { sources: Record<DefaultField, "explicit" | "company_default" | "not_set"> };

/**
 * `undefined` = the caller said nothing about this field → default may apply.
 * `null` = the caller explicitly chose Not Set → stays null.
 */
export function resolveVehicleDefaults(explicit: Explicit, def: VehicleDefault | null | undefined): Resolved {
  const out = { sources: {} } as Resolved;
  for (const f of DEFAULT_FIELDS) {
    const v = explicit[f];
    if (v !== undefined) {
      out[f] = v;
      out.sources[f] = v === null ? "not_set" : "explicit";
    } else if (def && def[f] != null) {
      out[f] = Number(def[f]);
      out.sources[f] = "company_default";
    } else {
      out[f] = null;
      out.sources[f] = "not_set";
    }
  }
  return out;
}

/** Form helper: which fields a newly chosen default may fill without asking. */
export function fillableFields(touched: Partial<Record<DefaultField, boolean>>, current: Partial<Record<DefaultField, string>>): DefaultField[] {
  return DEFAULT_FIELDS.filter((f) => !touched[f] || !(current[f] ?? "").trim());
}

// ---- Apply Template (existing vehicles) ----
export type ApplyRow = { field: DefaultField; current: number | null; proposed: number | null; change: "fill" | "replace" | "same" | "no_template_value" };
/** Side-by-side plan. "fill" = vehicle blank; "replace" = overwrites an existing rate (needs explicit opt-in). */
export function planApplyTemplate(vehicle: Partial<Record<DefaultField, number | null>>, def: VehicleDefault | null): ApplyRow[] {
  return DEFAULT_FIELDS.map((field) => {
    const current = vehicle[field] == null ? null : Number(vehicle[field]);
    const proposed = def?.[field] == null ? null : Number(def![field]);
    const change = proposed == null ? "no_template_value" : current === proposed ? "same" : current == null ? "fill" : "replace";
    return { field, current, proposed, change };
  });
}
/** Fields actually written: only those the staff member ticked, and only if they would change. */
export function fieldsToApply(plan: ApplyRow[], chosen: DefaultField[]): ApplyRow[] {
  return plan.filter((r) => chosen.includes(r.field) && (r.change === "fill" || r.change === "replace"));
}
