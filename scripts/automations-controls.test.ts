// Back Office → Automations. Behavioral against an in-memory database and a
// fake email provider: switches gate direct and cron sends, unreadable or
// malformed switches HOLD (fail closed, recorded failed, never "sent"),
// previews never send or mint links, and only the Owner can change a switch.
import { describe, expect, mock, test, beforeEach } from "bun:test";

type Row = Record<string, any>;
const db = {
  settings: new Map<string, any>(),
  settingsError: null as null | "error" | "throw",
  notifError: false,
  rows: {} as Record<string, Row[]>,
  audit: [] as Row[],
};
const fetches: string[] = [];
let tokenMints = 0;
const T = (n: string) => (db.rows[n] ??= []);

function table(name: string): any {
  const filters: Array<[string, any]> = [];
  const q: any = {
    select: () => q, order: () => q, limit: () => q, in: () => q, lt: () => q, gt: () => q, lte: () => q, gte: () => q, neq: () => q, not: () => q, is: () => q, or: () => q, like: () => q, ilike: () => q,
    eq(k: string, v: any) { filters.push([k, v]); return q; },
    then(res: any, rej: any) {
      return Promise.resolve({ data: T(name).filter((r) => filters.every(([k, v]) => r[k] === undefined || r[k] === v)), error: null, count: T(name).length }).then(res, rej);
    },
    async maybeSingle() {
      if (name === "app_settings") {
        const key = filters.find((f) => f[0] === "key")?.[1];
        if (key === "automation_controls" && db.settingsError === "throw") throw new Error("network");
        if (key === "automation_controls" && db.settingsError === "error") return { data: null, error: { message: "boom" } };
        if (key === "notifications" && db.notifError) return { data: null, error: { message: "boom" } };
        return { data: db.settings.has(key) ? { value: db.settings.get(key) } : null, error: null };
      }
      const rows = await q; return { data: rows.data[0] ?? null, error: null };
    },
    async upsert(row: Row) { if (name === "app_settings") db.settings.set(row.key, row.value); return { error: null }; },
    insert(row: Row) { T(name).push(row); const p: any = Promise.resolve({ error: null }); p.select = () => ({ single: async () => ({ data: { id: "d" + T(name).length }, error: null }) }); return p; },
    update(patch: Row) { const u: any = { eq: (_k: string, id: string) => { const w = T(name).find((x) => x.id === id); if (w) Object.assign(w, patch); return u; }, then: (r: any) => Promise.resolve({ error: null }).then(r), select: () => u }; return u; },
  };
  return q;
}
const supabaseAdmin = {
  from: (n: string) => table(n),
  rpc: async (fn: string) => fn === "get_cron_token" ? { data: "cron-test", error: null } : { data: null, error: { code: "PGRST202" } },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
mock.module("@/lib/resume-tokens.server", () => ({
  issueResumeToken: async () => { tokenMints++; return "REAL-TOKEN"; },
  issueResumeUrl: async () => { tokenMints++; return "https://drivereal.com/apply?resume=REAL-TOKEN"; },
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
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b: any = { middleware: () => b, inputValidator: (v: any) => { validate = v; return b; }, handler: (h: any) => async (a: any) => h({ ...a, data: validate(a.data) }) };
    return b;
  },
  useServerFn: (f: unknown) => f,
}));
mock.module("@tanstack/react-router", () => ({ createFileRoute: () => (cfg: any) => cfg }));
(globalThis as any).fetch = async (url: string) => { fetches.push(String(url)); return new Response(JSON.stringify({ id: "re_" + fetches.length }), { status: 200 }); };
process.env.RESEND_API_KEY = "test-only";

const email = await import("@/lib/email.server");
const controls = await import("@/lib/automation-controls.server");
const catalog = await import("@/lib/automation-catalog");
const fns = await import("@/lib/automations-overview.functions");
const ops = (await import("@/routes/api/public/cron/ops-reminders")).Route as any;
const wiz = (await import("@/routes/api/public/cron/wizard-recovery")).Route as any;
const KEY = catalog.AUTOMATION_CONTROLS_KEY;
const allOff = () => ({ off: Object.fromEntries(catalog.AUTOMATION_KEYS.map((k) => [k, { at: "t", by: "o" }])) });
const resend = () => fetches.filter((u) => u.includes("resend")).length;
const deliveries = () => T("email_deliveries");

beforeEach(() => {
  db.settings.clear(); db.settingsError = null; db.notifError = false; db.rows = {}; db.audit.length = 0; fetches.length = 0; tokenMints = 0; tier = "owner";
  T("automation_workflows").push({ id: "wf1", trigger_event: "application_submitted", is_active: false, created_at: "2026-09-25" });
  controls.clearAutomationControlsCache();
});

const pastDue = () => email.sendPastDueReminderEmail({ to: "r@example.com", firstName: "R", amount: 350, dueDate: "2026-11-01", daysLate: 3 });

describe("direct sends: absent vs off vs unreadable", () => {
  test("missing row = legacy default on: sends", async () => {
    const r = await pastDue();
    expect(r.ok).toBe(true); expect(resend()).toBe(1);
  });
  test("Owner Off: not sent, no delivery row, reported blocked off", async () => {
    db.settings.set(KEY, { off: { payment_past_due: { at: "t", by: "o" } } });
    const r = await pastDue();
    expect(r).toMatchObject({ ok: false, blocked: "off" }); expect(resend()).toBe(0); expect(deliveries().length).toBe(0);
  });
  for (const [label, setup] of [
    ["database error", () => { db.settingsError = "error"; }],
    ["client throws", () => { db.settingsError = "throw"; }],
    ["malformed row (not an object)", () => { db.settings.set(KEY, "garbage"); }],
    ["malformed row (off is a list)", () => { db.settings.set(KEY, { off: ["payment_past_due"] }); }],
  ] as const) {
    test(`${label}: HELD — not sent, recorded failed (not delivered), retriable`, async () => {
      setup();
      const r = await pastDue();
      expect(r).toMatchObject({ ok: false, blocked: "held", retriable: true });
      expect(resend()).toBe(0);
      expect(deliveries()).toEqual([expect.objectContaining({ workflow: "payment_past_due", state: "failed", provider_reason: controls.HELD_REASON })]);
    });
  }
  test("a failed read is not cached: the next send after recovery goes out", async () => {
    db.settingsError = "error"; await pastDue();
    db.settingsError = null; const r = await pastDue();
    expect(r.ok).toBe(true); expect(resend()).toBe(1);
  });
  test("Stripe-webhook templates (receipt, failed, card) honour Off and hold on failure", async () => {
    db.settings.set(KEY, allOff());
    const a = await email.sendPaymentReceiptEmail({ to: "r@example.com", firstName: "R", amount: 1, reason: "rent" });
    const b = await email.sendPaymentFailedEmail({ to: "r@example.com", firstName: "R", amount: 1, reason: "rent" });
    const c = await email.sendCardExpiringEmail({ to: "r@example.com", firstName: "R", expMonth: 1, expYear: 2027 });
    expect([a.blocked, b.blocked, c.blocked]).toEqual(["off", "off", "off"]); expect(resend()).toBe(0);
    controls.clearAutomationControlsCache(); db.settingsError = "error";
    const d = await email.sendPaymentReceiptEmail({ to: "r@example.com", firstName: "R", amount: 1, reason: "rent" });
    expect(d.blocked).toBe("held"); expect(deliveries().at(-1)).toMatchObject({ workflow: "payment_receipt", state: "failed" });
  });
  test("excluded paths (sign-in, invites, eSign, untracked) are never gated, even when unreadable", async () => {
    db.settingsError = "error";
    for (const w of ["portal_signin", "staff_invite", "portal_invite", "esign_signing_request", undefined]) expect(await controls.emailGate(w)).toBe("send");
    const r = await email.sendEmail({ to: "a@example.com", subject: "s", html: "<p>x</p>", track: { workflow: "portal_signin" } });
    expect(r.ok).toBe(true);
  });
});

describe("lead alerts (existing notifications fields)", () => {
  const lead = () => email.sendLeadAlertEmail({ event: "new", applicationId: "a", full_name: "N", phone: null, email: null, city: null, state: null, market: null, pickup_date: null, return_date: null, platforms: null, sms_consent: null, source: null });
  test("absent setting sends; Off does not", async () => {
    await lead(); expect(resend()).toBe(1);
    db.settings.set("notifications", { alert_on_new: false }); await lead(); expect(resend()).toBe(1);
  });
  test("unreadable notifications setting holds, even if it was On", async () => {
    db.notifError = true; await lead();
    expect(resend()).toBe(0); expect(deliveries().at(-1)).toMatchObject({ workflow: "lead_alert", state: "failed" });
  });
});

describe("cron routes (handlers run against the in-memory database)", () => {
  const req = () => new Request("https://x/api", { headers: { authorization: "Bearer cron-test" } });
  const seedPastDue = () => {
    T("payments").push({ id: "p1", driver_id: "app1", amount: 350, balance_due: 350, due_date: "2026-11-01", status: "overdue" });
    T("applications").push({ id: "app1", full_name: "R", email: "r@example.com", user_id: null });
  };
  test("ops-reminders: on → past-due email goes and is logged (proves the fixture path)", async () => {
    seedPastDue();
    const res = await ops.server.handlers.GET({ request: req() });
    expect(res.status).toBe(200); expect(resend()).toBeGreaterThan(0);
    expect(T("outbound_messages").some((m) => String(m.kind).startsWith("payment_reminder:"))).toBe(true);
  });
  test("ops-reminders: everything Off → no email, no reminder logged, no bell", async () => {
    seedPastDue(); db.settings.set(KEY, allOff());
    const res = await ops.server.handlers.GET({ request: req() });
    expect(res.status).toBe(200); expect(resend()).toBe(0);
    expect(T("outbound_messages").length).toBe(0); expect(T("notifications").length).toBe(0);
  });
  test("ops-reminders: unreadable switches → 503, nothing sent or logged", async () => {
    seedPastDue(); db.settingsError = "error";
    const res = await ops.server.handlers.GET({ request: req() });
    expect(res.status).toBe(503); expect(resend()).toBe(0); expect(T("outbound_messages").length).toBe(0);
  });
  test("wizard-recovery: Off → skipped; unreadable → 503; nothing claimed", async () => {
    db.settings.set(KEY, allOff());
    expect(await (await wiz.server.handlers.GET({ request: req() })).json()).toEqual({ skipped: "turned_off" });
    controls.clearAutomationControlsCache(); db.settings.clear(); db.settingsError = "error";
    expect((await wiz.server.handlers.GET({ request: req() })).status).toBe(503);
    expect(resend()).toBe(0); expect(tokenMints).toBe(0);
  });
});

describe("previews", () => {
  test("every preview renders with sample data: no send, no delivery row, no token minted, placeholder links only", async () => {
    const { renderAutomationPreview } = await import("@/lib/automation-preview.server");
    for (const id of [...new Set(catalog.AUTOMATIONS.flatMap((a) => a.previews))]) {
      const r = await renderAutomationPreview(id);
      expect(r.subject, id).toBeTruthy();
      expect(r.html, id).not.toContain("REAL-TOKEN");
      if (/recovery|resume/.test(id)) expect(r.html, id).toContain("PREVIEW-LINK");
    }
    expect(resend()).toBe(0); expect(deliveries().length).toBe(0); expect(tokenMints).toBe(0);
  });
  test("previews render while Off or unreadable", async () => {
    db.settingsError = "error";
    const r = await (await import("@/lib/automation-preview.server")).renderAutomationPreview("past_due");
    expect(r.subject).toContain("Past Due"); expect(deliveries().length).toBe(0);
  });
  test("Coordinator refused", async () => {
    tier = "coordinator";
    await expect(fns.previewAutomationTemplate({ data: { id: "past_due" }, context: { userId: "c" } } as any)).rejects.toThrow("Forbidden");
  });
});

describe("switches", () => {
  const set = (key: string, on: boolean) => fns.setAutomationOn({ data: { key, on }, context: { userId: "o" } } as any);
  test("Owner off/on: stored, audited, gate follows", async () => {
    await set("payment_past_due", false);
    expect(db.audit.at(-1)).toMatchObject({ action: "automation.turned_off", entityId: "payment_past_due", metadata: { from: true, to: false } });
    expect((await pastDue()).blocked).toBe("off");
    await set("payment_past_due", true);
    expect((await pastDue()).ok).toBe(true);
  });
  test("rejected changes write nothing and audit nothing", async () => {
    db.settings.set(KEY, { off: { payment_receipt: { at: "t", by: "o" } } });
    const before = JSON.stringify([...db.settings]);
    tier = "manager"; await expect(set("payment_past_due", false)).rejects.toThrow("Forbidden");
    tier = "owner";
    await expect(set("document_expiring", true)).rejects.toThrow("can't be turned on");
    await expect(set("everything", false)).rejects.toThrow();
    db.settingsError = "error"; await expect(set("payment_past_due", false)).rejects.toThrow("could not be read");
    db.settingsError = null; db.settings.set("notifications", "garbage");
    await expect(set("lead_alert_new", false)).rejects.toThrow("malformed");
    db.settings.delete("notifications");
    expect(JSON.stringify([...db.settings])).toBe(before);
    expect(db.audit.length).toBe(0);
    expect(T("automation_workflows")[0].is_active).toBe(false);
  });
  test("lead alert switch keeps other notifications fields", async () => {
    db.settings.set("notifications", { admin_email: "team@drivereal.com" });
    await set("lead_alert_new", false);
    expect(db.settings.get("notifications")).toEqual({ admin_email: "team@drivereal.com", alert_on_new: false });
  });
  test("workflow switch uses automation_workflows.is_active", async () => {
    await set("new_applicant_followup", true);
    expect(T("automation_workflows")[0].is_active).toBe(true);
  });
});

describe("overview is truthful", () => {
  const load = () => fns.getAutomationsOverview({ context: { userId: "m" } } as any);
  test("loading writes nothing; workflow that is Off shows Off, not On", async () => {
    const o = await load();
    expect(o.rows.find((r) => r.key === "new_applicant_followup")!.on).toBe(false);
    expect(o.rows.find((r) => r.key === "payment_past_due")!.on).toBe(true);
    expect(db.settings.size).toBe(0); expect(db.audit.length).toBe(0);
    expect(o.controlsStatus).toBe("absent");
  });
  test("unreadable switches show Held/unknown, never on, and can't be toggled", async () => {
    db.settingsError = "error";
    const o = await load();
    const r = o.rows.find((x) => x.key === "payment_past_due")!;
    expect(r.on).toBeNull(); expect(r.canToggle).toBe(false); expect(o.controlsStatus).toBe("error");
    const { statusWords } = await import("@/components/admin/AutomationsCatalog");
    expect(statusWords(r).label).toBe("Held");
  });
  test("status words", async () => {
    const { statusWords } = await import("@/components/admin/AutomationsCatalog");
    expect(statusWords({ on: true, health: "Job Failing", blockers: ["x"], canToggle: true }).label).toBe("On, Not Running");
    expect(statusWords({ on: null, health: "No Schedule", blockers: ["Built but switched off"], canToggle: false }).label).toBe("Not Built On");
  });
});

describe("no cross-instance lag", () => {
  test("an Off written by another instance applies to the very next send (no cache)", async () => {
    expect((await pastDue()).ok).toBe(true);
    db.settings.set(KEY, { off: { payment_past_due: { at: "t", by: "elsewhere" } } }); // no cache clear
    expect((await pastDue()).blocked).toBe("off");
  });
});

describe("applicant workflow dispatcher", () => {
  test("a transient workflow read error leaves the enrollment active for retry, not cancelled", async () => {
    const enr = { id: "e1", workflow_id: "wf1", application_id: "app1", status: "active", current_step: 0, enrolled_at: "2026-11-01", next_run_at: "2026-11-01" };
    T("automation_enrollments").push(enr);
    const orig = supabaseAdmin.from;
    (supabaseAdmin as any).from = (n: string) => {
      const t = orig(n);
      if (n === "automation_workflows") t.maybeSingle = async () => ({ data: null, error: { message: "timeout" } });
      return t;
    };
    try {
      const { runDueAutomations } = await import("@/lib/automations.server");
      const r: any = await runDueAutomations();
      expect(r.cancelled).toBe(0);
      expect(r.skipped).toBe(1);
      expect(enr.status).toBe("active");
    } finally { (supabaseAdmin as any).from = orig; }
  });
});
