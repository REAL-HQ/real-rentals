import { describe, expect, test } from "bun:test";
import { monthWindow, type OwnerCharge, type OwnerPnlDirectory } from "../src/lib/owner-pnl";
import { buildOwnerPnlView, ownerPnlViewCsv, resolvePnlRange } from "../src/lib/owner-pnl-range";
import type { OwnerFeeTxn } from "../src/lib/owner-pnl-fees";

const NOW = new Date("2026-10-21T15:00:00Z");

function directory(): OwnerPnlDirectory {
  return {
    payments: [
      { id: "pay1", vehicleId: "v1", driverId: "d1", rentalId: "rent1", type: "rent", status: "paid", paymentMethod: "card", amount: "350.00", paidDate: "2026-10-04", paymentIntentId: "pi_v1", invoiceId: null, subscriptionId: null },
      { id: "pay2", vehicleId: "v2", driverId: "d2", rentalId: "rent2", type: "rent", status: "paid", paymentMethod: "cash_app", amount: "80.00", paidDate: "2026-10-08", paymentIntentId: null, invoiceId: null, subscriptionId: null },
      { id: "pay3", vehicleId: "v1", driverId: "d1", rentalId: "rent1", type: "deposit", status: "paid", paymentMethod: "card", amount: "200.00", paidDate: "2026-10-02", paymentIntentId: "pi_dep", invoiceId: null, subscriptionId: null },
      { id: "pay4", vehicleId: null, driverId: null, type: "rent", status: "paid", paymentMethod: "zelle", amount: "40.00", paidDate: "2026-10-09", paymentIntentId: null, invoiceId: null, subscriptionId: null },
      { id: "pay5", vehicleId: "v1", driverId: "d1", rentalId: "rent1", type: "rent", status: "overdue", amount: "60.00", balanceDue: "60.00", dueDate: "2026-10-01", paymentIntentId: null, invoiceId: null, subscriptionId: null },
      { id: "pay6", vehicleId: "v2", driverId: "d2", rentalId: "rent2", type: "rent", status: "pending", amount: "25.00", balanceDue: "25.00", dueDate: "2026-10-28", paymentIntentId: null, invoiceId: null, subscriptionId: null },
    ],
    rentals: [
      { id: "rent1", vehicleId: "v1", customerId: null, subscriptionId: null, driverId: "d1", applicationId: "app1", startDate: "2026-10-01", endDate: "2026-10-10", status: "ended", depositHeld: true, depositAmount: "200.00", depositRefundAmount: "0", depositStatus: "held" },
      { id: "rent2", vehicleId: "v2", customerId: null, subscriptionId: null, driverId: "d2", applicationId: "app2", startDate: "2026-10-01", endDate: null, status: "active", depositHeld: false, depositAmount: "0", depositStatus: "none" },
    ],
    expenses: [
      { id: "e1", vehicleId: "v1", category: "repair", amount: "10.00", incurredOn: "2026-10-05", maintenanceRecordId: null },
      { id: "e2", vehicleId: "v2", category: "insurance", amount: "5.00", incurredOn: "2026-10-06", maintenanceRecordId: null },
    ],
    maintenance: [],
    refunds: [],
    vehicles: [
      { id: "v1", year: 2019, make: "Toyota", model: "Camry", licensePlate: "AAA111" },
      { id: "v2", year: 2020, make: "Honda", model: "Civic", licensePlate: "BBB222" },
    ],
    people: [
      { driverId: "d1", name: "Avery Stone" },
      { driverId: "d2", name: "Blake Moss" },
    ],
    purchases: [
      { vehicleId: "v1", priceCents: 100000 },
      { vehicleId: "v2", priceCents: null },
    ],
  };
}

function charge(id: string, paymentIntentId: string, amountCents: number, created: number): OwnerCharge {
  return { id, paymentIntentId, amountCents, created, currency: "usd", succeeded: true, customerId: null, invoiceId: null, subscriptionId: null };
}

function fee(cents: number, created: number): OwnerFeeTxn {
  return { id: `fee-${created}`, type: "charge", amount: 1000, fee: cents, net: 1000 - cents, currency: "usd", created };
}

function viewFor(filter: { vehicleId?: string; source?: "stripe" | "cash_app" | "zelle"; category?: string } = {}) {
  const range = resolvePnlRange({ preset: "this_month", now: NOW });
  if (!range) throw new Error("range");
  const october = monthWindow("2026-10")!;
  return buildOwnerPnlView({
    directory: directory(),
    charges: [
      charge("ch1", "pi_v1", 35000, october.gte + 10),
      charge("ch2", "pi_dep", 20000, october.gte + 10),
      charge("ch3", "pi_none", 5000, october.gte + 10),
    ],
    feeTxns: [fee(175, october.gte + 20)],
    range: { preset: "this_month", ...range },
    filter,
    today: "2026-10-21",
    revenueKnown: true,
    allTimeRevenueKnown: true,
    chargesCover: { gte: range.allTime.gte, lt: range.allTime.lt },
  });
}

describe("owner p&l ranges", () => {
  test("presets use Eastern Time and a prior period, except all time", () => {
    const month = resolvePnlRange({ preset: "this_month", now: NOW });
    expect(month?.current).toMatchObject({ from: "2026-10-01", through: "2026-10-31" });
    expect(month?.previous).toMatchObject({ from: "2026-09-01", through: "2026-09-30" });
    const last30 = resolvePnlRange({ preset: "last_30", now: NOW });
    expect(last30?.current).toMatchObject({ from: "2026-09-22", through: "2026-10-21" });
    expect(last30?.previous).toMatchObject({ from: "2026-08-23", through: "2026-09-21" });
    const ytd = resolvePnlRange({ preset: "ytd", now: NOW });
    expect(ytd?.current).toMatchObject({ from: "2026-01-01", through: "2026-10-21" });
    expect(ytd?.previous).toMatchObject({ from: "2025-01-01", through: "2025-10-21" });
    const all = resolvePnlRange({ preset: "all_time", now: NOW });
    expect(all?.previous).toBeNull();
    expect(all?.current.from).toBe("2019-01-01");
    expect(resolvePnlRange({ preset: "custom", now: NOW, from: "2026-10-10", through: "2026-10-01" })).toBeNull();
  });

  test("keeps stripe, recorded cash, and excluded deposits, and filters a car without changing all-time", () => {
    const view = viewFor();
    expect(view?.current.revenueCents).toBe(35000 + 8000 + 4000);
    expect(view?.current.depositsExcludedCents).toBe(20000);
    expect(view?.current.expenseCents).toBe(1500);
    expect(view?.current.feesCents).toBe(175);
    expect(view?.current.netCents).toBe(35000 + 8000 + 4000 - 1500 - 175);
    expect(view?.allTime.revenueCents).toBe(view?.current.revenueCents);
    const camry = view?.cars.find((row) => row.id === "v1");
    expect(camry?.revenueCents).toBe(35000);
    expect(camry?.feesCents).toBeNull();
    expect(camry?.netCents).toBe(34000);
    expect(camry?.daysRented).toBe(10);
    expect(camry?.daysIdle).toBe(21);
    expect(camry?.paybackPct).toBe(34);
    expect(view?.cars.find((row) => row.id === "v2")?.paybackPct).toBeNull();
    const only = viewFor({ vehicleId: "v1" });
    expect(only?.current.revenueCents).toBe(35000);
    expect(only?.cars.map((row) => row.id)).toEqual(["v1"]);
    expect(only?.allTime.revenueCents).toBe(view?.allTime.revenueCents);
    expect(only?.feesInNet).toBe(false);
  });

  test("source and category filters, renter names, receivables, and the unattributed list", () => {
    const cash = viewFor({ source: "cash_app" });
    expect(cash?.current.revenueCents).toBe(8000);
    expect(cash?.current.feesCents).toBe(0);
    const repairs = viewFor({ category: "repair" });
    expect(repairs?.current.expenseCents).toBe(1000);
    const view = viewFor();
    expect(view?.renters.map((row) => row.name)).toContain("Avery Stone");
    expect(view?.renters.find((row) => row.name === "Avery Stone")?.revenueCents).toBe(35000);
    expect(JSON.stringify(view?.renters)).not.toContain("@");
    expect(view?.receivables.overdueCents).toBe(6000);
    expect(view?.receivables.openCents).toBe(2500);
    expect(view?.receivables.unpaidCents).toBe(8500);
    expect(view?.receivables.depositsHeldCents).toBe(20000);
    expect(view?.unattributed).toEqual([
      expect.objectContaining({ date: "2026-10-09", amountCents: 4000, source: "Zelle", reference: "pay4" }),
      expect.objectContaining({ date: "2026-10-01", amountCents: 5000, source: "Stripe", reference: "pi_none" }),
    ]);
    const csv = ownerPnlViewCsv(view!);
    expect(csv).toContain("Avery Stone");
    expect(csv).toContain("All-Time Revenue");
    expect(csv).not.toContain("email");
  });
});
