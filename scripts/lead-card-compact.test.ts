import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LEAD_TONES, LEAD_NEXT_STEP, leadTiming } from "../src/lib/lead-card";
import { LEAD_BUCKETS } from "../src/lib/lead-priorities";

const ui = readFileSync("src/components/admin/LeadPriorities.tsx", "utf8");
const lib = readFileSync("src/lib/lead-card.ts", "utf8");

describe("compact lead cards", () => {
  test("every bucket has a short next step and a labeled solid tone", () => {
    for (const b of LEAD_BUCKETS) {
      expect(LEAD_NEXT_STEP[b].length).toBeLessThanOrEqual(32);
      expect(LEAD_TONES[b].label.length).toBeGreaterThan(0);
      expect(LEAD_TONES[b].accent).toMatch(/^border-l-/);
    }
    expect(new Set(LEAD_BUCKETS.map((b) => LEAD_TONES[b].key)).size).toBe(LEAD_BUCKETS.length);
  });
  test("no gradients", () => {
    for (const src of [ui, lib]) expect(src).not.toMatch(/bg-gradient|linear-gradient|bg-linear|\bfrom-\w+-\d|\bvia-\w+-\d/);
  });
  test("wordy filler and raw qualification percents are gone from the card", () => {
    expect(ui).not.toContain("ReadinessMetrics");
    expect(ui).not.toContain("positives");
    expect(ui).not.toContain("{lead.reason}");
    expect(ui).not.toContain("{lead.action}");
    expect(ui).not.toContain("Latest contact note");
    expect(ui).not.toMatch(/Verified/);
  });
  test("actions, status controls and draft stay", () => {
    for (const s of ["tel:", "open-messages", "View Applicant", "<ContactStatusCell", "ReadinessStatePill", "<LeadFollowUpDraft applicationId={lead.id} bucket={lead.bucket} />", "Unnamed Applicant", "No leads need attention"]) expect(ui).toContain(s);
  });
  test("timing variations", () => {
    const iso = new Date().toISOString();
    expect(leadTiming({ bucket: "new", created_at: iso, contact_status_at: null, contact_follow_up_on: null }, "2026-11-08")).toEqual(["Applied Today"]);
    const od = leadTiming({ bucket: "overdue", created_at: null, contact_status_at: null, contact_follow_up_on: "2026-11-05" }, "2026-11-08");
    expect(od[0]).toContain("3 days overdue");
    expect(od).toContain("Applied date unknown");
    expect(od).toContain("No contact logged");
    const it = leadTiming({ bucket: "interested", created_at: iso, contact_status_at: iso, contact_follow_up_on: null }, "2026-11-08");
    expect(it).toEqual(["Applied Today", "Last contact Today"]);
  });
});
