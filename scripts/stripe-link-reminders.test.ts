// Reminder skip for paid Stripe weeks, overdue days from the oldest unpaid
// week, and date-only display as calendar dates.
// Run: TZ=America/New_York bun test scripts/stripe-link-reminders.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
process.env.TZ = "America/New_York";

import { paidForWeek } from "../src/lib/rent-reminders.server.ts";
import { oldestUnpaidDue, rentalOverdueDays } from "../src/lib/active-rentals.ts";
import { fmtDate } from "../src/lib/date-format.ts";
import type { PaidInvoice } from "../src/lib/stripe-link.ts";

const pi = (over: Partial<PaidInvoice> = {}): PaidInvoice => ({
  id: "in_1", customerId: "cus_1", customerEmail: null, subscriptionId: null, amountPaid: 350, createdOn: "2026-11-10", paidOn: "2026-11-10", ...over,
});

describe("paidForWeek (reminder skip)", () => {
  it("counts a paid Stripe invoice the app never recorded (Heather, Nov 10)", () => {
    assert.equal(paidForWeek("2026-11-10", 350, [], [pi()]), 350);
  });
  it("counts an invoice paid up to 2 days early", () => {
    assert.equal(paidForWeek("2026-11-12", 350, [], [pi({ createdOn: "2026-11-10" })]), 350);
  });
  it("does not count the same invoice twice when a row already records it", () => {
    const rows = [{ amount: 350, type: "rent", status: "paid", due_date: "2026-11-10", stripe_invoice_id: "in_1" }];
    assert.equal(paidForWeek("2026-11-10", 350, rows, [pi()]), 350);
  });
  it("last week's payment does not cover this week, so the renter is still reminded", () => {
    assert.equal(paidForWeek("2026-11-17", 350, [], [pi()]), 0);
  });
  it("ignores unpaid rows and non-rent rows", () => {
    const rows = [
      { amount: 350, type: "rent", status: "failed", due_date: "2026-11-10" },
      { amount: 50, type: "late_fee", status: "paid", due_date: "2026-11-10" },
    ];
    assert.equal(paidForWeek("2026-11-10", 350, rows, []), 0);
  });
});

describe("overdue days from the oldest unpaid week", () => {
  const today = "2026-11-14";
  it("an older failed week wins over a later next-due date", () => {
    const oldest = oldestUnpaidDue("r1", [
      { rentalId: "r1", status: "failed", dueDate: "2026-11-05" },
      { rentalId: "r1", status: "paid", dueDate: "2026-10-29" },
      { rentalId: "r2", status: "failed", dueDate: "2026-10-01" },
    ] as any);
    assert.equal(oldest, "2026-11-05");
    assert.equal(rentalOverdueDays("2026-11-12", oldest, today), 9);
  });
  it("falls back to next due when nothing is unpaid, and is null when neither is late", () => {
    assert.equal(rentalOverdueDays("2026-11-12", null, today), 2);
    assert.equal(oldestUnpaidDue("r1", []), null);
    const n = rentalOverdueDays("2026-11-20", null, today);
    assert.ok(n == null || n <= 0);
  });
});

describe("date-only display", () => {
  it("shows a due date on its calendar day in Eastern time", () => {
    assert.equal(fmtDate("2026-11-05"), "Nov 5, 2026");
    assert.equal(fmtDate("2026-11-12"), "Nov 12, 2026");
  });
  it("no admin wrapper parses a date-only string with new Date(iso)", () => {
    for (const f of ["src/components/admin/PaymentsPanel.tsx", "src/components/admin/ui.tsx", "src/components/site/ApplicationWizard.tsx"]) {
      const src = readFileSync(f, "utf8");
      const wrapper = /function fmtDate\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
      assert.ok(wrapper, `${f}: fmtDate wrapper not found`);
      assert.ok(!/new Date\(iso\)/.test(wrapper), `${f}: fmtDate still shifts date-only values`);
    }
  });
});

describe("Stripe Link Check switch", () => {
  it("is in the catalog, default OFF, and the cron only runs it when switched on", async () => {
    const { AUTOMATIONS } = await import("../src/lib/automation-catalog.ts");
    const list: any[] = AUTOMATIONS;
    const entry = list.find((e) => e.key === "stripe_link_reconciliation");
    assert.ok(entry, "catalog entry missing");
    assert.equal(entry.defaultOn, false);
    const cron = readFileSync("src/routes/api/public/cron/ops-reminders.ts", "utf8");
    assert.match(cron, /if \(on\("stripe_link_reconciliation"\)\)/);
  });
});
