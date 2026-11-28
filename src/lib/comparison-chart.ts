/**
 * Public drivereal.com comparison chart (homepage and city pages).
 *
 * Default rows and the normalizer that keeps saved site_content in line:
 * drop the redundant Gig-App Eligibility row, put known features in the
 * approved order, and fill in Insurance and Maintenance if they are missing.
 * Competitor cells stay "Varies" unless a saved row already has a value.
 * Do not invent claims.
 */

import type { Json } from "@/integrations/supabase/types";

export type ComparisonRow = {
  feature: string;
  real: string;
  uberlyft: string;
  traditional: string;
  real_is_win: boolean;
};

export type ComparisonData = {
  title: string;
  columns: string[];
  rows: ComparisonRow[];
  disclaimer: string;
  as_of_date: string;
};

export const COMPARISON_FEATURE_ORDER = [
  "Deposit",
  "Credit Check",
  "Mileage",
  "Insurance",
  "Maintenance",
  "Multi-App Use",
  "Approval Speed",
  "Local Support",
] as const;

const INSURANCE_ROW: ComparisonRow = {
  feature: "Insurance",
  real: "Insurance Included",
  uberlyft: "Varies",
  traditional: "Varies",
  real_is_win: true,
};

const MAINTENANCE_ROW: ComparisonRow = {
  feature: "Maintenance",
  real: "Maintenance Included",
  uberlyft: "Varies",
  traditional: "Varies",
  real_is_win: true,
};

/** Rows we always show, even when saved site content omitted them. */
const REQUIRED_ROWS: Record<string, ComparisonRow> = {
  insurance: INSURANCE_ROW,
  maintenance: MAINTENANCE_ROW,
};

const DROPPED_FEATURES = new Set(["gig-app eligibility"]);

export const DEFAULT_COMPARISON: ComparisonData = {
  title: "The Gig Driver's Breakdown.",
  columns: ["Real Rentals", "Uber Rent / Lyft Express", "Avis / Hertz / Enterprise"],
  rows: [
    { feature: "Deposit", real: "No Deposit", uberlyft: "~$200-250 Hold", traditional: "~$200-500 Hold", real_is_win: true },
    { feature: "Credit Check", real: "No", uberlyft: "No", traditional: "Often Yes", real_is_win: true },
    { feature: "Mileage", real: "Unlimited (In Service Area)", uberlyft: "Restrictive / Per-Mile", traditional: "Restrictive / Per-Mile", real_is_win: true },
    INSURANCE_ROW,
    MAINTENANCE_ROW,
    { feature: "Multi-App Use", real: "Yes", uberlyft: "No", traditional: "No", real_is_win: true },
    { feature: "Approval Speed", real: "As Soon As Same Day", uberlyft: "Varies", traditional: "Varies", real_is_win: true },
    { feature: "Local Support", real: "Local Team", uberlyft: "Call Center", traditional: "Rental Counter", real_is_win: true },
  ],
  disclaimer:
    "Comparison reflects general program features; competitor terms vary by location and change over time. Figures are estimates.",
  as_of_date: "June 2026",
};

function featureKey(feature: string): string {
  return feature.trim().toLowerCase();
}

/**
 * Saved site content can replace the whole table. Keep Insurance and
 * Maintenance in that copy, drop Gig-App Eligibility (it duplicates
 * Multi-App Use), and put known features in the approved order, without
 * duplicating a row or inventing competitor claims.
 */
export function normalizeComparisonRows(rows: ComparisonRow[]): ComparisonRow[] {
  const known = new Map<string, ComparisonRow>();
  const extras: ComparisonRow[] = [];
  const canonical = new Set(COMPARISON_FEATURE_ORDER.map((name) => featureKey(name)));

  for (const row of rows) {
    const key = featureKey(row.feature);
    if (!key || DROPPED_FEATURES.has(key)) continue;
    if (canonical.has(key)) {
      if (!known.has(key)) known.set(key, row);
    } else {
      extras.push(row);
    }
  }

  const ordered: ComparisonRow[] = [];
  for (const name of COMPARISON_FEATURE_ORDER) {
    const key = featureKey(name);
    const existing = known.get(key);
    if (existing) {
      ordered.push(existing);
    } else if (REQUIRED_ROWS[key]) {
      ordered.push(REQUIRED_ROWS[key]);
    }
  }
  return [...ordered, ...extras];
}

export function parseComparison(value: Json): ComparisonData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.title === "string" &&
    Array.isArray(v.columns) &&
    Array.isArray(v.rows) &&
    typeof v.disclaimer === "string" &&
    typeof v.as_of_date === "string"
  ) {
    return v as unknown as ComparisonData;
  }
  return null;
}
