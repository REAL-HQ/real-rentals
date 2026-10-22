/**
 * Dark Lead Priorities follow-up drafts. No mail, no SMS, no hosted database.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bundled = await build({
  entryPoints: ["src/lib/lead-followups.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@": resolve("src") },
});
const lib = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

let checks = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  checks += 1;
  console.log("PASS", label);
}

const today = "2026-10-21";
const id = "11111111-1111-4111-8111-111111111111";

function row(overrides) {
  return {
    id,
    full_name: "Sam Rivera",
    phone: "5550100",
    status: "reviewing",
    created_at: "2026-10-01T12:00:00Z",
    contact_status: "follow_up",
    contact_status_note: "SECRET staff note",
    contact_follow_up_on: "2026-10-20",
    contact_status_at: "2026-10-18T15:00:00.000Z",
    contact_status_by: "staff@example.com",
    ...overrides,
  };
}

check(lib.LEAD_FOLLOWUPS_ENABLED === false, "the follow-up flag is a hard false");
const declaration = readFileSync("src/lib/lead-followups.ts", "utf8");
check(
  declaration.match(/export const LEAD_FOLLOWUPS_ENABLED: boolean = false;/g)?.length === 1,
  "the flag is declared once",
);
check(!declaration.includes("process.env") && !declaration.includes("email.server") && !declaration.includes("sendSms") && !declaration.includes("sendEmail"), "the draft module does not read an env flag or a sender");

const overdue = lib.leadFollowUpDraft(row({}), today);
check(overdue?.bucket === "overdue" && overdue.label === "Overdue Follow-Up", "an overdue follow-up gets a draft");
check(overdue.subject === "Following Up On Your Application", "the overdue subject is fixed wording");
check(overdue.body.startsWith("Hi Sam,") && overdue.body.includes("REAL RENTALS") && !overdue.body.includes("approved") && !overdue.body.includes("reserved"), "the draft does not promise a car or an approval");
check(!JSON.stringify(overdue).includes("SECRET") && !JSON.stringify(overdue).includes("staff@example.com") && !JSON.stringify(overdue).includes("5550100"), "the draft leaves out the note, the staff address, and the phone");

const dueToday = lib.leadFollowUpDraft(row({ contact_follow_up_on: today, contact_status: "attempted" }), today);
check(dueToday?.bucket === "today" && dueToday.label === "Due Today" && dueToday.subject === "Checking In On Your Application", "a follow-up due today gets a draft");

check(lib.leadFollowUpDraft(row({ contact_status: "new", contact_follow_up_on: today }), today) === null, "a new lead due today stays a first contact, not a follow-up draft");
check(lib.leadFollowUpDraft(row({ contact_status: "interested", contact_follow_up_on: today }), today) === null, "an interested lead due today stays on the interested action");
check(lib.leadFollowUpDraft(row({ contact_follow_up_on: "2026-10-22", contact_status: "follow_up" }), today) === null, "a future follow-up has no draft yet");
check(lib.leadFollowUpDraft(row({ contact_status: "documents", contact_follow_up_on: null }), today) === null, "waiting on documents is not a follow-up draft");
check(lib.leadFollowUpDraft(row({ contact_status: "unqualified", contact_follow_up_on: "2026-10-01" }), today) === null, "an unqualified lead gets no draft");
check(lib.leadFollowUpDraft(row({ status: "declined", contact_follow_up_on: "2026-10-01" }), today) === null, "a declined application gets no draft");
check(lib.leadFollowUpDraft(row({ contact_follow_up_on: "2026-10-21T00:00:00Z" }), today) === null, "a timestamp is not a follow-up date");
check(lib.leadFollowUpDraft(row({ full_name: "Ann <script>\nRivera", contact_follow_up_on: "2026-10-20" }), today).body.startsWith("Hi Ann,") && !lib.leadFollowUpDraft(row({ full_name: "Ann <script>\nRivera" }), today).body.includes("\n"), "a name cannot add a second line");
check(lib.leadFollowUpDraft(row({ full_name: null }), today).body.startsWith("Hi there,"), "a missing name uses a plain greeting");
check(lib.followUpDateLabel("2026-10-21") === "October 21, 2026", "the follow-up date stays on its calendar day");
check(lib.followUpDateLabel("2026-02-31") === "" && lib.leadFollowUpDraft(row({ contact_follow_up_on: "2026-02-31" }), today) === null, "an impossible date is not a follow-up");
check(lib.leadFollowUpDraft(row({ contact_status: "new", contact_follow_up_on: "2026-10-19" }), today)?.bucket === "overdue", "an overdue new lead still gets the overdue draft");

function fakeAdmin(result) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const q = {
        select(columns) {
          calls.push(columns);
          return q;
        },
        eq() { return q; },
        is() { return q; },
        maybeSingle: async () => result,
      };
      return q;
    },
  };
}

const closed = fakeAdmin({ data: row({}), error: null });
const skipped = await lib.loadLeadFollowUp(closed, id, new Date("2026-10-21T16:00:00Z"));
check(skipped.ok === false && skipped.skipped === "flag" && closed.calls.length === 0, "the loader does not read applications while the flag is off");
let refused = false;
try { lib.assertLeadFollowupsEnabled(); } catch (error) { refused = /not enabled/.test(String(error?.message ?? error)); }
check(refused, "the flag assertion throws while the flag is off");
const loaderSrc = declaration.slice(declaration.indexOf("export async function loadLeadFollowUp"));
const loaderSig = loaderSrc.slice(0, loaderSrc.indexOf("): Promise"));
check(!loaderSig.includes("enabled"), "the loader has no enabled override");
check(loaderSrc.indexOf("LEAD_FOLLOWUPS_ENABLED") < loaderSrc.indexOf(".from(") && loaderSrc.includes("LEAD_SELECT") && loaderSrc.includes('is("deleted_at", null)'), "the read stays behind the flag and selects the lead columns");

const fn = readFileSync("src/lib/lead-followups.functions.ts", "utf8");
const handler = fn.slice(fn.indexOf(".handler"));
check(fn.includes(".middleware([leadFollowupGate, requireSupabaseAuth])"), "the flag gate runs before auth");
check(fn.slice(fn.indexOf("const leadFollowupGate"), fn.indexOf("export const prepareLeadFollowUp")).includes("assertLeadFollowupsEnabled()"), "the gate refuses before it continues to auth");
check(handler.indexOf("assertLeadFollowupsEnabled()") < handler.indexOf("requireStaff"), "the handler refuses before the role check");
check(handler.indexOf("requireStaff") < handler.indexOf("client.server"), "the role check is still before the database import");
check(handler.includes("loadLeadFollowUp(supabaseAdmin, data.applicationId)") && !handler.includes(", true"), "the handler does not force the flag on");
check(handler.includes('await import("@/lib/roles.server")') && !fn.slice(0, fn.indexOf("const leadFollowupGate")).includes("roles.server"), "the role module is imported only after the flag refusal");
check(!fn.includes("email.server") && !fn.includes("sendEmail") && !fn.includes("sendSms") && !fn.includes("notifications"), "the preview does not send");

const ui = readFileSync("src/components/admin/LeadFollowUpDraft.tsx", "utf8");
const gate = ui.slice(ui.indexOf("export function LeadFollowUpDraft"), ui.indexOf("function LeadFollowUpDraftBody"));
check(gate.includes("if (!LEAD_FOLLOWUPS_ENABLED) return null") && !gate.includes("useServerFn"), "the draft stays unmounted while the flag is off");
const body = ui.slice(ui.indexOf("function LeadFollowUpDraftBody"));
check(body.indexOf("if (!LEAD_FOLLOWUPS_ENABLED) return") < body.indexOf("load("), "the loader returns before a request while the flag is off");
check(ui.includes("Copy Draft") && ui.includes("Nothing Is Sent From This Draft.") && !ui.includes("open-messages") && !ui.includes("sendEmail"), "the only action copies wording and does not send");
const list = readFileSync("src/components/admin/LeadPriorities.tsx", "utf8");
check(list.includes("<LeadFollowUpDraft applicationId={lead.id} bucket={lead.bucket} />"), "Lead Priorities can show the draft");
check(list.includes("open-messages"), "the existing Text action is unchanged");

console.log(`${checks} lead follow-up checks passed`);
