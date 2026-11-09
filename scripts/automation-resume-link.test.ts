/**
 * New Applicant Follow-Up: {{resume_link}} and "Skip If Profile Is Complete".
 * In-memory database, fake senders. No network, nothing is sent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
const sentSms: Row[] = [];
const sentEmail: Row[] = [];
let mintCount = 0;
let mintFails = false;

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let orderKey: string | null = null;
  let asc = true;
  let lim: number | null = null;
  const rows = () => {
    let out = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (orderKey)
      out = [...out].sort((a, b) => (a[orderKey!] > b[orderKey!] ? 1 : -1) * (asc ? 1 : -1));
    return lim == null ? out : out.slice(0, lim);
  };
  const run = () => {
    if (patch) {
      for (const r of rows()) Object.assign(r, patch);
      return { data: null, error: null };
    }
    return { data: rows(), error: null };
  };
  const q: any = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
    gt: (k: string, v: any) => (filters.push((r) => r[k] > v), q),
    lte: (k: string, v: any) => (filters.push((r) => r[k] <= v), q),
    not: (k: string) => (filters.push((r) => r[k] != null), q),
    order: (k: string, o?: { ascending?: boolean }) => (
      (orderKey = k),
      (asc = o?.ascending !== false),
      q
    ),
    limit: (n: number) => ((lim = n), q),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    update: (p: Row) => ((patch = p), q),
    insert: async (r: Row) => ((db[table] ??= []).push(r), { error: null }),
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: query } }));
vi.mock("@/lib/email.server", () => ({
  sendEmail: async (a: Row) => (sentEmail.push(a), { ok: true }),
}));
vi.mock("@/lib/company.server", () => ({
  getBusinessPhone: async () => ({ display: "(888) 833-8280" }),
}));
vi.mock("@/lib/resume-tokens.server", () => ({
  issueResumeToken: async (_a: unknown, id: string, opts?: Row) => {
    if (mintFails) throw new Error("db down");
    if (opts && Object.keys(opts).length) throw new Error("expected a plain 14-day session token");
    mintCount++;
    return `tok-${id}-${mintCount}`;
  },
  resumeUrl: (t: string) => `https://drivereal.com/thank-you?t=${t}`,
}));
vi.mock("@/lib/sms.server", async (orig) => {
  const real: any = await orig();
  return { ...real, sendSms: async (a: Row) => (sentSms.push(a), { ok: true }) };
});

const eng = await import("../src/lib/automations.server");

const WF = "wf1";
function seed(opts: { currentStep: string; steps: Row[]; consent?: boolean }) {
  for (const k of Object.keys(db)) delete db[k];
  sentSms.length = 0;
  sentEmail.length = 0;
  mintCount = 0;
  mintFails = false;
  db.automation_workflows = [
    {
      id: WF,
      name: "New Applicant Follow-Up",
      is_active: true,
      quiet_hours_start: 0,
      quiet_hours_end: 0,
      stop_on_statuses: ["approved"],
    },
  ];
  db.applications = [
    {
      id: "app1",
      full_name: "Jordan Lee",
      email: "j@example.com",
      phone: "+18135550100",
      city: "Tampa",
      status: "new",
      current_step: opts.currentStep,
      sms_consent: opts.consent ?? true,
      sms_opt_out_at: null,
    },
  ];
  db.automation_steps = opts.steps.map((s, i) => ({
    id: `s${i + 1}`,
    workflow_id: WF,
    step_order: i + 1,
    delay_minutes: 0,
    is_active: true,
    subject: null,
    ...s,
  }));
  db.automation_enrollments = [
    {
      id: "e1",
      workflow_id: WF,
      application_id: "app1",
      rental_id: null,
      status: "active",
      current_step: 0,
      enrolled_at: new Date(Date.now() - 60_000).toISOString(),
      next_run_at: new Date(Date.now() - 1000).toISOString(),
    },
  ];
}
const enrollment = () => db.automation_enrollments[0];

describe("pure helpers", () => {
  it("detects {{resume_link}} only when present", () => {
    expect(eng.wantsResumeLink("finish here: {{resume_link}}")).toBe(true);
    expect(eng.wantsResumeLink("finish here: {{ RESUME_LINK }}")).toBe(true);
    expect(eng.wantsResumeLink("Hi {{first_name}}")).toBe(false);
  });
  it("skips only opted-in steps for finished profiles", () => {
    expect(
      eng.shouldSkipForCompleteProfile(
        { skip_when_profile_complete: true },
        { current_step: "profile_complete" },
      ),
    ).toBe(true);
    expect(
      eng.shouldSkipForCompleteProfile(
        { skip_when_profile_complete: true },
        { current_step: "documents" },
      ),
    ).toBe(false);
    expect(
      eng.shouldSkipForCompleteProfile(
        { skip_when_profile_complete: false },
        { current_step: "profile_complete" },
      ),
    ).toBe(false);
    expect(eng.shouldSkipForCompleteProfile({}, { current_step: "profile_complete" })).toBe(false);
  });
  it("email html makes the link a Finish My Profile button and escapes the rest", () => {
    const link = "https://drivereal.com/thank-you?t=abc_DEF-123";
    const html = eng.renderAutomationEmailHtml(`Hi <b>, here: ${link}`, link);
    expect(html).toContain(`<a href="${link}"`);
    expect(html).toContain("Finish My Profile</a>");
    expect(html).toContain("Hi &lt;b&gt;");
    expect(eng.renderAutomationEmailHtml("no link", null)).not.toContain("<a ");
  });
});

describe("runDueAutomations", () => {
  beforeEach(() => vi.useRealTimers());

  it("fills {{resume_link}} with a 14-day session link in SMS", async () => {
    seed({
      currentStep: "submitted",
      steps: [
        {
          channel: "sms",
          body: "Hi {{first_name}}, finish here: {{resume_link}} Reply STOP to opt out.",
        },
      ],
    });
    await eng.runDueAutomations();
    expect(sentSms).toHaveLength(1);
    expect(sentSms[0].body).toBe(
      "Hi Jordan, finish here: https://drivereal.com/thank-you?t=tok-app1-1 Reply STOP to opt out.",
    );
    expect(mintCount).toBe(1);
    expect(enrollment().status).toBe("completed");
  });

  it("renders the link as a button in email", async () => {
    seed({
      currentStep: "documents",
      steps: [
        { channel: "email", subject: "Hi {{first_name}}", body: "Finish here: {{resume_link}}" },
      ],
    });
    await eng.runDueAutomations();
    expect(sentEmail).toHaveLength(1);
    expect(sentEmail[0].html).toContain('<a href="https://drivereal.com/thank-you?t=tok-app1-1"');
    expect(sentEmail[0].html).toContain("Finish My Profile");
    expect(db.outbound_messages[0].body).toBe(
      "Finish here: https://drivereal.com/thank-you?t=tok-app1-1",
    );
  });

  it("does not mint a token when the body has no {{resume_link}}", async () => {
    seed({
      currentStep: "submitted",
      steps: [{ channel: "sms", body: "Hi {{first_name}}, thanks! Reply STOP to opt out." }],
    });
    await eng.runDueAutomations();
    expect(sentSms).toHaveLength(1);
    expect(mintCount).toBe(0);
  });

  it("does not mint a token for an SMS the applicant can't receive", async () => {
    seed({
      currentStep: "submitted",
      consent: false,
      steps: [{ channel: "sms", body: "Finish: {{resume_link}} Reply STOP to opt out." }],
    });
    await eng.runDueAutomations();
    expect(mintCount).toBe(0);
  });

  it("skips an opted-in step for a finished profile but still advances", async () => {
    seed({
      currentStep: "profile_complete",
      steps: [
        {
          channel: "sms",
          body: "Finish: {{resume_link}} Reply STOP to opt out.",
          skip_when_profile_complete: true,
        },
        {
          channel: "email",
          subject: "Checking in",
          body: "Just checking in.",
          skip_when_profile_complete: false,
          delay_minutes: 2880,
        },
      ],
    });
    const r = await eng.runDueAutomations();
    expect(sentSms).toHaveLength(0);
    expect(mintCount).toBe(0);
    expect(r.skipped).toBe(1);
    expect(enrollment().status).toBe("active");
    expect(enrollment().current_step).toBe(1);
    // The next (non-skipped) step is scheduled from enrollment, ~2 days out.
    expect(new Date(enrollment().next_run_at).getTime()).toBeGreaterThan(
      Date.now() + 47 * 3600_000,
    );
  });

  it("still sends an opted-in step to someone who hasn't finished", async () => {
    seed({
      currentStep: "documents",
      steps: [
        {
          channel: "sms",
          body: "Finish: {{resume_link}} Reply STOP to opt out.",
          skip_when_profile_complete: true,
        },
      ],
    });
    await eng.runDueAutomations();
    expect(sentSms).toHaveLength(1);
  });

  it("a skipped last step completes the sequence", async () => {
    seed({
      currentStep: "profile_complete",
      steps: [
        {
          channel: "email",
          subject: "x",
          body: "Finish: {{resume_link}}",
          skip_when_profile_complete: true,
        },
      ],
    });
    await eng.runDueAutomations();
    expect(sentEmail).toHaveLength(0);
    expect(enrollment().status).toBe("completed");
  });

  it("steps without the column (migration not applied) send as before", async () => {
    seed({
      currentStep: "profile_complete",
      steps: [{ channel: "sms", body: "Hi {{first_name}} Reply STOP to opt out." }],
    });
    await eng.runDueAutomations();
    expect(sentSms).toHaveLength(1);
  });

  it("never sends with the link missing if minting fails; retries next sweep", async () => {
    seed({
      currentStep: "submitted",
      steps: [{ channel: "sms", body: "Finish: {{resume_link}} Reply STOP to opt out." }],
    });
    mintFails = true;
    const r = await eng.runDueAutomations();
    expect(sentSms).toHaveLength(0);
    expect(r.skipped).toBe(1);
    expect(enrollment().status).toBe("active");
    expect(enrollment().current_step).toBe(0);
  });
});

describe("source guards", () => {
  const engine = readFileSync("src/lib/automations.server.ts", "utf8");
  const panel = readFileSync("src/components/admin/AutomationsPanel.tsx", "utf8");
  const mig = readFileSync(
    "supabase/migrations/20261109200000_automation_step_skip_when_profile_complete.sql",
    "utf8",
  );
  it("uses the 14-day session token, never the 30-minute recovery link", () => {
    expect(engine).toMatch(/issueResumeToken\(supabaseAdmin, enrollment\.application_id\),?\s*\)/);
    expect(engine).not.toMatch(/recovery:\s*true/);
  });
  it("step editor offers the checkbox only when the column exists", () => {
    expect(panel).toContain("Skip If Profile Is Complete");
    expect(panel).toMatch(/skipSupported \? \{ skip_when_profile_complete/);
    expect(panel).toContain('"resume_link"');
  });
  it("migration is additive with a false default", () => {
    expect(mig).toMatch(
      /ADD COLUMN IF NOT EXISTS skip_when_profile_complete boolean NOT NULL DEFAULT false/,
    );
    expect(mig).not.toMatch(/\b(UPDATE|DELETE|DROP)\b/);
  });
});
