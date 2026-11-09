import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { buildRevenueForecast, revenueForecastToCsv, type ForecastRental, type ForecastVehicle } from "../src/lib/revenue-forecast";
import { runRevenueForecast } from "../src/lib/revenue-forecast.server";

const TODAY = "2026-10-21";

function rental(over: Partial<ForecastRental> = {}): ForecastRental {
  return {
    id: "rental-1",
    vehicleId: "v-civic",
    status: "active",
    weeklyRate: 100,
    nextPaymentDue: "2026-10-21",
    endDate: null,
    ...over,
  };
}

function vehicle(over: Partial<ForecastVehicle> = {}): ForecastVehicle {
  return {
    id: "v-civic",
    label: "Unit 7 · 2020 Honda Civic",
    status: "rented",
    weeklyRate: 100,
    archived: false,
    ...over,
  };
}

it("returns disabled before any read when the flag is off", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  await expect(runRevenueForecast({ enabled: false, userId: "owner", tier: "owner", today: TODAY, load })).resolves.toEqual({
    status: "disabled",
    report: null,
  });
  expect(load).not.toHaveBeenCalled();
});

it("refuses a non-owner before any read", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  await expect(runRevenueForecast({ enabled: true, userId: "manager", tier: "manager", today: TODAY, load })).rejects.toThrow("Forbidden");
  await expect(runRevenueForecast({ enabled: true, userId: null, tier: "owner", today: TODAY, load })).rejects.toThrow("Forbidden");
  expect(load).not.toHaveBeenCalled();
});

it("stops a rental after its end date inside the four week window", () => {
  const report = buildRevenueForecast({
    today: TODAY,
    rentals: [
      rental({ id: "ending", vehicleId: "v-civic", weeklyRate: 100, endDate: "2026-10-28" }),
      rental({ id: "open", vehicleId: "v-open", weeklyRate: 40, endDate: null }),
    ],
    vehicles: [
      vehicle({ label: 'Civic, "Ada"' }),
      vehicle({ id: "v-open", label: "Unit 8 · 2019 Toyota Camry", status: "rented", weeklyRate: 40 }),
      vehicle({ id: "v-idle", label: "Lot North", status: "available", weeklyRate: 80 }),
      vehicle({ id: "v-shop", label: "Unit 3 · Truck", status: "maintenance", weeklyRate: 50 }),
      vehicle({ id: "v-blank", label: "Unit 4 · Van", status: "available", weeklyRate: null }),
      vehicle({ id: "v-gone", label: "Sold", status: "archived", weeklyRate: 999, archived: true }),
    ],
  });
  expect(report).not.toBeNull();
  expect(report!.weeks.map((week) => [week.from, week.through, week.cents])).toEqual([
    ["2026-10-19", "2026-10-25", 14000],
    ["2026-10-26", "2026-11-01", 14000],
    ["2026-11-02", "2026-11-08", 4000],
    ["2026-11-09", "2026-11-15", 4000],
  ]);
  const ending = report!.vehicles.find((row) => row.vehicleId === "v-civic");
  expect(ending?.weekCents).toEqual([10000, 10000, 0, 0]);
  expect(report!.totalCents).toBe(36000);
  expect(report!.idleCount).toBe(3);
  expect(report!.idlePotentialCents).toBe(13000);
  expect(report!.idleRateNotSet).toBe(1);
  const csv = revenueForecastToCsv(report!);
  expect(csv.startsWith('"Projection, Not Collected Money"')).toBe(true);
  expect(csv).toContain('"Civic, ""Ada"""');
  expect(csv).toContain("Potential If Idle Vehicles Were Rented,130.00");
});

it("excludes and counts an active rental with no next payment due", () => {
  const report = buildRevenueForecast({
    today: TODAY,
    rentals: [
      rental({ id: "missing", vehicleId: "v-missing", weeklyRate: 200, nextPaymentDue: null }),
      rental({ id: "kept", vehicleId: "v-kept", weeklyRate: 40 }),
    ],
    vehicles: [
      vehicle({ id: "v-missing", label: "Missing Due", status: "rented", weeklyRate: 200 }),
      vehicle({ id: "v-kept", label: "Kept", status: "rented", weeklyRate: 40 }),
    ],
  });
  expect(report).not.toBeNull();
  expect(report!.excludedMissingDue).toBe(1);
  expect(report!.vehicles.map((row) => row.vehicleId)).toEqual(["v-kept"]);
  expect(report!.weeks.map((week) => week.cents)).toEqual([4000, 4000, 4000, 4000]);
  expect(report!.totalCents).toBe(16000);
  expect(revenueForecastToCsv(report!)).toContain("Active Rentals Excluded For Missing Next Payment Due,1");
});

it("keeps Revenue Forecast out of the dark nav and behind the owner check", () => {
  const flag = readFileSync("src/lib/revenue-forecast-flag.ts", "utf8");
  const fn = readFileSync("src/lib/revenue-forecast.functions.ts", "utf8");
  const server = readFileSync("src/lib/revenue-forecast.server.ts", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const disabled = fn.indexOf('if (!REVENUE_FORECAST_ENABLED) return { status: "disabled", report: null };');
  const owner = fn.indexOf("await requireOwner(context.userId)");
  const table = fn.indexOf("loadRevenueForecast(");
  expect(flag).toContain("export const REVENUE_FORECAST_ENABLED = false");
  expect(disabled).toBeGreaterThan(-1);
  expect(owner).toBeGreaterThan(disabled);
  expect(table).toBeGreaterThan(owner);
  expect(server).toContain("id,vehicle_id,status,weekly_rate,next_payment_due,end_date");
  expect(server).toContain("weekly_rate,archived_at");
  expect(`${fn}\n${server}`).not.toMatch(/stripe|createReadOnlyStripe|\.(create|update|del|cancel)\(/i);
  expect(tabs).not.toContain("revenue_forecast");
  expect(nav).toContain('REVENUE_FORECAST_ENABLED && tierAllows(tier, "owner")');
  expect(admin).toContain('if (!REVENUE_FORECAST_ENABLED || (tier && !tierAllows(tier, "owner"))) return "overview"');
  expect(admin).toContain('REVENUE_FORECAST_ENABLED && tab === "revenue_forecast"');
});
