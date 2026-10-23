import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { railEntries, TABS, visibleTabs } from "../src/components/admin/nav-config";
import {
  addCalendarDays,
  buildDepositLedger,
  depositLedgerToCsv,
  etToday,
  type LedgerDeduction,
  type LedgerPayment,
  type LedgerRental,
} from "../src/lib/deposit-ledger";
import { DEPOSIT_LEDGER_OFF } from "../src/lib/deposit-ledger-flag";
import { runDepositLedger } from "../src/lib/deposit-ledger.server";

const TODAY = "2026-10-21";

function rental(over: Partial<LedgerRental> = {}): LedgerRental {
  return {
    id: "rental-1",
    applicationId: "driver-1",
    vehicleId: "vehicle-1",
    status: "active",
    endDate: null,
    expectedCents: 50000,
    expectedUnreadable: false,
    depositHeld: true,
    depositHeldUnreadable: false,
    depositStatus: "held",
    refundCents: null,
    refundUnreadable: false,
    settledAt: null,
    ...over,
  };
}

function payment(over: Partial<LedgerPayment> = {}): LedgerPayment {
  return {
    id: "pay-1",
    rentalId: "rental-1",
    applicationId: "driver-1",
    type: "deposit",
    status: "paid",
    amountCents: 50000,
    netCollectedCents: 50000,
    refundedCents: 0,
    unreadable: false,
    ...over,
  };
}

function deduction(over: Partial<LedgerDeduction> = {}): LedgerDeduction {
  return { id: "ded-1", rentalId: "rental-1", amountCents: 0, unreadable: false, ...over };
}

const people = [{ id: "driver-1", name: 'Ada, "Bee"' }];
const vehicles = [{ id: "vehicle-1", label: "Unit 7 · Civic" }];

function ledger(rentals: LedgerRental[], payments: LedgerPayment[] = [], deductions: LedgerDeduction[] = []) {
  return buildDepositLedger({ today: TODAY, rentals, payments, deductions, people, vehicles });
}

it("throws before any read when the flag is off", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  await expect(runDepositLedger({ enabled: false, userId: "owner", tier: "owner", today: TODAY, load })).rejects.toThrow(DEPOSIT_LEDGER_OFF);
  expect(load).not.toHaveBeenCalled();
});

it("refuses a coordinator and a missing user before any read", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  await expect(runDepositLedger({ enabled: true, userId: "coord", tier: "coordinator", today: TODAY, load })).rejects.toThrow("Forbidden");
  await expect(runDepositLedger({ enabled: true, userId: null, tier: "owner", today: TODAY, load })).rejects.toThrow("Forbidden");
  expect(load).not.toHaveBeenCalled();
});

it("lets an owner and a manager read an empty ledger", async () => {
  const load = vi.fn(async () => ({ ok: true as const, rentals: [], payments: [], deductions: [], people: [], vehicles: [] }));
  for (const tier of ["owner", "manager"] as const) {
    const result = await runDepositLedger({ enabled: true, userId: tier, tier, today: TODAY, load });
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.report.heldCents).toBe(0);
      expect(result.report.dueBackCents).toBe(0);
      expect(result.report.omitted[0]).toContain("no Stripe list is called");
    }
  }
  expect(load).toHaveBeenCalledTimes(2);
});

it("splits held and due back on the Eastern Time 7 day boundary", () => {
  expect(addCalendarDays(TODAY, 7)).toBe("2026-10-28");
  const report = ledger(
    [
      rental({ id: "held", endDate: "2026-10-29" }),
      rental({ id: "window", endDate: "2026-10-28", expectedCents: 20000 }),
      rental({ id: "ended", status: "completed", endDate: "2026-11-15", expectedCents: 10000 }),
      rental({ id: "past", endDate: "2026-10-20", expectedCents: 5000 }),
    ],
    [
      payment({ rentalId: "held" }),
      payment({ id: "pay-window", rentalId: "window", amountCents: 20000, netCollectedCents: 20000 }),
      payment({ id: "pay-ended", rentalId: "ended", amountCents: 10000, netCollectedCents: 10000 }),
      payment({ id: "pay-past", rentalId: "past", amountCents: 5000, netCollectedCents: 5000 }),
    ],
  );
  expect(report).not.toBeNull();
  const state = (id: string) => report!.rows.find((row) => row.rentalId === id);
  expect(state("held")?.state).toBe("held");
  expect(state("window")?.state).toBe("due_back");
  expect(state("ended")?.state).toBe("due_back");
  expect(state("ended")?.evidence.join(" ")).toContain("already ended");
  expect(state("past")?.state).toBe("due_back");
  expect(state("past")?.evidence.join(" ")).toContain("already past");
  expect(report!.heldCents).toBe(50000);
  expect(report!.dueBackCents).toBe(35000);
  expect(report!.dueThrough).toBe("2026-10-28");
});

it("keeps a database mismatch as evidence and does not change the input", () => {
  const source = rental({ id: "mismatch", depositHeld: true, expectedCents: 30000, endDate: null });
  const before = structuredClone(source);
  const paid = payment({ rentalId: "mismatch", status: "failed", amountCents: 30000, netCollectedCents: null, refundedCents: 0 });
  const report = ledger([source], [paid]);
  expect(source).toEqual(before);
  expect(report!.rows).toHaveLength(1);
  expect(report!.rows[0].state).toBe("unknown");
  expect(report!.rows[0].evidence.join(" ")).toContain("Deposit Held is true and no paid deposit payment is on file.");
  expect(report!.heldCents).toBe(0);
  expect(report!.dueBackCents).toBe(0);

  const disagreed = rental({ id: "held-false", depositHeld: false, endDate: "2026-10-22" });
  const disagreedBefore = structuredClone(disagreed);
  const disagreedReport = ledger([disagreed], [payment({ rentalId: "held-false" })]);
  expect(disagreed).toEqual(disagreedBefore);
  expect(disagreedReport!.rows[0].state).toBe("unknown");
  expect(disagreedReport!.rows[0].evidence.join(" ")).toContain("Deposit Held is false and a paid deposit payment is on file.");
  expect(disagreedReport!.dueBackCents).toBe(0);
});

it("uses net collected once and notes when the rental also records a refund", () => {
  const report = ledger(
    [rental({ expectedCents: 10000, refundCents: 4000, endDate: "2026-12-01" })],
    [payment({ amountCents: 10000, netCollectedCents: 6000, refundedCents: 4000 })],
  );
  const row = report!.rows[0];
  expect(row.collectedCents).toBe(6000);
  expect(row.remainingCents).toBe(2000);
  expect(row.state).toBe("held");
  expect(row.evidence.join(" ")).toContain("both record a deposit refund");
  expect(report!.heldCents).toBe(2000);
});

it("flags an expected amount that differs and still counts the collected remainder as held", () => {
  const report = ledger(
    [rental({ expectedCents: 50000, endDate: "2026-12-01" })],
    [payment({ amountCents: 45000, netCollectedCents: 45000 })],
    [deduction({ amountCents: 5000 })],
  );
  expect(report!.rows[0].state).toBe("held");
  expect(report!.rows[0].remainingCents).toBe(40000);
  expect(report!.rows[0].evidence.join(" ")).toContain("Expected deposit and collected deposit differ.");
  expect(report!.heldCents).toBe(40000);
});

it("leaves a refunded deposit out of the held and due totals", () => {
  const report = ledger(
    [rental({ depositStatus: "refunded", depositHeld: false, refundCents: 50000, endDate: "2026-10-01" })],
    [payment()],
  );
  expect(report!.rows[0].state).toBe("refunded");
  expect(report!.heldCents).toBe(0);
  expect(report!.dueBackCents).toBe(0);
});

it("does not treat a rent payment or a payment with no rental as held", () => {
  const report = ledger(
    [rental({ id: "open", endDate: "2026-12-01" })],
    [
      payment({ rentalId: "open" }),
      payment({ id: "rent", rentalId: "open", type: "rent", amountCents: 99900, netCollectedCents: 99900 }),
      payment({ id: "loose", rentalId: null, applicationId: "driver-1", amountCents: 2500, netCollectedCents: 2500 }),
    ],
  );
  const open = report!.rows.find((row) => row.rentalId === "open");
  const loose = report!.rows.find((row) => row.rentalId == null);
  expect(open?.collectedCents).toBe(50000);
  expect(open?.state).toBe("held");
  expect(loose?.state).toBe("unknown");
  expect(loose?.evidence.join(" ")).toContain("no rental");
  expect(report!.heldCents).toBe(50000);
});

it("withholds totals when the read is capped", async () => {
  const result = await runDepositLedger({
    enabled: true,
    userId: "manager",
    tier: "manager",
    today: TODAY,
    load: async () => ({ ok: false, capped: true }),
  });
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.report.rows).toEqual([]);
    expect(result.report.heldCents).toBeNull();
    expect(result.report.dueBackCents).toBeNull();
    expect(result.report.warnings[0]).toContain("page cap");
  }
});

it("escapes commas, quotes, and formula text in the csv", () => {
  const report = ledger(
    [rental({ endDate: "2026-12-01" })],
    [payment()],
  );
  report!.rows[0].renter = '=Ada, "Bee"';
  const csv = depositLedgerToCsv(report!);
  expect(csv).toContain(`"'=Ada, ""Bee"""`);
  expect(csv).toContain("Deposits Held,500.00");
  expect(csv).toContain("no Stripe list is called");
});

it("reads Eastern Time, not the UTC date, around midnight", () => {
  expect(etToday(new Date("2026-10-21T03:30:00Z"))).toBe("2026-10-20");
  expect(etToday(new Date("2026-10-21T04:30:00Z"))).toBe("2026-10-21");
});

it("keeps Deposit Ledger out of the dark nav and behind the throw", () => {
  const flag = readFileSync("src/lib/deposit-ledger-flag.ts", "utf8");
  const fn = readFileSync("src/lib/deposit-ledger.functions.ts", "utf8");
  const server = readFileSync("src/lib/deposit-ledger.server.ts", "utf8");
  const pure = readFileSync("src/lib/deposit-ledger.ts", "utf8");
  const panel = readFileSync("src/components/admin/DepositLedgerPanel.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const disabled = fn.indexOf("if (!DEPOSIT_LEDGER_ENABLED) throw new Error(DEPOSIT_LEDGER_OFF);");
  const manager = fn.indexOf("await requireManager(context.userId)");
  const table = fn.indexOf("loadDepositLedger(");
  expect(flag).toContain("export const DEPOSIT_LEDGER_ENABLED = false");
  expect(disabled).toBeGreaterThan(-1);
  expect(manager).toBeGreaterThan(disabled);
  expect(table).toBeGreaterThan(manager);
  expect(tabs).not.toContain("deposit_ledger");
  expect(TABS.some((tab) => tab.id === "deposit_ledger")).toBe(false);
  for (const tier of ["owner", "manager", "coordinator"] as const) {
    expect(visibleTabs(tier).some((tab) => tab.id === "deposit_ledger")).toBe(false);
    expect(railEntries(tier).some((entry) => entry.id === "deposit_ledger")).toBe(false);
  }
  expect(admin.indexOf('urlTab === "deposit_ledger"')).toBeGreaterThan(-1);
  expect(admin.indexOf('urlTab === "deposit_ledger"')).toBeLessThan(admin.indexOf("TABS.some"));
  expect(admin).toContain('DEPOSIT_LEDGER_ENABLED && tab === "deposit_ledger"');
  expect(server).toContain("deposit_amount,deposit_held,deposit_status,deposit_refund_amount");
  expect(server).not.toContain("stripe_");
  for (const source of [flag, fn, server, pure, panel]) {
    expect(source).not.toMatch(/from ["'].*stripe/);
    expect(source).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  }
});
