import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { railEntries, TABS, visibleTabs } from "../src/components/admin/nav-config";
import {
  addCalendarDays,
  buildReceivablesAging,
  etToday,
  receivablesAgingToCsv,
  type AgingPayment,
  type AgingRental,
} from "../src/lib/receivables-aging";
import { RECEIVABLES_AGING_OFF } from "../src/lib/receivables-aging-flag";
import { runReceivablesAging } from "../src/lib/receivables-aging.server";

const TODAY = "2026-10-21";

function rental(over: Partial<AgingRental> = {}): AgingRental {
  return { id: "rental-1", applicationId: "driver-1", vehicleId: "vehicle-1", status: "active", endDate: null, ...over };
}

function payment(over: Partial<AgingPayment> = {}): AgingPayment {
  return {
    id: "pay-1",
    rentalId: "rental-1",
    applicationId: "driver-1",
    type: "rent",
    status: "unpaid",
    dueDate: TODAY,
    amountCents: 10000,
    netCollectedCents: 0,
    refundedCents: 0,
    balanceDueCents: 10000,
    unreadable: false,
    ...over,
  };
}

const people = [{ id: "driver-1", name: 'Ada, "Bee"' }];
const vehicles = [{ id: "vehicle-1", label: "Unit 7 · Civic" }];

function aging(rentals: AgingRental[], payments: AgingPayment[]) {
  return buildReceivablesAging({ today: TODAY, rentals, payments, people, vehicles });
}

it("throws before any read when the flag is off", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  await expect(runReceivablesAging({ enabled: false, userId: "owner", tier: "owner", today: TODAY, load })).rejects.toThrow(RECEIVABLES_AGING_OFF);
  expect(load).not.toHaveBeenCalled();
});

it("refuses a coordinator and a missing user before any read", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  await expect(runReceivablesAging({ enabled: true, userId: "coord", tier: "coordinator", today: TODAY, load })).rejects.toThrow("Forbidden");
  await expect(runReceivablesAging({ enabled: true, userId: null, tier: "owner", today: TODAY, load })).rejects.toThrow("Forbidden");
  expect(load).not.toHaveBeenCalled();
});

it("lets an owner and a manager read an empty aging", async () => {
  const load = vi.fn(async () => ({ ok: true as const, rentals: [], payments: [], people: [], vehicles: [] }));
  for (const tier of ["owner", "manager"] as const) {
    const result = await runReceivablesAging({ enabled: true, userId: tier, tier, today: TODAY, load });
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.report.bucketCents).toEqual({ current: 0, d1_7: 0, d8_14: 0, d15_30: 0, d30_plus: 0 });
      expect(result.report.omitted.join(" ")).toContain("There is no drivers table");
      expect(result.report.omitted.join(" ")).toContain("Stripe is not called");
    }
  }
  expect(load).toHaveBeenCalledTimes(2);
});

it("places balances in the Eastern Time buckets and keeps day 30 out of 30+", () => {
  expect(addCalendarDays(TODAY, -30)).toBe("2026-09-21");
  const cases: Array<[string, string, "current" | "d1_7" | "d8_14" | "d15_30" | "d30_plus"]> = [
    ["today", TODAY, "current"],
    ["future", "2026-10-22", "current"],
    ["day1", "2026-10-20", "d1_7"],
    ["day7", "2026-10-14", "d1_7"],
    ["day8", "2026-10-13", "d8_14"],
    ["day14", "2026-10-07", "d8_14"],
    ["day15", "2026-10-06", "d15_30"],
    ["day30", "2026-09-21", "d15_30"],
    ["day31", "2026-09-20", "d30_plus"],
  ];
  const report = aging(
    cases.map(([id]) => rental({ id })),
    cases.map(([id, due], index) => payment({ id: `pay-${id}`, rentalId: id, dueDate: due, amountCents: (index + 1) * 100, netCollectedCents: 0, balanceDueCents: (index + 1) * 100 })),
  );
  expect(report).not.toBeNull();
  for (const [id, , bucket] of cases) {
    expect(report!.rows.find((row) => row.rentalId === id)?.bucket).toBe(bucket);
  }
  expect(report!.bucketCents).toEqual({
    current: 100 + 200,
    d1_7: 300 + 400,
    d8_14: 500 + 600,
    d15_30: 700 + 800,
    d30_plus: 900,
  });
});

it("ages the whole balance by the oldest open due date", () => {
  const source = rental();
  const before = structuredClone(source);
  const report = aging(
    [source],
    [
      payment({ id: "old", dueDate: "2026-09-20", amountCents: 1000, netCollectedCents: 0, balanceDueCents: 1000 }),
      payment({ id: "new", dueDate: TODAY, amountCents: 5000, netCollectedCents: 0, balanceDueCents: 5000 }),
    ],
  );
  expect(source).toEqual(before);
  expect(report!.rows).toHaveLength(1);
  expect(report!.rows[0].oldestDue).toBe("2026-09-20");
  expect(report!.rows[0].bucket).toBe("d30_plus");
  expect(report!.rows[0].owedCents).toBe(6000);
  expect(report!.bucketCents!.d30_plus).toBe(6000);
  expect(report!.bucketCents!.current).toBe(0);
});

it("uses amount minus net collected and does not subtract the payment refund again", () => {
  const report = aging(
    [rental()],
    [payment({ amountCents: 10000, netCollectedCents: 4000, refundedCents: 1000, balanceDueCents: 7000, status: "failed", dueDate: "2026-10-20" })],
  );
  expect(report!.rows[0].owedCents).toBe(6000);
  expect(report!.rows[0].bucket).toBe("d1_7");
  expect(report!.rows[0].evidence.join(" ")).toContain("This is evidence only.");
  expect(report!.bucketCents!.d1_7).toBe(6000);
});

it("excludes deposits, paid rent, and rentals that are not active or recently ended", () => {
  const report = aging(
    [
      rental({ id: "open" }),
      rental({ id: "recent", status: "ended", endDate: "2026-09-21" }),
      rental({ id: "old", status: "ended", endDate: "2026-09-20" }),
      rental({ id: "blank", status: "completed", endDate: null }),
      rental({ id: "reserved", status: "reserved", endDate: null }),
    ],
    [
      payment({ rentalId: "open", id: "rent" }),
      payment({ rentalId: "open", id: "deposit", type: "deposit", amountCents: 99900, netCollectedCents: 0, balanceDueCents: 99900 }),
      payment({ rentalId: "open", id: "paid", status: "paid", amountCents: 8000, netCollectedCents: 8000, balanceDueCents: 0 }),
      payment({ rentalId: "recent", id: "recent-pay", dueDate: "2026-09-21", amountCents: 3000, netCollectedCents: 0, balanceDueCents: 3000 }),
      payment({ rentalId: "old", id: "old-pay", amountCents: 4000, netCollectedCents: 0, balanceDueCents: 4000 }),
      payment({ rentalId: "blank", id: "blank-pay", amountCents: 1500, netCollectedCents: 0, balanceDueCents: 1500 }),
      payment({ rentalId: "reserved", id: "reserved-pay", amountCents: 2500, netCollectedCents: 0, balanceDueCents: 2500 }),
      payment({ rentalId: null, id: "loose", amountCents: 500, netCollectedCents: 0, balanceDueCents: 500 }),
    ],
  );
  expect(report!.rows.map((row) => row.rentalId).sort()).toEqual(["open", "recent"]);
  expect(report!.rows.find((row) => row.rentalId === "open")?.owedCents).toBe(10000);
  expect(report!.bucketCents!.current).toBe(10000);
  expect(report!.bucketCents!.d15_30).toBe(3000);
  const omitted = report!.omitted.join(" ");
  expect(omitted).toContain("older than 30 days");
  expect(omitted).toContain("40.00");
  expect(omitted).toContain("no end date");
  expect(omitted).toContain("15.00");
  expect(omitted).toContain("not active or recently ended");
  expect(omitted).toContain("25.00");
  expect(omitted).toContain("no rental on file");
  expect(omitted).toContain("5.00");
});

it("leaves a balance with no due date out of the bucket totals", () => {
  const report = aging([rental()], [payment({ dueDate: null })]);
  expect(report!.rows[0].bucket).toBeNull();
  expect(report!.rows[0].owedCents).toBe(10000);
  expect(report!.bucketCents).toEqual({ current: 0, d1_7: 0, d8_14: 0, d15_30: 0, d30_plus: 0 });
  expect(report!.rows[0].evidence.join(" ")).toContain("not in a bucket");
});

it("withholds totals when the read is capped", async () => {
  const result = await runReceivablesAging({
    enabled: true,
    userId: "manager",
    tier: "manager",
    today: TODAY,
    load: async () => ({ ok: false, capped: true }),
  });
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.report.rows).toEqual([]);
    expect(result.report.bucketCents).toBeNull();
    expect(result.report.warnings[0]).toContain("page cap");
  }
});

it("escapes commas, quotes, and formula text in the csv", () => {
  const report = aging([rental()], [payment()]);
  report!.rows[0].driver = '=Ada, "Bee"';
  const csv = receivablesAgingToCsv(report!);
  expect(csv).toContain(`"'=Ada, ""Bee"""`);
  expect(csv).toContain("Current,100.00");
  expect(csv).toContain("There is no drivers table");
});

it("reads Eastern Time, not the UTC date, around midnight", () => {
  expect(etToday(new Date("2026-10-21T03:30:00Z"))).toBe("2026-10-20");
  expect(etToday(new Date("2026-10-21T04:30:00Z"))).toBe("2026-10-21");
});

it("keeps Receivables Aging out of the dark nav and behind the throw", () => {
  const flag = readFileSync("src/lib/receivables-aging-flag.ts", "utf8");
  const fn = readFileSync("src/lib/receivables-aging.functions.ts", "utf8");
  const server = readFileSync("src/lib/receivables-aging.server.ts", "utf8");
  const pure = readFileSync("src/lib/receivables-aging.ts", "utf8");
  const panel = readFileSync("src/components/admin/ReceivablesAgingPanel.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const disabled = fn.indexOf("if (!RECEIVABLES_AGING_ENABLED) throw new Error(RECEIVABLES_AGING_OFF);");
  const manager = fn.indexOf("await requireManager(context.userId)");
  const table = fn.indexOf("loadReceivablesAging(");
  expect(flag).toContain("export const RECEIVABLES_AGING_ENABLED = false");
  expect(disabled).toBeGreaterThan(-1);
  expect(manager).toBeGreaterThan(disabled);
  expect(table).toBeGreaterThan(manager);
  expect(tabs).not.toContain("receivables_aging");
  expect(TABS.some((tab) => tab.id === "receivables_aging")).toBe(false);
  for (const tier of ["owner", "manager", "coordinator"] as const) {
    expect(visibleTabs(tier).some((tab) => tab.id === "receivables_aging")).toBe(false);
    expect(railEntries(tier).some((entry) => entry.id === "receivables_aging")).toBe(false);
  }
  expect(admin.indexOf('urlTab === "receivables_aging"')).toBeGreaterThan(-1);
  expect(admin.indexOf('urlTab === "receivables_aging"')).toBeLessThan(admin.indexOf("TABS.some"));
  expect(admin).toContain('RECEIVABLES_AGING_ENABLED && tab === "receivables_aging"');
  expect(server).toContain("amount,net_collected,refunded_amount,balance_due,due_date");
  expect(server).not.toContain("stripe_");
  for (const source of [flag, fn, server, pure, panel]) {
    expect(source).not.toMatch(/from ["'].*stripe/);
    expect(source).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  }
});
