/**
 * Compact Lead Priorities cards: server-rendered card, real state variations.
 * No browser, no database, no server calls, nothing is sent.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LEAD_TONES,
  LEAD_NEXT_STEP,
  leadBadgeLabel,
  leadContactMeta,
  leadTiming,
  leadContextLine,
  leadUrgency,
  leadUrgencyStat,
  leadVisibleNextStep,
} from "../src/lib/lead-card";
import { LEAD_BUCKETS, projectLead, type LeadBucket } from "../src/lib/lead-priorities";
import { LeadCardBody } from "../src/components/admin/LeadCardBody";

const ui = readFileSync("src/components/admin/LeadPriorities.tsx", "utf8");
const body = readFileSync("src/components/admin/LeadCardBody.tsx", "utf8");
const lib = readFileSync("src/lib/lead-card.ts", "utf8");
const TODAY = "2026-11-08";
const now = new Date().toISOString();

function row(bucket: LeadBucket, over: Record<string, unknown> = {}) {
  return projectLead(
    {
      id: "a1",
      full_name: "David Stellar",
      phone: "555",
      status: "new",
      created_at: now,
      contact_status: "new",
      contact_status_note: null,
      contact_follow_up_on: null,
      contact_status_at: null,
      contact_status_by: null,
      ...over,
    } as never,
    bucket,
  );
}
const render = (lead: ReturnType<typeof row>) =>
  renderToStaticMarkup(
    h(LeadCardBody, {
      lead,
      today: TODAY,
      displayName: "David Stellar",
      name: "David Stellar",
      status: h("span", { "data-status": "" }, lead.contactLabel),
      actions: h("div", null, "Call Text View Applicant"),
    }),
  );

describe("compact lead cards", () => {
  test("new lead: neutral treatment, one short next step, no duplicate New or filler", () => {
    const html = render(row("new"));
    expect(html).toContain(">DS<");
    expect(html).not.toContain("blue");
    expect(html).not.toContain("border-l-");
    expect(html).not.toContain("data-lead-urgency");
    expect(html).toContain("from-emerald-300");
    expect(html).toContain("Applied Today");
    expect(html).not.toContain("Make first contact");
    expect(html).not.toContain("Follow up and log the outcome");
    for (const s of [
      "Awaiting first contact",
      "record the outcome",
      "Nothing recorded yet",
      "No contact logged",
      "Qualification",
      "Verified",
      "% Known",
      ">High<",
    ])
      expect(html).not.toContain(s);
  });
  test("overdue while Contacted keeps both truths, one urgency mark, last contact separate", () => {
    const html = render(
      row("overdue", {
        contact_status: "contacted",
        contact_follow_up_on: "2026-11-05",
        contact_status_at: now,
      }),
    );
    expect(html).toContain('data-status="">Contacted<');
    expect(html).toContain(">3<");
    expect(html).toContain("Days Overdue");
    expect(html).toContain("Due Nov 5, 2026 (3 days overdue)");
    expect(html).toContain("text-brand");
    expect(html).toContain("Last contact Today");
    expect(html).not.toContain("Overdue · Urgent");
    expect(html).not.toContain("Follow up and log the outcome");
    expect(html).not.toContain("Applied");
  });
  test("interested drops the duplicate stage chip; documents keep the missing-contact line", () => {
    const interested = render(row("interested", { contact_status: "interested" }));
    expect(interested).toContain('data-status="">Interested<');
    expect(interested).not.toContain(">High<");
    expect(interested).not.toContain("Confirm next steps");
    const info = render(row("information", { contact_status: "documents" }));
    expect(info).toContain('data-status="">Documents<');
    expect(info).not.toContain("Waiting on Info · Medium");
    expect(info).toContain("No contact logged");
    expect(info).not.toContain("Check what info is missing");
  });
  test("note is one line with the full text on hover; missing date is honest", () => {
    const note = "x".repeat(400);
    const html = render(
      row("future", {
        contact_status: "follow_up",
        contact_follow_up_on: "2026-11-20",
        contact_status_note: note,
        vehicle_size: "sedan",
        source: "google",
      }),
    );
    expect(html).toContain("line-clamp-1");
    expect(html).not.toContain("line-clamp-2");
    expect(html).not.toContain("Note: ");
    expect(html).toContain(`title="${note}"`);
    expect(html).toContain(">Nov 20<");
    expect(html).toContain('title="Due Nov 20, 2026"');
    expect(html).toContain("Sedan · Google");
    expect(
      leadTiming(
        { bucket: "new", created_at: null, contact_status_at: null, contact_follow_up_on: null },
        TODAY,
      ),
    ).toEqual(["Applied date unknown"]);
    expect(leadContactMeta({ bucket: "new", created_at: null, contact_status_at: null })).toBe(
      "Applied date unknown",
    );
    expect(
      leadUrgency({ bucket: "overdue", contact_follow_up_on: "2026-10-10" }, "2026-11-18"),
    ).toEqual({
      label: "39d overdue",
      title: "Due Oct 10, 2026 (39 days overdue)",
      prominent: true,
    });
    expect(leadVisibleNextStep("overdue")).toBeNull();
    expect(leadVisibleNextStep("new")).toBe("Make first contact");
    expect(leadUrgencyStat({ bucket: "overdue", contact_follow_up_on: "2026-10-10" }, "2026-11-18")).toMatchObject({
      figure: "39",
      unit: "Days Overdue",
      heat: "overdue",
    });
    expect(leadContextLine({ vehicle_size: "sedan", source: "google" })).toBe("Sedan · Google");
    expect(leadContextLine({ vehicle_size: "  ", source: null })).toBeNull();
  });
  test("every bucket: short step, distinct labeled tone, timing at most two items", () => {
    for (const b of LEAD_BUCKETS) {
      expect(LEAD_NEXT_STEP[b].length).toBeLessThanOrEqual(32);
      expect(LEAD_TONES[b].label.length).toBeGreaterThan(0);
      expect(
        leadTiming(
          {
            bucket: b,
            created_at: now,
            contact_status_at: null,
            contact_follow_up_on: "2026-11-01",
          },
          TODAY,
        ).length,
      ).toBeLessThanOrEqual(2);
    }
    expect(new Set(LEAD_BUCKETS.map((b) => LEAD_TONES[b].label)).size).toBe(LEAD_BUCKETS.length);
    expect(leadBadgeLabel("today", "Follow-Up", "Medium")).toBe("Due Today · Medium");
  });
  test("urgency color stays on brand red, amber, and green", () => {
    for (const src of [ui, body, lib]) {
      expect(src).not.toMatch(/\bblue\b|border-l-(?:blue|red|emerald|amber|violet|slate)/);
    }
    expect(body).toContain("bg-gradient-to-br");
    expect(ui).toContain("bg-gradient-to-b");
    expect(body).toContain("rounded-2xl");
  });
  test("list keeps actions, status control and readiness, drops metrics", () => {
    for (const s of [
      "tel:",
      "open-messages",
      "View Applicant",
      "<ContactStatusCell",
      "ReadinessStatePill",
      "<LeadFollowUpDraft applicationId={lead.id} bucket={lead.bucket} />",
      "Unnamed Applicant",
      "No leads need attention",
    ])
      expect(ui).toContain(s);
    for (const s of ["ReadinessMetrics", "positives", "{lead.reason}", "{lead.action}"])
      expect(ui).not.toContain(s);
  });
});
