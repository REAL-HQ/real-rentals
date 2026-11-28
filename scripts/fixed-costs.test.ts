// Fixed Costs (Accounting, Owner only). Run: bun test scripts/fixed-costs.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ACCOUNTING_TAB_IDS,
  FIXED_COSTS_TAB,
  GROUP_ORDER,
  LEGACY_TABS,
  railEntries,
  resolveAdminTab,
  visibleTabs,
} from "../src/components/admin/nav-config";
import {
  amountDueWithin,
  buildFixedCosts,
  dueDatesWithin,
  FIXED_COSTS_COPY,
  fixedCostInputError,
  FREQUENCY_LABELS,
  monthlyAmount,
  ROW_STATUS_LABELS,
  type FixedCostItem,
  type FixedCostVehicle,
} from "../src/lib/fixed-costs";
import { isMissingTable } from "../src/lib/fixed-costs.functions";

const V = (id: string, extra: Partial<FixedCostVehicle> = {}): FixedCostVehicle => ({
  id, year: 2015, make: "Toyota", model: "Camry", license_plate: `P${id}`, vin: `VIN0000000000${id}`, status: "available", archived_at: null, ...extra,
});
let n = 0;
const I = (extra: Partial<FixedCostItem>): FixedCostItem => ({
  id: `i${++n}`, kind: "gps", scope: "vehicle", vehicle_id: null, rental_id: null, label: null, provider: null,
  amount: 0, frequency: "monthly", next_due_on: null, active: true, notes: null, ...extra,
});

describe("normalizing to monthly", () => {
  test("weekly, monthly, quarterly, 6 months, yearly", () => {
    expect(monthlyAmount(120, "weekly")).toBe(520);
    expect(monthlyAmount(35, "monthly")).toBe(35);
    expect(monthlyAmount(300, "quarterly")).toBe(100);
    expect(monthlyAmount(1200, "semiannual")).toBe(200);
    expect(monthlyAmount(2400, "annual")).toBe(200);
    expect(monthlyAmount(-5, "monthly")).toBe(0);
  });
});

describe("next 30 days", () => {
  test("weekly line due today bills 5 times in 30 days", () => {
    expect(dueDatesWithin("2026-11-28", "weekly", "2026-11-28")).toHaveLength(5);
  });
  test("a past monthly due date rolls forward", () => {
    expect(dueDatesWithin("2026-09-15", "monthly", "2026-11-28")).toEqual(["2026-12-15"]);
  });
  test("month end anchor keeps the 31st where possible", () => {
    expect(dueDatesWithin("2026-01-31", "monthly", "2026-02-01", 60)).toEqual(["2026-02-28", "2026-03-31"]);
  });
  test("a yearly line outside the window costs nothing this month", () => {
    expect(amountDueWithin({ amount: 2400, frequency: "annual", nextDueOn: "2027-06-01", monthly: 200 }, "2026-11-28")).toEqual({ amount: 0, dated: true });
  });
  test("an undated line counts its monthly amount", () => {
    expect(amountDueWithin({ amount: 120, frequency: "weekly", nextDueOn: null, monthly: 520 }, "2026-11-28")).toEqual({ amount: 520, dated: false });
  });
});

describe("itemized rows", () => {
  const vehicles = [V("1", { status: "rented" }), V("2", { status: "rented" }), V("3"), V("4", { archived_at: "2026-10-01T00:00:00Z" }), V("5", { status: "sold" })];
  const rentals = [
    { id: "r1", vehicle_id: "1", status: "active", renter: "Ana Diaz" },
    { id: "r2", vehicle_id: "2", status: "active", renter: "Ben Cole" },
    { id: "r9", vehicle_id: "3", status: "closed", renter: "Old Renter" },
  ];

  test("with no costs entered, every renter and fleet car is Missing Cost and totals are 0", () => {
    const r = buildFixedCosts({ today: "2026-11-28", vehicles, rentals, items: [] });
    const ins = r.rows.filter((x) => x.kind === "insurance");
    const gps = r.rows.filter((x) => x.kind === "gps");
    expect(ins.map((x) => x.renter)).toEqual(["Ana Diaz", "Ben Cole"]);
    expect(ins.every((x) => x.status === "missing" && x.monthly === null)).toBe(true);
    // Archived (4) and sold (5) cars have no GPS row; closed rental r9 has no insurance row.
    expect(gps.map((x) => x.vehicleId)).toEqual(["1", "2", "3"]);
    expect(r.totals).toMatchObject({ grandMonthly: 0, missingInsurance: 2, missingGps: 3 });
  });

  test("a new car or renter shows up automatically (computed from source rows)", () => {
    const before = buildFixedCosts({ today: "2026-11-28", vehicles, rentals, items: [] });
    const after = buildFixedCosts({
      today: "2026-11-28",
      vehicles: [...vehicles, V("6", { status: "rented" })],
      rentals: [...rentals, { id: "r6", vehicle_id: "6", status: "active", renter: "Cy Moe" }],
      items: [],
    });
    expect(after.totals.missingGps).toBe(before.totals.missingGps + 1);
    expect(after.totals.missingInsurance).toBe(before.totals.missingInsurance + 1);
  });

  test("own lines, defaults and totals", () => {
    const items = [
      I({ kind: "gps", scope: "default", amount: 25 }),
      I({ kind: "gps", scope: "vehicle", vehicle_id: "3", amount: 30 }),
      I({ kind: "insurance", scope: "rental", rental_id: "r1", vehicle_id: "1", amount: 100, frequency: "weekly", next_due_on: "2026-11-30", provider: "Staff Note" }),
      I({ kind: "insurance", scope: "default", amount: 400 }),
    ];
    const r = buildFixedCosts({ today: "2026-11-28", vehicles, rentals, items });
    const ana = r.rows.find((x) => x.renter === "Ana Diaz" && x.kind === "insurance")!;
    const ben = r.rows.find((x) => x.renter === "Ben Cole" && x.kind === "insurance")!;
    expect(ana).toMatchObject({ status: "set", monthly: 433.33 });
    expect(ben).toMatchObject({ status: "default", monthly: 400 });
    expect(r.rows.filter((x) => x.kind === "gps").map((x) => [x.vehicleId, x.status, x.monthly])).toEqual([
      ["1", "default", 25], ["2", "default", 25], ["3", "set", 30],
    ]);
    expect(r.totals.insuranceMonthly).toBe(833.33);
    expect(r.totals.gpsMonthly).toBe(80);
    expect(r.totals.grandMonthly).toBe(913.33);
    // Ana: weekly from Nov 30 -> Nov 30, Dec 7, 14, 21 = 4 x 100; the rest undated at monthly.
    expect(r.totals.next30).toBe(400 + 400 + 80);
    expect(r.totals.undatedLines).toBe(4);
    expect(r.totals.missingInsurance + r.totals.missingGps).toBe(0);
  });

  test("a fleet policy covers renters without their own line, counted once", () => {
    const items = [I({ kind: "insurance", scope: "fleet", amount: 1800, label: "Fleet Policy" })];
    const r = buildFixedCosts({ today: "2026-11-28", vehicles, rentals, items });
    const ins = r.rows.filter((x) => x.kind === "insurance");
    expect(ins.filter((x) => x.status === "fleet")).toHaveLength(2);
    expect(r.totals.insuranceMonthly).toBe(1800);
    expect(r.totals.missingInsurance).toBe(0);
  });

  test("lines still billing on an ended rental or archived car keep counting, flagged", () => {
    const items = [
      I({ kind: "insurance", scope: "rental", rental_id: "r9", amount: 300 }),
      I({ kind: "gps", scope: "vehicle", vehicle_id: "4", amount: 20 }),
    ];
    const r = buildFixedCosts({ today: "2026-11-28", vehicles, rentals, items });
    expect(r.rows.find((x) => x.status === "rental_ended")).toMatchObject({ renter: "Old Renter", monthly: 300 });
    expect(r.rows.find((x) => x.status === "archived")).toMatchObject({ vehicleId: "4", monthly: 20 });
    expect(r.totals.grandMonthly).toBe(320);
  });

  test("ended lines are ignored", () => {
    const r = buildFixedCosts({ today: "2026-11-28", vehicles, rentals, items: [I({ kind: "gps", scope: "default", amount: 25, active: false })] });
    expect(r.totals.gpsMonthly).toBe(0);
    expect(r.defaults.gps).toBeNull();
  });
});

describe("save validation", () => {
  test("rejects bad input", () => {
    expect(fixedCostInputError({ kind: "gps", scope: "vehicle", amount: 25, frequency: "monthly" })).toBe("Pick A Vehicle");
    expect(fixedCostInputError({ kind: "insurance", scope: "rental", amount: 25, frequency: "monthly" })).toBe("Pick A Renter");
    expect(fixedCostInputError({ kind: "gps", scope: "default", vehicleId: "x", amount: 25, frequency: "monthly" })).toBe("Fleet Lines Have No Vehicle");
    expect(fixedCostInputError({ kind: "gps", scope: "default", amount: -1, frequency: "monthly" })).toBe("Enter An Amount");
    expect(fixedCostInputError({ kind: "gps", scope: "default", amount: 25, frequency: "daily" })).toBe("Pick How Often");
    expect(fixedCostInputError({ kind: "gps", scope: "default", amount: 25, frequency: "monthly" })).toBeNull();
  });
  test("missing table is reported as Setup Needed, other errors are not", () => {
    expect(isMissingTable({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(isMissingTable({ code: "PGRST205", message: "Could not find the table 'public.fixed_cost_items'" })).toBe(true);
    expect(isMissingTable({ code: "42501", message: "permission denied" })).toBe(false);
  });
});

describe("Accounting section: Owner only", () => {
  test("Accounting sits after Business", () => {
    expect(GROUP_ORDER.indexOf("ACCOUNTING")).toBe(GROUP_ORDER.indexOf("BUSINESS") + 1);
  });
  test("P&L moved from Business to Accounting, with Fixed Costs beside it", () => {
    const owner = railEntries("owner");
    expect(owner.find((t) => t.id === "owner_pnl")?.group).toBe("ACCOUNTING");
    expect(owner.find((t) => t.id === "fixed_costs")?.group).toBe("ACCOUNTING");
    expect(owner.filter((t) => t.group === "ACCOUNTING").map((t) => t.label)).toEqual(["P&L", "Fixed Costs"]);
    expect(owner.filter((t) => t.group === "BUSINESS").some((t) => t.id === "owner_pnl")).toBe(false);
    expect(FIXED_COSTS_TAB.minTier).toBe("owner");
  });
  test("Managers and Coordinators see no Accounting section", () => {
    for (const tier of ["manager", "coordinator", null] as const) {
      expect(railEntries(tier).some((t) => t.group === "ACCOUNTING")).toBe(false);
      expect(visibleTabs(tier).some((t) => (ACCOUNTING_TAB_IDS as readonly string[]).includes(t.id))).toBe(false);
    }
  });
  test("route guard: a direct link sends non-owners to Overview", () => {
    for (const urlTab of ACCOUNTING_TAB_IDS) {
      expect(resolveAdminTab({ urlTab, tier: "owner", navTabs: visibleTabs("owner") })).toBe(urlTab);
      expect(resolveAdminTab({ urlTab, tier: "manager", navTabs: visibleTabs("manager") })).toBe("overview");
      expect(resolveAdminTab({ urlTab, tier: "coordinator", navTabs: visibleTabs("coordinator") })).toBe("overview");
    }
  });
  test("old P&L link keeps working and short links resolve", () => {
    expect(resolveAdminTab({ urlTab: "owner_pnl", tier: "owner", navTabs: visibleTabs("owner") })).toBe("owner_pnl");
    expect(LEGACY_TABS.pnl?.tab).toBe("owner_pnl");
    expect(LEGACY_TABS.accounting?.tab).toBe("owner_pnl");
  });
  test("admin shell guards the route and renders panels only for owners; server checks the owner", () => {
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(admin).toContain('if (urlTab === "fixed_costs")');
    expect(admin).toMatch(/FIXED_COSTS_ENABLED && tab === "fixed_costs" && tierAllows\(tier, "owner"\) && <FixedCostsPanel \/>/);
    expect(admin).toMatch(/tab === "owner_pnl" && tierAllows\(tier, "owner"\) && <OwnerPnlPanel \/>/);
    const fns = readFileSync(new URL("../src/lib/fixed-costs.functions.ts", import.meta.url), "utf8");
    expect((fns.match(/await requireOwner\(context\.userId\)/g) ?? []).length).toBe(3);
  });
  test("migration: owner-only RLS, no anon access", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261128170000_fixed_costs.sql", import.meta.url), "utf8");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/USING \(private\.is_owner\(\)\) WITH CHECK \(private\.is_owner\(\)\)/);
    expect(sql).toMatch(/REVOKE ALL ON public\.fixed_cost_items FROM PUBLIC, anon/);
  });
});

describe("copy", () => {
  const all = [...Object.values(FIXED_COSTS_COPY), ...Object.values(FREQUENCY_LABELS), ...Object.values(ROW_STATUS_LABELS), FIXED_COSTS_TAB.label, FIXED_COSTS_TAB.description];
  test("no em dashes and no deposit wording", () => {
    for (const s of all) {
      expect(s.includes("\u2014")).toBe(false);
      expect(/deposit/i.test(s)).toBe(false);
    }
    const panel = readFileSync(new URL("../src/components/admin/FixedCostsPanel.tsx", import.meta.url), "utf8");
    expect(panel.includes("\u2014")).toBe(false);
  });
  test("short Title Case labels", () => {
    for (const s of [...Object.values(FREQUENCY_LABELS), ...Object.values(ROW_STATUS_LABELS), FIXED_COSTS_TAB.label]) {
      expect(s.split(" ").length).toBeLessThanOrEqual(2);
      expect(s.split(" ").every((w) => /^[A-Z0-9&]/.test(w))).toBe(true);
    }
  });
});
