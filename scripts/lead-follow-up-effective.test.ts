/**
 * Stale follow-up dates restart the day after the last contact.
 * Run: bun test scripts/lead-follow-up-effective.test.ts
 * WRITE_LEAD_FOLLOWUP_HTML=1 writes the Overview card screenshot to /tmp.
 */
import { describe, expect, test } from "bun:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import { nextBusinessDay } from "../src/lib/contact-status";
import { leadUrgency } from "../src/lib/lead-card";
import { LeadCardBody } from "../src/components/admin/LeadCardBody";
import { LeadCardContactActions } from "../src/components/admin/LeadCardActions";
import {
  effectiveFollowUpOn,
  lastContactDay,
  leadBucket,
  projectLead,
  type LeadRow,
} from "../src/lib/lead-priorities";

const TODAY = "2026-11-26";

function lead(over: Partial<LeadRow> & Pick<LeadRow, "id" | "full_name">): LeadRow {
  return {
    phone: "8135550100",
    email: null,
    status: "reviewing",
    created_at: "2026-09-01T15:00:00Z",
    contact_status: "contacted",
    contact_status_note: null,
    contact_follow_up_on: null,
    contact_status_at: null,
    contact_status_by: null,
    ...over,
  };
}

describe("effective follow-up", () => {
  test("a stale date restarts the next business day, and a later follow-up stays overdue", () => {
    const stale = lead({
      id: "stale",
      full_name: "Casey Nguyen",
      contact_follow_up_on: "2026-10-01",
      contacted_at: "2026-11-18T16:00:00Z",
    });
    expect(lastContactDay(stale)).toBe("2026-11-18");
    expect(nextBusinessDay("2026-11-18")).toBe("2026-11-19");
    expect(effectiveFollowUpOn(stale)).toBe("2026-11-19");
    expect(leadBucket(stale, TODAY)).toBe("overdue");
    const shown = projectLead(stale, "overdue");
    expect(leadUrgency(shown, TODAY)).toEqual({
      label: "7d overdue",
      title: "Due Nov 19, 2026 (7 days overdue)",
      prominent: true,
    });
    expect(leadUrgency({ bucket: "overdue", contact_follow_up_on: "2026-10-01" }, TODAY)?.label).toBe("56d overdue");

    const weekend = lead({
      id: "weekend",
      full_name: "Weekend",
      contact_follow_up_on: "2026-10-01",
      contact_status_at: "2026-11-21T16:00:00Z",
    });
    expect(effectiveFollowUpOn(weekend)).toBe("2026-11-23");

    const sameDay = lead({
      id: "same",
      full_name: "Same Day",
      contact_follow_up_on: "2026-11-18",
      contacted_at: "2026-11-18T16:00:00Z",
    });
    expect(effectiveFollowUpOn(sameDay)).toBe("2026-11-18");

    const genuine = lead({
      id: "genuine",
      full_name: "Sam Patel",
      contact_status: "follow_up",
      contact_follow_up_on: "2026-11-20",
      contacted_at: "2026-11-10T16:00:00Z",
      contact_status_note: "Asked to call after the holiday.",
    });
    expect(effectiveFollowUpOn(genuine)).toBe("2026-11-20");
    expect(leadBucket(genuine, TODAY)).toBe("overdue");
    expect(leadUrgency(projectLead(genuine, "overdue"), TODAY)?.label).toBe("6d overdue");
  });
});

function card(row: LeadRow) {
  const bucket = leadBucket(row, TODAY);
  if (!bucket) throw new Error("missing bucket");
  const projected = projectLead(row, bucket);
  return h(LeadCardBody, {
    lead: projected,
    today: TODAY,
    displayName: row.full_name ?? "Applicant",
    name: row.full_name ?? "Applicant",
    status: h("span", { className: "rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium" }, projected.contactLabel),
    actions: h(LeadCardContactActions, { applicationId: row.id, phone: row.phone }),
  });
}

if (process.env.WRITE_LEAD_FOLLOWUP_HTML === "1") {
  const stale = lead({
    id: "stale",
    full_name: "Casey Nguyen",
    contact_follow_up_on: "2026-10-01",
    contacted_at: "2026-11-18T16:00:00Z",
    contact_status_note: "Follow-up was Oct 1. Contact was logged Nov 18.",
  });
  const genuine = lead({
    id: "genuine",
    full_name: "Sam Patel",
    contact_status: "follow_up",
    contact_follow_up_on: "2026-11-20",
    contacted_at: "2026-11-10T16:00:00Z",
    contact_status_note: "Follow-up Nov 20 is after the last contact.",
  });
  const body = renderToStaticMarkup(
    h(
      "section",
      { className: "rounded-2xl border border-border bg-secondary p-4 text-card-foreground sm:p-5" },
      h("h2", { className: "text-lg font-semibold" }, "Lead Priorities"),
      h("p", { className: "text-sm text-muted-foreground" }, "Who needs attention and what to do next"),
      h(
        "p",
        { className: "mt-3 text-sm text-foreground" },
        "Adam Waez (closed rental) and Arielle (active rental) are not listed.",
      ),
      h(
        "ul",
        { className: "mt-4 grid grid-cols-1 gap-3 md:grid-cols-2" },
        h("li", null, card(stale)),
        h("li", null, card(genuine)),
      ),
    ),
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="http://127.0.0.1:5173/src/styles.css"></head><body class="bg-[#F6F6F7]"><div class="mx-auto max-w-4xl p-6">${body}</div></body></html>`;
  writeFileSync("/tmp/lead-follow-up-cards.html", html);
}
