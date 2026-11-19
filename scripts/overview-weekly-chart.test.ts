import { describe, expect, test } from "bun:test";
import { buildWeeklyBilledCollected } from "../src/lib/overview-weekly-revenue";

const label = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
// Thu Nov 19 2026, 12:30 PM ET
const now = new Date("2026-11-19T17:30:00Z");

describe("Billed vs Collected weekly series", () => {
  const rows = (tz: string) => buildWeeklyBilledCollected({
    now,
    collected: [
      { paid_date: "2026-11-15", net_collected: 100, type: "rent" }, // Sunday starts this week
      { paid_date: "2026-11-17", net_collected: 350, type: "rent" },
      { paid_date: "2026-11-14", net_collected: 70, type: "rent" }, // Saturday, last week
    ],
    billed: [
      { due_date: "2026-11-16", amount: 400, type: "rent" },
      { due_date: "2026-11-21", amount: 999, type: "rent" }, // not due yet
    ],
    label,
  });
  for (const tz of ["America/New_York", "UTC", "Asia/Tokyo"]) {
    test(`last bucket is this week (Nov 15, "This Week") — TZ ${tz}`, () => {
      const prev = process.env.TZ; process.env.TZ = tz;
      const s = rows(tz);
      process.env.TZ = prev;
      expect(s.length).toBe(12);
      expect(s[11]).toMatchObject({ iso: "2026-11-15", label: "This Week", current: true, collected: 450, billed: 400 });
      expect(s[10]).toMatchObject({ iso: "2026-11-08", label: "Nov 8", collected: 70 });
      expect(s[0].iso).toBe("2026-08-30");
      expect(s[0].label).toBe("Aug 30");
    });
  }
  test("every bucket is a Sunday seven days apart across the Nov 1 clock change", () => {
    const s = rows("x");
    for (let i = 1; i < s.length; i++) {
      expect((Date.parse(s[i].iso) - Date.parse(s[i - 1].iso)) / 864e5).toBe(7);
      expect(new Date(s[i].iso + "T00:00:00Z").getUTCDay()).toBe(0);
    }
  });
});
