/**
 * Compact Lead Priorities cards: server-rendered card, real state variations.
 * No browser, no database, no server calls, nothing is sent.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LEAD_AVATAR_CLASS,
  LEAD_TONES,
  LEAD_NEXT_STEP,
  leadActivity,
  leadAvatarQuality,
  leadBadgeLabel,
  leadContactMeta,
  leadEventStamp,
  leadTiming,
  leadUrgency,
  leadVisibleNextStep,
} from "../src/lib/lead-card";
import { LEAD_BUCKETS, projectLead, type LeadBucket } from "../src/lib/lead-priorities";
import { LeadCardContactActions } from "../src/components/admin/LeadCardActions";
import { LeadCardBody } from "../src/components/admin/LeadCardBody";
import { ReadinessStatePill } from "../src/components/admin/ui";

const ui = readFileSync("src/components/admin/LeadPriorities.tsx", "utf8");
const actionsSrc = readFileSync("src/components/admin/LeadCardActions.tsx", "utf8");
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
    expect(html).toContain(">Make First Contact<");
    expect(html).toContain("Applied Today");
    expect(html).not.toContain("Follow Up And Log The Outcome");
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
    // The contact stamp is after Nov 5, so the old follow-up is not the overdue count.
    expect(html).toContain('title="Overdue"');
    expect(html).not.toContain(">3d overdue<");
    expect(html).not.toContain("Due Nov 5, 2026");
    expect(html).toContain("bg-[#F9D0CC]");
    expect(html).toContain("text-[#111114]");
    expect(html).not.toContain("text-brand");
    expect(html).not.toContain("inset");
    expect(html).not.toContain("real-red");
    expect(html).not.toContain("border-l-");
    expect(body).not.toContain("inset_3px");
    expect(body).not.toContain("real-red");
    expect(html).toContain("Last Contact Today");
    expect(html).not.toContain("Overdue · Urgent");
    expect(html).not.toContain("Follow Up And Log The Outcome");
    expect(html).not.toContain("Applied");
  });
  test("interested drops the duplicate stage chip; documents keep the missing-contact line", () => {
    const interested = render(row("interested", { contact_status: "interested" }));
    expect(interested).toContain('data-status="">Interested<');
    expect(interested).not.toContain(">High<");
    expect(interested).toContain(">Confirm Next Steps<");
    const info = render(row("information", { contact_status: "documents" }));
    expect(info).toContain('data-status="">Documents<');
    expect(info).not.toContain("Waiting on Info · Medium");
    expect(info).toContain("No Contact Logged");
    expect(info).not.toContain("No contact logged");
    expect(info).toContain(">Check What Info Is Missing<");
  });
  test("note is one line with the full text on hover; missing date is honest", () => {
    const note = "x".repeat(400);
    const html = render(
      row("future", {
        contact_status: "follow_up",
        contact_follow_up_on: "2026-11-20",
        contact_status_note: note,
      }),
    );
    expect(html).toContain("line-clamp-1");
    expect(html).not.toContain("line-clamp-2");
    expect(html).not.toContain("Note: ");
    expect(html).toContain(`title="${note}"`);
    expect(html).toContain(">Due Nov 20<");
    expect(html).toContain('title="Due Nov 20, 2026"');
    expect(
      leadTiming(
        { bucket: "new", created_at: null, contact_status_at: null, contact_follow_up_on: null },
        TODAY,
      ),
    ).toEqual(["Applied date unknown"]);
    expect(leadContactMeta({ bucket: "new", created_at: null, contact_status_at: null })).toBe(
      "Applied Date Unknown",
    );
    expect(
      leadUrgency({ bucket: "overdue", contact_follow_up_on: "2026-10-10" }, "2026-11-18"),
    ).toEqual({
      label: "39d overdue",
      title: "Due Oct 10, 2026 (39 days overdue)",
      prominent: true,
    });
    expect(leadVisibleNextStep("overdue")).toBeNull();
    expect(leadVisibleNextStep("new")).toBe("Make First Contact");
    expect(html).toContain(">Review Note Before Follow-Up<");
  });
  test("every next step is Title Case in the source string", () => {
    expect(LEAD_NEXT_STEP).toEqual({
      overdue: "Follow Up And Log The Outcome",
      new: "Make First Contact",
      interested: "Confirm Next Steps",
      today: "Follow Up Today",
      information: "Check What Info Is Missing",
      future: "Review Note Before Follow-Up",
      incomplete: "Ask Them To Finish",
    });
    for (const step of Object.values(LEAD_NEXT_STEP)) {
      for (const word of step.split(/[\s-]+/)) {
        expect(word[0]).toBe(word[0].toUpperCase());
      }
      expect(step).toBe(step.replace(/\b\w/g, (c) => c.toUpperCase()));
    }
    expect(lib).not.toMatch(/text-transform|uppercase|capitalize/);
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
  test("neutral cards never reintroduce the rejected blue accents or gradients", () => {
    for (const src of [body, lib]) {
      expect(src).not.toMatch(/blue|border-l-(?:blue|red|emerald|amber|violet|slate)/);
    }
    for (const src of [ui, body, lib])
      expect(src).not.toMatch(/bg-gradient|linear-gradient|bg-linear|\bfrom-\w+-\d|\bvia-\w+-\d/);
  });
  test("list keeps actions, status control and readiness, drops metrics", () => {
    for (const s of [
      "View Applicant",
      "<ContactStatusCell",
      "ReadinessStatePill",
      "<LeadFollowUpDraft applicationId={lead.id} bucket={lead.bucket} />",
      "Unnamed Applicant",
      "No leads need attention",
      "LeadCardContactActions",
      "leadAvatarQuality",
      "grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3",
      "ArrowUpRight",
    ])
      expect(ui).toContain(s);
    for (const s of [
      "tel:",
      "open-messages",
      "ReadinessMetrics",
      "positives",
      "{lead.reason}",
      "{lead.action}",
      'size="icon"',
    ])
      expect(ui).not.toContain(s);
    expect(ui.indexOf("ArrowUpRight")).toBeLessThan(ui.indexOf("LeadCardContactActions"));
    for (const s of [
      "tel:",
      "open-messages",
      "\n              Call\n",
      "\n          Text\n",
      "data-lead-call",
      "data-lead-text",
      "flex w-full",
      "flex-1",
    ])
      expect(actionsSrc).toContain(s);
    expect(actionsSrc).not.toMatch(/text-transform|uppercase|capitalize/);
  });
  test("Call and Text span the card; Call is disabled without a phone", () => {
    const withPhone = renderToStaticMarkup(
      h(LeadCardContactActions, { applicationId: "a1", phone: "+1 (813) 555-0100" }),
    );
    expect(withPhone).toContain('href="tel:+18135550100"');
    expect(withPhone).toContain(">Call<");
    expect(withPhone).toContain(">Text<");
    expect(withPhone).toContain("flex w-full");
    expect(withPhone.match(/flex-1/g)?.length).toBe(2);
    expect(withPhone).not.toMatch(/\sdisabled=""/);

    const noPhone = renderToStaticMarkup(
      h(LeadCardContactActions, { applicationId: "a1", phone: null }),
    );
    expect(noPhone).not.toContain("tel:");
    expect(noPhone).toContain(">Call<");
    expect(noPhone).toContain(">Text<");
    const callTag = noPhone.match(/<button\b[^>]*data-lead-call[^>]*>/)?.[0] ?? "";
    expect(callTag).toMatch(/\sdisabled=""/);
    const textTag = noPhone.match(/<button\b[^>]*data-lead-text[^>]*>/)?.[0] ?? "";
    expect(textTag).not.toMatch(/\sdisabled=""/);
    expect(noPhone.match(/flex-1/g)?.length).toBe(2);
  });
  test("activity line is Title Case, stamped in Eastern time, and stays one line", () => {
    const now = new Date("2026-11-22T18:00:00Z");
    const applied = leadContactMeta(
      { bucket: "new", created_at: "2026-11-22T15:42:00Z", contact_status_at: null },
      now,
    );
    expect(applied).toBe("Applied Today · Sun Nov 22, 10:42 AM");
    const older = leadActivity(
      {
        bucket: "interested",
        created_at: "2026-11-18T15:00:00Z",
        contact_status_at: "2026-11-20T20:15:00Z",
      },
      now,
    );
    expect(older).toEqual({
      label: "Last Contact",
      when: { long: "Fri Nov 20, 3:15 PM", short: "Fri 11/20, 3:15 PM" },
    });
    expect(
      leadContactMeta(
        { bucket: "information", created_at: "2026-11-20T20:15:00Z", contact_status_at: null },
        now,
      ),
    ).toBe("No Contact Logged");
    expect(leadEventStamp("not-a-date")).toBeNull();
    const html = render(row("new"));
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("truncate");
    expect(html).toContain("flex-nowrap");
    expect(html).toContain("@min-[16rem]:hidden");
    expect(html).toContain("@min-[16rem]:inline");
    const timing = html.slice(
      html.indexOf("data-lead-timing"),
      html.indexOf("</p>", html.indexOf("data-lead-timing")),
    );
    expect(timing).toContain("flex-nowrap");
    expect(timing).toContain("whitespace-nowrap");
    expect(timing).toContain("truncate");
    expect(timing).not.toContain("flex-wrap");
  });
  test("avatar color follows the existing readiness states", () => {
    expect(leadAvatarQuality(null)).toBe("neutral");
    expect(
      leadAvatarQuality({ state: "promising_more_info", qualification: 80, coverage: 24 }),
    ).toBe("promising");
    expect(leadAvatarQuality({ state: "decision_ready", qualification: 90, coverage: 70 })).toBe(
      "promising",
    );
    expect(leadAvatarQuality({ state: "more_info_needed", qualification: 80, coverage: 10 })).toBe(
      "close",
    );
    expect(leadAvatarQuality({ state: "more_info_needed", qualification: 40, coverage: 10 })).toBe(
      "needs_info",
    );
    expect(leadAvatarQuality({ state: "more_info_needed", qualification: null, coverage: 0 })).toBe(
      "needs_info",
    );
    expect(leadAvatarQuality({ state: "needs_attention", qualification: 90, coverage: 80 })).toBe(
      "bad",
    );
    expect(LEAD_AVATAR_CLASS.promising).toContain("bg-[#CDEFD6]");
    expect(LEAD_AVATAR_CLASS.close).toContain("bg-[#FFF1B8]");
    expect(LEAD_AVATAR_CLASS.bad).toContain("bg-[#F9D0CC]");
    expect(LEAD_AVATAR_CLASS.needs_info).toContain("bg-white");
    expect(LEAD_AVATAR_CLASS.needs_info).toContain("border-[#D0D1D7]");
    expect(LEAD_AVATAR_CLASS.neutral).toContain("bg-[#ECEDF1]");
    for (const tone of Object.values(LEAD_AVATAR_CLASS)) {
      expect(tone).toContain("text-[#111114]");
      expect(tone).not.toContain("text-white");
    }
    const html = render(row("new"));
    expect(html).toContain('data-lead-avatar="neutral"');
    expect(html).toContain(LEAD_AVATAR_CLASS.neutral);
    const attention = renderToStaticMarkup(
      h(ReadinessStatePill, { state: "needs_attention", short: true, soft: true }),
    );
    expect(attention).toContain("bg-[#F9D0CC]");
    expect(attention).toContain("text-[#111114]");
    expect(attention).not.toContain("#D03020");
    expect(
      renderToStaticMarkup(
        h(ReadinessStatePill, { state: "promising_more_info", short: true, soft: true }),
      ),
    ).toContain("#FFF1B8");
    expect(
      renderToStaticMarkup(
        h(ReadinessStatePill, { state: "decision_ready", short: true, soft: true }),
      ),
    ).toContain("#CDEFD6");
    expect(
      renderToStaticMarkup(h(ReadinessStatePill, { state: "needs_attention", short: true })),
    ).not.toContain("bg-[#F9D0CC]");
    expect(ui).toContain("<ReadinessStatePill state={readinessResult.state} short soft />");
  });
});
