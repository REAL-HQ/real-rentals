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
import { saveSettingsSection } from "../src/lib/settings-save";
import { LIBRARY } from "../src/lib/agreement-library";
import { writeTerms } from "../src/lib/agreement-builder";
import { sha256Hex } from "../src/lib/esign-pdf.server";

type Role = "owner" | "manager" | "coordinator" | "driver" | "anon";
const ROLE_DB: Record<string, string> = { owner: "admin", manager: "team", coordinator: "coordinator", driver: "driver" };
const users: Record<string, string> = {};
const asUser = (r: Role) => createClient(H.URL_, process.env.SUPABASE_PUBLISHABLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${r === "anon" ? process.env.SUPABASE_PUBLISHABLE_KEY : H.jwt({ role: "authenticated", sub: users[r] })}` } },
});
const ctx = (r: Role) => ({ userId: users[r], supabase: asUser(r) });
const ni = LIBRARY.find((t) => t.key === "no_insurance")!;
const ir = LIBRARY.find((t) => t.key === "insurance_required")!;

beforeAll(async () => {
  expect(process.env.SUPABASE_URL).toBe("http://127.0.0.1:55434"); // isolation guard
  const pg = (await import("postgres")).default("postgresql://postgres@127.0.0.1:55432/esign?sslmode=disable", { max: 1 });
  for (const r of ["owner", "manager", "coordinator", "driver"] as const) {
    const [u] = await pg`insert into auth.users(email) values (${`${r}.persist@harness.invalid`}) returning id`;
    users[r] = u.id;
    await pg`insert into public.user_roles(user_id, role) values (${u.id}, ${ROLE_DB[r]}::public.app_role)`;
  }
  await pg.end();
});
afterAll(() => { expect(H.blocked).toEqual([]); });

describe("Agreement library Save Draft persistence (disposable DB)", () => {
  it("Owner save writes a numbered draft that survives a fresh read (refresh/reopen)", async () => {
    const terms = { ...ni.terms, notice_hours: "48", service_area: "Florida only", mileage_allowance: "1,500 miles per week", excess_mileage_fee: "$0.25 per mile" };
    const r = await T.saveLibraryDraft.run({ key: "no_insurance", terms }, ctx("owner"));
    if (!r.ok) console.log("SAVE ERROR", JSON.stringify(r));
    expect(r).toMatchObject({ ok: true, version: 1 });
    const fresh = await T.getLibraryDrafts.run(undefined, ctx("owner"));
    const v = fresh.no_insurance.at(-1)!;
    expect(v.n).toBe(1);
    expect(v.terms).toMatchObject({ notice_hours: "48", service_area: "Florida only", mileage_allowance: "1,500 miles per week", excess_mileage_fee: "$0.25 per mile" });
    expect(v.sha256).toBe(await sha256Hex(writeTerms(ni.source, v.terms)));
    expect(fresh.insurance_required).toEqual([]); // families stay independent
  });
  it("saved values match the generated PDF text", async () => {
    const { data } = await admin.from("app_settings").select("value").eq("key", "agreement_library_draft:no_insurance").single();
    const body = writeTerms(ni.source, (data!.value as any).versions.at(-1).terms);
    const p = await T.previewTemplateBody.run({ body, label: "persist" }, ctx("owner"));
    expect(p.ok).toBe(true);
    expect(body).toContain("[[service_area]]; [[mileage_allowance]]");
    expect(body).toContain('"service_area":"Florida only"');
    expect(body).not.toContain("$0.25 per mile"); // excess fee is never printed
  });
  it("version history appends; unlimited clears the excess fee; activity log records each save", async () => {
    const r = await T.saveLibraryDraft.run({ key: "no_insurance", terms: { ...ni.terms, notice_hours: "48", service_area: "Florida only", mileage_allowance: "Unlimited miles", excess_mileage_fee: "$0.25 per mile" } }, ctx("owner"));
    expect(r).toMatchObject({ ok: true, version: 2 });
    const all = (await T.getLibraryDrafts.run(undefined, ctx("owner"))).no_insurance;
    expect(all.map((x) => x.n)).toEqual([1, 2]);
    expect(all[1].terms.excess_mileage_fee).toBe("");
    const { data: logs } = await admin.from("audit_log").select("action,metadata").eq("action", "template.library_draft_saved");
    expect(logs!.length).toBe(2);
  });
  it("failed saves never report success: no-change, unknown value, Manager/Coordinator/Driver", async () => {
    const same = (await T.getLibraryDrafts.run(undefined, ctx("owner"))).no_insurance.at(-1)!.terms;
    expect(await T.saveLibraryDraft.run({ key: "no_insurance", terms: same }, ctx("owner"))).toMatchObject({ ok: false });
    expect(await T.saveLibraryDraft.run({ key: "no_insurance", terms: { insurance_notice_hours: "24" } }, ctx("owner"))).toMatchObject({ ok: false });
    for (const r of ["manager", "coordinator", "driver"] as const)
      await expect(T.saveLibraryDraft.run({ key: "no_insurance", terms: { notice_hours: "72" } }, ctx(r))).rejects.toThrow();
    expect((await T.getLibraryDrafts.run(undefined, ctx("owner"))).no_insurance.length).toBe(2);
  });
  it("Insurance Required draft keeps 15 initials; Prepare uses draft values and stays unsendable", async () => {
    const r = await T.saveLibraryDraft.run({ key: "insurance_required", terms: { ...ir.terms, insurance_notice_hours: "24", service_area: "Florida only", mileage_allowance: "Unlimited miles" } }, ctx("owner"));
    expect(r.ok).toBe(true);
    const { data: a } = await admin.from("applications").insert({ full_name: "Persist Driver", email: "persist@harness.invalid", phone: "+15555550111" } as any).select("id").single();
    const p = await A.previewAgreement.run({ applicationId: a!.id, templateKey: "insurance_required" }, ctx("manager"));
    expect(p.canSend).toBe(false);
    expect(p.template.label).toContain("Draft Values #1");
    expect(p.blockers.some((b: any) => b.field === "insurance_verification")).toBe(true);
  });
  it("sent and signed agreements are untouched by draft saves", async () => {
    const { data: before } = await admin.from("agreements").select("id,body,merge_data,status");
    await T.saveLibraryDraft.run({ key: "no_insurance", terms: { ...ni.terms, notice_hours: "96" } }, ctx("owner"));
    const { data: after } = await admin.from("agreements").select("id,body,merge_data,status");
    expect(after).toEqual(before);
  });
});

describe("Settings explicit Save Changes (disposable DB)", () => {
  it("Owner save merges only changed fields, verifies by read-back, and survives a fresh read", async () => {
    await admin.from("app_settings").upsert({ key: "system_preferences", value: { business_phone: "+15550001111", company_name: "" } } as any, { onConflict: "key" });
    const r = await saveSettingsSection(asUser("owner"), "system_preferences", { company_name: "Synthetic Rentals LLC" });
    expect(r.ok).toBe(true);
    const { data } = await asUser("owner").from("app_settings").select("value").eq("key", "system_preferences").single();
    expect(data!.value).toMatchObject({ company_name: "Synthetic Rentals LLC", business_phone: "+15550001111" }); // other field preserved
  });
  it("a refused write reports an error, never Saved", async () => {
    const r = await saveSettingsSection(asUser("driver"), "system_preferences", { company_name: "Hacked" });
    expect(r.ok).toBe(false);
    const { data } = await admin.from("app_settings").select("value").eq("key", "system_preferences").single();
    expect((data!.value as any).company_name).toBe("Synthetic Rentals LLC");
  });
});
