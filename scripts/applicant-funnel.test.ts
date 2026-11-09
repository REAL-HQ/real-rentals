import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  APPLICANT_FUNNEL_ENABLED,
  SUBMITTED_TO_APPROVED_NOTE,
  applicantFunnelCsv,
  assertApplicantFunnelEnabled,
  buildApplicantFunnel,
  funnelWindow,
  type FunnelApplication,
  type FunnelCsvRow,
} from "../src/lib/applicant-funnel";

const day = 86_400_000;

function app(partial: Partial<FunnelApplication> & Pick<FunnelApplication, "id" | "status">): FunnelApplication {
  return {
    createdAt: "2026-10-20T15:00:00.000Z",
    approvedAt: null,
    firstRentalAt: null,
    ...partial,
  };
}

describe("applicant funnel flag", () => {
  it("is off and the guard refuses", () => {
    assert.equal(APPLICANT_FUNNEL_ENABLED, false);
    assert.throws(() => assertApplicantFunnelEnabled(), /Applicant funnel is not enabled/);
  });

  it("refuses in the server handler before the role check and before any read", () => {
    const source = readFileSync("src/lib/applicant-funnel.functions.ts", "utf8");
    const handler = source.slice(source.indexOf(".handler("));
    const guard = handler.indexOf("assertApplicantFunnelEnabled()");
    const role = handler.indexOf("requireManager(");
    const read = handler.indexOf('.from("');
    assert.ok(guard !== -1 && guard < role && role < read);
    assert.doesNotMatch(source, /supabaseAdmin|stripe|\.insert\(|\.update\(|\.delete\(|full_name|email|phone/);
    assert.match(source, /select\("id,status,created_at"\)/);
    assert.match(source, /select\("application_id,created_at"\)/);
    assert.match(source, /select\("entity_id,created_at"\)/);
    assert.match(source, /action", "application\.approved"/);
  });

  it("keeps the tab off the rail and sends a direct link back to overview", () => {
    const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
    const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
    assert.equal(tabs.includes("funnel"), false);
    const visible = nav.slice(nav.indexOf("export function visibleTabs"));
    const guard = visible.indexOf('if (!APPLICANT_FUNNEL_ENABLED || !tierAllows(tier, "manager")) return withFinance(tabs, tier);');
    const insert = visible.indexOf("insertFunnel");
    assert.ok(guard !== -1 && guard < insert);
    assert.match(nav, /APPLICANT_FUNNEL_ENABLED && tierAllows\(tier, "manager"\)/);
    const admin = readFileSync("src/routes/admin.tsx", "utf8");
    assert.match(admin, /urlTab === "funnel"[\s\S]*!APPLICANT_FUNNEL_ENABLED \|\| \(tier && !tierAllows\(tier, "manager"\)\)\) return "overview"/);
    assert.match(admin, /APPLICANT_FUNNEL_ENABLED && tab === "funnel" && <ApplicantFunnelPanel \/>/);
  });
});

describe("eastern window", () => {
  it("starts at Eastern midnight and includes today", () => {
    const summer = funnelWindow(7, new Date("2026-10-21T16:00:00.000Z"));
    assert.equal(summer.start, "2026-10-15T04:00:00.000Z");
    assert.equal(summer.endDate, "2026-10-21");
    assert.equal(summer.startDate, "2026-10-15");

    const afterSpring = funnelWindow(7, new Date("2026-03-09T12:00:00.000Z"));
    assert.equal(afterSpring.start, "2026-03-03T05:00:00.000Z");
    assert.equal(afterSpring.endDate, "2026-03-09");

    const afterFall = funnelWindow(7, new Date("2026-11-02T12:00:00.000Z"));
    assert.equal(afterFall.start, "2026-10-27T04:00:00.000Z");
    assert.equal(afterFall.endDate, "2026-11-02");
  });
});

describe("applicant funnel report", () => {
  const window = funnelWindow(30, new Date("2026-10-21T16:00:00.000Z"));

  it("counts current stages, treats a rental as renting, and names the largest drop", () => {
    const report = buildApplicantFunnel(
      [
        app({ id: "p1", status: "partial" }),
        app({ id: "p2", status: "partial" }),
        app({ id: "p3", status: "partial" }),
        app({ id: "p4", status: "partial" }),
        app({ id: "n1", status: "new" }),
        app({ id: "c1", status: "complete" }),
        app({ id: "r1", status: "reviewing" }),
        app({ id: "a1", status: "approved", approvedAt: "2026-10-18T00:00:00.000Z" }),
        app({
          id: "rent1",
          status: "approved",
          approvedAt: "2026-10-10T00:00:00.000Z",
          firstRentalAt: "2026-10-14T00:00:00.000Z",
        }),
        app({ id: "d1", status: "declined" }),
        app({ id: "x1", status: "closed" }),
        app({ id: "active-rent", status: "active", firstRentalAt: "2026-10-12T00:00:00.000Z" }),
      ],
      window,
    );

    const stage = (id: string) => report.stages.find((row) => row.id === id)!;
    assert.equal(stage("started").here, 4);
    assert.equal(stage("complete").here, 2);
    assert.equal(stage("reviewing").here, 1);
    assert.equal(stage("approved").here, 1);
    assert.equal(stage("declined").here, 1);
    assert.equal(stage("declined").label, "Declined");
    assert.equal(stage("declined").conversion, null);
    assert.equal(stage("renting").here, 2);
    assert.equal(stage("started").reached, 10);
    assert.equal(stage("complete").reached, 6);
    assert.equal(stage("complete").conversion, "60%");
    assert.equal(stage("renting").conversion, "66.7%");
    assert.equal(report.omittedCount, 1);
    assert.deepEqual(report.omittedStatuses, ["Closed"]);
    assert.equal(report.dropOffLabel, "Started or Partial");
    assert.equal(report.dropOffDetail, "4 did not reach Complete.");
    assert.equal(report.submittedToApproved, null);
    assert.equal(report.submittedToApprovedNote, SUBMITTED_TO_APPROVED_NOTE);
    assert.equal(report.approvedToRental, "4 days");
    assert.match(report.approvedToRentalNote ?? "", /left out/);
  });

  it("omits the rental median when neither timestamp is present", () => {
    const report = buildApplicantFunnel([app({ id: "p1", status: "partial" })], window);
    assert.equal(report.approvedToRental, null);
    assert.match(report.approvedToRentalNote ?? "", /omitted/);
    assert.equal(report.stages.find((row) => row.id === "started")?.here, 1);
  });

  it("leaves a rental recorded before approval out of the median", () => {
    const report = buildApplicantFunnel(
      [
        app({
          id: "backwards",
          status: "approved",
          approvedAt: "2026-10-20T00:00:00.000Z",
          firstRentalAt: "2026-10-18T00:00:00.000Z",
        }),
      ],
      window,
    );
    assert.equal(report.stages.find((row) => row.id === "renting")?.here, 1);
    assert.equal(report.approvedToRental, null);
    assert.match(report.approvedToRentalNote ?? "", /omitted/);
  });
});

describe("applicant funnel csv", () => {
  it("keeps the application id and drops every other personal field", () => {
    const row = {
      application_id: "app-1",
      stage: "Complete",
      status: "new",
      created_at: "2026-10-20T15:00:00.000Z",
      approved_at: "",
      first_rental_at: "",
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "555",
    } as FunnelCsvRow;
    const csv = applicantFunnelCsv([row]);
    assert.match(csv, /^application_id,stage,status,created_at,approved_at,first_rental_at\napp-1,Complete,new,/);
    assert.doesNotMatch(csv, /Ada|ada@|555|full_name|email|phone/);
  });
});
