import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const admin = read("src/routes/admin.tsx");
const drivers = read("src/components/admin/DriversPanel.tsx");
const settingsWs = read("src/components/admin/SettingsWorkspace.tsx");
const settings = read("src/components/admin/SettingsPanel.tsx");

describe("back-office pages fill the width beside the sidebar", () => {
  test("admin main has no max-width cap or centering", () => {
    const main = /<main data-admin-main className="([^"]*)"/.exec(admin)![1];
    expect(main).not.toMatch(/max-w-|mx-auto|container/);
    expect(main).toContain("flex-1 min-w-0");
  });
  test("driver profile tab content is not capped", () => {
    const i = drivers.indexOf('<div className="px-4 sm:px-8 py-6');
    expect(i).toBeGreaterThan(0);
    const cls = /className="([^"]*)"/.exec(drivers.slice(i))![1];
    expect(cls).not.toMatch(/max-w-/);
  });
  test("settings sections and forms are not capped", () => {
    expect(settingsWs).not.toMatch(/max-w-3xl/);
    expect(settings).not.toMatch(/space-y-8 max-w-3xl/);
  });
  test("booking modal keeps its own width", () => {
    expect(read("src/components/admin/BookingDetails.tsx")).toContain("max-w-6xl");
  });
});
