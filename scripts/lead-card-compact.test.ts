/**
 * Compact Lead Priorities cards: server-rendered card, real state variations.
 * No browser, no database, no server calls, nothing is sent.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LEAD_TONES, LEAD_NEXT_STEP, leadBadgeLabel, leadTiming } from "../src/lib/lead-card";
import { LEAD_BUCKETS, projectLead, type LeadBucket } from "../src/lib/lead-priorities";
import { LeadCardBody } from "../src/components/admin/LeadCardBody";

const ui = readFileSync("src/components/admin/LeadPriorities.tsx", "utf8");
const body = readFileSync("src/components/admin/LeadCardBody.tsx", "utf8");
const lib = readFileSync("src/lib/lead-card.ts", "utf8");
const TODAY = "2026-11-08";
const now = new Date().toISOString();

function row(bucket: LeadBucket, over: Record<string, unknown> = {}) {
  return projectLead(
    { id: "a1", full_name: "David Stellar", phone: "555", status: "new", created_at: now, contact_status: "new", contact_status_note: null, contact_follow_up_on: null, contact_status_at: null, contact_status_by: null, ...over } as never,
    bucket,
  );
}
const render = (lead: ReturnType<typeof row>) =>
  renderToStaticMarkup(
    h(LeadCardBody, { lead, today: TODAY, name: h("a", null, "David Stellar"), status: h("span", { "data-status": "" }, lead.contactLabel), actions: h("div", null, "Call Text View Applicant") }),
  );
const badge = (html: string) => html.match(/data-lead-badge[^>]*>[\s\S]*?<\/span>([^<]*)<\/span>/)![1].trim();

describe("compact lead cards", () => {
  test("new lead: neutral treatment, one short next step, no duplicate New or filler", () => {
    const html = render(row("new"));
    expect(badge(html)).toBe("High");
    expect(html).not.toContain("blue");
    expect(html).not.toContain("border-l-");
    expect(html).toContain(">Make first contact<");
    expect(html).toContain("Applied Today");
    for (const s of ["Awaiting first contact", "record the outcome", "Nothing recorded yet", "No contact logged", "Qualification", "Verified", "% Known"]) expect(html).not.toContain(s);
  });
  test("overdue while Contacted keeps both truths, red due line, two timing items", () => {
    const html = render(row("overdue", { contact_status: "contacted", contact_follow_up_on: "2026-11-05", contact_status_at: now }));
    expect(badge(html)).toBe("Overdue · Urgent");
    expect(html).toContain('data-status="">Contacted<');
    expect(html).toContain("3 days overdue");
    expect(html).toContain("text-brand");
    expect(html).toContain("Last contact Today");
    expect(html).not.toContain("Applied");
  });
  test("interested drops duplicate label; documents vs Waiting on Info both shown", () => {
    expect(badge(render(row("interested", { contact_status: "interested" })))).toBe("High");
    const info = render(row("information", { contact_status: "documents" }));
    expect(badge(info)).toBe("Waiting on Info · Medium");
    expect(info).toContain("No contact logged");
  });
  test("note is clamped and labeled; missing date is honest", () => {
    const html = render(row("future", { contact_status: "follow_up", contact_follow_up_on: "2026-11-20", contact_status_note: "x".repeat(400) }));
    expect(html).toContain("line-clamp-2");
    expect(html).toContain("Note: ");
    expect(leadTiming({ bucket: "new", created_at: null, contact_status_at: null, contact_follow_up_on: null }, TODAY)).toEqual(["Applied date unknown"]);
  });
  test("every bucket: short step, distinct labeled tone, timing at most two items", () => {
    for (const b of LEAD_BUCKETS) {
      expect(LEAD_NEXT_STEP[b].length).toBeLessThanOrEqual(32);
      expect(LEAD_TONES[b].label.length).toBeGreaterThan(0);
      expect(leadTiming({ bucket: b, created_at: now, contact_status_at: null, contact_follow_up_on: "2026-11-01" }, TODAY).length).toBeLessThanOrEqual(2);
    }
    expect(new Set(LEAD_BUCKETS.map((b) => LEAD_TONES[b].label)).size).toBe(LEAD_BUCKETS.length);
    expect(leadBadgeLabel("today", "Follow-Up", "Medium")).toBe("Due Today · Medium");
  });
  test("neutral cards never reintroduce the rejected blue accents or gradients", () => {
    for (const src of [body, lib]) {
      expect(src).not.toMatch(/blue|border-l-(?:blue|red|emerald|amber|violet|slate)/);
    }
    for (const src of [ui, body, lib]) expect(src).not.toMatch(/bg-gradient|linear-gradient|bg-linear|\bfrom-\w+-\d|\bvia-\w+-\d/);
  });
  test("list keeps actions, status control and readiness, drops metrics", () => {
    for (const s of ["tel:", "open-messages", "View Applicant", "<ContactStatusCell", "ReadinessStatePill", "<LeadFollowUpDraft applicationId={lead.id} bucket={lead.bucket} />", "Unnamed Applicant", "No leads need attention"]) expect(ui).toContain(s);
    for (const s of ["ReadinessMetrics", "positives", "{lead.reason}", "{lead.action}"]) expect(ui).not.toContain(s);
  });
});
