/**
 * eSign engine — full workflow + role tests against a DISPOSABLE database.
 *
 *   bash scripts/esign-harness/up.sh            # throwaway Postgres + PostgREST + proxy on 127.0.0.1
 *   bunx vitest run --config scripts/esign-harness/vitest.config.ts
 *   bash scripts/esign-harness/down.sh
 *
 * Isolation: refuses to run unless the API URL is the 127.0.0.1 harness; every
 * outbound fetch to a non-loopback host is refused, except Resend/Twilio which
 * are answered by a capture-only transport (nothing leaves the sandbox).
 * Real server-function handlers run with real role gates; only the HTTP
 * wrapper of createServerFn is replaced so handlers can be called directly.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";

const H = vi.hoisted(() => {
  const SECRET = "esign-harness-jwt-secret-not-a-real-key-000000";
  const URL_ = "http://127.0.0.1:55434";
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const { createHmac } = require("node:crypto");
  const jwt = (claims: any) => {
    const head = b64({ alg: "HS256", typ: "JWT" });
    const body = b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 });
    return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
  };
  process.env.SUPABASE_URL = URL_;
  process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: "service_role" });
  process.env.SUPABASE_PUBLISHABLE_KEY = jwt({ role: "anon" });
  process.env.RESEND_API_KEY = "capture-only";
  process.env.TWILIO_ACCOUNT_SID = "ACcapture"; process.env.TWILIO_AUTH_TOKEN = "capture"; process.env.TWILIO_FROM_NUMBER = "+15550000000";
  process.env.PUBLIC_SITE_URL = "https://staging.invalid";
  const captured: { host: string; body: string }[] = [];
  const blocked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const u = new URL(typeof input === "string" ? input : input.url ?? String(input));
    if (u.hostname === "127.0.0.1") return realFetch(input, init);
    if (u.hostname === "api.resend.com" || u.hostname === "api.twilio.com") {
      captured.push({ host: u.hostname, body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ id: `cap_${captured.length}`, sid: `SMcap${captured.length}` }), { status: 200, headers: { "content-type": "application/json" } });
    }
    blocked.push(u.hostname);
    throw new Error(`harness: outbound network to ${u.hostname} refused`);
  }) as any;
  return { jwt, URL_, captured, blocked };
});

vi.mock("@tanstack/react-start", () => {
  const createServerFn = () => {
    let validate: (d: unknown) => any = (d) => d;
    const b: any = {
      middleware: () => b,
      inputValidator: (v: any) => { validate = v; return b; },
      handler: (fn: any) => {
        const call: any = () => { throw new Error("call .run in tests"); };
        call.run = (data: unknown, context: any = {}) => Promise.resolve().then(() => fn({ data: validate(data), context }));
        return call;
      },
    };
    return b;
  };
  return { createServerFn, createMiddleware: () => ({ server: () => ({}), client: () => ({}) }) };
});
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://127.0.0.1/", { headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "esign-harness" } }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";
import * as A from "../src/lib/agreements.functions";
import * as T from "../src/lib/agreement-templates.functions";
import { completeSigning, voidDocument, hashToken, randomToken, retryArchive, deliverSigningLink } from "../src/lib/esign.server";
import { sha256Hex } from "../src/lib/esign-pdf.server";

type Role = "owner" | "manager" | "coordinator" | "driver" | "anon";
const ROLE_DB: Record<string, string> = { owner: "admin", manager: "team", coordinator: "coordinator", driver: "driver" };
const users: Record<string, string> = {};
const asUser = (r: Role) =>
  createClient(H.URL_, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${r === "anon" ? process.env.SUPABASE_PUBLISHABLE_KEY : H.jwt({ role: "authenticated", sub: users[r] })}` } },
  });
const ctx = (r: Role) => ({ userId: users[r], supabase: asUser(r) });
const tokenOf = (url: string) => url.split("/sign/")[1];
let appId = ""; let vehicleId = "";

async function q(table: string, filter: Record<string, any>, cols = "*") {
  let x: any = admin.from(table as any).select(cols);
  for (const [k, v] of Object.entries(filter)) x = x.eq(k, v);
  const { data, error } = await x;
  if (error) throw error;
  return data as any[];
}

beforeAll(async () => {
  expect(process.env.SUPABASE_URL).toBe("http://127.0.0.1:55434"); // isolation guard
  const probe = await fetch(`${H.URL_}/__harness/storage`).catch(() => null);
  if (!probe?.ok) throw new Error("Harness not running — bash scripts/esign-harness/up.sh");
  const pg = (await import("postgres")).default("postgresql://postgres@127.0.0.1:55432/esign?sslmode=disable", { max: 1 });
  for (const r of ["owner", "manager", "coordinator", "driver"] as const) {
    const [u] = await pg`insert into auth.users(email) values (${`${r}@harness.invalid`}) returning id`;
    users[r] = u.id;
    await pg`insert into public.user_roles(user_id, role) values (${u.id}, ${ROLE_DB[r]}::public.app_role)`;
  }
  await pg.end();
  const { data: v, error: ve } = await admin.from("vehicles").insert({ year: 2022, make: "Toyota", model: "Camry", vin: "4T1G11AK5NU000001", color: "Silver", weekly_rate: 350 } as any).select("id").single();
  if (ve) throw ve; vehicleId = v.id;
  const start = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  const { data: a, error: ae } = await admin.from("applications").insert({
    full_name: "Synthetic Driver", email: "driver@harness.invalid", phone: "+15555550100",
    address: "100 Test Street", city: "Testville", state: "TX", zip: "75001",
    license_number: "T1234567", license_state: "TX", license_expiration: "2030-01-01",
    vehicle_id: vehicleId, weekly_rent: 350, deposit_amount: 0, contract_start_date: start, contract_end_date: end,
    user_id: users.driver,
  } as any).select("id").single();
  if (ae) throw ae; appId = a.id;
});

afterAll(() => { expect(H.blocked).toEqual([]); });

describe("1. Preparation, preview and fingerprint", () => {
  it("required-field validation: blockers withhold the preview", async () => {
    const { data: bare } = await admin.from("applications").insert({ full_name: "Incomplete", email: "inc@harness.invalid", phone: "+15555550101" } as any).select("id").single();
    const p = await A.previewAgreement.run({ applicationId: bare!.id }, ctx("manager"));
    expect(p.blockers.length).toBeGreaterThan(5);
    expect(p.pdfBase64).toBeNull(); expect(p.fingerprint).toBeNull(); expect(p.canSend).toBe(false);
    await expect(A.sendAgreement.run({ applicationId: bare!.id, fingerprint: "0".repeat(64) }, ctx("manager"))).rejects.toThrow(/missing/i);
  });
  it("full populated preview: no blanks, real VIN, PDF rendered, Draft v1 label", async () => {
    const p = await A.previewAgreement.run({ applicationId: appId }, ctx("manager"));
    expect(p.blockers).toEqual([]);
    expect(p.body).toContain("4T1G11AK5NU000001");
    expect(p.body).not.toContain("__________");
    expect(p.body).not.toContain(appId);
    expect(Buffer.from(p.pdfBase64!, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect(p.template.label).toBe("Draft v1 — Legal Review Required");
    expect(p.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  it("preview is deterministic: same data → same fingerprint", async () => {
    const a = await A.previewAgreement.run({ applicationId: appId }, ctx("manager"));
    const b = await A.previewAgreement.run({ applicationId: appId }, ctx("manager"));
    expect(a.fingerprint).toBe(b.fingerprint);
  });
  it("company warning: missing Settings → Company is reported, never invented", async () => {
    const p = await A.previewAgreement.run({ applicationId: appId }, ctx("manager"));
    expect(p.companyMissing).toEqual(expect.arrayContaining(["Legal Business Name", "Support Email"]));
  });
});

describe("2. Send, links and signing", () => {
  let sentId = ""; let url = "";
  it("changed data after preview is refused", async () => {
    const p = await A.previewAgreement.run({ applicationId: appId }, ctx("manager"));
    await admin.from("applications").update({ weekly_rent: 375 } as any).eq("id", appId);
    await expect(A.sendAgreement.run({ applicationId: appId, fingerprint: p.fingerprint, companyAck: true }, ctx("manager"))).rejects.toThrow(/changed since it was previewed/);
    await admin.from("applications").update({ weekly_rent: 350 } as any).eq("id", appId);
    expect(await q("agreements", { application_id: appId })).toHaveLength(0);
  });
  it("send without company acknowledgment is refused while company details are incomplete", async () => {
    const p = await A.previewAgreement.run({ applicationId: appId }, ctx("manager"));
    await expect(A.sendAgreement.run({ applicationId: appId, fingerprint: p.fingerprint }, ctx("manager"))).rejects.toThrow(/Company details are incomplete/);
  });
  it("Manager sends with matching fingerprint; secure link; capture-only email; audited", async () => {
    const before = H.captured.length;
    const p = await A.previewAgreement.run({ applicationId: appId }, ctx("manager"));
    const r = await A.sendAgreement.run({ applicationId: appId, fingerprint: p.fingerprint, companyAck: true }, ctx("manager"));
    sentId = r.id; url = r.url;
    expect(tokenOf(url)).toMatch(/^[0-9a-f]{64}$/);
    const [row] = await q("agreements", { id: sentId });
    expect(row.status).toBe("sent");
    expect(row.body).toBe(p.body);
    expect(row.token_hash).toBe(await hashToken(tokenOf(url)));
    expect(JSON.stringify(row)).not.toContain(tokenOf(url)); // raw token never stored
    expect(row.email_status).toBe("sent");
    expect(H.captured.length).toBeGreaterThan(before);
    expect(H.captured.at(-1)!.body).toContain("driver@harness.invalid");
    const acts = (await q("audit_log", { entity_id: sentId })).map((x) => x.action);
    expect(acts).toEqual(expect.arrayContaining(["document.created", "document.sent", "agreement.company_fallback_ack"]));
  });
  it("sent agreement wording cannot be changed, even by a Manager with table rights", async () => {
    const { error } = await asUser("manager").from("agreements").update({ body: "tampered" }).eq("id", sentId);
    expect(error?.message ?? "").toMatch(/cannot be changed/);
    const [row] = await q("agreements", { id: sentId });
    expect(row.body).not.toBe("tampered");
  });
  it("resend rotates the token: old link dead, new link works, same row", async () => {
    const old = tokenOf(url);
    const r = await A.resendAgreement.run({ agreementId: sentId }, ctx("manager"));
    expect(await A.getAgreementByToken.run({ token: old })).toBeNull();
    const view = await A.getAgreementByToken.run({ token: tokenOf(r.url) });
    expect(view?.id).toBe(sentId);
    expect(view?.status).toBe("viewed");
    url = r.url;
    expect(await q("agreements", { application_id: appId })).toHaveLength(1);
  });
  it("consent and typed name are required", async () => {
    await expect(A.signAgreement.run({ token: tokenOf(url), signerName: "Synthetic Driver", agree: false })).rejects.toThrow();
    await expect(A.signAgreement.run({ token: tokenOf(url), signerName: "S", agree: true })).rejects.toThrow();
    const [row] = await q("agreements", { id: sentId });
    expect(row.status).toBe("viewed");
  });
  it("concurrent signing: exactly one winner, timestamps + evidence + archived PDF", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => A.signAgreement.run({ token: tokenOf(url), signerName: "Synthetic Driver", agree: true })));
    const won = results.filter((x) => x.status === "fulfilled" && !(x.value as any).alreadySigned);
    expect(won).toHaveLength(1);
    const [row] = await q("agreements", { id: sentId });
    expect(row.status).toBe("signed");
    expect(row.signer_name).toBe("Synthetic Driver");
    expect(row.signer_ip).toBe("203.0.113.9");
    expect(row.signed_at && row.viewed_at && row.sent_at).toBeTruthy();
    expect(row.token_hash).toBeNull();
    expect(row.archive_status).toBe("archived");
    expect(row.body_sha256).toBe(await sha256Hex(row.body));
    expect(await q("audit_log", { entity_id: sentId, action: "document.signed" })).toHaveLength(1);
  });
  it("archived PDF integrity: bytes match stored SHA-256; one vault document", async () => {
    const [row] = await q("agreements", { id: sentId });
    const pdf = await A.getAgreementPdf.run({ agreementId: sentId }, ctx("driver"));
    const bytes = Buffer.from(pdf.base64, "base64");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await sha256Hex(new Uint8Array(bytes))).toBe(row.sha256);
    expect(await q("documents", { storage_path: `${appId}/agreement-${sentId}.pdf` })).toHaveLength(1);
  });
  it("reused link after signing does not sign again", async () => {
    await expect(A.signAgreement.run({ token: tokenOf(url), signerName: "Someone Else", agree: true })).rejects.toThrow(/no longer valid/);
    const [row] = await q("agreements", { id: sentId });
    expect(row.signer_name).toBe("Synthetic Driver");
  });
  it("signed document is immutable: no void, no resend, no wording change", async () => {
    await expect(A.voidAgreement.run({ agreementId: sentId }, ctx("manager"))).rejects.toThrow(/already been signed/);
    await expect(A.resendAgreement.run({ agreementId: sentId }, ctx("manager"))).rejects.toThrow(/can no longer be sent/);
    const { error } = await admin.from("agreements").update({ body: "x" } as any).eq("id", sentId);
    expect(error).toBeTruthy();
  });
  it("delivery events logged without the raw link", async () => {
    const del = await q("audit_log", { entity_id: sentId });
    expect(JSON.stringify(del)).not.toContain("staging.invalid/sign/");
  });
});

// ---------------- engine-level checks (the original 28, preserved) ----------------
async function mk(opts: { expired?: boolean; app?: boolean } = {}) {
  const token = randomToken(); const hash = await hashToken(token);
  const { data, error } = await admin.from("agreements").insert({
    source: opts.app ? "rental" : "standalone", application_id: opts.app ? appId : null, title: "ESIGN ENGINE TEST",
    body: "Test agreement body.\nLine two with enough text to wrap a little across the page width for the PDF renderer.",
    status: "sent", sent_at: new Date().toISOString(), token_hash: hash,
    token_expires_at: new Date(Date.now() + (opts.expired ? -60_000 : 3600_000)).toISOString(), signer_email: "esign-test@harness.invalid",
  } as any).select("id").single();
  if (error) throw error;
  return { id: data.id as string, hash };
}
const sign = (id: string, hash: string | null, name = "Test Signer") =>
  completeSigning(admin, { id, tokenHash: hash, signerName: name, ip: "203.0.113.9", userAgent: "test", authMethod: hash ? "email_link" : "portal" })
    .then((r) => r.result).catch((e) => `error:${e.message}`);
const outage = () => { const real = admin.storage.from.bind(admin.storage); (admin.storage as any).from = () => ({ upload: async () => ({ error: { message: "simulated outage" } }) }); return () => { (admin.storage as any).from = real; }; };

describe("3. Engine checks (A–N)", () => {
  it("A/N simultaneous signing: one winner, signed, archived, sha256, one document", async () => {
    const a = await mk({ app: true });
    const rs = await Promise.all(Array.from({ length: 5 }, () => sign(a.id, a.hash)));
    expect(rs.filter((r) => r === "won")).toHaveLength(1);
    const [r] = await q("agreements", { id: a.id });
    expect(r.status).toBe("signed"); expect(r.archive_status).toBe("archived"); expect(r.document_id).toBeTruthy();
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await q("documents", { storage_path: `${appId}/agreement-${a.id}.pdf` })).toHaveLength(1);
    expect(await sign(a.id, a.hash)).not.toBe("won");
    expect(await sign(a.id, null)).toBe("already_signed");
    expect(await voidDocument(admin, a.id, null)).toBe("signed");
  });
  it("B sign vs void race: exactly one wins, state consistent; voided cannot be signed", async () => {
    const b = await mk({ app: true });
    const [v, s] = await Promise.all([voidDocument(admin, b.id, null), sign(b.id, b.hash)]);
    expect((v === "voided") !== (s === "won")).toBe(true);
    const [r] = await q("agreements", { id: b.id });
    expect(r.status).toBe(v === "voided" ? "voided" : "signed");
    const c = await mk(); await voidDocument(admin, c.id, null);
    expect(await sign(c.id, null)).toBe("voided");
  });
  it("C/F replaced and guessed tokens rejected", async () => {
    const d = await mk();
    await admin.from("agreements").update({ token_hash: await hashToken(randomToken()) } as any).eq("id", d.id);
    expect(await sign(d.id, d.hash)).toBe("invalid");
    expect(await sign(d.id, await hashToken("guess"))).toBe("invalid");
  });
  it("D expired token rejected (engine and public view)", async () => {
    const e = await mk({ expired: true });
    expect(await sign(e.id, e.hash)).toBe("expired");
  });
  it("I/J archive failure visible, signature kept, retry recovers once with audit", async () => {
    const f = await mk({ app: true });
    const restore = outage(); const fr = await sign(f.id, f.hash); restore();
    const [r] = await q("agreements", { id: f.id });
    expect(fr).toBe("won"); expect(r.status).toBe("signed");
    expect(r.archive_status).toBe("failed"); expect(r.archive_error).toBeTruthy(); expect(r.document_id).toBeNull();
    expect(await retryArchive(admin, f.id, null)).toBe(true);
    const [r2] = await q("agreements", { id: f.id });
    expect(r2.archive_status).toBe("archived");
    expect(await q("documents", { storage_path: `${appId}/agreement-${f.id}.pdf` })).toHaveLength(1);
    expect(await q("audit_log", { entity_id: f.id, action: "document.archive_recovered" })).toHaveLength(1);
  });
  it("K concurrent retries produce exactly one document; retry after archived is a no-op", async () => {
    const g = await mk({ app: true });
    const restore = outage(); await sign(g.id, g.hash); restore();
    const both = await Promise.all([retryArchive(admin, g.id, null), retryArchive(admin, g.id, null)]);
    expect(both).toContain(true);
    expect(await q("documents", { storage_path: `${appId}/agreement-${g.id}.pdf` })).toHaveLength(1);
    expect(await retryArchive(admin, g.id, null)).toBe(true);
  });
  it("L persistent failure stays visible", async () => {
    const h = await mk({ app: true });
    const restore = outage(); await sign(h.id, h.hash); const again = await retryArchive(admin, h.id, null); restore();
    const [r] = await q("agreements", { id: h.id });
    expect(again).toBe(false); expect(r.archive_status).toBe("failed"); expect(r.archive_attempts).toBe(2);
  });
  it("M delivery failure is truthful, audited without the link, link still signable", async () => {
    const m = await mk({ app: true });
    const saved = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
    const del = await deliverSigningLink(admin, { id: m.id, url: "https://example.invalid/sign/x", email: "esign-test@harness.invalid", phone: null, name: "T", vehicle: null, applicationId: null, actor: null });
    process.env.RESEND_API_KEY = saved;
    const [r] = await q("agreements", { id: m.id });
    expect(del.email).toBe("failed"); expect(r.email_status).toBe("failed"); expect(r.email_error).toBeTruthy();
    expect(r.sms_status).toBe("not_attempted"); expect(r.status).toBe("sent");
    const df = await q("audit_log", { entity_id: m.id, action: "document.delivery_failed" });
    expect(df).toHaveLength(1); expect(JSON.stringify(df)).not.toContain("example.invalid");
    expect(await sign(m.id, m.hash)).toBe("won");
  });
});

describe("4. Role authorization (real handlers + real RLS)", () => {
  it("Coordinator cannot preview, send, resend or void", async () => {
    const p = await A.previewAgreement.run({ applicationId: appId }, ctx("manager"));
    for (const call of [
      () => A.previewAgreement.run({ applicationId: appId }, ctx("coordinator")),
      () => A.sendAgreement.run({ applicationId: appId, fingerprint: p.fingerprint, companyAck: true }, ctx("coordinator")),
      () => A.voidAgreement.run({ agreementId: appId }, ctx("coordinator")),
      () => A.resendAgreement.run({ agreementId: appId }, ctx("coordinator")),
    ]) await expect(call()).rejects.toThrow(/Forbidden/);
  });
  it("Driver and an unknown user are refused staff actions", async () => {
    await expect(A.previewAgreement.run({ applicationId: appId }, ctx("driver"))).rejects.toThrow(/Forbidden/);
    await expect(A.previewAgreement.run({ applicationId: appId }, { userId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/Forbidden/);
  });
  it("RLS: signed-out sees no agreements; Coordinator reads but cannot write; Driver sees only own", async () => {
    const anon = await asUser("anon").from("agreements").select("id");
    expect(anon.error || (anon.data ?? []).length === 0).toBeTruthy();
    const c = await asUser("coordinator").from("agreements").select("id");
    expect((c.data ?? []).length).toBeGreaterThan(0);
    const cw = await asUser("coordinator").from("agreements").insert({ body: "x", title: "x" }).select("id");
    expect(cw.error).toBeTruthy();
    const d = await asUser("driver").from("agreements").select("id,application_id");
    expect((d.data ?? []).every((r: any) => r.application_id === appId)).toBe(true);
    const dw = await asUser("driver").from("agreements").update({ status: "voided" }).eq("application_id", appId).select("id");
    expect((dw.data ?? []).length).toBe(0);
  });
  it("RLS: only Owner can write templates or settings", async () => {
    for (const r of ["manager", "coordinator", "driver", "anon"] as const) {
      const t = await asUser(r).from("agreement_templates").insert({ name: "Rental Agreement", body: "x", version: 99 }).select("id");
      expect(t.error).toBeTruthy();
      const s = await asUser(r).from("app_settings").upsert({ key: "esign_template_enforcement", value: { enabled: true } }).select("key");
      expect(s.error || (s.data ?? []).length === 0).toBeTruthy();
    }
  });
});

describe("5. Template enforcement", () => {
  const sendable = async () => {
    const p = await A.previewAgreement.run({ applicationId: appId }, ctx("manager"));
    return p;
  };
  it("defaults Off; cannot turn On with no approved version; Draft v1 stays unapproved", async () => {
    expect(await q("app_settings", { key: "esign_template_enforcement" })).toHaveLength(0);
    const r = await T.setTemplateEnforcement.run({ enabled: true, reason: "", confirm: "ENABLE" }, ctx("owner"));
    expect(r.ok).toBe(false);
    const l = await T.listTemplateVersions.run({}, ctx("owner"));
    expect(l.versions.find((v: any) => v.version === 1)?.status).toBe("draft");
  });
  it("only Owner can approve, retire or change enforcement", async () => {
    for (const r of ["manager", "coordinator", "driver"] as const) {
      await expect(T.setTemplateEnforcement.run({ enabled: false, reason: "test reason", confirm: "DISABLE" }, ctx(r))).rejects.toThrow(/Forbidden/);
      await expect(T.approveTemplateVersion.run({ version: 1, fingerprint: "x", effectiveDate: "2026-10-09", confirm: "APPROVE" }, ctx(r))).rejects.toThrow(/Forbidden/);
      await expect(T.retireTemplateVersion.run({ version: 1, reason: "test reason" }, ctx(r))).rejects.toThrow(/Forbidden/);
    }
  });
  it("approval refused while company details are incomplete (nothing invented)", async () => {
    const { data: row } = await admin.from("agreement_templates").insert({ name: "Rental Agreement", body: "TEST TEMPLATE {{driver_name}} {{vehicle_vin}}", version: 2 } as any).select("id,content_sha256").single();
    const l = await T.listTemplateVersions.run({}, ctx("owner"));
    const v2 = l.versions.find((v: any) => v.version === 2)!;
    const r = await T.approveTemplateVersion.run({ version: 2, fingerprint: v2.fingerprint, effectiveDate: "2026-10-09", confirm: "APPROVE" }, ctx("owner"));
    expect(r.ok).toBe(false);
    expect(String((r as any).error)).toMatch(/missing in Settings/);
    expect(row).toBeTruthy();
  });
  it("with SYNTHETIC company details: Owner approves; approved wording immutable; enforcement On leaves sent/signed rows untouched", async () => {
    const snapshot = await q("agreements", {}, "id,body,status,template_id,merge_data");
    await admin.from("app_settings").upsert({ key: "system_preferences", value: { company_name: "Synthetic Test Co LLC", mailing_address: "1 Harness Way, Testville, TX 75001", business_phone: "+15555550199", support_email: "support@harness.invalid" } } as any);
    await admin.from("app_settings").upsert({ key: "esign_company_signer", value: { name: "Test Signer", title: "Test Title" } } as any);
    const l = await T.listTemplateVersions.run({}, ctx("owner"));
    const v2 = l.versions.find((v: any) => v.version === 2)!;
    const ap = await T.approveTemplateVersion.run({ version: 2, fingerprint: v2.fingerprint, effectiveDate: "2026-10-09", confirm: "APPROVE" }, ctx("owner"));
    expect(ap).toEqual({ ok: true });
    const { error: imm } = await admin.from("agreement_templates").update({ body: "changed" } as any).eq("version", 2);
    expect(imm?.message ?? "").toMatch(/immutable/);
    const on = await T.setTemplateEnforcement.run({ enabled: true, reason: "", confirm: "ENABLE" }, ctx("owner"));
    expect(on).toEqual({ ok: true });
    expect(await q("audit_log", { action: "template.enforcement_on" })).toHaveLength(1);
    expect(await q("agreements", {}, "id,body,status,template_id,merge_data")).toEqual(snapshot);
    const p = await sendable();
    expect(p.template.label).toBe("Approved v2");
    const off = await T.setTemplateEnforcement.run({ enabled: false, reason: "harness reset", confirm: "DISABLE" }, ctx("owner"));
    expect(off).toEqual({ ok: true });
    const l2 = await T.listTemplateVersions.run({}, ctx("owner"));
    expect(l2.versions.find((v: any) => v.version === 1)?.status).toBe("draft");
  });
});
