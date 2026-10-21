/**
 * Dark lead response report. No mail, no hosted database, flag stays false.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bundled = await build({
  entryPoints: ["src/lib/lead-response-report.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@": resolve("src") },
});
const lib = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);

let checks = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  checks += 1;
  console.log("PASS", label);
}

const now = new Date("2026-10-21T16:00:00.000Z");
const declaration = readFileSync("src/lib/lead-response-report.ts", "utf8");

check(lib.LEAD_RESPONSE_REPORT_ENABLED === false, "the response report flag is a hard false");
check(
  declaration.match(/export const LEAD_RESPONSE_REPORT_ENABLED: boolean = false;/g)?.length === 1,
  "the flag is declared once",
);
check(!declaration.includes("process.env"), "the report does not read an environment flag");
check(
  !declaration.includes("email.server") && !declaration.includes("sendSms") && !declaration.includes("sendEmail"),
  "the report does not send",
);

let refused = false;
try {
  lib.assertLeadResponseReportEnabled();
} catch (error) {
  refused = /not enabled/.test(String(error?.message ?? error));
}
check(refused, "the flag assertion throws while the flag is off");

function fakeAdmin() {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      return { select() { return this; } };
    },
  };
}
const closed = fakeAdmin();
const skipped = await lib.loadLeadResponseReport(closed, now);
check(skipped.ok === false && skipped.skipped === "flag" && closed.calls.length === 0, "the loader does not read applications while the flag is off");
const loaderSrc = declaration.slice(declaration.indexOf("export async function loadLeadResponseReport"));
const loaderSig = loaderSrc.slice(0, loaderSrc.indexOf("): Promise"));
check(!loaderSig.includes("enabled"), "the loader has no enabled override");
check(
  loaderSrc.indexOf("LEAD_RESPONSE_REPORT_ENABLED") < loaderSrc.indexOf(".from("),
  "the read stays behind the flag",
);
check(loaderSrc.includes(".limit(LEAD_RESPONSE_READ_LIMIT + 1)"), "the read asks for one row past the cap");
check(loaderSrc.includes("sampleRows.slice(0, LEAD_RESPONSE_READ_LIMIT)"), "a full cap is truncated before it is totaled");
check(loaderSrc.includes('is("deleted_at", null)'), "deleted applications stay out of the report");
check(declaration.includes('!== "unqualified"') && loaderSrc.includes("activeContactStatuses()"), "unqualified leads stay out of the report");
check(!/insert\(|\.update\(|\.delete\(|\.rpc\(/.test(declaration), "the report module does not write");

const google = (overrides) => ({
  source: "google",
  created_at: "2026-10-20T12:00:00.000Z",
  contacted_at: "2026-10-20T14:00:00.000Z",
  contact_status: "new",
  contact_status_at: null,
  contact_follow_up_on: "2026-10-22",
  ...overrides,
});
const rows = [
  google({}),
  google({ created_at: "2026-10-20T08:00:00.000Z", contacted_at: "2026-10-20T12:00:00.000Z" }),
  google({ created_at: "2026-10-20T14:00:00.000Z", contacted_at: "2026-10-20T12:00:00.000Z", contact_follow_up_on: "2026-10-21" }),
  google({ created_at: "2026-10-20T15:00:00.000Z", contacted_at: null, contact_status: "new", contact_follow_up_on: "2026-10-20" }),
  google({ created_at: "2026-10-19T16:00:00.000Z", contacted_at: null, contact_status: "contacted", contact_status_at: "2026-10-20T16:00:00.000Z" }),
  google({ created_at: "2026-10-21T14:00:00.000Z", contacted_at: "2026-10-21T16:00:00.000Z", contact_status: "contacted", contact_status_at: "2026-10-21T15:00:00.000Z" }),
  google({ created_at: "2026-10-21T12:00:00.000Z", contacted_at: "2026-10-21T11:00:00.000Z", contact_status: "new" }),
  google({ created_at: "2026-10-20T17:00:00.000Z", contacted_at: null, contact_status: "new", contact_follow_up_on: "2026-10-22" }),
  google({ created_at: "2026-10-20T16:00:00.000Z", contacted_at: null, contact_status: "new", contact_follow_up_on: "2026-02-31" }),
  { source: "  ", created_at: "2026-10-19T16:00:00.000Z", contacted_at: null, contact_status: "new", contact_follow_up_on: "2026-10-21T00:00:00Z" },
  { source: "referral", created_at: "2026-10-21T14:00:00.000Z", contacted_at: "2026-10-21T15:30:00.000Z", contact_status: "new", contact_follow_up_on: null },
  { source: "minute", created_at: "2026-10-21T15:00:00.000Z", contacted_at: "2026-10-21T15:01:00.000Z", contact_status: "new", contact_follow_up_on: null },
];
const report = lib.buildLeadResponseReport(rows, now, false);
const bySource = Object.fromEntries(report.sources.map((row) => [row.source, row]));
check(bySource.google.medianHours === 3, "median time uses the two clean two-hour and four-hour contacts");
check(bySource.google.uncontactedOver24h === 1, "a status other than new is not uncontacted, and a 23-hour new lead is not either");
check(bySource.google.contactBeforeCreated === 2, "a contact time before created is surfaced and kept out of the median");
check(bySource.google.followUpsDue === 0, "the response sample does not pretend to count every follow-up");
check(bySource.Unknown.uncontactedOver24h === 1, "a blank source is Unknown");
check(bySource.referral.medianHours === 1.5 && bySource.referral.uncontactedOver24h === 0, "a contacted referral keeps its own source");
check(bySource.minute.medianHours === 1 / 60, "a one-minute median is not rounded to a tenth of an hour");
check(lib.formatResponseHours(bySource.minute.medianHours) === "1 Minute", "minute formatting rounds only when the label is built");
const due = new Map();
lib.addDueFollowUps(due, rows, now);
check(due.get("google") === 2 && due.get("Unknown") == null, "follow-ups due today or earlier count, and a timestamp or impossible date does not");
const merged = lib.applyFollowUpCounts(report, due, false);
const mergedGoogle = merged.sources.find((row) => row.source === "google");
check(mergedGoogle.followUpsDue === 2 && merged.followUpsTruncated === false, "follow-up counts are applied beside the response sample");
const onlyDue = lib.applyFollowUpCounts(lib.buildLeadResponseReport([], now, false), new Map([["office", 4]]), false);
check(onlyDue.sources.some((row) => row.source === "office" && row.followUpsDue === 4), "a follow-up outside the newest page still has a row");
check(report.truncated === false && report.readLimit === 200, "an under-cap read is not marked truncated");
const partial = lib.buildLeadResponseReport([google({})], now, true);
check(partial.truncated === true && partial.sources.length === 1, "a capped read stays marked truncated");
check(lib.formatResponseHours(null) === "—" && lib.formatResponseHours(0) === "Under 1 Minute", "a missing contact and an immediate contact stay readable");
check(lib.formatResponseHours(0.5) === "30 Minutes" && lib.formatResponseHours(1) === "1 Hour" && lib.formatResponseHours(2.5) === "2.5 Hours", "response time is labeled in minutes or hours");
check(lib.formatResponseHours(59.4 / 60) === "59 Minutes", "59.4 minutes stays in minutes");
check(lib.formatResponseHours(59.5 / 60) === "1 Hour" && lib.formatResponseHours(59.99 / 60) === "1 Hour", "59.5 to 59.99 minutes reads as 1 hour");
check(!declaration.includes("matches Lead Priorities"), "first contact is not described as the Lead Priorities rule");
check(declaration.includes("can overstate the time to first contact"), "the status stamp notes that it can overstate the first response");
check(
  declaration.includes('{ count: "exact", head: true }') &&
    declaration.includes('.lte("contact_follow_up_on", today)') &&
    loaderSrc.includes("dueFollowUps") &&
    !declaration.includes(".range("),
  "follow-ups are an exact head count, not a paged row read",
);

const fn = readFileSync("src/lib/lead-response-report.functions.ts", "utf8");
const handler = fn.slice(fn.indexOf(".handler"));
check(fn.includes(".middleware([leadResponseReportGate, requireSupabaseAuth])"), "the flag gate runs before auth");
check(
  fn.slice(fn.indexOf("const leadResponseReportGate"), fn.indexOf("export const getLeadResponseReport")).includes("assertLeadResponseReportEnabled()"),
  "the gate refuses before it continues to auth",
);
check(handler.indexOf("assertLeadResponseReportEnabled()") < handler.indexOf("requireManager"), "the handler refuses before the role check");
check(handler.indexOf("requireManager") < handler.indexOf("client.server"), "the role check is still before the database import");
check(handler.includes('await import("@/lib/roles.server")') && !fn.slice(0, fn.indexOf("const leadResponseReportGate")).includes("roles.server"), "the role module is imported only after the flag refusal");
check(!fn.includes("enabled:") && !handler.includes("data.enabled") && fn.includes("z.object({}).strict()"), "the request has no enabled override and rejects extra fields");
check(!fn.includes("email.server") && !fn.includes("sendEmail") && !fn.includes("sendSms"), "the endpoint does not send");

const ui = readFileSync("src/components/admin/LeadResponseReport.tsx", "utf8");
const gate = ui.slice(ui.indexOf("export function LeadResponseReport"), ui.indexOf("function LeadResponseReportBody"));
check(gate.includes("LEAD_RESPONSE_REPORT_ENABLED !== true") && gate.includes("if (!isManager) return null") && gate.includes("return null") && !gate.includes("useServerFn"), "the report stays unmounted while the flag is off or the viewer is not a manager");
const body = ui.slice(ui.indexOf("function LeadResponseReportBody"));
check(body.indexOf("LEAD_RESPONSE_REPORT_ENABLED !== true") < body.indexOf("load("), "the loader returns before a request while the flag is off");
check(
  ui.includes("Response And Follow-Ups") && ui.includes("Median Time To First Contact") && ui.includes("Uncontacted Over 24 Hours") && ui.includes("Follow-Ups Due"),
  "the report names the three figures by source",
);
check(ui.includes("Showing The Newest") && ui.includes("Older Leads Are Not In These Figures") && ui.includes("Contact Before Created"), "a capped read is labeled as a partial read and early contacts are shown");
check(!ui.includes("uppercase") && !ui.includes("text-transform"), "the report does not add a text transform");

const list = readFileSync("src/components/admin/LeadPriorities.tsx", "utf8");
check(list.includes("<LeadResponseReport isManager={isManager} />"), "Lead Priorities hosts the report for a manager");
check(list.includes("open-messages") && list.includes("Lead Priorities"), "the existing lead list stays in place");
const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
check(overview.includes("<LeadPriorities isManager={canSeeCollections} />") && !overview.includes("LeadResponseReport"), "Overview passes the manager bit and does not gain a second lead screen");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
check(!admin.includes("LeadResponseReport"), "the report does not add a navigation entry");
const leads = readFileSync("src/components/admin/LeadsPanel.tsx", "utf8");
check(!leads.includes("LeadResponseReport"), "the contact lead table is unchanged");

console.log(`${checks} lead response report checks passed`);
