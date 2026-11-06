// Incident follow-up aging stays dark, manager-only, and read-only
// (run: bun scripts/incident-aging.test.ts).
import { readFileSync } from "node:fs";
import { INCIDENT_AGING_ENABLED } from "../src/lib/incident-aging-flag";
import {
  easternCalendarDate,
  incidentAging,
  incidentAgingReadError,
  incidentDaysOpen,
  incidentLastUpdate,
} from "../src/lib/incident-aging";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const flag = readFileSync("src/lib/incident-aging-flag.ts", "utf8");
const rules = readFileSync("src/lib/incident-aging.ts", "utf8");
const server = readFileSync("src/lib/incident-aging.functions.ts", "utf8");
const ui = readFileSync("src/components/admin/IncidentsPanel.tsx", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const incidents = readFileSync("src/lib/incidents.functions.ts", "utf8");

ok(INCIDENT_AGING_ENABLED === false, "INCIDENT_AGING_ENABLED is false");
ok(flag.split("INCIDENT_AGING_ENABLED =").length === 2, "the hard-false flag is declared once");
ok(!rules.includes("INCIDENT_AGING_ENABLED ="), "the aging rules do not declare a second flag");
ok(!/process\.env/.test(flag + rules + server), "no environment variable can open the flag");

const thrown = server.indexOf('if (!INCIDENT_AGING_ENABLED) throw new Error("Incident Aging is off")');
const middleware = server.indexOf("[refuseIncidentAging, requireSupabaseAuth]");
ok(thrown >= 0 && thrown < middleware, "the flag throws before the auth middleware runs");
const handler = server.slice(server.indexOf(".handler"));
const role = handler.indexOf("requireManager");
const read = handler.indexOf('.from("incidents")');
ok(role >= 0 && role < read, "the role check happens before any read");
ok(handler.indexOf("incidentIds.length === 0") < read, "an empty id list returns before a table read");
ok(!server.slice(0, server.indexOf("export const listIncidentAging")).includes("roles.server"), "the role module is not a static import");
ok(!server.slice(0, server.indexOf("export const listIncidentAging")).includes("client.server"), "the admin client is not a static import");
ok(server.includes("readInBatches") && server.includes('.range(from, to)') && server.includes('{ count: "exact" }'), "reads are paged the way the waitlist reads are");
ok((server.match(/await readIncidentRows</g) ?? []).length === 2, "incidents and deductions are paged separately");
ok(server.includes("incidentAgingReadError") && !server.includes("Waitlist"), "a failed read says Incident Aging, not Waitlist");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(server + rules), "aging does not write");
ok(!/notes|stripe|token_hash/i.test(server), "aging does not read notes, Stripe, or tokens");
ok(server.includes('select("id,status,occurred_at,updated_at,driver_responsible_amount"'), "the incident read names its columns");
ok(server.includes('select("id,incident_id,amount"'), "the deduction read names its columns");
ok(!incidents.includes("INCIDENT_AGING_ENABLED"), "the live incidents reader does not know this flag");

ok(
  ui.indexOf("if (!INCIDENT_AGING_ENABLED) return") < ui.indexOf("useServerFn(listIncidentAging)"),
  "the follow-up returns before its server call",
);
ok(ui.includes('INCIDENT_AGING_ENABLED && aging.status === "error"') && ui.includes("Could Not Load Incident Aging"), "the load error is behind the flag");
ok(ui.includes('INCIDENT_AGING_ENABLED && updated === "Unknown" ? " · Last Update Unknown"'), "a missing last update is labeled");
ok(ui.includes("INCIDENT_AGING_ENABLED ? <> · Last Update"), "a dated last update stays behind the flag");
ok(ui.includes('INCIDENT_AGING_ENABLED && row?.unresolvedDeduction === "unresolved"') && ui.includes("Unresolved Deduction"), "the deduction flag is behind the flag");
ok(ui.includes('INCIDENT_AGING_ENABLED && row?.unresolvedDeduction === "unknown"') && ui.includes("Deduction Unknown"), "an unreadable deduction is labeled");
ok(!ui.includes("· Unknown\""), "aging does not show a bare Unknown label");
ok(!nav.includes("incident_aging"), "there is no new screen");

ok(incidentAgingReadError("Waitlist data unavailable. Please retry.") === "Incident Aging data unavailable. Please retry.", "an unreadable page is an incident error");
ok(incidentAgingReadError("Waitlist data changed. Please retry.") === "Incident Aging data changed. Please retry.", "a changed page is an incident error");
ok(incidentAgingReadError("Waitlist data incomplete. Please retry.") === "Incident Aging data incomplete. Please retry.", "an incomplete page is an incident error");
ok(easternCalendarDate(new Date("2026-10-21T03:30:00Z")) === "2026-10-20", "03:30 UTC is still the previous Eastern day");
ok(easternCalendarDate(new Date("2026-10-21T04:00:00Z")) === "2026-10-21", "04:00 UTC is Eastern midnight");

const today = "2026-10-21";
const base = {
  incidentId: "10000000-0000-4000-8000-000000000001",
  status: "open",
  occurredAt: "2026-10-01T15:00:00Z",
  updatedAt: "2026-10-18T15:00:00Z",
  responsible: 100,
  deductionAmounts: [40, 10],
  today,
};

const open = incidentAging(base);
ok(open.daysOpen === "20 Days Open", "an open incident counts Eastern days since it occurred");
ok(open.lastUpdate === "2026-10-18", "last update is the Eastern day of updated_at");
ok(open.unresolvedDeduction === "unresolved", "a short deduction leaves the amount unresolved");

ok(
  incidentDaysOpen({ status: "open", occurredAt: "2026-10-21T15:00:00Z", updatedAt: null, today }).startsWith("Opened Today"),
  "an incident that occurred today opened today",
);
ok(
  incidentDaysOpen({ status: "in_claim", occurredAt: "2026-10-20T15:00:00Z", updatedAt: null, today }) === "1 Day Open",
  "one Eastern day stays singular",
);
ok(
  incidentDaysOpen({ status: "closed", occurredAt: "2026-10-01T15:00:00Z", updatedAt: "2026-10-11T15:00:00Z", today }) === "10 Days Open",
  "a closed incident stops at its last update",
);
ok(
  incidentDaysOpen({ status: "written_off", occurredAt: "2026-10-01T15:00:00Z", updatedAt: "2026-10-11T15:00:00Z", today }) === "10 Days Open",
  "a written-off incident stops at its last update",
);
ok(incidentDaysOpen({ status: "open", occurredAt: null, updatedAt: null, today }) === "Unknown", "a missing occurred time is Unknown");
ok(incidentDaysOpen({ status: "open", occurredAt: "2026-10-22T15:00:00Z", updatedAt: null, today }) === "Unknown", "a future occurred time is Unknown");
ok(incidentLastUpdate(null) === "Unknown", "a missing update is Unknown");
ok(incidentLastUpdate("not-a-date") === "Unknown", "an unreadable update is Unknown");
ok(
  incidentDaysOpen({ status: "open", occurredAt: "2026-10-01", updatedAt: null, today }) === "20 Days Open",
  "a date-only occurred day is not shifted across time zones",
);
ok(
  incidentDaysOpen({ status: "closed", occurredAt: "2026-10-01T15:00:00Z", updatedAt: null, today }) === "Unknown",
  "a finished incident with no last update is Unknown",
);

ok(
  incidentAging({ ...base, deductionAmounts: [60, 40] }).unresolvedDeduction === "resolved",
  "deductions that cover the amount are resolved",
);
ok(
  incidentAging({ ...base, deductionAmounts: [-25, 100] }).unresolvedDeduction === "resolved",
  "a negative deduction does not reduce what was recorded",
);
ok(
  incidentAging({ ...base, deductionAmounts: [-25, 10] }).unresolvedDeduction === "unresolved",
  "ignoring a negative deduction can leave the amount unresolved",
);
ok(incidentAging({ ...base, responsible: 0, deductionAmounts: [] }).unresolvedDeduction === "resolved", "nothing owed is not an unresolved deduction");
ok(incidentAging({ ...base, responsible: "100.00", deductionAmounts: ["60.00", "40"] }).unresolvedDeduction === "resolved", "dollar strings are read in cents");
ok(incidentAging({ ...base, responsible: "nope" }).unresolvedDeduction === "unknown", "an unreadable amount is Unknown");
ok(incidentAging({ ...base, deductionAmounts: [40, "bad"] }).unresolvedDeduction === "unknown", "an unreadable deduction is Unknown");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall incident aging checks pass");
process.exit(fails ? 1 : 0);
