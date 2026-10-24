// Shared helpers for tests against the local Record Rental harness: staff sessions
// through the real PostgREST gateway, a read-only Stripe double that throws on any
// write, and a Storage double backed by public.rr_harness_objects. Local only.
import { createHash, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type postgres from "postgres";
import type { RentalContext } from "../../src/lib/record-rental-runtime.server";
import type { RecordStripeReader } from "../../src/lib/record-rental-resources.server";

export const DB = "postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable";
export const GATEWAY = "http://127.0.0.1:55464";
export const SECRET = "record-rental-harness-jwt-secret-not-a-real-key-0000";
export const ISSUER = "postgres://rr_evidence_transport:harness-transport-only@127.0.0.1:55462/rr?sslmode=disable";
// sha256("record-rental-harness-gateway-key-not-real"), as up.sh installs it. Harness only.
export const GATEWAY_KEY = createHash("sha256").update("record-rental-harness-gateway-key-not-real").digest("hex");
// RR_TRANSPORT=gateway runs a suite through the signed evidence gateway instead of TCP.
export const ISSUER_CONFIG = process.env.RR_TRANSPORT === "gateway" ? { gatewayKey: GATEWAY_KEY } : { issuerUrl: ISSUER };
export const OWNER = "11111111-1111-4111-8111-111111111111", OWNER_SESSION = "33333333-3333-4333-8333-333333333333";

export function jwt(sub: string, session: string, role = "authenticated") {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b({ alg: "HS256", typ: "JWT" })}.${b({ sub, session_id: session, role, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
export function context(sub: string, session: string): { ctx: RentalContext; token: string } {
  const token = jwt(sub, session);
  const supabase = createClient(GATEWAY, jwt("00000000-0000-4000-8000-000000000000", OWNER_SESSION, "anon"), {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  return { ctx: { supabase: supabase as any, userId: sub, claims: { sub, session_id: session } }, token };
}
// A staff login with a live session and one role.
export async function staff(db: ReturnType<typeof postgres>, id: string, session: string, email: string, role: "admin" | "team" | "coordinator") {
  await db`insert into auth.users(id, email, email_confirmed_at) values (${id}, ${email}, now()) on conflict do nothing`;
  await db`insert into auth.sessions(id, user_id, not_after) values (${session}, ${id}, now() + interval '1 day') on conflict do nothing`;
  await db`insert into public.user_roles(user_id, role) values (${id}, ${role}) on conflict do nothing`;
  return context(id, session);
}

// Simulated Stripe: exactly three reads; anything else (create, update, charge, ...) throws.
export function fakeStripe(subs: Record<string, any[]>, calls: string[]): RecordStripeReader {
  const reader = {
    accounts: { retrieve: async () => { calls.push("accounts.retrieve"); return { id: "acct_harness" }; } },
    subscriptions: {
      list: async (p: any) => { calls.push("subscriptions.list"); const d = subs[p.customer] ?? []; return { data: d, has_more: false }; },
      retrieve: async (id: string) => { calls.push("subscriptions.retrieve"); const s = Object.values(subs).flat().find((x) => x.id === id); if (!s) throw new Error("no such subscription"); return s; },
    },
  };
  const guard = (o: any, name: string): any => new Proxy(o, { get(t, k) {
    if (typeof k === "symbol" || k === "then") return t[k];
    if (!(k in t)) throw new Error(`Stripe write or unexpected call attempted: ${name}.${String(k)}`);
    return typeof t[k] === "object" ? guard(t[k], `${name}.${String(k)}`) : t[k]; } });
  return guard(reader, "stripe");
}
export const weeklySub = (id: string, customer: string, cents: number) => ({ id, customer, livemode: false, status: "active",
  items: { has_more: false, data: [{ quantity: 1, current_period_end: Math.floor(Date.parse("2026-10-29T15:00:00Z") / 1000), price: { currency: "usd", unit_amount: cents, recurring: { interval: "week", interval_count: 1 } } }] } });

// Storage double: reads and write-once uploads against public.rr_harness_objects.
export function harnessStorage(db: ReturnType<typeof postgres>) {
  return {
    async download(bucket: string, path: string) {
      const [r] = await db`select bytes from public.rr_harness_objects where bucket = ${bucket} and path = ${path}`;
      if (!r) throw new Error(`object not found: ${bucket}/${path}`);
      return new Uint8Array(r.bytes);
    },
    async upload(bucket: string, path: string, bytes: Uint8Array, contentType: string) {
      void contentType;
      const rows = await db`insert into public.rr_harness_objects (bucket, path, bytes) values (${bucket}, ${path}, ${Buffer.from(bytes)}) on conflict do nothing returning path`;
      return { error: rows.length ? null : new Error("The resource already exists") };
    },
  };
}
