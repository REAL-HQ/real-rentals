import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { railEntries, visibleWorkspaceTabs } from "../src/components/admin/nav-config";
import { buildWeeklyCashFlow, cashFlowWeeks, type CashCharge, type CashExpense, type CashRefund } from "../src/lib/weekly-cash-flow";
import { WEEKLY_CASH_FLOW_ENABLED } from "../src/lib/weekly-cash-flow-flag";
import { runWeeklyCashFlow } from "../src/lib/weekly-cash-flow.server";

const read = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const NOW = new Date("2026-10-21T15:00:00.000Z");

describe("Eastern week bucketing", () => {
  it("builds 12 Monday-to-Sunday weeks ending with the week that contains today", () => {
    const weeks = cashFlowWeeks(NOW);
    expect(weeks).toHaveLength(12);
    expect(weeks?.[0]).toEqual({ from: "2026-08-03", through: "2026-08-09", gte: unix("2026-08-03T04:00:00.000Z"), lt: unix("2026-08-10T04:00:00.000Z") });
    expect(weeks?.[11]).toEqual({ from: "2026-10-19", through: "2026-10-25", gte: unix("2026-10-19T04:00:00.000Z"), lt: unix("2026-10-26T04:00:00.000Z") });
    expect(weeks?.every((week, index) => index === 0 || week.gte === weeks[index - 1]!.lt)).toBe(true);
  });

  it("keeps the spring-forward Sunday and the fall-back Sunday in the right week", () => {
    const spring = cashFlowWeeks(new Date("2026-03-04T15:00:00.000Z"));
    expect(spring?.at(-1)).toEqual({ from: "2026-03-02", through: "2026-03-08", gte: unix("2026-03-02T05:00:00.000Z"), lt: unix("2026-03-09T04:00:00.000Z") });
    const springEnd = spring!.at(-1)!;
    expect(unix("2026-03-09T03:30:00.000Z")).toBeGreaterThanOrEqual(springEnd.gte);
    expect(unix("2026-03-09T03:30:00.000Z")).toBeLessThan(springEnd.lt);
    expect(unix("2026-03-09T04:00:00.000Z")).toBe(springEnd.lt);

    const fall = cashFlowWeeks(new Date("2026-11-02T17:00:00.000Z"));
    expect(fall?.[10]).toEqual({ from: "2026-10-26", through: "2026-11-01", gte: unix("2026-10-26T04:00:00.000Z"), lt: unix("2026-11-02T05:00:00.000Z") });
    expect(fall?.at(-1)?.from).toBe("2026-11-02");
    expect(fall?.at(-1)?.gte).toBe(unix("2026-11-02T05:00:00.000Z"));
    const previous = fall![10]!;
    expect(unix("2026-11-02T04:30:00.000Z")).toBeGreaterThanOrEqual(previous.gte);
    expect(unix("2026-11-02T04:30:00.000Z")).toBeLessThan(previous.lt);
  });
});

describe("totals", () => {
  const last = cashFlowWeeks(NOW)!.at(-1)!;
  const charge = (over: Partial<CashCharge> = {}): CashCharge => ({ id: "ch_1", amountCents: 10000, currency: "usd", created: last.gte + 3600, succeeded: true, ...over });
  const refund = (over: Partial<CashRefund> = {}): CashRefund => ({ id: "re_1", amountCents: 2500, currency: "usd", created: last.gte + 7200, status: "succeeded", ...over });
  const expense = (over: Partial<CashExpense> = {}): CashExpense => ({ id: "ex_1", amount: 40.5, category: "insurance", incurredOn: last.from, ...over });

  it("subtracts refunds and expenses, and keeps category totals", () => {
    const report = buildWeeklyCashFlow({
      now: NOW,
      charges: [charge(), charge({ id: "ch_fail", amountCents: 9000, succeeded: false, created: last.gte + 10 }), charge({ id: "ch_old", created: cashFlowWeeks(NOW)![0]!.gte - 10 })],
      refunds: [refund(), refund({ id: "re_pending", amountCents: 100, status: "pending" })],
      expenses: [expense(), expense({ id: "ex_2", amount: 10, category: "fuel", incurredOn: "2026-08-03" }), expense({ id: "ex_out", amount: 99, incurredOn: "2026-07-01" })],
    });
    const week = report?.weeks.at(-1);
    expect(week).toMatchObject({ grossCents: 10000, refundCents: 2500, netCents: 7500, expenseCents: 4050, cashFlowCents: 3450 });
    expect(week?.categories).toEqual([{ category: "insurance", label: "Insurance Premium", cents: 4050 }]);
    expect(report?.weeks[0]).toMatchObject({ grossCents: 0, refundCents: 0, netCents: 0, expenseCents: 1000, cashFlowCents: -1000 });
    expect(report?.totals).toMatchObject({ grossCents: 10000, refundCents: 2500, netCents: 7500, expenseCents: 5050, cashFlowCents: 2450 });
    expect(report?.totals.categories).toEqual([
      { category: "fuel", label: "Fuel", cents: 1000 },
      { category: "insurance", label: "Insurance Premium", cents: 4050 },
    ]);
  });

  it("withholds a non-USD week and the 12-week Stripe rollup", () => {
    const report = buildWeeklyCashFlow({
      now: NOW,
      charges: [charge({ currency: "eur" })],
      refunds: [refund({ status: "pending", currency: "eur", amountCents: 100 })],
      expenses: [expense()],
    });
    expect(report?.weeks.at(-1)).toMatchObject({ grossCents: null, refundCents: 0, netCents: null, expenseCents: 4050, cashFlowCents: null });
    expect(report?.totals.grossCents).toBeNull();
    expect(report?.totals.cashFlowCents).toBeNull();
    expect(report?.totals.expenseCents).toBe(4050);
    expect(buildWeeklyCashFlow({ now: NOW, charges: [charge(), charge({ amountCents: 1 })], refunds: [], expenses: [] })).toBeNull();
  });
});

describe("flag off", () => {
  it("is a hard-false constant with no environment read", () => {
    expect(WEEKLY_CASH_FLOW_ENABLED).toBe(false);
    const flag = read("lib/weekly-cash-flow-flag.ts");
    expect(flag).toContain("export const WEEKLY_CASH_FLOW_ENABLED = false");
    expect(flag).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it("returns before expenses and Stripe, and refuses a coordinator", async () => {
    let loads = 0;
    let reads = 0;
    const load = async () => { loads += 1; return []; };
    const readStripe = async () => { reads += 1; return { ok: true as const, charges: [], refunds: [] }; };
    expect(await runWeeklyCashFlow({ enabled: false, userId: "user", roles: ["admin"], load, readStripe })).toEqual({ status: "disabled", report: null });
    await expect(runWeeklyCashFlow({ enabled: true, userId: null, roles: ["admin"], load, readStripe })).rejects.toThrow("Forbidden");
    await expect(runWeeklyCashFlow({ enabled: true, userId: "user", roles: ["coordinator"], load, readStripe })).rejects.toThrow("Forbidden");
    expect(loads).toBe(0);
    expect(reads).toBe(0);
    const ready = await runWeeklyCashFlow({ enabled: true, userId: "user", roles: ["team"], now: NOW, load, readStripe });
    expect(ready.status).toBe("ready");
    expect(loads).toBe(1);
    expect(reads).toBe(1);
  });

  it("lists charges and refunds only, and stays off the coordinator Payments workspace", () => {
    const source = read("lib/weekly-cash-flow.functions.ts");
    const handler = source.slice(source.indexOf(".handler"));
    const flag = handler.indexOf("if (!WEEKLY_CASH_FLOW_ENABLED)");
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(handler.indexOf('from("user_roles")'));
    expect(flag).toBeLessThan(handler.indexOf("loadCashFlowExpenses"));
    const reader = read("lib/weekly-cash-flow-read.server.ts");
    const calls = [...reader.matchAll(/gateway\.(\w+)\.(\w+)/g)].map((match) => `${match[1]}.${match[2]}`);
    expect(calls).toEqual(expect.arrayContaining(["charges.list", "refunds.list"]));
    expect(calls.every((call) => call === "charges.list" || call === "refunds.list")).toBe(true);
    expect(reader).not.toMatch(/\.(retrieve|create|update|del|delete|capture|confirm|cancel|refund|createPreview)\s*\(/);
    expect(visibleWorkspaceTabs("payments", "manager").map((tab) => tab.id)).toContain("weekly_cash_flow");
    expect(visibleWorkspaceTabs("payments", "owner").map((tab) => tab.id)).toContain("weekly_cash_flow");
    expect(visibleWorkspaceTabs("payments", "coordinator")).toEqual([]);
    expect(railEntries("owner").map((entry) => entry.label)).not.toContain("Weekly Cash Flow");
  });
});
