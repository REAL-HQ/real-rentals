// Stop emailing bad addresses (Dolmar, Nov 22 2026). Nov 2026 bounces were
// renter typos (gkail.com, gmail.vom, fmail.com), dead inboxes and test
// records (.invalid), and most workflows kept retrying them. Every
// renter-facing email now uses Missing-Items Outreach's rule, and the lead
// card shows "Bad Email". Nothing is sent: fetch is faked.
import { describe, expect, mock, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type Row = Record<string, any>;
const db = { deliveries: [] as Row[], readError: false };
function table(name: string): any {
  const preds: Array<(r: Row) => boolean> = [];
  const q: any = {
    select: () => q, order: () => q, limit: () => q, eq: () => q, is: () => q, lt: () => q, gt: () => q,
    ilike(k: string, v: string) { const want = v.replace(/\\([\\%_])/g, "$1").toLowerCase(); preds.push((r) => String(r[k] ?? "").toLowerCase() === want); return q; },
    in(k: string, v: any[]) { preds.push((r) => v.includes(r[k])); return q; },
    async maybeSingle() { return { data: null, error: null }; },
    then(res: any, rej: any) {
      const rows = name === "email_deliveries" ? db.deliveries.filter((r) => preds.every((p) => p(r))) : [];
      return Promise.resolve({ data: rows, error: name === "email_deliveries" && db.readError ? { message: "boom" } : null }).then(res, rej);
    },
    insert() { const p: any = Promise.resolve({ error: null }); p.select = () => ({ single: async () => ({ data: { id: "d1" }, error: null }) }); return p; },
    update() { const u: any = { eq: () => u, then: (r: any) => Promise.resolve({ error: null }).then(r) }; return u; },
  };
  return q;
}
const supabaseAdmin = { from: (n: string) => table(n), rpc: async () => ({ data: false, error: null }) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
const fetches: string[] = [];
(globalThis as any).fetch = async (url: string) => { fetches.push(String(url)); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); };
process.env.RESEND_API_KEY = "test-only";

const rule = await import("@/lib/email-suppression");
const srv = await import("@/lib/email-suppression.server");
const email = await import("@/lib/email.server");
const { isSuppressedEmail } = await import("@/lib/missing-items-outreach.server");

beforeEach(() => { db.deliveries = []; db.readError = false; fetches.length = 0; });
const d = (recipient: string, state: string, created_at: string) => db.deliveries.push({ recipient, state, created_at });

describe("rule", () => {
  test("past bounce, complaint, typo and test domains", () => {
    expect(rule.badEmailReason("a@gkail.com", [])).toBe("undeliverable");
    expect(rule.badEmailReason("a@gmail.vom", [])).toBe("undeliverable");
    expect(rule.badEmailReason("test@example.invalid", [])).toBe("undeliverable");
    expect(rule.badEmailReason("A@x.com", [{ recipient: "a@x.com", state: "bounced", created_at: "2026-11-01" }])).toBe("bounced");
    expect(rule.badEmailReason("a@x.com", [{ state: "delivered", created_at: "2026-11-09" }, { state: "complained", created_at: "2026-11-01" }])).toBe("complained");
    expect(rule.badEmailReason("ok@gmail.com", [])).toBe(null);
    expect(rule.badEmailReason("", [])).toBe(null);
  });
  test("a delivery after the last bounce clears it; one before does not", () => {
    expect(rule.badEmailReason("a@x.com", [{ state: "bounced", created_at: "2026-11-01" }, { state: "delivered", created_at: "2026-11-05" }])).toBe(null);
    expect(rule.badEmailReason("a@x.com", [{ state: "delivered", created_at: "2026-11-01" }, { state: "bounced", created_at: "2026-11-05" }])).toBe("bounced");
  });
  test("Missing-Items keeps its exact rule", () => {
    const bad = new Set(["old@gmail.com"]);
    expect(isSuppressedEmail("Old@Gmail.com ", bad)).toBe(true);
    expect(isSuppressedEmail("x@fmail.com", bad)).toBe(true);
    expect(isSuppressedEmail("ok@gmail.com", bad)).toBe(false);
  });
});

describe("every renter-facing email", () => {
  const send = (to: string, workflow?: string) => email.sendEmail({ to, subject: "s", html: "<p>x</p>", ...(workflow ? { track: { workflow } } : {}) });
  test("a bounced address gets no automated email", async () => {
    d("pat@x.com", "bounced", "2026-11-10T00:00:00Z");
    for (const wf of ["application_recovery", "application_resume", "approval_confirmation", "portal_invite", "payment_receipt", undefined]) {
      const r = await send("Pat@x.com", wf);
      expect(r).toMatchObject({ ok: false, blocked: "bounced" });
    }
    expect(fetches.length).toBe(0);
  });
  test("typo and test domains are blocked without a lookup", async () => {
    expect((await send("x@gmail.vom", "application_recovery")).blocked).toBe("bounced");
    expect((await send("t@example.invalid", "application_resume")).blocked).toBe("bounced");
    expect(fetches.length).toBe(0);
  });
  test("staff writing by hand, sign-in emails and team alerts still send", async () => {
    d("pat@x.com", "bounced", "2026-11-10T00:00:00Z");
    for (const wf of ["staff_message", "password_reset", "signup_confirm", "portal_signin", "lead_alert", "payment_team_alert"]) {
      expect((await send("pat@x.com", wf)).ok).toBe(true);
    }
    expect(fetches.length).toBe(6);
  });
  test("a good address sends; an unreadable history fails open", async () => {
    expect((await send("ok@x.com", "application_recovery")).ok).toBe(true);
    db.readError = true; d("pat@x.com", "bounced", "2026-11-10T00:00:00Z");
    expect((await send("pat@x.com", "application_recovery")).ok).toBe(true);
    expect(fetches.length).toBe(2);
  });
  test("held payment notices drop a bad address instead of calling it a provider failure", () => {
    expect(readFileSync("src/lib/held-payment-notices.server.ts", "utf8")).toContain('r.blocked === "bounced"');
  });
});

describe("lead card", () => {
  test("badEmailsFor flags bounced and typo addresses, case-insensitive", async () => {
    d("pat@x.com", "bounced", "2026-11-10T00:00:00Z");
    d("sam@x.com", "bounced", "2026-11-01T00:00:00Z"); d("sam@x.com", "delivered", "2026-11-03T00:00:00Z");
    const m = await srv.badEmailsFor(supabaseAdmin, ["Pat@x.com", "sam@x.com", "x@gkail.com", null, "ok@x.com"]);
    expect([...m.entries()].sort()).toEqual([["pat@x.com", "bounced"], ["x@gkail.com", "undeliverable"]]);
  });
  test("the server function sets email_bad, and the card shows Bad Email", async () => {
    const fn = readFileSync("src/lib/lead-priorities.functions.ts", "utf8");
    expect(fn).toContain("badEmailsFor(supabaseAdmin, rows.map((r) => r.email))");
    expect(readFileSync("src/components/admin/LeadPriorities.tsx", "utf8")).toContain("emailBad={lead.email_bad === true}");
    const { LeadCardBody } = await import("../src/components/admin/LeadCardBody");
    const lead: any = { bucket: "new", contact_status: "new", priority: "High", contactLabel: "New", created_at: "2026-11-22T14:00:00Z", contact_status_at: null, contact_follow_up_on: null, contact_status_note: null };
    const on = renderToStaticMarkup(h(LeadCardBody, { lead, today: "2026-11-22", name: "Pat", status: null, actions: null, emailBad: true }));
    const off = renderToStaticMarkup(h(LeadCardBody, { lead, today: "2026-11-22", name: "Pat", status: null, actions: null }));
    expect(on).toContain("data-lead-bad-email"); expect(on).toContain("Bad Email");
    expect(off).not.toContain("Bad Email");
  });
});
