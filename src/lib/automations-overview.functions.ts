import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  AUTOMATIONS,
  AUTOMATION_CONTROLS_KEY,
  AUTOMATION_KEYS,
  automationHealth,
  isAutomationOn,
  nextAutomationControls,
  type AutomationHealth,
} from "@/lib/automation-catalog";

// Back Office → Settings → Automations.
//
// Reading is Manager+ (it shows template wording and send history, no
// recipients). Changing a switch is Owner only, audited, and future-only:
// nothing is enrolled, queued or sent by loading the page or flipping a switch.

export type AutomationRow = {
  key: string;
  /** Is the switch on? null for entries that cannot be switched from here. */
  on: boolean | null;
  canToggle: boolean;
  health: AutomationHealth;
  lastRunAt: string | null;
  lastRunFailed: boolean;
  /** Last email this automation sent, and its delivery state. */
  lastSentAt: string | null;
  lastState: string | null;
  sent30d: number;
  /** Emails held in the last 30 days because the switches could not be read. */
  held30d: number;
  workflowId: string | null;
  smsSteps: Array<{ order: number; delayMinutes: number; body: string; active: boolean }>;
  emailSteps: Array<{ order: number; delayMinutes: number; subject: string | null; body: string; active: boolean }>;
  /** Plain reasons this cannot run right now even when on. */
  blockers: string[];
};

export type AutomationsOverview = {
  rows: AutomationRow[];
  emailReady: boolean;
  smsReady: boolean;
  /** Which SMS settings are present on the server (never their values). */
  smsSetup: { provider: "quo" | "twilio" | "none"; dryRun: boolean; account: boolean; authToken: boolean; sender: "number" | "messaging_service" | "none" };
  cronKnown: boolean;
  smsSentEver: number;
  isOwner: boolean;
  /** "error": the switches could not be read, so every catalogued email is held. */
  controlsStatus: "ok" | "absent" | "error";
  /** The New Applicant Follow-Up switch is the workflow itself; per-step switches live in Workflows. */
};

type Cron = Record<string, { active: boolean; lastStatus: string | null; lastRunAt: string | null }>;

export const getAutomationsOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutomationsOverview> => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const { loadAutomationControls } = await import("@/lib/automation-controls.server");
    const controls = await loadAutomationControls(sb, true);

    // Schedules and last run: a read-only database function staged in
    // proposed/automation-health-v1.sql. Until it is installed, health is "Unknown".
    let cron: Cron | null = null;
    try {
      const { data, error } = await sb.rpc("automation_cron_health");
      if (!error && Array.isArray(data)) {
        cron = {};
        for (const j of data as any[]) cron[String(j.jobname)] = { active: j.active === true, lastStatus: j.last_status ?? null, lastRunAt: j.last_run_at ?? null };
      }
    } catch { cron = null; }

    const workflows = [...new Set(AUTOMATIONS.flatMap((a) => a.emailWorkflows)), "lead_alert"];
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { HELD_REASON } = await import("@/lib/automation-controls.server");
    const { data: deliveries } = await sb.from("email_deliveries").select("workflow,state,created_at,provider_reason").in("workflow", workflows).order("created_at", { ascending: false }).limit(1000);
    const byWf = new Map<string, { last: string; state: string | null; n30: number; held30: number }>();
    for (const d of (deliveries ?? []) as any[]) {
      const held = d.provider_reason === HELD_REASON;
      const cur = byWf.get(d.workflow) ?? { last: "", state: null, n30: 0, held30: 0 };
      if (!held && !cur.last) { cur.last = d.created_at; cur.state = d.state ?? null; }
      if (d.created_at >= since) { if (held) cur.held30++; else cur.n30++; }
      byWf.set(d.workflow, cur);
    }

    const { data: notif, error: notifReadErr } = await sb.from("app_settings").select("value").eq("key", "notifications").maybeSingle();
    const notifErr = Boolean(notifReadErr) || (notif != null && (!notif.value || typeof notif.value !== "object" || Array.isArray(notif.value)));
    const nv = (notifErr ? {} : (notif?.value ?? {})) as Record<string, unknown>;

    const { data: wfRows, error: wfErr } = await sb.from("automation_workflows").select("id,trigger_event,is_active,created_at").order("created_at", { ascending: true });
    const { count: smsSentEver } = await sb.from("outbound_messages").select("id", { count: "exact", head: true }).eq("channel", "sms").eq("status", "sent");

    const emailReady = Boolean(process.env.RESEND_API_KEY);
    const { smsProviderStatus } = await import("@/lib/sms-provider.server");
    const smsProvider = smsProviderStatus();
    const smsReady = smsProvider.ready;
    const lifecycleOn = process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true";

    const rows: AutomationRow[] = [];
    for (const def of AUTOMATIONS) {
      const job = def.cronJob && cron ? cron[def.cronJob] : undefined;
      const blockers: string[] = [];
      let on: boolean | null = null;
      let canToggle = false;
      let workflowId: string | null = null;
      const smsSteps: AutomationRow["smsSteps"] = [];
      const emailSteps: AutomationRow["emailSteps"] = [];
      const wfLog = def.control.kind === "notifications" ? byWf.get("lead_alert") : def.emailWorkflows.map((w) => byWf.get(w)).filter(Boolean).sort((a, b) => (a!.last < b!.last ? 1 : -1))[0];

      if (def.control.kind === "setting") {
        // Unreadable switches: show the state as unknown and block changes, never "on".
        if (controls.status === "error") { on = null; blockers.push("Switches could not be read. Its emails are held until they can."); }
        else { on = isAutomationOn(controls.value, def.key); canToggle = true; }
      }
      else if (def.control.kind === "notifications") {
        if (notifErr) { on = null; blockers.push("Alert settings could not be read. Alerts are held until they can."); }
        else { on = nv[def.control.field] !== false; canToggle = true; }
      }
      else if (def.control.kind === "workflow") {
        const trig = def.control.trigger;
        const wf = ((wfRows ?? []) as any[]).find((w) => w.trigger_event === trig);
        if (wfErr) blockers.push("Workflow could not be read.");
        else if (wf) {
          workflowId = wf.id; on = wf.is_active === true; canToggle = true;
          const { data: steps } = await sb.from("automation_steps").select("step_order,delay_minutes,channel,subject,body,is_active").eq("workflow_id", wf.id).order("step_order");
          for (const s of (steps ?? []) as any[]) {
            const base = { order: s.step_order, delayMinutes: s.delay_minutes, body: String(s.body ?? ""), active: s.is_active !== false };
            if (s.channel === "sms") smsSteps.push(base); else emailSteps.push({ ...base, subject: s.subject ?? null });
          }
        } else blockers.push("No workflow is set up for this trigger.");
      } else {
        blockers.push(def.control.reason);
        if (def.key === "rental_lifecycle" && lifecycleOn) blockers.splice(0, 1);
      }

      if (def.channels.includes("Email") && !emailReady) blockers.push("Email sending is not set up on the server.");
      if (def.channels.includes("SMS") && !smsReady) blockers.push("SMS sending is not set up on the server.");
      const health = def.control.kind === "code" ? "No Schedule" : automationHealth(def, cron ? Object.fromEntries(Object.entries(cron).map(([k, v]) => [k, { active: v.active, lastStatus: v.lastStatus }])) : null);
      if (health === "Job Failing") blockers.push("Its daily job is failing, so nothing is sent.");
      if (health === "No Schedule" && def.cronJob) blockers.push("Its job is not scheduled.");
      if (def.key.startsWith("payment_") || def.key === "collections_plan" || def.key === "license_expiring") {
        const { count } = await sb.from("rentals").select("id", { count: "exact", head: true }).eq("status", "active");
        if (!count) blockers.push("No active rentals yet, so there is no one to remind.");
      }

      rows.push({
        key: def.key, on, canToggle, health,
        lastRunAt: job?.lastRunAt ?? null, lastRunFailed: job?.lastStatus === "failed",
        lastSentAt: wfLog?.last || null, lastState: wfLog?.state ?? null, sent30d: wfLog?.n30 ?? 0, held30d: wfLog?.held30 ?? 0,
        workflowId, smsSteps, emailSteps, blockers,
      });
    }
    const smsSetup = {
      provider: smsProvider.provider,
      dryRun: smsProvider.dryRun,
      account: smsProvider.provider === "quo" ? true : Boolean(process.env.TWILIO_ACCOUNT_SID),
      authToken: smsProvider.provider === "quo" ? true : Boolean(process.env.TWILIO_AUTH_TOKEN),
      sender: smsProvider.senderKind,
    };
    return { rows, emailReady, smsReady, smsSetup, cronKnown: cron !== null, smsSentEver: smsSentEver ?? 0, isOwner: actor.tier === "owner", controlsStatus: controls.status };
  });

export const setAutomationOn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ key: z.enum(AUTOMATION_KEYS as [string, ...string[]]), on: z.boolean() }).strict().parse(d))
  .handler(async ({ data, context }): Promise<{ key: string; on: boolean }> => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const def = AUTOMATIONS.find((a) => a.key === data.key)!;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const { logAudit } = await import("@/lib/audit.server");
    const at = new Date().toISOString();
    let from: boolean;

    if (def.control.kind === "code") throw new Error("This automation can't be turned on from the back office yet.");
    if (def.control.kind === "setting") {
      const { loadAutomationControls, clearAutomationControlsCache } = await import("@/lib/automation-controls.server");
      const cur = await loadAutomationControls(sb, true);
      // Never rebuild the switches from a failed read: that could wipe other Offs.
      if (cur.status === "error") throw new Error("Switches could not be read. Nothing was changed.");
      from = isAutomationOn(cur.value, def.key);
      const next = nextAutomationControls(cur.value, def.key, data.on, at, actor.email ?? actor.userId);
      const { error } = await sb.from("app_settings").upsert({ key: AUTOMATION_CONTROLS_KEY, value: next, updated_at: at });
      if (error) throw new Error("Could not save. Nothing was changed.");
      clearAutomationControlsCache();
    } else if (def.control.kind === "notifications") {
      const field = def.control.field;
      const { data: row, error: rErr } = await sb.from("app_settings").select("value").eq("key", "notifications").maybeSingle();
      if (rErr) throw new Error("Could not read the current setting. Nothing was changed.");
      if (row && (!row.value || typeof row.value !== "object" || Array.isArray(row.value))) throw new Error("Alert settings are malformed. Nothing was changed.");
      const value = { ...((row?.value ?? {}) as Record<string, unknown>) };
      from = value[field] !== false;
      value[field] = data.on;
      const { error } = await sb.from("app_settings").upsert({ key: "notifications", value, updated_at: at });
      if (error) throw new Error("Could not save. Nothing was changed.");
    } else {
      // Existing workflow switch. Turning it on enrolls only applications submitted from now on.
      const trig = def.control.trigger;
      const { data: wf, error: wfReadErr } = await sb.from("automation_workflows").select("id,is_active").eq("trigger_event", trig).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (wfReadErr) throw new Error("Workflow could not be read. Nothing was changed.");
      if (!wf) throw new Error("No workflow is set up for this trigger.");
      from = wf.is_active === true;
      const { error } = await sb.from("automation_workflows").update({ is_active: data.on }).eq("id", wf.id);
      if (error) throw new Error("Could not save. Nothing was changed.");
    }

    await logAudit(actor, {
      action: data.on ? "automation.turned_on" : "automation.turned_off",
      summary: `${def.title} turned ${data.on ? "on" : "off"}`,
      entityType: "automation",
      entityId: def.key,
      metadata: { from, to: data.on, control: def.control.kind },
    });
    return { key: def.key, on: data.on };
  });

const PREVIEW_IDS = [...new Set(AUTOMATIONS.flatMap((a) => a.previews))] as [string, ...string[]];

export type TemplatePreview = { subject: string; html: string } | { subject: null; html: null; reason: string };

export const previewAutomationTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.enum(PREVIEW_IDS) }).strict().parse(d))
  .handler(async ({ data, context }): Promise<TemplatePreview> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { renderAutomationPreview } = await import("@/lib/automation-preview.server");
    return renderAutomationPreview(data.id);
  });

export type SmsCheck = { status: "ok" | "not_set_up" | "rejected" | "sender_missing" | "unreachable"; detail: string };

/**
 * Owner-only, read-only check of the SMS provider settings: asks Twilio for
 * the account and the sender (GET requests). Sends nothing and returns no
 * credential, account id or number — only a status word and one sentence.
 */
export const checkSmsSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SmsCheck> => {
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { runSmsSetupCheck } = await import("@/lib/sms-setup-check.server");
    return runSmsSetupCheck(process.env, fetch);
  });
