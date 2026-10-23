import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyDepositRefunds,
  daysSinceReturn,
  easternToday,
  formatCents,
  formatDaysSinceReturn,
  type DepositDeductionInput,
  type DepositPaymentInput,
  type DepositRentalInput,
} from "../src/lib/deposit-refunds-due";
import { runDepositRefundsDue, type DepositQuery, type DepositReads } from "../src/lib/deposit-refunds-due.server";

type Row = Record<string, unknown> & { id: string };
type Call = { table: string; columns: string; filters: { op: string; column: string; value: unknown }[] };

function rental(over: Partial<DepositRentalInput> = {}): DepositRentalInput {
  return {
    id: "r1",
    status: "closed",
    endDate: "2026-10-18",
    depositHeld: true,
    depositStatus: "held",
    depositRefundAmount: null,
    applicationId: "a1",
    ...over,
  };
}

function payment(over: Partial<DepositPaymentInput> = {}): DepositPaymentInput {
  return {
    id: "p1",
    rentalId: "r1",
    type: "deposit",
    status: "paid",
    amount: "150.00",
    netCollected: null,
    refundedAmount: "0.00",
    ...over,
  };
}

function deduction(over: Partial<DepositDeductionInput> = {}): DepositDeductionInput {
  return { id: "d1", rentalId: "r1", amount: "0.00", ...over };
}

const AS_OF = "2026-10-21";
const NAMES = [{ id: "a1", fullName: "Ada Lovelace" }];

function listed(over: Partial<DepositRentalInput> = {}, payments: DepositPaymentInput[] = [payment()], deductions: DepositDeductionInput[] = []) {
  return classifyDepositRefunds({
    rentals: [rental(over)],
    payments,
    deductions,
    applications: NAMES,
    asOf: AS_OF,
  });
}

function client(
  tables: Record<string, Row[]>,
  options: {
    fail?: Set<string>;
    cap?: Set<string>;
    errorAndCap?: Set<string>;
    changeCount?: boolean;
    duplicate?: boolean;
    throwTable?: string;
    short?: boolean;
  } = {},
): DepositReads & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    from(table: string) {
      const filters: Call["filters"] = [];
      let columns = "";
      let counted = false;
      let ordered = false;
      const api = {
        select(cols: string, opts: { count: "exact" }) {
          columns = cols;
          counted = opts?.count === "exact";
          return api;
        },
        in(column: string, values: readonly string[]) {
          filters.push({ op: "in", column, value: [...values] });
          return api;
        },
        eq(column: string, value: string) {
          filters.push({ op: "eq", column, value });
          return api;
        },
        order(column: string, opts: { ascending: boolean }) {
          ordered = column === "id" && opts.ascending === true;
          return api;
        },
        async range(from: number, to: number) {
          calls.push({ table, columns, filters: filters.map((filter) => ({ ...filter })) });
          if (options.throwTable === table) throw new Error("boom");
          if (!counted || !ordered) return { data: null, error: { message: "bad query" }, count: null };
          if (options.errorAndCap?.has(table)) return { data: null, error: { message: "nope" }, count: 100_001 };
          if (options.fail?.has(table)) return { data: null, error: { message: "nope" }, count: null };
          let rows = (tables[table] ?? []).filter((row) =>
            filters.every((filter) => {
              if (filter.op === "eq") return String(row[filter.column]) === String(filter.value);
              return (filter.value as string[]).includes(String(row[filter.column]));
            }),
          );
          rows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
          if (options.duplicate && table === "rentals") {
            const page = rows.slice(from, to + 1);
            return { data: page[0] ? [page[0], page[0]] : [], error: null, count: rows.length };
          }
          if (options.changeCount && table === "rentals" && from > 0) {
            return { data: rows.slice(from, to + 1), error: null, count: rows.length + 1 };
          }
          if (options.short && table === "rentals") return { data: [], error: null, count: Math.max(rows.length, 1) };
          const count = options.cap?.has(table) ? 100_001 : rows.length;
          return { data: rows.slice(from, to + 1), error: null, count };
        },
      };
      return api as DepositQuery;
    },
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

const manager = [{ id: "role-1", user_id: "user-1", role: "team" }];

describe("deposit refunds due", () => {
  it("counts Eastern days without shifting a stored date across a daylight boundary", () => {
    expect(easternToday(new Date("2026-03-08T04:30:00Z"))).toBe("2026-03-07");
    expect(easternToday(new Date("2026-10-21T03:30:00Z"))).toBe("2026-10-20");
    expect(daysSinceReturn("2026-03-08", "2026-03-09")).toBe(1);
    expect(daysSinceReturn("2026-11-01", "2026-11-02")).toBe(1);
    expect(daysSinceReturn("2026-03-08T00:00:00.000Z", "2026-03-09")).toBeNull();
    expect(formatDaysSinceReturn(0)).toBe("Today");
    expect(formatDaysSinceReturn(1)).toBe("1 Day");
    expect(formatDaysSinceReturn(3)).toBe("3 Days");
    expect(formatDaysSinceReturn(null)).toBe("Unknown");
    expect(formatCents(7450)).toBe("7450");
    expect(formatCents(null)).toBe("Unknown");
  });

  it("lists a closed held deposit in cents and days, and drops rows that are not due", () => {
    const rows = listed();
    expect(rows).toEqual([
      {
        rentalId: "r1",
        renter: "Ada Lovelace",
        daysSinceReturn: 3,
        daysLabel: "3 Days",
        cents: 15000,
      },
    ]);

    expect(listed({ status: "returned" })[0]?.cents).toBe(15000);
    expect(listed({ status: "active" })).toEqual([]);
    expect(listed({ status: "completed" })).toEqual([]);
    expect(listed({ depositHeld: false })).toEqual([]);
    expect(listed({ depositHeld: null })).toEqual([]);
    expect(listed({ depositStatus: "refunded" })).toEqual([]);
    expect(listed({ depositStatus: "applied" })).toEqual([]);
    expect(listed({ depositStatus: "forfeited" })).toEqual([]);
    expect(listed({}, [payment()], [deduction({ amount: "150.00" })])).toEqual([]);
    expect(listed({}, [payment({ netCollected: "0.00", refundedAmount: "150.00" })])).toEqual([]);

    const partial = listed({ depositStatus: "partially_refunded" }, [
      payment({ netCollected: "80.00", refundedAmount: "70.00" }),
    ]);
    expect(partial[0]?.cents).toBe(8000);

    const netOnly = listed({}, [payment({ amount: "150.00", netCollected: "100.00", refundedAmount: "50.00" })], [
      deduction({ amount: "25.50" }),
    ]);
    expect(netOnly[0]?.cents).toBe(7450);

    const refundedField = listed({ depositRefundAmount: "10.00" }, [
      payment({ netCollected: "100.00", refundedAmount: "0.00" }),
    ]);
    expect(refundedField[0]?.cents).toBe(9000);
  });

  it("keeps a held deposit visible when the amount or the return day cannot be read", () => {
    expect(listed({}, [])[0]).toMatchObject({ cents: null, daysLabel: "3 Days", renter: "Ada Lovelace" });
    expect(listed({}, [payment({ status: "void" })])[0]?.cents).toBeNull();
    expect(listed({}, [payment({ status: "pending" })])[0]?.cents).toBeNull();
    expect(listed({}, [payment({ netCollected: "10.555" })])[0]?.cents).toBeNull();
    expect(listed({}, [payment({ amount: "-12.00", netCollected: null })])[0]?.cents).toBeNull();
    expect(listed({}, [payment()], [deduction({ amount: "nope" })])[0]?.cents).toBeNull();
    expect(listed({ depositRefundAmount: "1.234" })[0]?.cents).toBeNull();
    expect(listed({}, [payment({ netCollected: "10.00" })], [deduction({ amount: "40.00" })])[0]?.cents).toBeNull();
    expect(listed({ endDate: null })[0]).toMatchObject({ daysSinceReturn: null, daysLabel: "Unknown", cents: 15000 });
    expect(listed({ endDate: "2026-10-22" })[0]?.daysLabel).toBe("Unknown");
    expect(listed({ applicationId: null })[0]?.renter).toBe("Renter");
    expect(listed({ applicationId: "missing" })[0]?.renter).toBe("Renter");

    const sorted = classifyDepositRefunds({
      asOf: AS_OF,
      applications: NAMES,
      deductions: [],
      payments: [payment({ id: "p-long", rentalId: "long" }), payment({ id: "p-short", rentalId: "short" }), payment({ id: "p-unknown", rentalId: "unknown" })],
      rentals: [
        rental({ id: "unknown", endDate: null }),
        rental({ id: "short", endDate: "2026-10-20" }),
        rental({ id: "long", endDate: "2026-10-01" }),
      ],
    });
    expect(sorted.map((row) => row.rentalId)).toEqual(["long", "short", "unknown"]);
  });

  it("refuses before the role check and before any read while the flag is off", async () => {
    const db = client({});
    db.from = () => {
      throw new Error("read");
    };
    await expect(runDepositRefundsDue({ enabled: false, supabase: db, userId: "user-1" })).resolves.toEqual({
      status: "disabled",
    });
  });

  it("uses the signed-in client, withholds a partial list, and separates capped from degraded", async () => {
    const closed = {
      id: "rental-1",
      status: "closed",
      end_date: "2026-10-18",
      deposit_held: true,
      deposit_status: "held",
      deposit_refund_amount: null,
      application_id: "app-1",
      deposit_amount: 999,
    };
    const happy = client({
      user_roles: manager,
      rentals: [closed, { ...closed, id: "rental-active", status: "active" }],
      payments: [
        {
          id: "pay-1",
          rental_id: "rental-1",
          type: "deposit",
          status: "paid",
          amount: "150.00",
          net_collected: "100.00",
          refunded_amount: "50.00",
        },
      ],
      deposit_deductions: [{ id: "ded-1", rental_id: "rental-1", amount: "25.50" }],
      applications: [{ id: "app-1", full_name: "Ada Lovelace" }],
    });
    const ready = await runDepositRefundsDue({
      enabled: true,
      supabase: happy,
      userId: "user-1",
      now: new Date("2026-10-21T03:30:00Z"),
    });
    expect(ready).toEqual({
      status: "ready",
      report: {
        asOf: "2026-10-20",
        rows: [
          {
            rentalId: "rental-1",
            renter: "Ada Lovelace",
            daysSinceReturn: 2,
            daysLabel: "2 Days",
            cents: 7450,
          },
        ],
      },
    });
    expect(happy.calls.map((call) => call.table)).toEqual([
      "user_roles",
      "rentals",
      "payments",
      "deposit_deductions",
      "applications",
    ]);
    expect(happy.calls.find((call) => call.table === "rentals")?.columns).toBe(
      "id,status,end_date,deposit_held,deposit_status,deposit_refund_amount,application_id",
    );
    expect(happy.calls.find((call) => call.table === "rentals")?.columns).not.toContain("deposit_amount");
    expect(happy.calls.find((call) => call.table === "rentals")?.filters).toEqual([
      { op: "in", column: "status", value: ["closed", "returned"] },
    ]);
    expect(happy.calls.find((call) => call.table === "payments")?.filters).toContainEqual({
      op: "eq",
      column: "type",
      value: "deposit",
    });

    const denied = client({ user_roles: [{ id: "role-2", user_id: "user-2", role: "coordinator" }] });
    await expect(runDepositRefundsDue({ enabled: true, supabase: denied, userId: "user-2" })).rejects.toThrow("Forbidden");
    expect(denied.calls.map((call) => call.table)).toEqual(["user_roles"]);

    const capped = client({ user_roles: manager, rentals: [closed] }, { cap: new Set(["rentals"]) });
    await expect(runDepositRefundsDue({ enabled: true, supabase: capped, userId: "user-1" })).resolves.toEqual({
      status: "capped",
    });
    expect(capped.calls.map((call) => call.table)).toEqual(["user_roles", "rentals"]);

    const failed = client({ user_roles: manager, rentals: [closed] }, { fail: new Set(["rentals"]) });
    await expect(runDepositRefundsDue({ enabled: true, supabase: failed, userId: "user-1" })).resolves.toEqual({
      status: "degraded",
    });
    const erroredCap = client({ user_roles: manager, rentals: [closed] }, { errorAndCap: new Set(["rentals"]) });
    await expect(runDepositRefundsDue({ enabled: true, supabase: erroredCap, userId: "user-1" })).resolves.toEqual({
      status: "degraded",
    });

    const many = Array.from({ length: 201 }, (_, index) => ({ ...closed, id: `rental-${String(index).padStart(3, "0")}` }));
    const changed = client({ user_roles: manager, rentals: many }, { changeCount: true });
    await expect(runDepositRefundsDue({ enabled: true, supabase: changed, userId: "user-1" })).resolves.toEqual({
      status: "degraded",
    });
    const duplicated = client({ user_roles: manager, rentals: [closed] }, { duplicate: true });
    await expect(runDepositRefundsDue({ enabled: true, supabase: duplicated, userId: "user-1" })).resolves.toEqual({
      status: "degraded",
    });
    const short = client({ user_roles: manager, rentals: [closed] }, { short: true });
    await expect(runDepositRefundsDue({ enabled: true, supabase: short, userId: "user-1" })).resolves.toEqual({
      status: "degraded",
    });
    const thrown = client({ user_roles: manager, rentals: [closed] }, { throwTable: "payments" });
    await expect(runDepositRefundsDue({ enabled: true, supabase: thrown, userId: "user-1" })).resolves.toEqual({
      status: "degraded",
    });
    expect(thrown.calls.map((call) => call.table)).not.toContain("deposit_deductions");

    const batched = client({
      user_roles: manager,
      rentals: Array.from({ length: 51 }, (_, index) => ({ ...closed, id: `batch-${String(index).padStart(2, "0")}` })),
      payments: [],
      deposit_deductions: [],
      applications: [],
    });
    const batchResult = await runDepositRefundsDue({ enabled: true, supabase: batched, userId: "user-1" });
    expect(batchResult.status).toBe("ready");
    expect(batched.calls.filter((call) => call.table === "payments")).toHaveLength(2);
  });

  it("is one hard-false flag, read-only, and gated on the existing Payments screen", () => {
    const flag = readFileSync("src/lib/deposit-refunds-due-flag.ts", "utf8");
    expect(flag.match(/export const DEPOSIT_REFUNDS_DUE_ENABLED = false\b/g)).toHaveLength(1);
    expect(flag).not.toContain("process.env");
    const declarations = walk("src").flatMap((file) => readFileSync(file, "utf8").match(/export const DEPOSIT_REFUNDS_DUE_ENABLED\b/g) ?? []);
    expect(declarations).toHaveLength(1);

    const handler = readFileSync("src/lib/deposit-refunds-due.functions.ts", "utf8");
    const gate = handler.indexOf('if (!DEPOSIT_REFUNDS_DUE_ENABLED) return { status: "disabled" }');
    const serverImport = handler.indexOf('await import("./deposit-refunds-due.server")');
    expect(gate).toBeGreaterThan(-1);
    expect(serverImport).toBeGreaterThan(gate);
    expect(handler.indexOf("context.supabase")).toBeGreaterThan(gate);
    expect(handler).not.toContain("roles.server");
    expect(handler).not.toContain("client.server");
    expect(handler).not.toContain("supabaseAdmin");

    const feature = [
      "src/lib/deposit-refunds-due-flag.ts",
      "src/lib/deposit-refunds-due.ts",
      "src/lib/deposit-refunds-due.server.ts",
      "src/lib/deposit-refunds-due.functions.ts",
      "src/components/admin/DepositRefundsDueSection.tsx",
    ];
    for (const file of feature) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("process.env");
      expect(source).not.toContain("supabaseAdmin");
      expect(source).not.toContain("client.server");
      expect(source).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    }
    const server = readFileSync("src/lib/deposit-refunds-due.server.ts", "utf8");
    const waitlist = readFileSync("src/lib/waitlist-reads.server.ts", "utf8");
    expect(server).toContain("const PAGE = 200");
    expect(server).toContain("const MAX_ROWS = 100_000");
    expect(server).toContain("const ID_BATCH = 50");
    expect(server).toContain("i += ID_BATCH");
    expect(waitlist).toContain("const PAGE = 200");
    expect(waitlist).toContain("const MAX_ROWS = 100_000");
    expect(server).not.toContain("waitlist-reads");
    expect(server).not.toContain("apply_payment_refund");

    const panel = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
    expect(panel).toContain("DEPOSIT_REFUNDS_DUE_ENABLED ? <DepositRefundsDueSection /> : null");
    const section = readFileSync("src/components/admin/DepositRefundsDueSection.tsx", "utf8");
    expect(section).toContain("Deposit Refunds Due");
    expect(section).toContain("Days Since Return");
    expect(section).toContain("Amount (Cents)");
    expect(section).toContain("Deposit Refunds Due Is Capped");
    expect(section).toContain("Deposit Refunds Due Could Not Be Loaded");
    expect(section).not.toMatch(/uppercase|lowercase|capitalize|text-transform/);
    expect(section).not.toMatch(/<td[^>]*>\{row\.rentalId\}/);
    expect(readFileSync("src/lib/AGENTS.md", "utf8")).toContain("Deposit refunds due:");
    expect(readFileSync("src/routes/admin.tsx", "utf8")).not.toContain("DepositRefundsDue");
  });
});
