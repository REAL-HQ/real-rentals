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

describe("first table row is not covered at scroll 0", () => {
  test("sticky bars no longer pull the table up with a negative margin", () => {
    const rule = css.slice(css.indexOf(".admin-sticky-bar.admin-sticky-bar {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("margin-bottom: 0");
    expect(body).not.toContain("margin-bottom: -");
  });
});

describe("booking modal and vehicle picker are wide enough for plates", () => {
  test("booking modal is max-w-6xl; picker popover has a 28rem floor", () => {
    expect(readFileSync("src/components/admin/BookingDetails.tsx", "utf8")).toContain("w-full max-w-6xl");
    const combo = readFileSync("src/components/admin/VehicleCombobox.tsx", "utf8");
    expect(combo).toContain("min-w-[min(28rem,calc(100vw-2rem))]");
  });
});
