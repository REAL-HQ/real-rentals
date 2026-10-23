/**
 * Dark read-only pricing and reminder schedule. No mail, no SMS, no hosted database.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bundled = await build({
  entryPoints: ["src/lib/pricing-reminder-settings.ts"],
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

check(lib.PRICING_REMINDER_SETTINGS_ENABLED === false, "the settings flag is a hard false");
const declaration = readFileSync("src/lib/pricing-reminder-settings.ts", "utf8");
check(
  declaration.match(/export const PRICING_REMINDER_SETTINGS_ENABLED: boolean = false;/g)?.length === 1,
  "the flag is declared once",
);
check(
  !declaration.includes("process.env") && !declaration.includes("email.server") && !declaration.includes("sendSms") && !declaration.includes("sendEmail"),
  "the settings module does not read an env flag or a sender",
);

let refused = false;
try {
  lib.assertPricingReminderSettingsEnabled();
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
      return {
        select() {
          return { order: async () => ({ data: [], error: null }) };
        },
      };
    },
  };
}

const closed = fakeAdmin();
const skipped = await lib.loadPricingReminderSettings(closed);
check(skipped.ok === false && skipped.skipped === "flag" && closed.calls.length === 0, "the loader does not read settings while the flag is off");
const loaderSrc = declaration.slice(declaration.indexOf("export async function loadPricingReminderSettings"));
const loaderSig = loaderSrc.slice(0, loaderSrc.indexOf("): Promise"));
check(!loaderSig.includes("enabled"), "the loader has no enabled override");
check(
  loaderSrc.indexOf("PRICING_REMINDER_SETTINGS_ENABLED") < loaderSrc.indexOf(".from("),
  "the read stays behind the flag",
);
check(loaderSrc.includes("throw new Error") && loaderSrc.includes("could not be loaded"), "a query error is refused instead of an empty schedule");

const priceSelect = declaration.match(/const PRICE_SELECT = "([^"]+)"/)?.[1] ?? "";
const workflowSelect = declaration.match(/const WORKFLOW_SELECT = "([^"]+)"/)?.[1] ?? "";
const stepSelect = declaration.match(/const STEP_SELECT = "([^"]+)"/)?.[1] ?? "";
check(priceSelect === "body_type,weekly_rate,monthly_rate,deposit", "pricing reads only the rate columns");
check(
  workflowSelect === "id,name,is_active,quiet_hours_start,quiet_hours_end,stop_on_reply",
  "workflows read only the schedule columns",
);
check(stepSelect === "workflow_id,step_order,delay_minutes,channel,is_active", "steps read only the schedule columns");
const selected = new Set([...priceSelect.split(","), ...workflowSelect.split(","), ...stepSelect.split(",")]);
for (const hidden of ["*", "body", "subject", "updated_by", "description", "outbound_messages"]) {
  check(!selected.has(hidden), `the selects leave out ${hidden}`);
}

const view = lib.projectPricingReminderSettings({
  prices: [
    { body_type: "suv", weekly_rate: "450.50", monthly_rate: -1, deposit: null, updated_by: "staff-secret" },
    { body_type: "  ", weekly_rate: 100, monthly_rate: 100, deposit: 100 },
    { body_type: "sedan", weekly_rate: 0, monthly_rate: "", deposit: "nope" },
    { body_type: "truck", weekly_rate: Number.POSITIVE_INFINITY, monthly_rate: "  ", deposit: "250" },
  ],
  workflows: [
    { id: "wf-1", name: "Past\nDue", is_active: true, quiet_hours_start: 21, quiet_hours_end: 8, stop_on_reply: true, description: "SECRET description" },
    { id: "wf-2", name: "   ", is_active: "yes", quiet_hours_start: 24, quiet_hours_end: 1.5, stop_on_reply: false },
  ],
  steps: [
    { workflow_id: "missing", step_order: 1, delay_minutes: 30, channel: "email", is_active: true, body: "SECRET body", subject: "SECRET subject" },
    { workflow_id: "wf-1", step_order: 0, delay_minutes: 15, channel: "sms", is_active: true, body: "SECRET body" },
    { workflow_id: "wf-1", step_order: 2, delay_minutes: 90, channel: "sms", is_active: true, body: "SECRET body", subject: "SECRET subject" },
    { workflow_id: "wf-2", step_order: 1, delay_minutes: -5, channel: "EMAIL", is_active: false, body: "SECRET body" },
    { workflow_id: "wf-1", step_order: 1.5, delay_minutes: 10, channel: "email", is_active: true },
  ],
});
check(view.prices.map((row) => row.bodyType).join(",") === "sedan,suv,truck", "blank body types are dropped and rows sort by label");
check(view.prices[0].label === "Sedan" && view.prices[0].weeklyRate === 0 && view.prices[0].monthlyRate === null && view.prices[0].deposit === null, "a real zero stays zero and a blank or junk rate stays unset");
check(view.prices[1].weeklyRate === 450.5 && view.prices[1].monthlyRate === null && view.prices[1].deposit === null, "a numeric string is kept and a negative rate stays unset");
check(view.prices[2].weeklyRate === null && view.prices[2].monthlyRate === null && view.prices[2].deposit === 250, "a non-finite rate stays unset");
check(view.reminders.length === 2, "steps without a known workflow or a whole step number are dropped");
check(view.reminders[0].workflowName === "Past Due" && view.reminders[0].stepOrder === 2 && view.reminders[0].channel === "SMS" && view.reminders[0].delayMinutes === 90, "the first reminder keeps the schedule and strips a control character from the name");
check(view.reminders[0].quietHoursStart === 21 && view.reminders[0].quietHoursEnd === 8 && view.reminders[0].stopOnReply === true && view.reminders[0].workflowActive === true && view.reminders[0].stepActive === true, "quiet hours and the reply stop are schedule fields");
check(view.reminders[1].workflowName === "Untitled Sequence" && view.reminders[1].channel === "Other" && view.reminders[1].delayMinutes === null && view.reminders[1].quietHoursStart === null && view.reminders[1].workflowActive === false && view.reminders[1].stepActive === false, "a blank name, an unknown channel, and a bad delay stay unset");
const dumped = JSON.stringify(view);
check(!dumped.includes("SECRET") && !dumped.includes("staff-secret") && !dumped.includes("updated_by"), "message text, descriptions, and the last editor stay out of the view");

const fn = readFileSync("src/lib/pricing-reminder-settings.functions.ts", "utf8");
const handler = fn.slice(fn.indexOf(".handler"));
check(fn.includes(".middleware([pricingReminderGate, requireSupabaseAuth])"), "the flag gate runs before auth");
check(
  fn.slice(fn.indexOf("const pricingReminderGate"), fn.indexOf("export const getPricingReminderSettings")).includes("assertPricingReminderSettingsEnabled()"),
  "the gate refuses before it continues to auth",
);
check(handler.indexOf("assertPricingReminderSettingsEnabled()") < handler.indexOf("requireManager"), "the handler refuses before the role check");
check(handler.indexOf("requireManager") < handler.indexOf("client.server"), "the role check is still before the database import");
check(!handler.includes("enabled"), "the handler has no enabled override");
check(
  handler.includes('await import("@/lib/roles.server")') && !fn.slice(0, fn.indexOf("const pricingReminderGate")).includes("roles.server"),
  "the role module is imported only after the flag refusal",
);
check(!fn.includes("email.server") && !fn.includes("sendEmail") && !fn.includes("sendSms") && !fn.includes("notifications") && !fn.includes(".insert(") && !fn.includes(".update(") && !fn.includes(".upsert("), "the view does not send or write");

const ui = readFileSync("src/components/admin/PricingReminderSettings.tsx", "utf8");
const gate = ui.slice(ui.indexOf("export function PricingReminderSettings"), ui.indexOf("function PricingReminderSettingsBody"));
check(gate.includes("if (!PRICING_REMINDER_SETTINGS_ENABLED) return null") && !gate.includes("useServerFn"), "the view stays unmounted while the flag is off");
const body = ui.slice(ui.indexOf("function PricingReminderSettingsBody"));
check(body.indexOf("if (!PRICING_REMINDER_SETTINGS_ENABLED) return") < body.indexOf("load("), "the loader returns before a request while the flag is off");
check(ui.includes("Pricing And Reminder Schedule") && ui.includes("Read Only. Nothing Is Sent.") && ui.includes("Not Set") && ui.includes("No Reminder Steps."), "the copy is Title Case and read only");
check(!ui.includes("sendEmail") && !ui.includes("sendSms") && !ui.includes("Save"), "the view has no save and no send");

const workspace = readFileSync("src/components/admin/SettingsWorkspace.tsx", "utf8");
check(
  workspace.includes('{current.id === "vehicle_defaults" || current.id === "automations" ? <PricingReminderSettings /> : null}'),
  "the view is offered only on vehicle pricing and automations",
);
check(workspace.includes("<VehicleDefaultsPanel />") && workspace.includes("<AutomationsPanel />"), "the existing settings panels stay in place");

console.log(`${checks} pricing reminder settings checks passed`);
