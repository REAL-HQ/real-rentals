import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");

describe("sticky table headers are never covered by the filter bar", () => {
  test("th z-index is above the sticky bar (15) and below page chrome (20)", () => {
    const rule = css.slice(css.indexOf(".admin-table-fit thead th {"));
    const z = Number(/z-index:\s*(\d+)/.exec(rule.slice(0, rule.indexOf("}")))![1]);
    expect(z).toBeGreaterThan(15);
    expect(z).toBeLessThan(20);
  });
  test("stacked bars are offset and summed into --admin-bar-h", () => {
    expect(admin).toContain('querySelectorAll<HTMLElement>(".admin-sticky-bar")');
    expect(admin).toContain("offset += desktop ? bar.offsetHeight : 0");
    expect(admin).toContain('"--admin-bar-h", `${offset}px`');
  });
});

describe("unit number is not shown in vehicle lists", () => {
  test("VehicleCell has no unit prop", () => {
    expect(readFileSync("src/components/admin/VehicleCell.tsx", "utf8")).not.toContain("showUnit");
  });
});
