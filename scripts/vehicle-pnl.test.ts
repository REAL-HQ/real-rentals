import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { monthWindow } from "../src/lib/owner-pnl";
import { verifyCollectedCharges } from "../src/lib/stripe-collections";
import { VEHICLE_PNL_ENABLED } from "../src/lib/vehicle-pnl-flag";
import {
  VEHICLE_PNL_MAX_PAGES,
  VEHICLE_PNL_PAGE,
  VEHICLE_PNL_STRIPE_NOTE,
  VEHICLE_PNL_TRUNCATED_NOTE,
  buildVehiclePnl,
  type VehiclePnlCharge,
  type VehiclePnlPayment,
  type VehiclePnlWindow,
} from "../src/lib/vehicle-pnl";
import { loadVehiclePnl, readPages, runVehiclePnl, type VehiclePnlClient } from "../src/lib/vehicle-pnl.server";

const window = monthWindow("2026-10");
if (!window) throw new Error("October window");
const OCTOBER: VehiclePnlWindow = window;

const caps = {
  vehicles: false,
  rentals: false,
  payments: false,
  expenses: false,
  tolls: false,
  maintenance: false,
};

const vehicle = {
  id: "veh-1",
  year: 2020,
  make: "Honda",
  model: "Civic",
  licensePlate: "ABC",
};

function payment(extra: Partial<VehiclePnlPayment> & { id: string }): VehiclePnlPayment {
  return {
    rentalId: null,
    vehicleId: "veh-1",
    status: "paid",
    type: "rent",
    netCollected: "0.00",
    paidDate: "2026-10-09",
    stripePaymentIntentId: null,
    stripeInvoiceId: null,
    ...extra,
  };
}

function charge(extra: Partial<VehiclePnlCharge> = {}): VehiclePnlCharge {
  return {
    id: "ch_1",
    paymentIntentId: "pi_1",
    invoiceId: null,
    currency: "usd",
    amount: 10000,
    created: OCTOBER.gte + 3600,
    paid: true,
    captured: true,
    status: "succeeded",
    fee: 300,
    ...extra,
  };
}

function report(extra: Partial<Parameters<typeof buildVehiclePnl>[0]> = {}) {
  return buildVehiclePnl({
    window: OCTOBER,
    vehicles: [vehicle],
    rentals: [],
    payments: [],
    expenses: [],
    tolls: [],
    maintenance: [],
    stripe: { ok: true, truncated: false, charges: [], refunds: [] },
    caps,
    ...extra,
  });
}

describe("vehicle profit amounts", () => {
  it("uses verified Stripe net plus non-Stripe net collected, and does not double count", () => {
    const result = report({
      payments: [
        payment({ id: "p-cash", netCollected: "45.00" }),
        payment({ id: "p-card", netCollected: "100.00", stripePaymentIntentId: "pi_1" }),
      ],
      stripe: { ok: true, truncated: false, charges: [charge()], refunds: [] },
      expenses: [
        {
          id: "e-1",
          vehicleId: "veh-1",
          category: "insurance",
          amount: "10.00",
          incurredOn: "2026-10-04",
          maintenanceRecordId: null,
        },
      ],
      tolls: [{ id: "t-1", vehicleId: "veh-1", chargeType: "toll", occurredAt: "2026-10-05", amount: "2.50" }],
      maintenance: [
        {
          id: "m-1",
          vehicleId: "veh-1",
          companyShare: "4.00",
          totalCost: "99.00",
          performedOn: "2026-10-06",
          completedAt: null,
          createdAt: null,
        },
      ],
    });
    const row = result.rows[0];
    expect(row?.label).toBe("2020 Honda Civic · ABC");
    expect(row?.revenueCents).toBe(14200);
    expect(row?.expenses).toEqual([{ category: "insurance", label: "Insurance", cents: 1000 }]);
    expect(row?.expenseCents).toBe(1000);
    expect(row?.tollsTicketsCents).toBe(250);
    expect(row?.maintenanceCents).toBe(400);
    expect(row?.netCents).toBe(12550);
    expect(result.unattributed.revenueCents).toBe(0);
  });

  it("leaves a blank collected amount Unknown", () => {
    const row = report({ payments: [payment({ id: "p-1", netCollected: null })] }).rows[0];
    expect(row?.revenueCents).toBeNull();
    expect(row?.netCents).toBeNull();
    expect(row?.expenseCents).toBe(0);
  });

  it("leaves revenue Unknown when Stripe cannot be read", () => {
    const result = report({
      payments: [payment({ id: "p-1", netCollected: "45.00" })],
      stripe: { ok: false, truncated: false },
      expenses: [
        {
          id: "e-1",
          vehicleId: "veh-1",
          category: "repair",
          amount: "10.00",
          incurredOn: "2026-10-04",
          maintenanceRecordId: null,
        },
      ],
    });
    expect(result.rows[0]?.revenueCents).toBeNull();
    expect(result.rows[0]?.expenseCents).toBe(1000);
    expect(result.rows[0]?.netCents).toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.notes).toContain(VEHICLE_PNL_STRIPE_NOTE);
  });

  it("does not keep a partial sum when the payment read is truncated", () => {
    const result = report({
      caps: { ...caps, payments: true },
      payments: [payment({ id: "p-1", netCollected: "45.00" })],
    });
    expect(result.truncated).toBe(true);
    expect(result.rows[0]?.revenueCents).toBeNull();
    expect(result.notes).toContain(VEHICLE_PNL_TRUNCATED_NOTE);
  });

  it("uses total cost when the maintenance share is blank, and Unknown when both are blank", () => {
    const known = report({
      maintenance: [
        {
          id: "m-1",
          vehicleId: "veh-1",
          companyShare: null,
          totalCost: "8.00",
          performedOn: "2026-10-06",
          completedAt: null,
          createdAt: null,
        },
      ],
    });
    expect(known.rows[0]?.maintenanceCents).toBe(800);
    const blank = report({
      maintenance: [
        {
          id: "m-2",
          vehicleId: "veh-1",
          companyShare: "",
          totalCost: null,
          performedOn: "2026-10-06",
          completedAt: null,
          createdAt: null,
        },
      ],
    });
    expect(blank.rows[0]?.maintenanceCents).toBeNull();
    expect(blank.rows[0]?.netCents).toBeNull();
  });

  it("counts a linked service once, on the expense", () => {
    const result = report({
      expenses: [
        {
          id: "e-1",
          vehicleId: "veh-1",
          category: "maintenance",
          amount: "10.00",
          incurredOn: "2026-10-04",
          maintenanceRecordId: "m-1",
        },
      ],
      maintenance: [
        {
          id: "m-1",
          vehicleId: "veh-1",
          companyShare: "4.00",
          totalCost: "4.00",
          performedOn: "2026-10-04",
          completedAt: null,
          createdAt: null,
        },
      ],
    });
    expect(result.rows[0]?.expenseCents).toBe(1000);
    expect(result.rows[0]?.maintenanceCents).toBe(0);
    expect(result.rows[0]?.netCents).toBe(-1000);
  });

  it("excludes a deposit and a fee payment from verified revenue", () => {
    const result = report({
      payments: [
        payment({ id: "p-dep", type: "deposit", netCollected: "50.00" }),
        payment({ id: "p-fee", type: "fee", netCollected: "9.00" }),
      ],
    });
    expect(result.rows[0]?.revenueCents).toBe(0);
    expect(result.rows[0]?.netCents).toBe(0);
  });

  it("excludes a Stripe deposit charge from verified revenue", () => {
    const result = report({
      payments: [payment({ id: "p-dep", type: "deposit", stripePaymentIntentId: "pi_dep", netCollected: "50.00" })],
      stripe: {
        ok: true,
        truncated: false,
        charges: [charge({ id: "ch_dep", paymentIntentId: "pi_dep", amount: 5000, fee: 100 })],
        refunds: [],
      },
    });
    expect(result.rows[0]?.revenueCents).toBe(0);
    expect(result.rows[0]?.netCents).toBe(0);
  });

  it("keeps revenue known when the payment is in the month and the charge was captured earlier", () => {
    const result = report({
      payments: [payment({ id: "p-1", stripePaymentIntentId: "pi_old", netCollected: "100.00", paidDate: "2026-10-09" })],
      stripe: {
        ok: true,
        truncated: false,
        charges: [charge({ id: "ch_old", paymentIntentId: "pi_old", created: OCTOBER.gte - 86400 })],
        refunds: [],
      },
    });
    expect(result.rows[0]?.revenueCents).toBe(0);
    expect(result.unattributed.revenueCents).toBe(0);
  });

  it("does not add a payment that shares only a Stripe invoice with the charge", () => {
    const matched = report({
      payments: [payment({ id: "p-1", stripePaymentIntentId: null, stripeInvoiceId: "in_1", netCollected: "100.00" })],
      stripe: {
        ok: true,
        truncated: false,
        charges: [charge({ invoiceId: "in_1", paymentIntentId: "pi_other" })],
        refunds: [],
      },
    });
    expect(matched.rows[0]?.revenueCents).toBe(9700);
    const earlier = report({
      payments: [payment({ id: "p-2", stripePaymentIntentId: null, stripeInvoiceId: "in_old", netCollected: "100.00" })],
    });
    expect(earlier.rows[0]?.revenueCents).toBe(0);
  });

  it("attributes a payment through its rental", () => {
    const result = report({
      rentals: [{ id: "r-1", vehicleId: "veh-1" }],
      payments: [payment({ id: "p-1", vehicleId: null, rentalId: "r-1", netCollected: "12.00" })],
    });
    expect(result.rows[0]?.revenueCents).toBe(1200);
  });

  it("keeps an unreadable expense Unknown and ignores a bad amount outside the month", () => {
    const bad = report({
      expenses: [
        {
          id: "e-bad",
          vehicleId: "veh-1",
          category: "tires",
          amount: "nope",
          incurredOn: "2026-10-04",
          maintenanceRecordId: null,
        },
      ],
    });
    expect(bad.rows[0]?.expenses).toEqual([{ category: "tires", label: "Tires", cents: null }]);
    expect(bad.rows[0]?.expenseCents).toBeNull();
    expect(bad.rows[0]?.netCents).toBeNull();
    const outside = report({
      expenses: [
        {
          id: "e-old",
          vehicleId: "veh-1",
          category: "tires",
          amount: "nope",
          incurredOn: "2026-09-02",
          maintenanceRecordId: null,
        },
        {
          id: "e-now",
          vehicleId: "veh-1",
          category: "fuel",
          amount: "3.00",
          incurredOn: "2026-10-02",
          maintenanceRecordId: null,
        },
      ],
    });
    expect(outside.rows[0]?.expenseCents).toBe(300);
  });

  it("withholds revenue for a repeated payment id", () => {
    const result = report({
      payments: [payment({ id: "p-1", netCollected: "5.00" }), payment({ id: "p-1", netCollected: "5.00" })],
    });
    expect(result.rows[0]?.revenueCents).toBeNull();
  });

  it("puts a charge claimed by two vehicles on Unattributed", () => {
    const result = report({
      vehicles: [vehicle, { ...vehicle, id: "veh-2", make: "Toyota", model: "Camry", licensePlate: null }],
      payments: [
        payment({ id: "p-1", vehicleId: "veh-1", stripePaymentIntentId: "pi_1" }),
        payment({ id: "p-2", vehicleId: "veh-2", stripePaymentIntentId: "pi_1" }),
      ],
      stripe: { ok: true, truncated: false, charges: [charge()], refunds: [] },
    });
    expect(result.rows.every((row) => row.revenueCents === 0)).toBe(true);
    expect(result.unattributed.revenueCents).toBe(9700);
  });

  it("leaves a non-USD charge and a missing fee Unknown", () => {
    const linked = [payment({ id: "p-1", stripePaymentIntentId: "pi_1", netCollected: "100.00" })];
    expect(
      report({ payments: linked, stripe: { ok: true, truncated: false, charges: [charge({ currency: "eur" })], refunds: [] } }).rows[0]?.revenueCents,
    ).toBeNull();
    expect(
      report({ payments: linked, stripe: { ok: true, truncated: false, charges: [charge({ fee: null })], refunds: [] } }).rows[0]?.revenueCents,
    ).toBeNull();
  });

  it("subtracts an in-month refund and its fee", () => {
    const result = report({
      payments: [payment({ id: "p-1", stripePaymentIntentId: "pi_1", netCollected: "100.00" })],
      stripe: {
        ok: true,
        truncated: false,
        charges: [charge({ fee: 200 })],
        refunds: [
          {
            id: "re_1",
            chargeId: "ch_1",
            currency: "usd",
            amount: 500,
            created: OCTOBER.gte + 7200,
            status: "succeeded",
            fee: 50,
          },
        ],
      },
    });
    expect(result.rows[0]?.revenueCents).toBe(9250);
  });

  it("places a timestamp on the Eastern Time day", () => {
    const before = report({
      payments: [payment({ id: "p-early", paidDate: "2026-10-01T03:00:00.000Z", netCollected: "5.00" })],
    });
    const onDay = report({
      payments: [payment({ id: "p-day", paidDate: "2026-10-01T04:00:00.000Z", netCollected: "5.00" })],
    });
    expect(before.rows[0]?.revenueCents).toBe(0);
    expect(onDay.rows[0]?.revenueCents).toBe(500);
  });

  it("shows a quiet vehicle as zero, not Unknown", () => {
    const row = report().rows[0];
    expect(row?.revenueCents).toBe(0);
    expect(row?.expenseCents).toBe(0);
    expect(row?.tollsTicketsCents).toBe(0);
    expect(row?.maintenanceCents).toBe(0);
    expect(row?.netCents).toBe(0);
  });

  it("counts a citation and skips a charge that is not a toll or ticket", () => {
    const result = report({
      tolls: [
        { id: "t-1", vehicleId: "veh-1", chargeType: "citation", occurredAt: "2026-10-08", amount: "15.00" },
        { id: "t-2", vehicleId: "veh-1", chargeType: "other", occurredAt: "2026-10-08", amount: "7.00" },
      ],
    });
    expect(result.rows[0]?.tollsTicketsCents).toBe(1500);
  });
});

function queryChain(limit: (count: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>) {
  const api = {
    order() {
      return api;
    },
    gt() {
      return api;
    },
    gte() {
      return api;
    },
    lt() {
      return api;
    },
    or() {
      return api;
    },
    in() {
      return api;
    },
    limit,
  };
  return api;
}

describe("vehicle profit reads", () => {
  it("stops at limit plus one and reports a truncated page", async () => {
    let issued = 0;
    const client: VehiclePnlClient = {
      from() {
        return {
          select() {
            return queryChain((count: number) => {
              expect(count).toBe(VEHICLE_PNL_PAGE + 1);
              const rows = Array.from({ length: count }, (_, index) => {
                issued += 1;
                return { id: String(issued).padStart(8, "0"), status: "paid", type: "rent" };
              });
              return Promise.resolve({ data: rows, error: null });
            });
          },
        };
      },
    };
    const page = await readPages(client, "payments", "id");
    expect(page?.truncated).toBe(true);
    expect(page?.rows).toHaveLength(VEHICLE_PNL_PAGE * VEHICLE_PNL_MAX_PAGES);
  });

  it("does not call Stripe when a table read fails", async () => {
    const stripe = vi.fn();
    const client: VehiclePnlClient = {
      from() {
        return {
          select() {
            return queryChain(() => Promise.resolve({ data: null, error: { message: "down" } }));
          },
        };
      },
    };
    await expect(loadVehiclePnl(client, stripe, "2026-10")).resolves.toBeNull();
    expect(stripe).not.toHaveBeenCalled();
  });

  it("asks Stripe for the month window after the tables come back", async () => {
    const stripe = vi.fn(async () => ({ ok: true, truncated: false, charges: [], refunds: [] }));
    const client: VehiclePnlClient = {
      from(table: string) {
        return {
          select() {
            return queryChain(() => {
              const row =
                table === "vehicles"
                  ? { id: "veh-1", year: 2020, make: "Honda", model: "Civic", license_plate: "ABC" }
                  : { id: `${table}-1`, status: "paid", type: "rent", charge_type: "toll" };
              return Promise.resolve({ data: [row], error: null });
            });
          },
        };
      },
    };
    const loaded = await loadVehiclePnl(client, stripe, "2026-10");
    expect(loaded?.caps.payments).toBe(false);
    expect(stripe).toHaveBeenCalledTimes(1);
    const bounds = stripe.mock.calls[0]?.[0] as { gte: number; lt: number };
    expect(bounds).toEqual({ gte: OCTOBER.gte, lt: OCTOBER.lt });
  });

  it("filters money tables to the month and leaves the vehicle directory unfiltered", async () => {
    const calls: string[] = [];
    const client: VehiclePnlClient = {
      from(table: string) {
        return {
          select() {
            const api = {
              order() {
                return api;
              },
              gt() {
                return api;
              },
              gte(column: string, value: string) {
                calls.push(`${table}.gte.${column}.${value}`);
                return api;
              },
              lt(column: string, value: string) {
                calls.push(`${table}.lt.${column}.${value}`);
                return api;
              },
              or(filters: string) {
                calls.push(`${table}.or.${filters}`);
                return api;
              },
              in() {
                return api;
              },
              limit() {
                const row =
                  table === "vehicles"
                    ? { id: "veh-1", year: 2020, make: "Honda", model: "Civic", license_plate: "ABC" }
                    : { id: `${table}-1`, status: "paid", type: "rent", charge_type: "toll" };
                return Promise.resolve({ data: [row], error: null });
              },
            };
            return api;
          },
        };
      },
    };
    const loaded = await loadVehiclePnl(client, async () => ({ ok: true, truncated: false, charges: [], refunds: [] }), "2026-10");
    expect(loaded?.payments).toHaveLength(1);
    expect(calls.some((call) => call.startsWith("vehicles."))).toBe(false);
    expect(calls).toContain("vehicle_expenses.gte.incurred_on.2026-09-30");
    expect(calls).toContain("vehicle_expenses.lt.incurred_on.2026-11-02");
    expect(calls).toContain("toll_charges.gte.occurred_at.2026-09-30");
    expect(calls).toContain("payments.gte.paid_date.2026-09-30");
    expect(calls.some((call) => call.startsWith("maintenance_records.or.") && call.includes("performed_on") && call.includes("completed_at") && call.includes("created_at"))).toBe(true);
  });
});

describe("shared Stripe verification", () => {
  const gte = Date.parse("2026-10-15T00:00:00Z") / 1000;
  const lt = Date.parse("2026-10-17T00:00:00Z") / 1000;
  const owned = {
    invoicePayments: [{ id: "ip", invoiceId: "in", intentId: "pi", chargeId: "ch", externalRecord: false }],
    invoices: [{ id: "in", customerId: "cus", subscriptionId: "sub" }],
    subscriptions: [{ id: "sub", customerId: "cus" }],
  };
  function charge(extra: Record<string, unknown> = {}) {
    return {
      id: "ch",
      customerId: "cus",
      paymentIntentId: "pi",
      currency: "usd",
      amountCaptured: 35000,
      paid: true,
      captured: true,
      status: "succeeded",
      created: gte + 10,
      balance: { created: gte + 10, currency: "usd", amount: 35000, fee: 1045 },
      ...extra,
    };
  }
  function verify(charges: ReturnType<typeof charge>[], refunds: Parameters<typeof verifyCollectedCharges>[0]["refunds"] = []) {
    return verifyCollectedCharges({ window: { gte, lt }, ...owned, charges, refunds });
  }

  it("dates cash by capture time and checks settlement amount, ownership, and bad refunds", () => {
    const dated = verify([charge({ created: gte - 604800, balance: { created: gte + 10, currency: "usd", amount: 35000, fee: 1045 } })]);
    expect(dated.collectionsComplete).toBe(true);
    expect(dated.charges[0]?.created).toBe(gte + 10);
    const unowned = verifyCollectedCharges({
      window: { gte, lt },
      invoicePayments: [],
      invoices: [],
      subscriptions: [],
      charges: [charge()],
      refunds: [],
    });
    expect(unowned.collectionsComplete).toBe(false);
    expect(unowned.charges).toEqual([]);
    const mismatched = verify([charge({ balance: { created: gte + 10, currency: "usd", amount: 10000, fee: 1045 } })]);
    expect(mismatched.collectionsComplete).toBe(false);
    expect(mismatched.charges).toEqual([]);
    const badRefund = verify([charge()], [{ id: "re", chargeId: "ch_missing", created: gte + 20, currency: "usd", amount: 500, status: "succeeded", fee: 0 }]);
    expect(badRefund.collectionsComplete).toBe(false);
    expect(badRefund.incompletePortions.some((portion) => portion.source === "Refund" && portion.id === "re")).toBe(true);
  });
});

describe("vehicle profit access", () => {
  it("stays off, is declared once, and returns before the role check and any read", async () => {
    expect(VEHICLE_PNL_ENABLED).toBe(false);
    const flag = readFileSync(new URL("../src/lib/vehicle-pnl-flag.ts", import.meta.url), "utf8");
    expect(flag).toMatch(/export const VEHICLE_PNL_ENABLED = false/);
    expect(flag.match(/VEHICLE_PNL_ENABLED\s*=/g)).toHaveLength(1);
    expect(flag).not.toMatch(/process\.env/);
    const handler = readFileSync(new URL("../src/lib/vehicle-pnl.functions.ts", import.meta.url), "utf8");
    const gate = handler.indexOf("if (!VEHICLE_PNL_ENABLED) return DISABLED");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(handler.indexOf('await import("@/lib/roles.server")'));
    expect(gate).toBeLessThan(handler.indexOf('"./vehicle-pnl.server"'));
    expect(gate).toBeLessThan(handler.indexOf('"./vehicle-pnl-stripe.server"'));
    const sources = [
      "src/lib/vehicle-pnl.ts",
      "src/lib/vehicle-pnl.server.ts",
      "src/lib/vehicle-pnl.functions.ts",
      "src/lib/vehicle-pnl-stripe.server.ts",
      "src/components/admin/ExpenseCategoriesPanel.tsx",
      "src/components/admin/VehiclePnlSection.tsx",
      "src/routes/admin.tsx",
      "src/components/admin/nav-config.ts",
    ];
    for (const path of sources) {
      const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      expect(text).not.toMatch(/export const VEHICLE_PNL_ENABLED/);
      expect(text).not.toMatch(/process\.env\.VEHICLE_PNL_ENABLED/);
    }
    const panel = readFileSync(new URL("../src/components/admin/ExpenseCategoriesPanel.tsx", import.meta.url), "utf8");
    expect(panel).toMatch(/VEHICLE_PNL_ENABLED && <VehiclePnlSection \/>/);
    const section = readFileSync(new URL("../src/components/admin/VehiclePnlSection.tsx", import.meta.url), "utf8");
    expect(section).toContain("Unknown");
    expect(section).not.toMatch(/text-transform/);
    expect(section).toContain("Verified Revenue");
    expect(section).toContain("Tolls And Tickets");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(admin).not.toContain("VEHICLE_PNL_ENABLED");
    expect(admin).not.toContain("vehicle_pnl");
    const stripe = readFileSync(new URL("../src/lib/vehicle-pnl-stripe.server.ts", import.meta.url), "utf8");
    expect(stripe).toContain("createReadOnlyStripe");
    expect(stripe).toContain("verifyCollectedCharges");
    expect(stripe).toContain("lt: window.lt");
    expect(stripe).not.toMatch(/\.create\(/);
    expect(stripe).not.toContain("amount_captured ??");
    const formula = readFileSync(new URL("../src/lib/vehicle-pnl.ts", import.meta.url), "utf8");
    expect(formula).toContain("aggregateCollections");
    expect(formula).toContain("consolidatedRevenue");
    expect(formula).not.toContain("add(target.revenue, charge.amount)");
    const shared = readFileSync(new URL("../src/lib/stripe-collections.ts", import.meta.url), "utf8");
    expect(shared).toContain("export function verifyCollectedCharges");
    expect(shared).toContain("balance.amount !==");
    const collections = readFileSync(new URL("../src/lib/stripe-collections.server.ts", import.meta.url), "utf8");
    expect(collections).toContain("verifyCollectedCharges");
    const server = readFileSync(new URL("../src/lib/vehicle-pnl.server.ts", import.meta.url), "utf8");
    expect(server).not.toContain("createReadOnlyStripe");
    expect(server).toContain("stripe_invoice_id");
    expect(server).toContain('dated("paid_date")');
    expect(server).toContain('dated("incurred_on")');
    expect(server).toContain('dated("occurred_at")');
    expect(server).toContain("performed_on");
    const load = vi.fn();
    await expect(
      runVehiclePnl({ enabled: false, userId: "owner-1", tier: "owner", month: "2026-10", load }),
    ).resolves.toEqual({ status: "disabled", report: null });
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses a coordinator before the read", async () => {
    const load = vi.fn();
    await expect(
      runVehiclePnl({ enabled: true, userId: "coord-1", tier: "coordinator", month: "2026-10", load }),
    ).rejects.toThrow("Forbidden");
    expect(load).not.toHaveBeenCalled();
  });

  it("lets a manager read", async () => {
    const load = vi.fn(async () => ({
      vehicles: [vehicle],
      rentals: [],
      payments: [],
      expenses: [],
      tolls: [],
      maintenance: [],
      stripe: { ok: true as const, truncated: false, charges: [], refunds: [] },
      caps,
    }));
    const result = await runVehiclePnl({
      enabled: true,
      userId: "manager-1",
      tier: "manager",
      month: "2026-10",
      load,
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.report.rows[0]?.netCents).toBe(0);
  });
});
