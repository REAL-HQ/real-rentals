/**
 * Lead card ⋮ menu: option rules, Contact Status drafts, and wiring.
 * No browser, no database, no server calls, nothing is sent. 555 numbers only.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LEAD_FOLLOW_UP_PRESETS,
  LEAD_MENU_LABELS,
  addDaysIso,
  followUpDraft,
  leadDraftProblems,
  leadMenuGroups,
  notAFitDraft,
  notInterestedDraft,
  undoDraft,
  type LeadMenuLead,
} from "../src/lib/lead-card-menu";
import { contactStatusPatch } from "../src/lib/contact-status";
import { LEAD_SELECT, projectLead } from "../src/lib/lead-priorities";
import { LeadCardBody } from "../src/components/admin/LeadCardBody";

const menuSrc = readFileSync("src/components/admin/LeadCardMenu.tsx", "utf8");
const listSrc = readFileSync("src/components/admin/LeadPriorities.tsx", "utf8");
const dialogSrc = readFileSync("src/components/admin/DeleteDriverDialog.tsx", "utf8");
const overviewSrc = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
const adminSrc = readFileSync("src/routes/admin.tsx", "utf8");
const TODAY = "2026-11-17";

const lead = (over: Partial<LeadMenuLead> = {}): LeadMenuLead => ({
  id: "00000000-0000-4000-8000-000000000001",
  full_name: "Test Lead",
  phone: "+18135550123",
  email: "lead@example.com",
  contact_status: "new",
  contact_status_note: null,
  contact_follow_up_on: null,
  ...over,
});

describe("which options show", () => {
  test("Owner: contact group, status group, Delete alone and last", () => {
    const g = leadMenuGroups(lead({ contact_status: "contacted" }), "owner");
    expect(g).toEqual([
      ["open", "copy_phone", "copy_email"],
      ["follow_up", "not_interested", "not_a_fit"],
      ["delete"],
    ]);
  });
  test("Manager and Coordinator never see Delete (the delete DB functions are Owner-only)", () => {
    for (const t of ["manager", "coordinator"] as const) {
      expect(leadMenuGroups(lead(), t).flat()).not.toContain("delete");
      expect(leadMenuGroups(lead({ contact_status: "interested" }), t).flat()).toContain("not_interested");
    }
  });
  test("New leads get no status quick actions (would fake first contact)", () => {
    expect(leadMenuGroups(lead({ contact_status: "new" }), "owner")).toEqual([["open", "copy_phone", "copy_email"], ["delete"]]);
    expect(leadMenuGroups(lead({ contact_status: "" }), "manager")).toEqual([["open", "copy_phone", "copy_email"]]);
  });
  test("no staff tier: no menu at all", () => {
    expect(leadMenuGroups(lead(), null)).toEqual([]);
  });
  test("copy options only when there is something to copy", () => {
    const flat = leadMenuGroups(lead({ phone: null, email: "  " }), "owner").flat();
    expect(flat).not.toContain("copy_phone");
    expect(flat).not.toContain("copy_email");
    expect(flat[0]).toBe("open");
  });
  test("labels are Title Case strings and skipped options are not offered", () => {
    for (const label of Object.values(LEAD_MENU_LABELS)) {
      for (const word of label.replace("…", "").split(/[\s-]+/)) expect(word[0]).toBe(word[0].toUpperCase());
    }
    for (const label of LEAD_FOLLOW_UP_PRESETS.map((p) => p.label))
      for (const word of label.split(" ")) expect(word[0]).toBe(word[0].toUpperCase());
    const all = Object.values(LEAD_MENU_LABELS).join(" ");
    for (const s of ["Priority", "Assign", "Duplicate"]) expect(all).not.toContain(s);
  });
});

describe("Contact Status drafts pass the same rules the server re-runs", () => {
  test("follow-up on a New lead becomes Follow-Up with the date, note kept", () => {
    const d = followUpDraft(lead({ contact_status_note: "asked about a Camry" }), TODAY, 3);
    expect(d).toEqual({ status: "follow_up", note: "asked about a Camry", followUpOn: "2026-11-20" });
    expect(leadDraftProblems(d)).toEqual([]);
  });
  test("follow-up keeps a status that already carries a date", () => {
    for (const s of ["contacted", "interested", "documents", "attempted", "voicemail", "unresponsive", "follow_up"]) {
      const d = followUpDraft(lead({ contact_status: s }), TODAY, 7);
      expect(d.status).toBe(s as never);
      expect(d.followUpOn).toBe("2026-11-24");
      expect(leadDraftProblems(d)).toEqual([]);
    }
  });
  test("date math crosses months and years without time zone drift", () => {
    expect(addDaysIso("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysIso("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDaysIso("2026-03-07", 1)).toBe("2026-03-08");
  });
  test("Not Interested = Declined, keeps the note, clears the date", () => {
    const d = notInterestedDraft(lead({ contact_status: "contacted", contact_status_note: "has a car", contact_follow_up_on: "2026-11-20" }));
    expect(d).toEqual({ status: "declined", note: "has a car", followUpOn: "" });
    expect(leadDraftProblems(d)).toEqual([]);
    expect(contactStatusPatch(d).contact_follow_up_on).toBeNull();
  });
  test("Not A Fit = Unqualified and needs a reason", () => {
    expect(leadDraftProblems(notAFitDraft("   ")).length).toBeGreaterThan(0);
    const d = notAFitDraft("  Out of state license ");
    expect(d).toEqual({ status: "unqualified", note: "Out of state license", followUpOn: "" });
    expect(leadDraftProblems(d)).toEqual([]);
  });
  test("Undo puts back exactly what the card showed", () => {
    const before = lead({ contact_status: "follow_up", contact_status_note: "call after 5", contact_follow_up_on: "2026-11-19" });
    const d = undoDraft(before);
    expect(d).toEqual({ status: "follow_up", note: "call after 5", followUpOn: "2026-11-19" });
    expect(leadDraftProblems(d)).toEqual([]);
    expect(undoDraft(lead({ contact_status: "bogus" })).status).toBe("new");
  });
});

describe("card wiring", () => {
  test("the card renders the menu slot in the top-right of the name row", () => {
    const row = projectLead(
      { id: "a1", full_name: "Test Lead", phone: "555", email: null, status: "new", created_at: new Date().toISOString(), contact_status: "new", contact_status_note: null, contact_follow_up_on: null, contact_status_at: null, contact_status_by: null } as never,
      "new",
    );
    const html = renderToStaticMarkup(
      h(LeadCardBody, { lead: row, today: TODAY, displayName: "Test Lead", name: h("a", null, "Test Lead"), status: h("span", null, "New"), actions: h("div", null, "Call"), menu: h("button", { "data-kebab": "" }, "menu") }),
    );
    // Name, then the ⋮ control, still above the next-step line.
    expect(html.indexOf(">Test Lead<")).toBeLessThan(html.indexOf("data-kebab"));
    expect(html.indexOf("data-kebab")).toBeLessThan(html.indexOf("Make first contact"));
    expect(html).toMatch(/flex items-start gap-2[\s\S]*Test Lead[\s\S]*data-kebab/);
  });
  test("lead rows carry email for Copy Email", () => {
    expect(LEAD_SELECT.split(",")).toContain("email");
  });
  test("menu: kebab icon, accessible name, stops propagation, Delete red and last after a divider", () => {
    expect(menuSrc).toContain("MoreVertical");
    expect(menuSrc).toContain("aria-label={`Lead Actions For ${name}`}");
    expect(menuSrc).toMatch(/onClick=\{stop\} onKeyDown=\{stop\} onPointerDown=\{stop\}/);
    expect(menuSrc).toContain("e.stopPropagation()");
    expect(menuSrc).toContain('action === "delete" ? "text-real-red focus:text-real-red"');
    expect(menuSrc).toContain("<DropdownMenuSeparator />");
    expect(menuSrc).not.toMatch(/bg-white|text-transform|uppercase/);
  });
  test("delete is the existing recoverable Owner path; Undo restores; no raw deletes", () => {
    expect(menuSrc).toContain('mode="soft"');
    expect(menuSrc).toContain('subject="Lead"');
    expect(menuSrc).toContain("restoreDriver");
    expect(menuSrc).not.toMatch(/\.delete\(|purgeDriver|supabase\b/);
    expect(dialogSrc).toContain("deleteDriver");
    expect(dialogSrc).toContain("Delete ${leadName}?");
    expect(menuSrc).toContain("setContactStatus");
  });
  test("tier flows from the admin shell to every lead card", () => {
    expect(adminSrc).toContain('<OverviewPanel canSeeCollections={tierAllows(tier, "manager")} tier={tier} />');
    expect(overviewSrc).toContain("tier={tier}");
    expect(listSrc).toContain("<LeadCardMenu lead={lead} today={result.today} tier={tier} onChanged={refresh} />");
  });
  test("no real phone numbers in the menu code or this test", () => {
    const self = readFileSync("scripts/lead-card-menu.test.ts", "utf8");
    for (const src of [menuSrc, self]) {
      for (const m of src.match(/(?<![\w-])\+?1?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w-])/g) ?? []) expect(m.replace(/\D/g, "").slice(-7, -4)).toBe("555");
    }
  });
});
