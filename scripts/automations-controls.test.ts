// Back Office → Automations: switches gate real sends, previews never send,
// and only the Owner can change a switch (audited). Behavioral where it can
// be (sendEmail, server-function handlers against an in-memory database);
// the cron-route gate placement is checked from source.
import { describe, expect, mock, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";

// ---- in-memory database + provider -----------------------------------------
type Row = Record<string, any>;
const db: { app_settings: Map<string, any>; email_deliveries: Row[]; automation_workflows: Row[]; audit: Row[] } = {
  app_settings: new Map(), email_deliveries: [], automation_workflows: [], audit: [],
};
const fetches: string[] = [];
let tokenMints = 0;

function table(name: string): any {
  const q: any = {
    _filters: [] as Array<[string, any]>,
    select() { return q; }, order() { return q; }, limit() { return q; }, in() { return q; },
    eq(k: string, v: any) { q._filters.push([k, v]); return q; },
    async maybeSingle() {
      if (name === "app_settings") { const key = q._filters.find((f: any) => f[0] === "key")?.[1]; return { data: db.app_settings.has(key) ? { value: db.app_settings.get(key) } : null, error: null }; }
      if (name === "automation_workflows") return { data: db.automation_workflows[0] ?? null, error: null };
      return { data: null, error: null };
    },
    async upsert(row: Row) { if (name === "app_settings") db.app_settings.set(row.key, row.value); return { error: null }; },
    insert(row: Row) { if (name === "email_deliveries") db.email_deliveries.push(row); return { select: () => ({ single: async () => ({ data: { id: "d1" }, error: null }) }), then: (r: any) => r({ error: null }) }; },
    update(patch: Row) { return { eq: async (_k: string, id: string) => { const w = db.automation_workflows.find((x) => x.id === id); if (w) Object.assign(w, patch); return { error: null }; } }; },
  };
  return q;
}
const supabaseAdmin = { from: (n: string) => table(n), rpc: async () => ({ data: null, error: { code: "PGRST202" } }) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
mock.module("@/lib/resume-tokens.server", () => ({
  issueResumeToken: async () => { tokenMints++; return "real-token"; },
  resumeUrl: (t: string) => `https://drivereal.com/apply?resume=${t}`,
  RECOVERY_TOKEN_MINUTES: 30,
}));
let tier = "owner";
mock.module("@/lib/roles.server", () => ({
  requireOwner: async (id: string) => { if (tier !== "owner") throw new Error("Forbidden"); return { userId: id, email: "owner@x", tier }; },
  requireManager: async (id: string) => { if (tier === "coordinator") throw new Error("Forbidden"); return { userId: id, email: "m@x", tier }; },
}));
mock.module("@/lib/audit.server", () => ({ logAudit: async (actor: any, e: any) => { db.audit.push({ actor: actor?.email, ...e }); } }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
// createServerFn → expose the handler so it can be called directly.
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b: any = { middleware: () => b, inputValidator: (v: any) => { validate = v; return b; },
      handler: (h: any) => async (args: any) => h({ ...args, data: validate(args.data) }) };
    return b;
  },
  useServerFn: (f: unknown) => f,
}));
(globalThis as any).fetch = async (url: string) => { fetches.push(String(url)); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); };
process.env.RESEND_API_KEY = "test-only";

const email = await import("@/lib/email.server");
const controls = await import("@/lib/automation-controls.server");
const catalog = await import("@/lib/automation-catalog");
const fns = await import("@/lib/automations-overview.functions");

beforeEach(() => {
  db.app_settings.clear(); db.email_deliveries.length = 0; db.audit.length = 0; fetches.length = 0; tokenMints = 0; tier = "owner";
  db.automation_workflows.splice(0, db.automation_workflows.length, { id: "wf1", trigger_event: "application_submitted", is_active: false });
  controls.clearAutomationControlsCache();
});

const pastDue = () => email.sendPastDueReminderEmail({ to: "r@example.com", firstName: "R", amount: 350, dueDate: "2026-11-01", daysLate: 3 });

describe("dispatch-time gate in sendEmail", () => {
  test("absent setting = on (today's behaviour): the email goes to the provider", async () => {
    await pastDue();
    expect(fetches.filter((u) => u.includes("resend")).length).toBe(1);
    expect(db.email_deliveries.length).toBe(1);
  });
  test("switched off: no provider call and no delivery row", async () => {
    db.app_settings.set(catalog.AUTOMATION_CONTROLS_KEY, { off: { payment_past_due: { at: "t", by: "o" } } });
    await pastDue();
    expect(fetches.length).toBe(0);
    expect(db.email_deliveries.length).toBe(0);
  });
  test("turning one off leaves the others sending", async () => {
    db.app_settings.set(catalog.AUTOMATION_CONTROLS_KEY, { off: { payment_past_due: { at: "t", by: "o" } } });
    await email.sendPaymentDueTomorrowEmail({ to: "r@example.com", firstName: "R", amount: 350, dueDate: "2026-11-09" });
    expect(fetches.length).toBe(1);
  });
  test("untracked or uncatalogued mail (eSign, invites) is never blocked", async () => {
    db.app_settings.set(catalog.AUTOMATION_CONTROLS_KEY, { off: Object.fromEntries(catalog.AUTOMATION_KEYS.map((k) => [k, { at: "t", by: "o" }])) });
    expect(await controls.automationAllowsEmail("esign_signing_request")).toBe(true);
    expect(await controls.automationAllowsEmail(undefined)).toBe(true);
  });
  test("an unreadable setting fails open", () => {
    expect(catalog.readAutomationControls("garbage")).toEqual({ off: {} });
    expect(catalog.readAutomationControls({ off: { not_a_key: {} } })).toEqual({ off: {} });
  });
});

describe("template previews never send", () => {
  test("renders subject + html with no provider call, no delivery row, no resume token", async () => {
    const { renderAutomationPreview } = await import("@/lib/automation-preview.server");
    for (const id of [...new Set(catalog.AUTOMATIONS.flatMap((a) => a.previews))]) {
      const r = await renderAutomationPreview(id);
      expect(r.subject, id).toBeTruthy();
      expect(r.html ?? "", id).toContain("<");
    }
    expect(fetches.length).toBe(0);
    expect(db.email_deliveries.length).toBe(0);
    expect(tokenMints).toBe(0);
  });
  test("previews still render while the automation is switched off", async () => {
    db.app_settings.set(catalog.AUTOMATION_CONTROLS_KEY, { off: { payment_past_due: { at: "t", by: "o" } } });
    const r = await (await import("@/lib/automation-preview.server")).renderAutomationPreview("past_due");
    expect(r.subject).toContain("Past Due");
  });
  test("preview is Manager+; a Coordinator is refused", async () => {
    tier = "coordinator";
    await expect(fns.previewAutomationTemplate({ data: { id: "past_due" }, context: { userId: "c" } } as any)).rejects.toThrow("Forbidden");
  });
});

describe("switches: Owner only, audited, stored where the control already lives", () => {
  test("Owner turns Past Due off then on; stored, audited, and the gate follows", async () => {
    await fns.setAutomationOn({ data: { key: "payment_past_due", on: false }, context: { userId: "o" } } as any);
    expect(db.app_settings.get(catalog.AUTOMATION_CONTROLS_KEY).off.payment_past_due).toBeTruthy();
    expect(db.audit.at(-1)).toMatchObject({ action: "automation.turned_off", entityId: "payment_past_due", metadata: { from: true, to: false } });
    await pastDue();
    expect(fetches.length).toBe(0);
    await fns.setAutomationOn({ data: { key: "payment_past_due", on: true }, context: { userId: "o" } } as any);
    expect(db.app_settings.get(catalog.AUTOMATION_CONTROLS_KEY).off.payment_past_due).toBeUndefined();
    await pastDue();
    expect(fetches.length).toBe(1);
  });
  test("a Manager cannot change a switch and nothing is written", async () => {
    tier = "manager";
    await expect(fns.setAutomationOn({ data: { key: "payment_past_due", on: false }, context: { userId: "m" } } as any)).rejects.toThrow("Forbidden");
    expect(db.app_settings.size).toBe(0);
    expect(db.audit.length).toBe(0);
  });
  test("lead alerts reuse the existing notifications fields and keep other fields", async () => {
    db.app_settings.set("notifications", { admin_email: "team@drivereal.com" });
    await fns.setAutomationOn({ data: { key: "lead_alert_new", on: false }, context: { userId: "o" } } as any);
    expect(db.app_settings.get("notifications")).toEqual({ admin_email: "team@drivereal.com", alert_on_new: false });
    expect(db.app_settings.has(catalog.AUTOMATION_CONTROLS_KEY)).toBe(false);
  });
  test("the applicant workflow reuses automation_workflows.is_active", async () => {
    await fns.setAutomationOn({ data: { key: "new_applicant_followup", on: true }, context: { userId: "o" } } as any);
    expect(db.automation_workflows[0].is_active).toBe(true);
    expect(db.audit.at(-1)).toMatchObject({ action: "automation.turned_on", metadata: { control: "workflow" } });
  });
  test("code-switched entries cannot be turned on from the back office", async () => {
    await expect(fns.setAutomationOn({ data: { key: "document_expiring", on: true }, context: { userId: "o" } } as any)).rejects.toThrow("can't be turned on");
  });
  test("unknown keys are rejected by the input schema", async () => {
    await expect(fns.setAutomationOn({ data: { key: "everything", on: false }, context: { userId: "o" } } as any)).rejects.toThrow();
  });
});

describe("health words never claim running when it can't", () => {
  const def = catalog.AUTOMATIONS.find((a) => a.key === "payment_due_tomorrow")!;
  test("failing job, missing job, unknown", () => {
    expect(catalog.automationHealth(def, { "ops-reminders-daily": { active: true, lastStatus: "failed" } })).toBe("Job Failing");
    expect(catalog.automationHealth(def, {})).toBe("No Schedule");
    expect(catalog.automationHealth(def, null)).toBe("Health Unknown");
    expect(catalog.automationHealth(def, { "ops-reminders-daily": { active: true, lastStatus: "succeeded" } })).toBe("Running");
  });
});

describe("cron routes skip a switched-off reminder before recording it (source)", () => {
  const ops = readFileSync("src/routes/api/public/cron/ops-reminders.ts", "utf8");
  const wiz = readFileSync("src/routes/api/public/cron/wizard-recovery.ts", "utf8");
  test("controls are read fresh once per run", () => {
    expect(ops).toContain("await loadAutomationControls(supabaseAdmin, true)");
  });
  test("past-due email and its log sit inside the switch", () => {
    const i = ops.indexOf('if (on("payment_past_due")) {');
    expect(i).toBeGreaterThan(0);
    expect(ops.indexOf("await sendPastDueReminderEmail(")).toBeGreaterThan(i);
    expect(ops.indexOf('kind, "Balance Past Due"')).toBeGreaterThan(i);
  });
  test("team alert, due tomorrow, collections plan and license all check their switch", () => {
    expect(ops).toContain('if (on("payment_team_alert") && !(await alreadySent(');
    expect(ops).toContain('if (!on("payment_due_tomorrow")) break;');
    expect(ops).toContain('on("collections_plan") ? await teamDigestAlreadySent');
    expect(ops).toContain('if (!on("license_expiring")) break;');
  });
  test("recovery cron returns before claiming anything when off", () => {
    expect(wiz.indexOf('"application_recovery"')).toBeLessThan(wiz.indexOf("runWizardRecovery(supabaseAdmin"));
    expect(wiz).toContain('skipped: "turned_off"');
  });
});

describe("UI status words (pure)", async () => {
  const { statusWords } = await import("@/components/admin/AutomationsCatalog");
  test("on + blocker reads 'On, Not Running', never just 'On'", () => {
    expect(statusWords({ on: true, health: "Job Failing", blockers: ["x"], canToggle: true }).label).toBe("On, Not Running");
    expect(statusWords({ on: false, health: "Running", blockers: [], canToggle: true }).label).toBe("Off");
    expect(statusWords({ on: null, health: "No Schedule", blockers: ["x"], canToggle: false }).label).toBe("Not Built On");
    expect(statusWords({ on: true, health: "Running", blockers: [], canToggle: true }).label).toBe("On, Running");
  });
});
