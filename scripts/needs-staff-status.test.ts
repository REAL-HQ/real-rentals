import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { driverStatusDisplay } from "../src/lib/driver-status-display";
import { DANGER_BADGE, DANGER_BADGE_STYLE } from "../src/lib/badge-tone";
import { CONTACT_STATUS_TONE } from "../src/lib/contact-status";
import { toneFor } from "../src/components/admin/ui";

describe("driverStatusDisplay", () => {
  test("flag shows Needs Staff and keeps the saved status", () => {
    const d = driverStatusDisplay("reviewing", { reason: "License unclear" });
    expect(d.label).toBe("Needs Staff");
    expect(d.needsStaff).toBe(true);
    expect(d.underlying).toBe("reviewing");
    expect(d.title).toContain("License unclear");
    expect(d.title).toContain("Reviewing");
  });
  test("terminal statuses are not masked by a stale flag", () => {
    expect(driverStatusDisplay("declined", { reason: "x" }).label).toBe("Declined");
    expect(driverStatusDisplay("closed", { reason: "x" }).needsStaff).toBe(false);
  });
  test("statuses render Title Case without a flag", () => {
    expect(driverStatusDisplay("declined", null).label).toBe("Declined");
    expect(driverStatusDisplay("partial", undefined).label).toBe("Partial");
    expect(driverStatusDisplay(null, null).label).toBe("—");
  });
});

describe("one red badge", () => {
  test("Unqualified and Declined contact badges are the shared danger tone", () => {
    expect(CONTACT_STATUS_TONE.unqualified).toBe(DANGER_BADGE);
    expect(CONTACT_STATUS_TONE.declined).toBe(DANGER_BADGE);
    expect(DANGER_BADGE).toBe("bg-rose-100 text-rose-800");
  });
  test("StatusPill red tone uses the same colours as rose-100 / rose-800", () => {
    expect(toneFor("declined")).toBe("red");
    expect(toneFor("failed")).toBe("red");
    expect(toneFor("overdue")).toBe("red");
    expect(DANGER_BADGE_STYLE).toEqual({ backgroundColor: "#ffe4e6", color: "#9f1239" });
    const ui = readFileSync("src/components/admin/ui.tsx", "utf8");
    expect(ui).toContain("red: { bg: DANGER_BADGE_STYLE.backgroundColor");
  });
  test("Drivers list has no Needs Staff pill beside the name", () => {
    const src = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    const nameCell = src.slice(src.indexOf("<SourceBadge"), src.indexOf("dupeCount > 0 &&"));
    expect(nameCell).not.toContain("Needs Staff");
    expect(nameCell).not.toContain("data-fleet-needs-staff-pill");
    expect(src).toContain("driverStatusDisplay(a.status, needsStaff.get(a.id))");
  });
  test("no one-off red badge classes left in badge components", () => {
    for (const f of ["DriversPanel", "DriverDocExpiry", "OverdueStatus", "MaintenanceDue", "MaintenanceLog", "TeamPanel"]) {
      const s = readFileSync(`src/components/admin/${f}.tsx`, "utf8");
      expect(s).not.toMatch(/bg-red-(50|100)|rgba\(208,48,32,0\.08\)\] text-/);
    }
  });
});
