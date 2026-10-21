import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildUnbilledTolls,
  formatUnbilledAge,
  formatUnbilledMoney,
  type DeductionInput,
  type PaymentInput,
  type RentalInput,
  type TollInput,
  type UnbilledCaps,
  type UnbilledLoad,
} from "../src/lib/tolls-unbilled";
import { ID_CHUNK, MAX_PAGES, PAGE, loadUnbilledTolls, readPages, runUnbilledTolls } from "../src/lib/tolls-unbilled.server";

const AS_OF = new Date("2026-10-22T15:00:00.000Z");
const QUIET: UnbilledCaps = {
  tolls: false,
  rentals: false,
  payments: false,
  deductions: false,
  vehicles: false,
  drivers: false,
};

function bundle(partial: Partial<UnbilledLoad> = {}): UnbilledLoad {
  return {
    tolls: [],
    rentals: [],
    payments: [],
    deductions: [],
    vehicles: [],
    drivers: [],
    ...partial,
    caps: { ...QUIET, ...partial.caps },
  };
}

function toll(partial: Partial<TollInput> & { id: string }): TollInput {
  return {
    vehicleId: "v1",
    rentalId: null,
    occurredAt: "2026-10-10T15:00:00.000Z",
    amount: "10.00",
    adminFee: "0",
    status: "new",
    paymentId: null,
    ...partial,
  };
}

function rental(partial: Partial<RentalInput> & { id: string }): RentalInput {
  return {
    vehicleId: "v1",
    driverId: "d1",
    applicationId: "d1",
    status: "active",
    startDate: "2026-10-01",
    endDate: null,
    ...partial,
  };
}

function payment(partial: Partial<PaymentInput> & { id: string }): PaymentInput {
  return { driverId: "d1", status: "pending", ...partial };
}

function report(partial: Partial<UnbilledLoad>, now = AS_OF) {
  return buildUnbilledTolls(bundle(partial), now);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("unbilled tolls", () => {
  it("lists one active rental with amount, fee, and Eastern age", () => {
    const result = report({
      tolls: [toll({ id: "t1", amount: "10.10", adminFee: "0.20" })],
      rentals: [rental({ id: "r1" })],
      drivers: [{ id: "d1", fullName: "Ada Lovelace" }],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      tollId: "t1",
      cents: 1030,
      ageDays: 12,
      occurredOn: "2026-10-10",
      driverLabel: "Ada Lovelace",
      rentalId: "r1",
      ambiguous: false,
    });
    expect(result.totalCents).toBe(1030);
    expect(formatUnbilledAge(12)).toBe("12 Days");
    expect(formatUnbilledMoney(1030)).toBe("$10.30");
  });

  it("adds a one-cent fee instead of dropping it", () => {
    const result = report({
      tolls: [toll({ id: "t1", amount: "0.01", adminFee: "0.01" })],
      rentals: [rental({ id: "r1" })],
    });
    expect(result.rows[0]?.cents).toBe(2);
    expect(result.totalCents).toBe(2);
  });

  it("keeps an unlinked toll when another toll on the rental is billed", () => {
    const result = report({
      tolls: [
        toll({ id: "t-billed", amount: "4.00", paymentId: "p1" }),
        toll({ id: "t-open", amount: "2.50", adminFee: null }),
      ],
      rentals: [rental({ id: "r1", driverId: "driver-user", applicationId: "app-1" })],
      payments: [payment({ id: "p1", driverId: "app-1", status: "pending" })],
    });
    expect(result.rows.map((row) => row.tollId)).toEqual(["t-open"]);
    expect(result.totalCents).toBe(250);
  });

  it.each(["pending", "paid", "succeeded", "processing", "Paid", "PENDING"])(
    "treats a %s payment to the rental driver as billed",
    (status) => {
      const byDriver = report({
        tolls: [toll({ id: "t1", paymentId: "p1" })],
        rentals: [rental({ id: "r1", driverId: "driver-user", applicationId: "app-1" })],
        payments: [payment({ id: "p1", driverId: "driver-user", status })],
      });
      const byApplication = report({
        tolls: [toll({ id: "t1", paymentId: "p1" })],
        rentals: [rental({ id: "r1", driverId: "driver-user", applicationId: "app-1" })],
        payments: [payment({ id: "p1", driverId: "app-1", status })],
      });
      expect(byDriver.totalCents).toBe(0);
      expect(byDriver.rows).toEqual([]);
      expect(byApplication.totalCents).toBe(0);
      expect(byApplication.rows).toEqual([]);
    },
  );

  it("stays unbilled when the payment is for a different driver", () => {
    const result = report({
      tolls: [toll({ id: "t1", amount: "3.00", paymentId: "p1" })],
      rentals: [rental({ id: "r1", driverId: "driver-user", applicationId: "app-1" })],
      payments: [payment({ id: "p1", driverId: "someone-else", status: "paid" })],
    });
    expect(result.rows.map((row) => row.tollId)).toEqual(["t1"]);
    expect(result.totalCents).toBe(300);
  });

  it.each(["void", "cancelled", "canceled", "waived", "refunded", "failed", "written_off", "Void"])(
    "does not treat a %s payment as a charge",
    (status) => {
      const result = report({
        tolls: [toll({ id: "t1", amount: "3.00", paymentId: "p1" })],
        rentals: [rental({ id: "r1" })],
        payments: [payment({ id: "p1", status })],
      });
      expect(result.totalCents).toBe(300);
      expect(result.rows).toHaveLength(1);
    },
  );

  it("withholds the row and the total when the linked payment status is unrecognized", () => {
    const result = report({
      tolls: [toll({ id: "t1", paymentId: "p1" })],
      rentals: [rental({ id: "r1" })],
      payments: [payment({ id: "p1", status: "scheduled" })],
    });
    expect(result.rows[0]).toMatchObject({ cents: null, ambiguous: false, driverLabel: "Driver" });
    expect(result.totalCents).toBeNull();
  });

  it("clears only the toll named by a deposit deduction on the matched rental", () => {
    const deductions: DeductionInput[] = [
      { id: "ded-1", rentalId: "r1", tollChargeId: "t-cleared" },
      { id: "ded-2", rentalId: "r-other", tollChargeId: "t-open" },
    ];
    const result = report({
      tolls: [toll({ id: "t-cleared", amount: "8.00" }), toll({ id: "t-open", amount: "1.25" })],
      rentals: [rental({ id: "r1" })],
      deductions,
    });
    expect(result.rows.map((row) => row.tollId)).toEqual(["t-open"]);
    expect(result.totalCents).toBe(125);
    expect(formatUnbilledMoney(125)).toBe("$1.25");
  });

  it("makes overlapping active rentals Unknown instead of picking a driver", () => {
    const result = report({
      tolls: [toll({ id: "t-overlap", amount: "5.00" }), toll({ id: "t-clear", vehicleId: "v2", amount: "1.00" })],
      rentals: [
        rental({ id: "r1", driverId: "d1" }),
        rental({ id: "r2", driverId: "d2", applicationId: "d2" }),
        rental({ id: "r3", vehicleId: "v2", driverId: "d3", applicationId: "d3" }),
      ],
    });
    const overlap = result.rows.find((row) => row.tollId === "t-overlap");
    const clear = result.rows.find((row) => row.tollId === "t-clear");
    expect(overlap).toMatchObject({ ambiguous: true, cents: null, driverLabel: null, ageDays: 12 });
    expect(clear).toMatchObject({ ambiguous: false, cents: 100 });
    expect(result.totalCents).toBeNull();
    expect(result.notes.join(" ")).toContain("Ambiguous");
  });

  it("withholds the total when the stamped rental disagrees with the time match", () => {
    const result = report({
      tolls: [toll({ id: "t1", rentalId: "r-other", amount: "6.00" })],
      rentals: [rental({ id: "r1" })],
    });
    expect(result.rows[0]).toMatchObject({ ambiguous: true, cents: null, driverLabel: null });
    expect(result.totalCents).toBeNull();
  });

  it("ignores an ended rental that covers the same day", () => {
    const result = report({
      tolls: [toll({ id: "t1" })],
      rentals: [rental({ id: "r-ended", status: "completed" })],
    });
    expect(result.rows).toEqual([]);
    expect(result.totalCents).toBe(0);
  });

  it("uses the Eastern day, so a toll before midnight Eastern is the previous day", () => {
    const windowed = report({
      tolls: [
        toll({ id: "t-out", occurredAt: "2026-10-01T03:00:00.000Z", amount: "1.00" }),
        toll({ id: "t-in", occurredAt: "2026-10-01T04:00:00.000Z", amount: "2.00" }),
      ],
      rentals: [rental({ id: "r1", startDate: "2026-10-01" })],
    });
    expect(windowed.rows.map((row) => row.tollId)).toEqual(["t-in"]);
    expect(windowed.rows[0]?.occurredOn).toBe("2026-10-01");
    expect(windowed.totalCents).toBe(200);

    const labeled = report({
      tolls: [
        toll({ id: "t-late", occurredAt: "2026-10-01T03:00:00.000Z" }),
        toll({ id: "t-early", occurredAt: "2026-10-01T04:00:00.000Z" }),
      ],
      rentals: [rental({ id: "r1", startDate: "2026-09-01" })],
    });
    expect(labeled.rows.find((row) => row.tollId === "t-late")?.occurredOn).toBe("2026-09-30");
    expect(labeled.rows.find((row) => row.tollId === "t-early")?.occurredOn).toBe("2026-10-01");
  });

  it("counts Eastern calendar days across the spring-forward weekend", () => {
    const result = report(
      {
        tolls: [toll({ id: "t1", occurredAt: "2026-03-07T05:00:00.000Z", amount: "1.00" })],
        rentals: [rental({ id: "r1", startDate: "2026-03-01" })],
      },
      new Date("2026-03-09T04:00:00.000Z"),
    );
    expect(result.asOf).toBe("2026-03-09");
    expect(result.rows[0]?.occurredOn).toBe("2026-03-07");
    expect(result.rows[0]?.ageDays).toBe(2);
    expect(formatUnbilledAge(2)).toBe("2 Days");
    expect(formatUnbilledAge(1)).toBe("1 Day");
    expect(formatUnbilledAge(0)).toBe("Today");
    expect(formatUnbilledAge(null)).toBe("Unknown");
  });

  it("keeps today's Eastern date when UTC has already rolled over", () => {
    const result = report(
      {
        tolls: [toll({ id: "t1", occurredAt: "2026-09-30T16:00:00.000Z", amount: "1.00" })],
        rentals: [rental({ id: "r1", startDate: "2026-09-01" })],
      },
      new Date("2026-10-01T03:00:00.000Z"),
    );
    expect(result.asOf).toBe("2026-09-30");
    expect(result.rows[0]?.ageDays).toBe(0);
    expect(result.totalCents).toBe(100);
  });

  it("withholds the total when an in-scope amount is unreadable, without zeroing the sibling", () => {
    const result = report({
      tolls: [
        toll({ id: "t-bad", amount: "10.999", adminFee: "0.20" }),
        toll({ id: "t-good", amount: "1.00" }),
      ],
      rentals: [rental({ id: "r1" })],
    });
    expect(result.rows.find((row) => row.tollId === "t-bad")?.cents).toBeNull();
    expect(result.rows.find((row) => row.tollId === "t-good")?.cents).toBe(100);
    expect(result.totalCents).toBeNull();
  });

  it("leaves a blank admin fee at zero and still lists a zero-dollar toll", () => {
    const blankFee = report({
      tolls: [toll({ id: "t1", amount: "1.50", adminFee: "" })],
      rentals: [rental({ id: "r1" })],
    });
    const zero = report({
      tolls: [toll({ id: "t1", amount: "0", adminFee: null })],
      rentals: [rental({ id: "r1" })],
    });
    expect(blankFee.totalCents).toBe(150);
    expect(zero.rows[0]?.cents).toBe(0);
    expect(zero.totalCents).toBe(0);
  });

  it.each(["written_off", "Written_Off", "disputed", "Disputed"])("omits a %s toll", (status) => {
    const result = report({
      tolls: [toll({ id: "t1", status })],
      rentals: [rental({ id: "r1" })],
    });
    expect(result.rows).toEqual([]);
    expect(result.totalCents).toBe(0);
  });

  it("does not trust rebilled or paid status without a payment or deduction", () => {
    const result = report({
      tolls: [
        toll({ id: "t-rebilled", status: "rebilled", amount: "1.00" }),
        toll({ id: "t-paid", status: "paid", amount: "2.00" }),
      ],
      rentals: [rental({ id: "r1" })],
    });
    expect(result.rows.map((row) => row.tollId).sort()).toEqual(["t-paid", "t-rebilled"]);
    expect(result.totalCents).toBe(300);
  });

  it("includes the end date and a capitalized active status, and skips a bad start", () => {
    const included = report({
      tolls: [toll({ id: "t1", occurredAt: "2026-10-20T15:00:00.000Z", amount: "1.00" })],
      rentals: [rental({ id: "r1", status: " ACTIVE ", endDate: "2026-10-20" })],
    });
    const afterEnd = report({
      tolls: [toll({ id: "t1", occurredAt: "2026-10-21T15:00:00.000Z" })],
      rentals: [rental({ id: "r1", endDate: "2026-10-20" })],
    });
    const badStart = report({
      tolls: [toll({ id: "t1" })],
      rentals: [rental({ id: "r1", startDate: "not-a-date" })],
    });
    expect(included.totalCents).toBe(100);
    expect(afterEnd.totalCents).toBe(0);
    expect(badStart.totalCents).toBe(0);
  });

  it("is Unknown when the toll day is missing and the vehicle has an active rental", () => {
    const unknown = report({
      tolls: [toll({ id: "t1", occurredAt: null })],
      rentals: [rental({ id: "r1" })],
    });
    const quiet = report({
      tolls: [toll({ id: "t1", occurredAt: null, vehicleId: "v-empty" })],
      rentals: [rental({ id: "r1" })],
    });
    expect(unknown.rows[0]).toMatchObject({ ambiguous: true, cents: null, ageDays: null });
    expect(unknown.totalCents).toBeNull();
    expect(quiet.rows).toEqual([]);
    expect(quiet.totalCents).toBe(0);
  });

  it("leaves age Unknown without wiping a known amount", () => {
    const result = report(
      {
        tolls: [toll({ id: "t1", occurredAt: "2026-10-23T15:00:00.000Z", amount: "4.00" })],
        rentals: [rental({ id: "r1", startDate: "2026-10-01" })],
      },
      AS_OF,
    );
    expect(result.rows[0]?.ageDays).toBeNull();
    expect(result.rows[0]?.cents).toBe(400);
    expect(result.totalCents).toBe(400);
  });

  it("nulls every candidate when rentals, payments, or deductions are truncated", () => {
    const base = {
      tolls: [toll({ id: "t-open", amount: "2.00" }), toll({ id: "t-off", status: "written_off", amount: "9.00" })],
      rentals: [rental({ id: "r1" })],
    };
    const rentals = report({ ...base, caps: { ...QUIET, rentals: true } });
    const payments = report({
      ...base,
      payments: [payment({ id: "p1", status: "paid" })],
      tolls: [toll({ id: "t-open", amount: "2.00", paymentId: "p1" }), toll({ id: "t-off", status: "written_off" })],
      caps: { ...QUIET, payments: true },
    });
    const deductions = report({
      ...base,
      deductions: [{ id: "ded-1", rentalId: "r1", tollChargeId: "t-open" }],
      caps: { ...QUIET, deductions: true },
    });
    for (const result of [rentals, payments, deductions]) {
      expect(result.rows.map((row) => row.tollId)).toEqual(["t-open"]);
      expect(result.rows[0]?.cents).toBeNull();
      expect(result.totalCents).toBeNull();
    }
    expect(payments.rows[0]?.ambiguous).toBe(false);
  });

  it("keeps loaded cents when only the toll page is truncated, and still withholds the total", () => {
    const loaded = report({
      tolls: [toll({ id: "t1", amount: "2.00" })],
      rentals: [rental({ id: "r1" })],
      caps: { ...QUIET, tolls: true },
    });
    const noneLoaded = report({ caps: { ...QUIET, tolls: true } });
    expect(loaded.rows[0]?.cents).toBe(200);
    expect(loaded.totalCents).toBeNull();
    expect(loaded.truncated).toBe(true);
    expect(noneLoaded.totalCents).toBeNull();
    expect(noneLoaded.rows).toEqual([]);
  });

  it("does not withhold money when only the label reads are truncated", () => {
    const result = report({
      tolls: [toll({ id: "t1", amount: "2.00" })],
      rentals: [rental({ id: "r1" })],
      caps: { ...QUIET, vehicles: true, drivers: true },
    });
    expect(result.rows[0]).toMatchObject({ vehicleLabel: "Vehicle", driverLabel: "Driver", cents: 200 });
    expect(result.totalCents).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it("withholds every row when a toll or rental id is duplicated", () => {
    const tolls = report({
      tolls: [toll({ id: "t1" }), toll({ id: "t1", amount: "1.00" })],
      rentals: [rental({ id: "r1" })],
    });
    const rentals = report({
      tolls: [toll({ id: "t1" })],
      rentals: [rental({ id: "r1" }), rental({ id: "r1", driverId: "d2" })],
    });
    expect(tolls.rows).toEqual([]);
    expect(tolls.totalCents).toBeNull();
    expect(rentals.rows).toEqual([]);
    expect(rentals.totalCents).toBeNull();
  });

  it("reports a quiet fleet as zero", () => {
    const result = report({});
    expect(result.totalCents).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("refuses before the loader when the flag is off or the tier is below manager", async () => {
    const load = vi.fn(async () => bundle());
    const disabled = await runUnbilledTolls({ enabled: false, userId: "u", tier: "owner", load });
    expect(disabled).toEqual({ status: "disabled", report: null });
    await expect(runUnbilledTolls({ enabled: true, userId: "u", tier: "coordinator", load })).rejects.toThrow("Forbidden");
    await expect(runUnbilledTolls({ enabled: true, userId: null, tier: "manager", load })).rejects.toThrow("Forbidden");
    await expect(runUnbilledTolls({ enabled: true, userId: "u", tier: null, load })).rejects.toThrow("Forbidden");
    expect(load).not.toHaveBeenCalled();

    const manager = await runUnbilledTolls({ enabled: true, userId: "u", tier: "manager", now: AS_OF, load });
    const owner = await runUnbilledTolls({ enabled: true, userId: "u", tier: "owner", now: AS_OF, load });
    expect(manager.status).toBe("ready");
    expect(owner.status).toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);

    load.mockResolvedValueOnce(null);
    const missing = await runUnbilledTolls({ enabled: true, userId: "u", tier: "manager", load });
    expect(missing.status).toBe("unavailable");
    expect(missing.report).toBeNull();
  });
});

describe("unbilled toll reads", () => {
  it("asks for one extra row, rejects a count mismatch, and caps a long read", async () => {
    expect(PAGE).toBe(100);
    expect(MAX_PAGES).toBe(20);
    const calls: Array<string | null> = [];
    const exact = await readPages(async (cursor) => {
      calls.push(cursor);
      const rows = cursor ? [{ id: "b" }] : [{ id: "a" }, { id: "b" }];
      return { data: rows.slice(0, PAGE + 1), error: null, count: 2 };
    });
    expect(exact).toEqual({ rows: [{ id: "a" }, { id: "b" }], truncated: false });

    const extraId = `id-${String(PAGE).padStart(4, "0")}`;
    const extra = await readPages(async (cursor) => {
      if (cursor) return { data: [{ id: extraId }], error: null, count: PAGE + 1 };
      const rows = Array.from({ length: PAGE + 1 }, (_, index) => ({ id: `id-${String(index).padStart(4, "0")}` }));
      return { data: rows, error: null, count: PAGE + 1 };
    });
    expect(extra?.rows).toHaveLength(PAGE + 1);
    expect(extra?.truncated).toBe(false);
    expect(extra?.rows.filter((row) => row.id === extraId)).toHaveLength(1);

    const mismatch = await readPages(async () => ({ data: [{ id: "a" }], error: null, count: 2 }));
    expect(mismatch).toBeNull();
    const missingCount = await readPages(async () => ({ data: [], error: null, count: null }));
    expect(missingCount).toBeNull();
    const tooLong = await readPages(async () => ({
      data: Array.from({ length: PAGE + 2 }, (_, index) => ({ id: `z-${index}` })),
      error: null,
      count: PAGE + 2,
    }));
    expect(tooLong).toBeNull();
    const unsorted = await readPages(async () => ({ data: [{ id: "b" }, { id: "a" }], error: null, count: 2 }));
    expect(unsorted).toBeNull();

    let pages = 0;
    const capped = await readPages(async (cursor) => {
      pages += 1;
      const start = pages * PAGE;
      const rows = Array.from({ length: PAGE + 1 }, (_, index) => ({ id: `p-${String(start + index).padStart(5, "0")}` }));
      if (cursor && rows[0] && !(String(rows[0].id) > cursor)) return { data: null, error: { message: "cursor" }, count: null };
      return { data: rows, error: null, count: PAGE * MAX_PAGES + 5 };
    });
    expect(pages).toBe(MAX_PAGES);
    expect(capped?.truncated).toBe(true);
    expect(capped?.rows).toHaveLength(PAGE * MAX_PAGES);

    const inconsistentCap = await readPages(async () => ({
      data: Array.from({ length: PAGE + 1 }, (_, index) => ({ id: `c-${String(index).padStart(4, "0")}` })),
      error: null,
      count: PAGE,
    }));
    expect(inconsistentCap).toBeNull();
  });

  it("stops after a failed toll page and checks the active-rental read", async () => {
    const failed = failingDb("toll_charges");
    expect(await loadUnbilledTolls(failed)).toBeNull();
    expect(failed.calls).toEqual(["toll_charges"]);
    expect(failed.limits).toEqual([PAGE + 1]);

    const mismatch = mismatchDb();
    expect(await loadUnbilledTolls(mismatch)).toBeNull();
    expect(mismatch.calls).toEqual(["toll_charges"]);
  });

  it("maps amount plus fee and chunks payment ids", async () => {
    expect(ID_CHUNK).toBe(50);
    const tolls = Array.from({ length: 51 }, (_, index) => ({
      id: `t-${String(index).padStart(2, "0")}`,
      vehicle_id: "v1",
      rental_id: null,
      occurred_at: "2026-10-10T15:00:00.000Z",
      amount: index === 0 ? "10.10" : "1.00",
      admin_fee: index === 0 ? "0.20" : "0.00",
      status: "new",
      payment_id: `p-${String(index).padStart(2, "0")}`,
    }));
    const payments = tolls.map((row) => ({ id: row.payment_id, driver_id: "d1", status: "paid" }));
    const db = memoryDb({
      toll_charges: tolls,
      rentals: [
        {
          id: "r1",
          vehicle_id: "v1",
          driver_id: "d1",
          application_id: "d1",
          status: "active",
          start_date: "2026-10-01",
          end_date: null,
        },
        {
          id: "r-ended",
          vehicle_id: "v1",
          driver_id: "d9",
          application_id: "d9",
          status: "completed",
          start_date: "2026-10-01",
          end_date: null,
        },
      ],
      deposit_deductions: [{ id: "ded-null", rental_id: "r1", toll_charge_id: null }],
      vehicles: [{ id: "v1", year: 2020, make: "Honda", model: "Civic", license_plate: "ABC" }],
      payments,
      applications: [{ id: "d1", full_name: "Ada Lovelace" }],
    });
    const loaded = await loadUnbilledTolls(db);
    expect(loaded).not.toBeNull();
    expect(db.calls[0]).toBe("toll_charges");
    expect(db.limits.every((limit) => limit === PAGE + 1)).toBe(true);
    expect(db.eqs).toContain("rentals.status=active");
    expect(db.nots).toContain("deposit_deductions.toll_charge_id is null");
    expect(db.calls.filter((table) => table === "payments")).toHaveLength(2);
    expect(db.calls.filter((table) => table === "deposit_deductions")).toHaveLength(2);
    expect(loaded?.rentals.map((row) => row.id)).toEqual(["r1"]);
    expect(loaded?.payments).toHaveLength(51);
    const built = buildUnbilledTolls(loaded!, AS_OF);
    expect(built.totalCents).toBe(0);
    expect(built.rows).toEqual([]);

    const open = memoryDb({
      toll_charges: [tolls[0]],
      rentals: [
        {
          id: "r1",
          vehicle_id: "v1",
          driver_id: "d1",
          application_id: "d1",
          status: "active",
          start_date: "2026-10-01",
          end_date: null,
        },
      ],
      deposit_deductions: [],
      vehicles: [{ id: "v1", year: 2020, make: "Honda", model: "Civic", license_plate: "ABC" }],
      payments: [],
      applications: [{ id: "d1", full_name: "Ada Lovelace" }],
    });
    const openLoad = await loadUnbilledTolls(open);
    const openReport = buildUnbilledTolls(openLoad!, AS_OF);
    expect(openReport.rows[0]).toMatchObject({
      cents: 1030,
      vehicleLabel: "2020 Honda Civic · ABC",
      driverLabel: "Ada Lovelace",
      ageDays: 12,
    });
    expect(openReport.totalCents).toBe(1030);
  });
});

describe("unbilled tolls source", () => {
  it("declares the hard-false flag once and gates the handler before any read", () => {
    const flag = readFileSync("src/lib/tolls-unbilled-flag.ts", "utf8");
    expect(flag.match(/export const TOLLS_UNBILLED_ENABLED = false\b/g)).toHaveLength(1);
    expect(flag).not.toContain("process.env");
    expect(flag).not.toContain("import.meta.env");
    const declarations = walk("src").flatMap((file) => readFileSync(file, "utf8").match(/export const TOLLS_UNBILLED_ENABLED\b/g) ?? []);
    expect(declarations).toHaveLength(1);

    const handler = readFileSync("src/lib/tolls-unbilled.functions.ts", "utf8");
    const gate = handler.indexOf("if (!TOLLS_UNBILLED_ENABLED)");
    expect(gate).toBeGreaterThan(-1);
    expect(handler.indexOf("roles.server")).toBeGreaterThan(gate);
    expect(handler.indexOf("tolls-unbilled.server")).toBeGreaterThan(gate);
    expect(handler.indexOf("client.server")).toBeGreaterThan(gate);

    const server = readFileSync("src/lib/tolls-unbilled.server.ts", "utf8");
    expect(server).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
    expect(server).not.toContain("createReadOnlyStripe");
    expect(server).toContain('count: "exact"');
    expect(server).toContain('.eq("status", "active")');
    expect(server).toContain("limit(PAGE + 1)");
    expect(server).toContain('.not("toll_charge_id", "is", null)');

    const panel = readFileSync("src/components/admin/ChargesPanel.tsx", "utf8");
    expect(panel).toContain("TOLLS_UNBILLED_ENABLED ?");
    const section = readFileSync("src/components/admin/UnbilledTollsSection.tsx", "utf8");
    expect(section).not.toMatch(/text-transform|uppercase/);
    expect(section).toContain("Unknown");
    expect(section).toContain("Unbilled Tolls");
    expect(section).toContain("This Read Is Truncated");
    expect(section).not.toMatch(/\.insert\(|\.update\(|rebill/i);
    for (const file of walk("src/routes")) {
      expect(readFileSync(file, "utf8")).not.toContain("TOLLS_UNBILLED");
    }
    expect(readFileSync("src/components/admin/nav-config.ts", "utf8")).not.toContain("Unbilled");
  });
});

function memoryDb(tables: Record<string, Record<string, unknown>[]>) {
  const calls: string[] = [];
  const limits: number[] = [];
  const eqs: string[] = [];
  const nots: string[] = [];
  return {
    calls,
    limits,
    eqs,
    nots,
    from(table: string) {
      calls.push(table);
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let cursor: string | null = null;
      const api = {
        select(_columns: string, options?: { count?: string }) {
          if (options?.count !== "exact") throw new Error("count");
          return api;
        },
        order(column: string) {
          if (column !== "id") throw new Error("order");
          return api;
        },
        gt(column: string, value: string) {
          if (column !== "id") throw new Error("gt");
          cursor = value;
          return api;
        },
        eq(column: string, value: string) {
          eqs.push(`${table}.${column}=${value}`);
          filters.push((row) => String(row[column]) === value);
          return api;
        },
        in(column: string, values: string[]) {
          const allowed = new Set(values);
          filters.push((row) => allowed.has(String(row[column])));
          return api;
        },
        not(column: string, operator: string, value: null) {
          nots.push(`${table}.${column} ${operator} ${value}`);
          if (operator === "is" && value === null) filters.push((row) => row[column] != null);
          return api;
        },
        limit(n: number) {
          limits.push(n);
          let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
          rows = rows.slice().sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
          const count = rows.length;
          if (cursor) rows = rows.filter((row) => String(row.id) > cursor!);
          return Promise.resolve({ data: rows.slice(0, n), error: null, count });
        },
      };
      return api;
    },
  };
}

function failingDb(failTable: string) {
  const calls: string[] = [];
  const limits: number[] = [];
  return {
    calls,
    limits,
    from(table: string) {
      calls.push(table);
      const api = {
        select() {
          return api;
        },
        order() {
          return api;
        },
        gt() {
          return api;
        },
        eq() {
          return api;
        },
        in() {
          return api;
        },
        not() {
          return api;
        },
        limit(n: number) {
          limits.push(n);
          if (table === failTable) return Promise.resolve({ data: null, error: { message: "no" }, count: null });
          return Promise.resolve({ data: [], error: null, count: 0 });
        },
      };
      return api;
    },
  };
}

function mismatchDb() {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const api = {
        select() {
          return api;
        },
        order() {
          return api;
        },
        gt() {
          return api;
        },
        eq() {
          return api;
        },
        in() {
          return api;
        },
        not() {
          return api;
        },
        limit() {
          return Promise.resolve({
            data: [
              {
                id: "t1",
                vehicle_id: "v1",
                rental_id: null,
                occurred_at: "2026-10-10",
                amount: "1.00",
                admin_fee: "0",
                status: "new",
                payment_id: null,
              },
            ],
            error: null,
            count: 2,
          });
        },
      };
      return api;
    },
  };
}
