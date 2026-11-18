// Vehicle picker (Dolmar t437u): every place staff choose a car uses the one
// shared searchable picker with a thumbnail (click to enlarge), plate, VIN last 6.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatVehicleLabel, vehicleMatchesQuery, vinLast6 } from "../src/lib/vehicle-label";

const read = (p: string) => readFileSync(p, "utf8");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : []; });
}

const fusion = { id: "a", unit_number: "U-12", year: 2015, make: "Ford", model: "Fusion", license_plate: "abc1234", vin: "3FA6P0HD1FR153036", status: "available" };
const fusion2 = { id: "b", unit_number: "U-13", year: 2013, make: "Ford", model: "Fusion", license_plate: "XYZ9876", vin: "3FADP4BJ8DM274418", status: "available" };

describe("what each option shows and how search finds it", () => {
  test("label has year make model, plate and VIN last 6 so look-alike cars differ", () => {
    expect(formatVehicleLabel(fusion)).toContain("2015 Ford Fusion");
    expect(formatVehicleLabel(fusion)).toContain("ABC1234");
    expect(formatVehicleLabel(fusion)).toContain("VIN …153036");
    expect(formatVehicleLabel(fusion)).not.toBe(formatVehicleLabel(fusion2));
    expect(vinLast6("3fa6p0hd1fr153036")).toBe("153036");
  });
  test("search matches year, make, model, plate, any VIN substring, last 6, unit and status", () => {
    for (const q of ["2015", "ford", "fusion", "abc12", "abc1234", "153036", "FR1530", "3FA6P0", "u-12", "avail", "ford 2015", "153036 fusion"]) expect(vehicleMatchesQuery(fusion, q)).toBe(true);
    expect(vehicleMatchesQuery(fusion2, "153036")).toBe(false);
    expect(vehicleMatchesQuery(fusion, "274418")).toBe(false);
    expect(vehicleMatchesQuery(fusion, "")).toBe(true);
  });
});

describe("shared picker wiring", () => {
  const combo = read("src/components/admin/VehicleCombobox.tsx");
  const photo = read("src/components/admin/VehiclePickerPhoto.tsx");
  test("picker has a search box, thumbnail enlarge lightbox, plate and VIN last 6", () => {
    expect(combo).toContain("CommandInput");
    expect(combo).toContain("vehicleMatchesQuery");
    expect(combo).toContain("vinLast6");
    expect(combo).toContain("license_plate");
    expect(combo).toContain("onEnlarge={setEnlarged}");
    expect(combo).toContain('data-testid="vehicle-photo-lightbox"');
    expect(combo).toContain("export { VehicleCombobox as VehiclePicker }");
  });
  test("enlarging never selects the row and never dismisses the list", () => {
    expect(photo).toContain("e.stopPropagation()");
    expect(photo).toContain("onPointerDown={swallow}");
    expect(combo).toContain("onInteractOutside={(e) => { if (enlarged) e.preventDefault(); }}");
    expect(combo).toContain("onEscapeKeyDown={(e) => { if (enlarged) e.preventDefault(); }}");
  });
  test("thumbnail is a real button (keyboard Enter/Space) only when a photo exists; placeholder otherwise", () => {
    expect(photo).toContain('type="button"');
    expect(photo).toContain('e.key === "Enter"');
    expect(photo).toContain("No Confirmed Car Photo");
  });
  test("photo list matches trigger width (no dialog overhang) with plate and VIN on a second line at every size", () => {
    expect(combo).toContain("w-[var(--radix-popover-trigger-width)] min-w-0 max-w-[calc(100vw-2rem)]");
    expect(combo).not.toContain("48rem");
    expect(combo).not.toContain("sm:grid-cols-[1rem_3rem_minmax(0,1fr)_5rem_5rem_6rem]");
    expect(combo).toContain('VIN …{vinLast6(v.vin)');
  });
  test("lightbox sits above the list popover", () => {
    expect(combo).toContain('overlayClassName="z-[300]"');
    expect(combo).toContain("z-[301]");
    expect(combo).toContain("z-[200]");
  });
});

describe("no vehicle dropdown is left as a plain select", () => {
  test("no <option>/SelectItem list is built from vehicles/cars", () => {
    const offenders: string[] = [];
    for (const f of [...walk("src/components"), ...walk("src/routes")]) {
      const lines = read(f).split("\n");
      lines.forEach((l, i) => {
        if (!/<option|<SelectItem/.test(l)) return;
        const ctx = lines.slice(Math.max(0, i - 3), i + 1).join(" ");
        if (/\b(vehicles?|cars|termsVehicles|vehicleOptions)\w*\.map\(/.test(ctx)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
  const callers = [
    "TermsConfirmedControl", "BookingVehicleHistory", "ReserveCarDialog", "ActivateRentalDialog", "PickupPlanDialog", "RecordRentalDialog",
    "MaintenancePanel", "ExpensesPanel", "OwnerExpenseEntryPanel", "ServiceTransactionReview", "BulkReceiptUpload", "ChargesPanel",
    "PaymentsPanel", "InspectionsPanel", "IncidentsPanel", "IncidentBoard", "FleetInboxPanel", "FleetServiceCenter", "DriversPanel",
  ];
  for (const c of callers) test(`${c} uses the shared picker`, () => expect(read(`src/components/admin/${c}.tsx`)).toContain("<VehicleCombobox"));
  test("Confirm Terms passes plate, VIN and status (not a label-only list) and keeps the vehicle id value", () => {
    const t = read("src/components/admin/TermsConfirmedControl.tsx");
    expect(t).toContain("onChange={(id) => setVehicle(id ?? \"\")}");
    expect(t).not.toContain("AppSelect");
    const d = read("src/components/admin/DriversPanel.tsx");
    expect(d).toContain("license_plate: v.license_plate ?? v.plate ?? null, vin: v.vin ?? null");
  });
  test("reservation car list returns plate and VIN for the picker, still only open cars", () => {
    const s = read("src/lib/reservations.functions.ts");
    expect(s).toContain('"id,unit_number,year,make,model,license_plate,vin,status,weekly_rate,archived_at"');
    expect(s).toContain('.in("status", ["available", "ready", "onboarding"])');
  });
  test("replacement-vehicle swap field is a picker, still validated as a vehicle id", () => {
    const b = read("src/components/admin/BookingVehicleHistory.tsx");
    expect(b).toContain('aria-label="Replacement Vehicle"');
    expect(b).toContain("Replacement Vehicle must be the vehicle id");
  });
});
