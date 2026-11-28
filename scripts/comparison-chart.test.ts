// Public comparison chart on drivereal.com (home and city pages).
// Order and values are the approved program copy (Dolmar, Nov 28 2026).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  COMPARISON_FEATURE_ORDER,
  DEFAULT_COMPARISON,
  normalizeComparisonRows,
  parseComparison,
  type ComparisonRow,
} from "../src/lib/comparison-chart";

const row = (
  feature: string,
  real = "x",
  uberlyft = "y",
  traditional = "z",
): ComparisonRow => ({ feature, real, uberlyft, traditional, real_is_win: true });

describe("default comparison chart", () => {
  test("columns, title, disclaimer, and as-of date stay as published", () => {
    expect(DEFAULT_COMPARISON.title).toBe("The Gig Driver's Breakdown.");
    expect(DEFAULT_COMPARISON.columns).toEqual([
      "Real Rentals",
      "Uber Rent / Lyft Express",
      "Avis / Hertz / Enterprise",
    ]);
    expect(DEFAULT_COMPARISON.disclaimer).toBe(
      "Comparison reflects general program features; competitor terms vary by location and change over time. Figures are estimates.",
    );
    expect(DEFAULT_COMPARISON.as_of_date).toBe("June 2026");
  });

  test("rows are in the approved order with the approved values", () => {
    expect(DEFAULT_COMPARISON.rows.map((r) => r.feature)).toEqual([...COMPARISON_FEATURE_ORDER]);
    expect(DEFAULT_COMPARISON.rows).toEqual([
      { feature: "Deposit", real: "No Deposit", uberlyft: "~$200-250 Hold", traditional: "~$200-500 Hold", real_is_win: true },
      { feature: "Credit Check", real: "No", uberlyft: "No", traditional: "Often Yes", real_is_win: true },
      { feature: "Mileage", real: "Unlimited (In Service Area)", uberlyft: "Restrictive / Per-Mile", traditional: "Restrictive / Per-Mile", real_is_win: true },
      { feature: "Insurance", real: "Insurance Included", uberlyft: "Varies", traditional: "Varies", real_is_win: true },
      { feature: "Maintenance", real: "Maintenance Included", uberlyft: "Varies", traditional: "Varies", real_is_win: true },
      { feature: "Multi-App Use", real: "Yes", uberlyft: "No", traditional: "No", real_is_win: true },
      { feature: "Approval Speed", real: "As Soon As Same Day", uberlyft: "Varies", traditional: "Varies", real_is_win: true },
      { feature: "Local Support", real: "Local Team", uberlyft: "Call Center", traditional: "Rental Counter", real_is_win: true },
    ]);
  });

  test("Gig-App Eligibility is gone; Multi-App Use is the one app-use row", () => {
    const features = DEFAULT_COMPARISON.rows.map((r) => r.feature);
    expect(features).not.toContain("Gig-App Eligibility");
    expect(features.filter((f) => /gig-app|multi-app/i.test(f))).toEqual(["Multi-App Use"]);
  });
});

describe("normalizeComparisonRows", () => {
  test("reorders known features and drops Gig-App Eligibility", () => {
    const normalized = normalizeComparisonRows([
      row("Multi-App Use", "Yes", "No", "No"),
      row("Insurance", "Insurance Included", "Varies", "Varies"),
      row("Mileage", "Unlimited (In Service Area)", "Restrictive / Per-Mile", "Restrictive / Per-Mile"),
      row("Gig-App Eligibility", "Any Gig Service", "One Platform", "Not Gig-Focused"),
      row("Credit Check", "No", "No", "Often Yes"),
      row("Approval Speed", "As Soon As Same Day", "Varies", "Varies"),
      row("Deposit", "No Deposit", "~$200-250 Hold", "~$200-500 Hold"),
      row("Local Support", "Local Team", "Call Center", "Rental Counter"),
    ]);
    expect(normalized.map((r) => r.feature)).toEqual([...COMPARISON_FEATURE_ORDER]);
    expect(normalized.find((r) => r.feature === "Maintenance")).toEqual({
      feature: "Maintenance",
      real: "Maintenance Included",
      uberlyft: "Varies",
      traditional: "Varies",
      real_is_win: true,
    });
  });

  test("does not overwrite saved values, duplicate required rows, or invent competitor claims", () => {
    const savedInsurance = row("Insurance", "Full Coverage", "Ask them", "Ask them");
    const normalized = normalizeComparisonRows([
      savedInsurance,
      row("insurance", "Insurance Included", "Varies", "Varies"),
      row("Maintenance", "Maintenance Included", "Varies", "Varies"),
    ]);
    expect(normalized.filter((r) => r.feature.toLowerCase() === "insurance")).toEqual([savedInsurance]);
    expect(normalized.find((r) => r.feature === "Maintenance")?.uberlyft).toBe("Varies");
    expect(normalized.find((r) => r.feature === "Maintenance")?.traditional).toBe("Varies");
    expect(normalized.map((r) => r.feature)).toEqual(["Insurance", "Maintenance"]);
  });

  test("keeps unknown extra rows after the known features", () => {
    const extra = row("Weekly Payments", "Weekly", "Varies", "Varies");
    const normalized = normalizeComparisonRows([extra, row("Deposit", "No Deposit", "~$200-250 Hold", "~$200-500 Hold")]);
    expect(normalized[0].feature).toBe("Deposit");
    expect(normalized.at(-1)).toEqual(extra);
    expect(normalized.map((r) => r.feature)).toContain("Insurance");
    expect(normalized.map((r) => r.feature)).toContain("Maintenance");
  });
});

describe("parseComparison", () => {
  test("accepts a complete payload and rejects a partial one", () => {
    expect(parseComparison(DEFAULT_COMPARISON)).toEqual(DEFAULT_COMPARISON);
    expect(parseComparison({ title: "x" })).toBeNull();
    expect(parseComparison(null)).toBeNull();
    expect(parseComparison("nope")).toBeNull();
  });
});

describe("the homepage and city pages use this table", () => {
  test("ComparisonSection renders the shared defaults and normalizer", () => {
    const src = readFileSync("src/components/site/ComparisonSection.tsx", "utf8");
    expect(src).toContain('from "@/lib/comparison-chart"');
    expect(src).toContain("useState(DEFAULT_COMPARISON)");
    expect(src).toContain("normalizeComparisonRows(parsed.rows)");
    expect(src).toContain('t.startsWith("maintenance included")');
    expect(src).not.toContain("Gig-App Eligibility");
    expect(src).not.toContain("withInsuranceRow");
  });

  test("home and city pages still mount ComparisonSection", () => {
    expect(readFileSync("src/routes/index.tsx", "utf8")).toContain("<ComparisonSection />");
    expect(readFileSync("src/routes/$slug.tsx", "utf8")).toContain("<ComparisonSection siteId={site.id} />");
  });

  test("chart copy lives only in the shared module", () => {
    const home = readFileSync("src/routes/index.tsx", "utf8");
    const city = readFileSync("src/routes/$slug.tsx", "utf8");
    expect(home).not.toContain("Gig-App Eligibility");
    expect(city).not.toContain("Gig-App Eligibility");
    expect(home).not.toContain("~$200-250 Hold");
    expect(city).not.toContain("~$200-250 Hold");
  });
});
