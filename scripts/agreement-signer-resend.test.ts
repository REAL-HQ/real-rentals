// Multi-signer agreement resend. Each signer keeps a distinct token.
// Fake database; nothing real is sent.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
import { fakeDb, KEY, req } from "./fleet-fake-db";
import { handleFleetResendLink, SIGNING_REQUIRED_KEYS } from "@/lib/fleet-resend-link.server";
import { handleFleetAgreementSigners } from "@/lib/fleet-agreement-signers.server";
import { resendAgreementSigners } from "@/lib/agreement-resend.server";

const sha = (token: string) => createHash("sha256").update(token).digest("hex");
const DAY = new Date("2026-11-16T15:00:00Z"); // 10 AM ET
const L1 = "11111111-1111-4111-8111-111111111111";
const AG = "66666666-6666-4666-8666-666666666666";
const S1 = "aaaaaaa1-1111-4111-8111-111111111111";
const S2 = "aaaaaaa2-2222-4222-8222-222222222222";
const T1 = "11".repeat(32);
const T2 = "22".repeat(32);
const H1 = sha(T1);
const H2 = sha(T2);
const env = { FLEET_API_KEY: KEY };
const fullMerge = Object.fromEntries(SIGNING_REQUIRED_KEYS.map((k) => [k, "x"]));

function seed(patch: { signer2?: Record<string, unknown>; channelsReady?: boolean } = {}) {
  return fakeDb({
    applications: [{ id: L1, full_name: "ana test", status: "approved", email: "ana@example.com", phone: "8135550101", sms_consent: true, deleted_at: null }],
    agreements: [{
      id: AG, application_id: L1, status: "sent", sent_at: "2026-11-16T08:00:00Z",
      signer_email: "ana@example.com", signer_name: "Ana Test",
      merge_data: { ...fullMerge, driver_name: "Ana Test", vehicle: "2017 Ford Fusion" },
      voided_at: null, created_at: "2026-11-16T08:00:00Z", token_hash: H1, token_expires_at: "2026-12-16T08:00:00Z",
    }],
    esign_recipients: [
      {
        id: S1, document_id: AG, role: "signer", signing_order: 1, status: "sent",
        name: "Ana Test", email: "ana@example.com", phone: "8135550101",
        token_hash: H1, link_token: T1, token_expires_at: "2026-12-16T08:00:00Z",
        token_revoked_at: null, signed_at: null, sent_at: "2026-11-16T08:00:00Z", viewed_at: "2026-11-16T09:00:00Z",
        sms_consent: true,
      },
      {
        id: S2, document_id: AG, role: "signer", signing_order: 2, status: "sent",
        name: "Ben Driver", email: "ben@example.com", phone: "8135550199",
        token_hash: H2, link_token: T2, token_expires_at: "2026-12-16T08:00:00Z",
        token_revoked_at: null, signed_at: null, sent_at: "2026-11-16T08:00:00Z", viewed_at: null,
        sms_consent: true,
        link_channel: "email_and_sms", link_email_status: "sent", link_sms_status: "sent",
        ...patch.signer2,
      },
    ],
    rental_additional_drivers: [],
    audit_log: [],
  });
}

function harness(db: any, now = DAY) {
  const calls: any = { deliver: [], mail: [], sms: [], audit: [] };
  const deps = {
    admin: db, env, now: () => now, gate: async () => "send" as const,
    audit: async (e: any) => { calls.audit.push(e); db.state.audit_log.push({ id: `au${calls.audit.length}`, action: e.action, entity_id: e.entityId, metadata: e.metadata, created_at: now.toISOString() }); },
    deliverSigning: async (_a: any, args: any) => { calls.deliver.push(args); return { email: "sent", sms: args.allowSms === false ? "not_attempted" : "sent", delivered: true }; },
    sendAgreementEmail: async (a: any) => { calls.mail.push(a); return { ok: true }; },
    sendSms: async (a: any) => { calls.sms.push(a); return { ok: true }; },
    siteUrl: () => "https://drivereal.com",
  };
  return { calls, deps };
}

const signer = (db: any, id: string) => db.state.esign_recipients.find((r: any) => r.id === id);

describe("per-signer resend", () => {
  test("two signers keep distinct tokens and signer 2's original token stays valid", async () => {
    const db = seed();
    const { calls, deps } = harness(db);
    const result = await resendAgreementSigners(db, {
      agreementId: AG, source: "staff", now: DAY, siteUrl: deps.siteUrl(), actor: null,
      deliverSigning: deps.deliverSigning, sendAgreementEmail: deps.sendAgreementEmail, sendSms: deps.sendSms, audit: deps.audit,
    });
    expect(signer(db, S1).token_hash).toBe(H1);
    expect(signer(db, S2).token_hash).toBe(H2);
    expect(H1).not.toBe(H2);
    expect(sha(T2)).toBe(signer(db, S2).token_hash);
    expect(db.state.agreements[0].token_hash).toBe(H1);
    expect(calls.deliver).toHaveLength(1);
    expect(calls.deliver[0].email).toBe("ana@example.com");
    expect(calls.deliver[0].url).toBe(`https://drivereal.com/sign/${T1}`);
    expect(calls.mail.map((m: any) => m.to)).toEqual(["ben@example.com"]);
    expect(calls.mail[0].url).toBe(`https://drivereal.com/sign/${T2}`);
    expect(result.signers.map((s) => s.action)).toEqual(["reused", "reused"]);
    expect(calls.audit).toHaveLength(2);
    expect(calls.audit.map((a: any) => a.metadata.signer_id).sort()).toEqual([S1, S2].sort());
    expect(JSON.stringify(calls.audit)).not.toContain(T1);
    expect(JSON.stringify(calls.audit)).not.toContain(T2);
  });

  test("both signers are emailed through the FLEET endpoint too", async () => {
    const db = seed();
    const { calls, deps } = harness(db);
    const res = await handleFleetResendLink(req({ kind: "signing", agreement_id: AG }), deps as any);
    const json = await res.json() as any;
    expect(res.status).toBe(200);
    expect(json.email).toBe("sent");
    expect(JSON.stringify(json)).not.toContain("/sign/");
    expect(JSON.stringify(json)).not.toContain(T1);
    expect(signer(db, S1).token_hash).toBe(H1);
    expect(signer(db, S2).token_hash).toBe(H2);
    expect(calls.deliver[0].url).toContain(T1);
    expect(calls.mail[0]).toMatchObject({ to: "ben@example.com" });
    expect(calls.mail[0].url).toContain(T2);
    expect(json.signers).toHaveLength(2);
  });

  test("email only sends zero SMS", async () => {
    const db = seed();
    const { calls, deps } = harness(db);
    const res = await handleFleetResendLink(req({ kind: "signing", agreement_id: AG, channels: "email" }), deps as any);
    const json = await res.json() as any;
    expect(res.status).toBe(200);
    expect(json.sms).toBe("not_attempted");
    expect(calls.sms).toHaveLength(0);
    expect(calls.deliver[0].allowSms).toBe(false);
    expect(calls.deliver[0].phone).toBeNull();
    expect(calls.mail).toHaveLength(1);
  });

  test("email only is allowed outside texting hours and still sends no SMS", async () => {
    const db = seed();
    const { calls, deps } = harness(db, new Date("2026-11-17T02:30:00Z")); // 9:30 PM ET, after the last send
    const res = await handleFleetResendLink(req({ kind: "signing", agreement_id: AG, channels: "email" }), deps as any);
    expect(res.status).toBe(200);
    expect(calls.sms).toHaveLength(0);
  });

  test("a signed signer is skipped and their token is untouched", async () => {
    const db = seed({ signer2: { status: "signed", signed_at: "2026-11-16T10:00:00Z" } });
    const { calls, deps } = harness(db);
    const result = await resendAgreementSigners(db, {
      agreementId: AG, source: "staff", now: DAY, siteUrl: deps.siteUrl(), actor: null,
      deliverSigning: deps.deliverSigning, sendAgreementEmail: deps.sendAgreementEmail, sendSms: deps.sendSms, audit: deps.audit,
    });
    expect(signer(db, S2).token_hash).toBe(H2);
    expect(signer(db, S2).link_token).toBe(T2);
    expect(signer(db, S2).signed_at).toBe("2026-11-16T10:00:00Z");
    expect(calls.mail).toHaveLength(0);
    expect(calls.deliver).toHaveLength(1);
    expect(result.signers.map((s) => s.id)).toEqual([S1]);
    expect(calls.audit.map((a: any) => a.metadata.signer_id)).toEqual([S1]);
  });

  test("an expired token is reissued for that signer only", async () => {
    const db = seed({ signer2: { token_expires_at: "2020-01-01T00:00:00Z" } });
    const { calls, deps } = harness(db);
    await resendAgreementSigners(db, {
      agreementId: AG, source: "staff", now: DAY, siteUrl: deps.siteUrl(), actor: null,
      deliverSigning: deps.deliverSigning, sendAgreementEmail: deps.sendAgreementEmail, sendSms: deps.sendSms, audit: deps.audit,
    });
    expect(signer(db, S1).token_hash).toBe(H1);
    expect(signer(db, S2).token_hash).not.toBe(H2);
    expect(signer(db, S2).token_hash).not.toBe(H1);
    expect(signer(db, S1).token_hash).not.toBe(signer(db, S2).token_hash);
    expect(calls.mail[0].url).not.toContain(T1);
    expect(calls.mail[0].url).not.toContain(T2);
  });

  test("signer id resends one person and leaves the other token alone", async () => {
    const db = seed();
    const { calls, deps } = harness(db);
    const res = await handleFleetResendLink(req({ kind: "signing", agreement_id: AG, signer_id: S2, channels: "email" }), deps as any);
    expect(res.status).toBe(200);
    expect(calls.deliver).toHaveLength(0);
    expect(calls.mail.map((m: any) => m.to)).toEqual(["ben@example.com"]);
    expect(signer(db, S1).token_hash).toBe(H1);
    expect(signer(db, S2).token_hash).toBe(H2);
    expect(calls.sms).toHaveLength(0);
  });

  test("additional signer SMS follows that signer's consent and not a shared number", async () => {
    const db = seed();
    const { calls, deps } = harness(db);
    await handleFleetResendLink(req({ kind: "signing", agreement_id: AG, channels: "email_and_sms" }), deps as any);
    expect(calls.sms).toHaveLength(1);
    expect(calls.sms[0].to).toBe("8135550199");
    expect(calls.sms[0].body).toContain(T2);
    expect(calls.sms[0].body).not.toContain(T1);
  });

  test("the status endpoint returns one row per signer", async () => {
    const db = seed({ signer2: { signed_at: "2026-11-16T12:00:00Z", status: "signed", last_viewed_at: "2026-11-16T11:00:00Z" } });
    const { deps } = harness(db);
    const res = await handleFleetAgreementSigners(req({ agreement_id: AG }), deps);
    const json = await res.json() as any;
    expect(res.status).toBe(200);
    expect(json.signers).toHaveLength(2);
    const ben = json.signers.find((s: any) => s.id === S2);
    const ana = json.signers.find((s: any) => s.id === S1);
    expect(ana).toMatchObject({
      role: "signer", name: "Ana Test", email: "a***@example.com", signed_at: null,
      last_link_sent_at: "2026-11-16T08:00:00Z", first_viewed_at: "2026-11-16T09:00:00Z",
    });
    expect(ben).toMatchObject({
      role: "signer", name: "Ben Driver", email: "b***@example.com",
      signed_at: "2026-11-16T12:00:00Z",
      last_link_channel: "email_and_sms",
      delivery_status: { email: "sent", sms: "sent" },
      last_viewed_at: "2026-11-16T11:00:00Z",
    });
    expect(JSON.stringify(json)).not.toContain("ana@example.com");
    expect(JSON.stringify(json)).not.toContain("ben@example.com");
    expect((await handleFleetAgreementSigners(req({ agreement_id: AG }, null), deps)).status).toBe(401);
  });

  test("the admin resend and the card offer All Unsigned Signers and Email Only", () => {
    const fn = readFileSync("src/lib/agreements.functions.ts", "utf8");
    const fleet = readFileSync("src/lib/fleet-resend-link.server.ts", "utf8");
    const card = readFileSync("src/components/admin/AgreementsCard.tsx", "utf8");
    expect(fn).toContain("resendAgreementSigners");
    expect(fleet).toContain("resendAgreementSigners");
    expect(card).toContain("All Unsigned Signers");
    expect(card).toContain("Email Only");
    expect(card).toContain("Resend Link");
    expect(card).not.toMatch(/text-transform:\s*uppercase|uppercase/);
    expect(readFileSync("src/lib/agreement-resend.server.ts", "utf8")).not.toMatch(/\+1\d{10}|\d{3}[-.)\s]\d{3}[-.\s]\d{4}/);
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain("/api/public/fleet/agreement-signers");
  });
});
