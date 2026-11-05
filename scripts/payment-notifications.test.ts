// Payment notification package: renter cadence, admin bell merge, Collections fix.
// Run: bun test scripts/payment-notifications.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { addDays, daysBetween, followUpStage, reminderKind, UNPAID_STATUSES } from "../src/lib/payment-reminders";
import { mergeAdminNotifications, projectNotification, projectPaymentAlert } from "../src/lib/admin-overview";

describe("follow-up cadence", () => {
  it("day 1, 3, 7, then weekly", () => {
    expect(followUpStage(0)).toBeNull();
    expect([1, 2].map(followUpStage)).toEqual(["d1", "d1"]);
    expect([3, 6].map(followUpStage)).toEqual(["d3", "d3"]);
    expect([7, 13].map(followUpStage)).toEqual(["d7", "d7"]);
    expect([14, 20, 21, 28].map(followUpStage)).toEqual(["w2", "w2", "w3", "w4"]);
  });
  it("one email per stage per due date, distinct stages advance", () => {
    const days = Array.from({ length: 30 }, (_, i) => i + 1);
    const kinds = new Set(days.map((d) => followUpStage(d)!).map((s) => reminderKind(s, "2026-11-01")));
    expect([...kinds]).toEqual(["d1", "d3", "d7", "w2", "w3", "w4"].map((s) => reminderKind(s, "2026-11-01")));
  });
  it("stops on paid / waived / void", () => {
    for (const s of ["paid", "waived", "void", "refunded"]) expect((UNPAID_STATUSES as readonly string[]).includes(s)).toBe(false);
  });
  it("date math is calendar-day based", () => {
    expect(daysBetween("2026-11-01", new Date("2026-11-04T23:00:00Z"))).toBe(3);
    expect(addDays(new Date("2026-11-05T12:00:00Z"), 1)).toBe("2026-11-06");
  });
});

describe("admin bell", () => {
  it("keeps applications and adds payment alerts newest first", () => {
    const app = projectNotification({ id: "a1", full_name: "A", created_at: "2026-11-01T00:00:00Z" } as any)!;
    const pay = projectPaymentAlert({ id: "n1", title: "Payment Failed", body: "$300", created_at: "2026-11-02T00:00:00Z" } as any)!;
    expect(projectPaymentAlert({ id: "n2", title: "Payment Received", created_at: "x" } as any)).toBeNull();
    const rows = mergeAdminNotifications([app], [pay]);
    expect(rows.map((r) => r.type)).toEqual(["payment", "application"]);
    expect(rows[0].id).toBe("pay:n1");
  });
});

describe("wiring", () => {
  const cron = readFileSync("src/routes/api/public/cron/ops-reminders.ts", "utf8");
  const hook = readFileSync("src/routes/api/public/payments/webhook.ts", "utf8");
  const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
  it("cron sends day-before + team past-due alert", () => {
    expect(cron).toContain("sendPaymentDueTomorrowEmail");
    expect(cron).toContain("sendTeamPaymentAlertEmail");
    expect(cron).not.toMatch(/recentlyNotified\(supabaseAdmin, app.id, "past_due"/);
  });
  it("webhook alerts team on both failure paths", () => {
    expect(hook.match(/alertTeamPaymentFailed\(/g)?.length).toBe(3);
  });
  it("Collections card sums outstanding, not net_collected", () => {
    expect(overview).toContain('.select("amount, balance_due, driver_id")');
    expect(overview).toContain("setOverdueAmt(sumOutstanding(overdueRows))");
  });
});
