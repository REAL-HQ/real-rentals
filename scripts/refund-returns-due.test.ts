import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { railEntries } from "@/components/admin/nav-config";
import {
  REFUND_RETURNS_CAPPED,
  applyReturnStripe,
  buildRefundReturns,
  dollarsToCents,
  refundReturnsToCsv,
  type ReturnDeduction,
  type ReturnPayment,
  type ReturnRental,
} from "@/lib/refund-returns-due";
import { REFUND_RETURNS_DUE_OFF } from "@/lib/refund-returns-due-flag";
import { readRefundReturnsStripe, type ReturnStripeGateway } from "@/lib/refund-returns-due-stripe.server";
import { runRefundReturns } from "@/lib/refund-returns-due.server";

const TODAY = "2026-10-21";

function rental(overrides: Partial<ReturnRental> = {}): ReturnRental {
  return {
    id: "rental-1",
    applicationId: "app-1",
    vehicleId: "veh-1",
    vehicleOnFile: true,
    status: "closed",
    endDate: "2026-10-11",
    depositHeld: true,
    depositHeldUnreadable: false,
    depositStatus: "held",
    refundCents: null,
    refundUnreadable: false,
    ...overrides,
  };
}

function payment(overrides: Partial<ReturnPayment> = {}): ReturnPayment {
  return {
    id: "pay-1",
    rentalId: "rental-1",
    type: "deposit",
    status: "paid",
    amountCents: 50000,
    netCollectedCents: 50000,
    refundedCents: 0,
    unreadable: false,
    stripePaymentIntentId: "pi_1",
    ...overrides,
  };
}

function reportFor(input: {
  rentals?: ReturnRental[];
  payments?: ReturnPayment[];
  deductions?: ReturnDeduction[];
  names?: { id: string; name: string }[];
  vehicles?: { id: string; label: string }[];
}) {
  const report = buildRefundReturns({
    today: TODAY,
    rentals: input.rentals ?? [rental()],
    payments: input.payments ?? [payment()],
    deductions: input.deductions ?? [],
    names: input.names ?? [{ id: "app-1", name: "Ada Lovelace" }],
    vehicles: input.vehicles ?? [{ id: "veh-1", label: "Unit 12 · 2020 Toyota Camry" }],
  });
  expect(report).not.toBeNull();
  return report!;
}

it("lists a closed rental with an unreturned deposit and Eastern Time days since close", () => {
  const report = reportFor({});
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0]).toMatchObject({
    renter: "Ada Lovelace",
    vehicle: "Unit 12 · 2020 Toyota Camry",
    rentalLabel: "Closed · 2026-10-11",
    rentalHref: "/admin?tab=bookings&id=rental-1",
    closeDate: "2026-10-11",
    daysSinceClose: 10,
    stillDueCents: 50000,
    depositStatus: "Held",
  });
  expect(report.rows[0].rentalLabel).not.toContain("rental-1");
  expect(report.stillDueCents).toBe(50000);
  expect(report.unknownCount).toBe(0);
});

it("leaves an active rental off the list even when the deposit is still held", () => {
  const report = reportFor({ rentals: [rental({ status: "active", endDate: "2026-10-01" })] });
  expect(report.rows).toEqual([]);
  expect(report.stillDueCents).toBeNull();
});

it("omits a closed rental whose deposit was fully refunded", () => {
  const report = reportFor({
    rentals: [rental({ depositStatus: "refunded", depositHeld: false, refundCents: 50000 })],
    payments: [payment({ status: "refunded", netCollectedCents: 0, refundedCents: 50000 })],
  });
  expect(report.rows).toEqual([]);
});

it("keeps the remainder when only part of the deposit was refunded", () => {
  const report = reportFor({
    rentals: [rental({ depositStatus: "partially_refunded", refundCents: 20000 })],
    payments: [payment({ netCollectedCents: 50000, refundedCents: 0 })],
  });
  expect(report.rows[0].stillDueCents).toBe(30000);
  expect(report.rows[0].daysSinceClose).toBe(10);
});

it("does not shift a stored close date, and converts a timestamp into the Eastern Time day", () => {
  const stored = reportFor({ rentals: [rental({ endDate: "2026-10-11" })] });
  expect(stored.rows[0].closeDate).toBe("2026-10-11");
  expect(stored.rows[0].daysSinceClose).toBe(10);
  const stamped = reportFor({ rentals: [rental({ id: "rental-stamp", endDate: "2026-10-21T03:00:00Z" })] });
  expect(stamped.rows[0].closeDate).toBe("2026-10-20");
  expect(stamped.rows[0].daysSinceClose).toBe(1);
});

it("lists a missing close date as not recorded and does not drop the deposit", () => {
  const report = reportFor({ rentals: [rental({ endDate: null })] });
  expect(report.rows[0].daysSinceClose).toBeNull();
  expect(report.rows[0].closeDate).toBeNull();
  expect(report.rows[0].stillDueCents).toBe(50000);
  expect(report.rows[0].notes.join(" ")).toContain("The close date is not recorded.");
  expect(report.rows[0].rentalLabel).toBe("Closed");
});

it("keeps an unreadable amount unknown instead of zero", () => {
  expect(dollarsToCents("10.555")).toEqual({ cents: null, unreadable: true });
  expect(dollarsToCents(0)).toEqual({ cents: 0, unreadable: false });
  const report = reportFor({
    payments: [payment({ amountCents: null, netCollectedCents: null, unreadable: true })],
  });
  expect(report.rows[0].stillDueCents).toBeNull();
  expect(report.unknownCount).toBe(1);
  expect(report.stillDueCents).toBeNull();
});

it("counts a known return beside an unknown one without treating the unknown as zero", () => {
  const report = reportFor({
    rentals: [rental(), rental({ id: "rental-2", endDate: "2026-10-01" })],
    payments: [
      payment(),
      payment({ id: "pay-2", rentalId: "rental-2", amountCents: null, netCollectedCents: null, unreadable: true }),
    ],
  });
  expect(report.stillDueCents).toBe(50000);
  expect(report.unknownCount).toBe(1);
  expect(report.rows[0].rentalId).toBe("rental-2");
  expect(report.rows[0].daysSinceClose).toBe(20);
});

it("keeps applied and forfeited deposits out of the return list and says so", () => {
  const report = reportFor({
    rentals: [
      rental({ id: "kept", depositStatus: "forfeited", refundCents: 0 }),
      rental({ id: "open", depositStatus: "held" }),
    ],
    payments: [payment({ rentalId: "kept" }), payment({ id: "pay-open", rentalId: "open" })],
  });
  expect(report.rows.map((row) => row.rentalId)).toEqual(["open"]);
  expect(report.keptCount).toBe(1);
  expect(report.note).toContain("Applied or Forfeited");
});

it("separates a blank vehicle id from a vehicle that is not on file", () => {
  const report = reportFor({
    rentals: [
      rental({ id: "blank", vehicleId: null, vehicleOnFile: false }),
      rental({ id: "missing", vehicleId: "veh-missing", vehicleOnFile: false }),
    ],
    payments: [
      payment({ id: "pay-blank", rentalId: "blank" }),
      payment({ id: "pay-missing", rentalId: "missing" }),
    ],
    vehicles: [],
  });
  const byId = new Map(report.rows.map((row) => [row.rentalId, row.vehicle]));
  expect(byId.get("blank")).toBe("No Vehicle");
  expect(byId.get("missing")).toBe("Unknown Vehicle");
});

it("leaves Stripe evidence beside the database amount", () => {
  const base = reportFor({});
  const next = applyReturnStripe(base, [payment({ refundedCents: 0 })], [
    { paymentId: "pay-1", capturedCents: 50000, refundedCents: 20000 },
  ]);
  expect(next.rows[0].stillDueCents).toBe(50000);
  expect(next.rows[0].stripeRefundedCents).toBe(20000);
  expect(next.rows[0].notes.join(" ")).toContain("This is evidence only.");
});

it("withholds the list when the database read is past the page cap and does not call Stripe", async () => {
  let stripeCalled = false;
  const result = await runRefundReturns({
    enabled: true,
    userId: "owner-1",
    tier: "owner",
    today: TODAY,
    load: async () => ({ ok: false, capped: true }),
    stripe: async () => {
      stripeCalled = true;
      return { ok: false };
    },
  });
  expect(result).toEqual({ status: "unavailable", reason: REFUND_RETURNS_CAPPED });
  expect(stripeCalled).toBe(false);
});

it("keeps the rows when Stripe cannot be read", async () => {
  const result = await runRefundReturns({
    enabled: true,
    userId: "manager-1",
    tier: "manager",
    today: TODAY,
    load: async () => ({
      ok: true,
      rentals: [rental()],
      payments: [payment()],
      deductions: [],
      names: [{ id: "app-1", name: "Ada Lovelace" }],
      vehicles: [{ id: "veh-1", label: "Unit 12" }],
    }),
    stripe: async () => ({ ok: false }),
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(result.report.stripeCheck).toBe("unavailable");
  expect(result.report.rows[0].stillDueCents).toBe(50000);
});

it("refuses before the role check and before a read while the flag is off", async () => {
  let loaded = false;
  await expect(runRefundReturns({
    enabled: false,
    userId: null,
    tier: null,
    today: TODAY,
    load: async () => {
      loaded = true;
      return { ok: false, capped: false };
    },
  })).rejects.toThrow(REFUND_RETURNS_DUE_OFF);
  expect(loaded).toBe(false);
  await expect(runRefundReturns({
    enabled: true,
    userId: "coord",
    tier: "coordinator",
    today: TODAY,
    load: async () => ({ ok: true, rentals: [], payments: [], deductions: [], names: [], vehicles: [] }),
  })).rejects.toThrow("Forbidden");
});

it("reads Stripe refunds through list and retrieve and does not change a failed check into rows", async () => {
  const gateway: ReturnStripeGateway = {
    paymentIntents: {
      retrieve: async () => ({ id: "pi_1", latest_charge: "ch_1", livemode: true }),
    },
    charges: {
      retrieve: async () => ({ id: "ch_1", amount: 50000, amount_captured: 50000, amount_refunded: 0, livemode: true }),
    },
    refunds: {
      list: async () => ({ data: [{ id: "re_1", amount: 0 }], has_more: false }),
    },
  };
  const checked = await readRefundReturnsStripe(gateway, [payment()]);
  expect(checked).toEqual({ ok: true, checks: [{ paymentId: "pay-1", capturedCents: 50000, refundedCents: 0 }] });
  const capped: ReturnStripeGateway = {
    ...gateway,
    refunds: { list: async () => ({ data: [{ id: "re_1", amount: 0 }], has_more: true }) },
  };
  expect(await readRefundReturnsStripe(capped, [payment()])).toEqual({ ok: false });
});

it("escapes a spreadsheet formula in the CSV", () => {
  const report = reportFor({ names: [{ id: "app-1", name: "=Ada" }] });
  expect(refundReturnsToCsv(report)).toContain(`"'=Ada"`);
});

it("keeps the flag off, the tab out of the rail, and the throw ahead of the role and Stripe reads", () => {
  const flag = readFileSync("src/lib/refund-returns-due-flag.ts", "utf8");
  const fn = readFileSync("src/lib/refund-returns-due.functions.ts", "utf8");
  const server = readFileSync("src/lib/refund-returns-due.server.ts", "utf8");
  const stripe = readFileSync("src/lib/refund-returns-due-stripe.server.ts", "utf8");
  const pure = readFileSync("src/lib/refund-returns-due.ts", "utf8");
  const panel = readFileSync("src/components/admin/RefundReturnsDuePanel.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const handler = fn.slice(fn.indexOf("export const getRefundReturnsDue"));
  const thrown = handler.indexOf("throw new Error(REFUND_RETURNS_DUE_OFF)");
  const role = handler.indexOf("await requireManager(context.userId)");
  const load = handler.indexOf("loadRefundReturns");
  const stripeImport = handler.indexOf("readLiveRefundReturnsStripe");
  expect(flag).toContain("export const REFUND_RETURNS_DUE_ENABLED = false");
  expect(flag).not.toContain("process.env");
  expect(thrown).toBeGreaterThan(-1);
  expect(role).toBeGreaterThan(thrown);
  expect(load).toBeGreaterThan(role);
  expect(stripeImport).toBeGreaterThan(load);
  expect(`${fn}\n${server}\n${stripe}\n${pure}`).not.toContain("createStripeClient");
  expect(stripe).toContain('createReadOnlyStripe("live", { cache: true })');
  expect(stripe).not.toMatch(/refunds\.create|charges\.create/);
  expect(`${fn}\n${server}\n${pure}`).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  expect(panel).toContain(">Refunds & Deposit Returns Due<");
  expect(panel).toContain('tab: "bookings"');
  expect(tabs).not.toMatch(/id: "refund_returns_due"/);
  expect(nav).toContain('label: "Refunds & Deposit Returns Due"');
  expect(nav).toContain('!REFUND_RETURNS_DUE_ENABLED || !tierAllows(tier, "manager")');
  expect(admin).toContain('urlTab === "refund_returns_due"');
  expect(admin).toContain('if (!REFUND_RETURNS_DUE_ENABLED || (tier && !tierAllows(tier, "manager"))) return "overview"');
  expect(admin).toContain('REFUND_RETURNS_DUE_ENABLED && tab === "refund_returns_due"');
  const overviewAt = admin.indexOf('if (!urlTab || !TABS.some((t) => t.id === urlTab)) return "overview"');
  expect(admin.indexOf('urlTab === "refund_returns_due"')).toBeLessThan(overviewAt);
  const rail = railEntries("owner").map((entry) => entry.label).join(",");
  expect(rail).not.toContain("Refunds & Deposit Returns Due");
  expect(rail).not.toContain("Partner Statement");
});
