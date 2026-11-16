/**
 * Shared plumbing for FLEET's inbound API (src/routes/api/public/fleet/*).
 * Same contract as the payment-text pause: POST + JSON, Bearer FLEET_API_KEY
 * compared in constant time, no-store JSON replies, every write audited as
 * "FLEET (automated)".
 */
import { fleetApiAuthorized } from "@/lib/payment-text-pause.server";

export type FleetEnv = Record<string, string | undefined>;
export type FleetDeps = {
  admin?: any;
  env?: FleetEnv;
  now?: () => Date;
  audit?: (e: { action: string; summary: string; entityType?: string | null; entityId?: string | null; metadata?: Record<string, unknown> }) => Promise<void>;
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const fleetJson = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Auth + JSON body. Returns the parsed object, or the Response to send back. */
export async function fleetRequestBody(request: Request, deps: FleetDeps): Promise<{ body: Record<string, any> } | { response: Response }> {
  if (request.method !== "POST") return { response: fleetJson(405, { ok: false, error: "POST only." }) };
  const auth = await fleetApiAuthorized(request, deps.env ?? (process.env as FleetEnv));
  if (auth === "not_configured") return { response: fleetJson(503, { ok: false, error: "FLEET API is not configured." }) };
  if (auth !== "ok") return { response: fleetJson(401, { ok: false, error: "Unauthorized." }) };
  let body: any;
  try { body = await request.json(); } catch { return { response: fleetJson(400, { ok: false, error: "Body must be JSON." }) }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { response: fleetJson(400, { ok: false, error: "Body must be a JSON object." }) };
  return { body };
}

export async function fleetAdmin(deps: FleetDeps): Promise<any> {
  return deps.admin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export function fleetAudit(deps: FleetDeps) {
  return deps.audit ?? (async (e: any) => (await import("@/lib/audit.server")).logAudit(null, e));
}

export function cleanText(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Optional idempotency key: 1–120 printable characters, or null. */
export function idempotencyKey(v: unknown): string | null | "invalid" {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!s || s.length > 120 || /[\u0000-\u001f]/.test(s)) return "invalid";
  return s;
}

export function tableMissing(err: any, table: string): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "");
  return code === "42P01" || code === "PGRST205" || (msg.includes(table) && /does not exist|not find/i.test(msg));
}
