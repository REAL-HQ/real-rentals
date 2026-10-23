/**
 * Dark read-only view of vehicle pricing defaults and automation reminder
 * schedules. The flag is a hard false. While it is off, the server function
 * and the loader both return before a role check and before any read.
 * Nothing here sends email or SMS, and nothing writes a setting.
 *
 * Declared once in this file. No environment variable can open it.
 */
import { bodyTypeLabel } from "@/lib/vehicle-defaults";

export const PRICING_REMINDER_SETTINGS_ENABLED: boolean = false;

export function assertPricingReminderSettingsEnabled(): void {
  if (PRICING_REMINDER_SETTINGS_ENABLED !== true) {
    throw new Error("Pricing and reminder settings are not enabled.");
  }
}

export type PriceSetting = {
  bodyType: string;
  label: string;
  weeklyRate: number | null;
  monthlyRate: number | null;
  deposit: number | null;
};

export type ReminderStep = {
  workflowName: string;
  workflowActive: boolean;
  stopOnReply: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  stepOrder: number;
  delayMinutes: number | null;
  channel: "Email" | "SMS" | "Other";
  stepActive: boolean;
};

export type PricingReminderView = {
  prices: PriceSetting[];
  reminders: ReminderStep[];
};

const PRICE_SELECT = "body_type,weekly_rate,monthly_rate,deposit";
const WORKFLOW_SELECT = "id,name,is_active,quiet_hours_start,quiet_hours_end,stop_on_reply";
const STEP_SELECT = "workflow_id,step_order,delay_minutes,channel,is_active";

function money(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function hour(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23 ? value : null;
}

function delay(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function channel(value: unknown): ReminderStep["channel"] {
  if (value === "email") return "Email";
  if (value === "sms") return "SMS";
  return "Other";
}

function workflowName(value: unknown): string {
  const name = String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim();
  if (!name) return "Untitled Sequence";
  return name.slice(0, 80);
}

type PriceInput = { body_type?: unknown; weekly_rate?: unknown; monthly_rate?: unknown; deposit?: unknown };
type WorkflowInput = {
  id?: unknown;
  name?: unknown;
  is_active?: unknown;
  quiet_hours_start?: unknown;
  quiet_hours_end?: unknown;
  stop_on_reply?: unknown;
};
type StepInput = {
  workflow_id?: unknown;
  step_order?: unknown;
  delay_minutes?: unknown;
  channel?: unknown;
  is_active?: unknown;
  body?: unknown;
  subject?: unknown;
};

/** Staff-facing rows only. Message text, addresses, and who last edited a price are dropped. */
export function projectPricingReminderSettings(input: {
  prices: readonly PriceInput[];
  workflows: readonly WorkflowInput[];
  steps: readonly StepInput[];
}): PricingReminderView {
  const prices: PriceSetting[] = [];
  for (const row of input.prices) {
    const bodyType = typeof row.body_type === "string" ? row.body_type.trim() : "";
    if (!bodyType) continue;
    prices.push({
      bodyType,
      label: bodyTypeLabel(bodyType),
      weeklyRate: money(row.weekly_rate),
      monthlyRate: money(row.monthly_rate),
      deposit: money(row.deposit),
    });
  }
  prices.sort((a, b) => a.label.localeCompare(b.label) || a.bodyType.localeCompare(b.bodyType));

  const workflows = new Map<string, WorkflowInput>();
  for (const row of input.workflows) {
    if (typeof row.id === "string" && row.id) workflows.set(row.id, row);
  }
  const reminders: ReminderStep[] = [];
  for (const step of input.steps) {
    const workflowId = typeof step.workflow_id === "string" ? step.workflow_id : "";
    const workflow = workflows.get(workflowId);
    if (!workflow) continue;
    const stepOrder = typeof step.step_order === "number" && Number.isInteger(step.step_order) ? step.step_order : null;
    if (stepOrder == null || stepOrder < 1) continue;
    reminders.push({
      workflowName: workflowName(workflow.name),
      workflowActive: workflow.is_active === true,
      stopOnReply: workflow.stop_on_reply === true,
      quietHoursStart: hour(workflow.quiet_hours_start),
      quietHoursEnd: hour(workflow.quiet_hours_end),
      stepOrder,
      delayMinutes: delay(step.delay_minutes),
      channel: channel(step.channel),
      stepActive: step.is_active === true,
    });
  }
  reminders.sort((a, b) => a.workflowName.localeCompare(b.workflowName) || a.stepOrder - b.stepOrder);
  return { prices, reminders };
}

/**
 * Read pricing defaults and reminder steps. The flag is the constant above.
 * There is no parameter that can turn the read on. `select` returns `any`
 * so the service-role client, whose builder is thenable rather than a Promise,
 * still typechecks. The flag return is above the only call.
 */
export async function loadPricingReminderSettings(
  admin: { from: (table: string) => { select: (columns: string) => any } },
): Promise<{ ok: false; skipped: "flag" } | { ok: true; view: PricingReminderView }> {
  if (PRICING_REMINDER_SETTINGS_ENABLED !== true) return { ok: false, skipped: "flag" };
  const [prices, workflows, steps] = await Promise.all([
    admin.from("vehicle_defaults").select(PRICE_SELECT).order("body_type"),
    admin.from("automation_workflows").select(WORKFLOW_SELECT).order("name"),
    admin.from("automation_steps").select(STEP_SELECT).order("step_order"),
  ]);
  if (prices.error || workflows.error || steps.error) {
    throw new Error("Pricing and reminder settings could not be loaded.");
  }
  return {
    ok: true,
    view: projectPricingReminderSettings({
      prices: (prices.data ?? []) as PriceInput[],
      workflows: (workflows.data ?? []) as WorkflowInput[],
      steps: (steps.data ?? []) as StepInput[],
    }),
  };
}
