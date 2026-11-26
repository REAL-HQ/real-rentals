// Driver profile: Recent Activity shows ET time, is wider than Driver Facts,
// and Next Step sits above Blacklist And Warnings.
// Run: TZ=UTC bun test scripts/driver-profile-activity-layout.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fmtActivityStamp } from "../src/lib/date-format";

describe("fmtActivityStamp", () => {
  it("formats real timestamps in America/New_York (EST)", () => {
    expect(fmtActivityStamp("2026-11-21T19:04:00Z")).toBe("Nov 21, 2026 · 2:04 PM ET");
  });
  it("handles EDT and the ET date rolling back across midnight UTC", () => {
    expect(fmtActivityStamp("2026-07-01T03:30:00Z")).toBe("Jun 30, 2026 · 11:30 PM ET");
    expect(fmtActivityStamp("2026-11-21T05:00:00Z")).toBe("Nov 21, 2026 · 12:00 AM ET");
  });
  it("shows no time for date-only values", () => {
    expect(fmtActivityStamp("2026-11-21")).toBe("Nov 21, 2026");
  });
  it("returns empty for invalid input", () => {
    expect(fmtActivityStamp("nope")).toBe("");
    expect(fmtActivityStamp(null)).toBe("");
  });
});

describe("driver profile overview layout", () => {
  const src = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  it("renders activity with the ET stamp on one line", () => {
    expect(src).toContain("fmtActivityStamp(e.at)");
    expect(src).toContain("whitespace-nowrap");
  });
  it("gives Recent Activity more width than Driver Facts", () => {
    expect(src).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]");
    expect(src).not.toContain("lg:grid-cols-[minmax(0,1fr)_380px]");
  });
  it("puts Next Step above Blacklist And Warnings in the overview", () => {
    const overview = src.slice(src.indexOf('<TabsContent value="overview"'), src.indexOf('<TabsContent value="documents"'));
    const next = overview.indexOf("<NextStepCard");
    const black = overview.indexOf("<BlacklistCard");
    expect(next).toBeGreaterThan(-1);
    expect(black).toBeGreaterThan(next);
    expect(src.match(/<BlacklistCard/g)?.length).toBe(1);
  });
});
