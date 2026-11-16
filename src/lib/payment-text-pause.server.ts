/**
 * Payment text pauses: hold the app's automatic payment notices to one renter
 * (rent reminders, Payment Failed Text, failed-payment emails) until a date,
 * for a stated reason, e.g. a payment deal. Staff and FLEET can set one.
 *
 * Only automatic renter-facing payment notices check this. Staff texts, receipts,
 * team alerts and Stripe itself are unaffected. A pause never changes what is
 * owed, never waives a late fee and never touches Stripe.
 *
 * Table: public.payment_text_pauses (proposed/payment-text-pauses-v1.sql).
 * Before that table exists every check answers "not paused" (today's behavior).
 */
type Admin = any;

export const MAX_PAUSE_DAYS = 45;
const ET = "America/New_York";

export type PauseCheck = { paused: true; until: string; reason: string; id: string } | { paused: false } | "unavailable";

function tableMissing(err: any): boolean {
  const code = String(err?.code ?? "");
  return code === "42P01" || code === "PGRST205" || /payment_text_pauses/.test(String(err?.message ?? "")) && /does not exist|not find/i.test(String(err?.message ?? ""));
}

/** Is an automatic payment notice to this rental paused right now? "unavailable" = could not read (callers hold the notice). */
export async function activePaymentPause(admin: Admin, rentalId: string | null | undefined, now: Date = new Date()): Promise<PauseCheck> {
  if (!rentalId) return { paused: false };
  try {
    const iso = now.toISOString();
    const res = await admin.from("payment_text_pauses")
      .select("id, pause_until, reason, starts_at, cancelled_at")
      .eq("rental_id", rentalId)
      .is("cancelled_at", null)
      .gt("pause_until", iso);
    if (res.error) return tableMissing(res.error) ? { paused: false } : "unavailable";
    const live = (res.data ?? []).filter((r: any) => !r.starts_at || Date.parse(r.starts_at) <= now.getTime());
    if (!live.length) return { paused: false };
    live.sort((a: any, b: any) => Date.parse(b.pause_until) - Date.parse(a.pause_until));
    return { paused: true, until: live[0].pause_until, reason: live[0].reason, id: live[0].id };
  } catch {
    return "unavailable";
  }
}

/** Offset of America/New_York at that instant, e.g. "-05:00". */
function etOffset(at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: ET, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  return name.replace("GMT", "") || "+00:00";
}

/**
 * "YYYY-MM-DD" = the end of that day in Eastern time (11:59:59 PM ET).
 * A full timestamp must carry its zone (Z or ±hh:mm).
 */
export function parsePauseUntil(input: unknown, now: Date = new Date()): { ok: true; until: Date } | { ok: false; error: string } {
  const s = String(input ?? "").trim();
  let until: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const probe = new Date(`${s}T12:00:00Z`);
    until = new Date(`${s}T23:59:59${etOffset(probe)}`);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    until = new Date(s);
  } else {
    return { ok: false, error: "pause_until must be YYYY-MM-DD (end of that day, Eastern) or an ISO timestamp with a time zone." };
  }
  if (!Number.isFinite(until.getTime())) return { ok: false, error: "pause_until is not a valid date." };
  if (until.getTime() <= now.getTime()) return { ok: false, error: "pause_until must be in the future." };
  if (until.getTime() - now.getTime() > MAX_PAUSE_DAYS * 86400000) return { ok: false, error: `A pause can last at most ${MAX_PAUSE_DAYS} days.` };
  return { ok: true, until };
}

// ------------------------------------------------------------------ FLEET API

export async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Bearer FLEET_API_KEY, compared in constant time (both sides hashed first, so length leaks nothing). */
export async function fleetApiAuthorized(request: Request, env: Record<string, string | undefined> = process.env as any): Promise<"ok" | "unauthorized" | "not_configured"> {
  const key = String(env.FLEET_API_KEY ?? "").trim();
  if (key.length < 24) return "not_configured";
  const h = request.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const [a, b] = await Promise.all([sha256(given), sha256(key)]);
  let diff = given ? 0 : 1;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? "ok" : "unauthorized";
}

function digits(p: unknown): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exactly one active rental by rental_id, lead_id or phone. */
export async function resolveActiveRental(admin: Admin, by: { rental_id?: unknown; lead_id?: unknown; phone?: unknown }):
  Promise<{ ok: true; rental: { id: string; application_id: string | null } } | { ok: false; status: number; error: string }> {
  if (by.rental_id) {
    if (!UUID.test(String(by.rental_id))) return { ok: false, status: 400, error: "rental_id must be a UUID." };
    const r = await admin.from("rentals").select("id, application_id, status").eq("id", String(by.rental_id)).maybeSingle();
    if (r.error) return { ok: false, status: 503, error: "Could not read rentals." };
    if (!r.data) return { ok: false, status: 404, error: "Rental not found." };
    if (r.data.status !== "active") return { ok: false, status: 409, error: "That rental is not active." };
    return { ok: true, rental: { id: r.data.id, application_id: r.data.application_id ?? null } };
  }
  let appIds: string[] = [];
  if (by.lead_id) {
    if (!UUID.test(String(by.lead_id))) return { ok: false, status: 400, error: "lead_id must be a UUID." };
    appIds = [String(by.lead_id)];
  } else if (by.phone) {
    const want = digits(by.phone);
    if (want.length !== 10) return { ok: false, status: 400, error: "phone must be a 10-digit US number." };
    const apps = await admin.from("applications").select("id, phone").ilike("phone", `%${want.slice(-4)}%`).is("deleted_at", null);
    if (apps.error) return { ok: false, status: 503, error: "Could not read leads." };
    appIds = (apps.data ?? []).filter((a: any) => digits(a.phone) === want).map((a: any) => a.id);
  } else {
    return { ok: false, status: 400, error: "Give rental_id, lead_id or phone." };
  }
  if (!appIds.length) return { ok: false, status: 404, error: "No renter matches." };
  const rs = await admin.from("rentals").select("id, application_id, status").in("application_id", appIds).eq("status", "active");
  if (rs.error) return { ok: false, status: 503, error: "Could not read rentals." };
  const list = rs.data ?? [];
  if (!list.length) return { ok: false, status: 404, error: "No active rental for that renter." };
  if (list.length > 1) return { ok: false, status: 409, error: "More than one active rental matches. Send rental_id." };
  return { ok: true, rental: { id: list[0].id, application_id: list[0].application_id ?? null } };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

type HandlerDeps = { admin?: Admin; env?: Record<string, string | undefined>; now?: () => Date; audit?: (e: any) => Promise<void> };

/**
 * POST /api/public/fleet/payment-text-pause
 *   { "action": "pause",  "phone"|"lead_id"|"rental_id": …, "pause_until": "2026-11-21", "reason": "…", "requested_by": "Dolmar via FLEET", "idempotency_key": "…" }
 *   { "action": "cancel", "pause_id": "…", "reason": "…" }
 *   { "action": "status", "phone"|"lead_id"|"rental_id": … }
 */
export async function handleFleetPaymentPause(request: Request, deps: HandlerDeps = {}): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, error: "POST only." });
  const auth = await fleetApiAuthorized(request, deps.env ?? (process.env as any));
  if (auth === "not_configured") return json(503, { ok: false, error: "FLEET API is not configured." });
  if (auth !== "ok") return json(401, { ok: false, error: "Unauthorized." });
  let body: any;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "Body must be JSON." }); }
  if (!body || typeof body !== "object") return json(400, { ok: false, error: "Body must be a JSON object." });
  const admin = deps.admin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const now = (deps.now ?? (() => new Date()))();
  const audit = deps.audit ?? (async (e: any) => (await import("@/lib/audit.server")).logAudit(null, e));
  const action = String(body.action ?? "pause");

  if (action === "cancel") {
    if (!UUID.test(String(body.pause_id ?? ""))) return json(400, { ok: false, error: "pause_id must be a UUID." });
    const pauseId = String(body.pause_id);
    const cur = await admin.from("payment_text_pauses").select("id, rental_id").eq("id", pauseId).is("cancelled_at", null).maybeSingle();
    if (cur.error) return json(503, { ok: false, error: "Could not read pauses." });
    if (!cur.data) return json(404, { ok: false, error: "No active pause with that id." });
    const res = await admin.from("payment_text_pauses")
      .update({ cancelled_at: now.toISOString(), cancelled_by: "FLEET (automated)", cancel_reason: String(body.reason ?? "").trim().slice(0, 500) || null })
      .eq("id", pauseId).is("cancelled_at", null).select("id");
    if (res.error) return json(503, { ok: false, error: "Could not cancel." });
    if (!res.data?.length) return json(404, { ok: false, error: "No active pause with that id." });
    await audit({ action: "payment_text_pause.cancelled", summary: "Payment text pause cancelled by FLEET (automated)", entityType: "rental", entityId: cur.data.rental_id, metadata: { pause_id: pauseId } });
    return json(200, { ok: true, pause_id: pauseId, cancelled_at: now.toISOString() });
  }

  const found = await resolveActiveRental(admin, body);
  if (!found.ok) return json(found.status, { ok: false, error: found.error });
  const rental = found.rental;

  if (action === "status") {
    const c = await activePaymentPause(admin, rental.id, now);
    if (c === "unavailable") return json(503, { ok: false, error: "Could not read pauses." });
    return json(200, { ok: true, rental_id: rental.id, lead_id: rental.application_id, ...(c.paused ? { paused: true, pause_id: c.id, pause_until: c.until, reason: c.reason } : { paused: false }) });
  }
  if (action !== "pause") return json(400, { ok: false, error: "action must be pause, cancel or status." });

  const until = parsePauseUntil(body.pause_until, now);
  if (!until.ok) return json(400, { ok: false, error: until.error });
  const reason = String(body.reason ?? "").trim();
  if (reason.length < 5) return json(400, { ok: false, error: "reason is required (at least 5 characters)." });
  const idem = body.idempotency_key == null ? null : String(body.idempotency_key).trim().slice(0, 120) || null;
  const row = {
    rental_id: rental.id,
    application_id: rental.application_id,
    starts_at: now.toISOString(),
    pause_until: until.until.toISOString(),
    reason: reason.slice(0, 500),
    created_by: `FLEET (automated)${body.requested_by ? ` for ${String(body.requested_by).trim().slice(0, 100)}` : ""}`,
    source: "fleet",
    idempotency_key: idem,
  };
  if (idem) {
    const prior = await admin.from("payment_text_pauses").select("id, rental_id, pause_until, cancelled_at").eq("idempotency_key", idem).maybeSingle();
    if (prior.error) return json(503, { ok: false, error: "Could not read pauses." });
    if (prior.data) {
      if (prior.data.rental_id !== rental.id) return json(409, { ok: false, error: "idempotency_key was already used for another rental." });
      return json(200, { ok: true, duplicate: true, pause_id: prior.data.id, rental_id: rental.id, lead_id: rental.application_id, pause_until: prior.data.pause_until, cancelled: !!prior.data.cancelled_at });
    }
  }
  const ins = await admin.from("payment_text_pauses").insert(row).select("id").single();
  if (ins.error || !ins.data) {
    if (String(ins.error?.code) === "23505" && idem) return json(409, { ok: false, error: "Duplicate idempotency_key; retry with status." });
    return json(503, { ok: false, error: tableMissing(ins.error) ? "Pauses are not set up yet." : "Could not save the pause. Nothing was changed." });
  }
  await audit({ action: "payment_text_pause.created", summary: `Payment texts paused until ${row.pause_until} by FLEET (automated)`, entityType: "rental", entityId: rental.id, metadata: { pause_id: ins.data.id, pause_until: row.pause_until, reason: row.reason } });
  return json(201, { ok: true, pause_id: ins.data.id, rental_id: rental.id, lead_id: rental.application_id, pause_until: row.pause_until, pause_until_et: until.until.toLocaleString("en-US", { timeZone: ET }) + " ET" });
}
