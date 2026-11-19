import { vinLast6 } from "@/lib/vehicle-label";

/** Loose vehicle shape every list can fill in; all fields optional. */
export type VehicleCellInput = {
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  /** Pre-built "2013 Ford Fusion" (or "Unit 4 · 2013 Ford Fusion · PLATE") label when parts are not on hand. */
  label?: string | null;
  plate?: string | null;
  vin?: string | null;
  vinLast6?: string | null;
  unitNumber?: string | null;
};

export type VehicleCellParts = {
  title: string;
  plate: string | null;
  vinLast6: string | null;
  unit: string | null;
  /** Plate · VIN …123456 [· Unit X]; "—" when none are known. */
  detailLine: string;
};

const clean = (v: unknown) => (v == null ? "" : String(v).trim());

/** Pull the "year make model" part out of a joined label like "Unit 4 · 2013 Ford Fusion · ABC123". */
function titleFromLabel(label: string, unit: string, plate: string): string {
  const bits = label.split(" · ").map((b) => b.trim()).filter(Boolean);
  const kept = bits.filter((b) => b !== unit && b !== `Unit ${unit}` && b.toUpperCase() !== plate && !/^VIN\b/i.test(b));
  return kept[0] ?? "";
}

export function vehicleCellParts(v: VehicleCellInput | null | undefined): VehicleCellParts {
  const unit = clean(v?.unitNumber);
  const plate = clean(v?.plate).toUpperCase();
  const ymm = [clean(v?.year), clean(v?.make), clean(v?.model)].filter(Boolean).join(" ");
  const title = ymm || titleFromLabel(clean(v?.label), unit, plate) || (unit ? `Unit ${unit}` : "Vehicle Not Listed");
  const last6 = clean(v?.vinLast6) || vinLast6(v?.vin);
  const detailLine =
    [plate || null, last6 ? `VIN …${last6}` : null, unit && title !== `Unit ${unit}` ? `Unit ${unit}` : null].filter(Boolean).join(" · ") || "—";
  return { title, plate: plate || null, vinLast6: last6 || null, unit: unit || null, detailLine };
}
