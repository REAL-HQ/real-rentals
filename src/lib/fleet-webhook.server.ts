/**
 * Outbound FLEET webhooks (Automation Blueprint, Nov 14 2026).
 *
 * One signed sender for every event FLEET gets:
 *   lead_created, stage_changed            (queued by a DB trigger on applications)
 *   quo_message_received, quo_call,
 *   quo_voicemail, quo_transcript          (queued by the Quo webhook)
 *
 * Disabled until FLEET_WEBHOOK_URL (https) and FLEET_WEBHOOK_KEY are set.
 * While disabled, queued rows are marked 'skipped' (nothing is sent and no
 * backlog replays later). Every attempt is logged on the row in
 * public.fleet_webhook_deliveries; failures retry with backoff up to
 * FLEET_MAX_ATTEMPTS, then stop as 'failed'.
 *
 * Request: POST, Content-Type application/json, and
 *   <FLEET_WEBHOOK_AUTH_HEADER, default Authorization>: Bearer <FLEET_WEBHOOK_KEY>
 *     (for any other header name the raw key is sent; FLEET_WEBHOOK_AUTH_SCHEME
 *      overrides the prefix, "" for none)
 *   X-Real-Event:        the event name
 *   X-Real-Delivery-Id:  stable per delivery (same on retries); dedupe on it
 *   X-Real-Timestamp:    unix seconds
 *   X-Real-Signature:    v1=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 * secret = FLEET_WEBHOOK_SIGNING_SECRET, or FLEET_WEBHOOK_KEY when unset.
 * See docs/fleet-webhooks.md for how to verify.
 */
import { REQUIRED_DOC_TYPES } from "@/components/admin/types";
import { canonicalRequiredDoc } from "@/lib/required-docs";
import { toE164 } from "@/lib/sms.server";

type Env = Record<string, string | undefined>;
type Admin = any;

export const FLEET_LEAD_EVENTS = ["lead_created", "stage_changed"] as const;
export const FLEET_QUO_EVENTS = ["quo_message_received", "quo_call", "quo_voicemail", "quo_transcript"] as const;
export type FleetEvent = (typeof FLEET_LEAD_EVENTS)[number] | (typeof FLEET_QUO_EVENTS)[number];

export const FLEET_MAX_ATTEMPTS = 8;
/** Wait before attempt n+1 after n failed attempts. */
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000];
export function retryDelayMs(failedAttempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(failedAttempts, 1), BACKOFF_MS.length) - 1];
}

export type FleetConfig =
  | { enabled: true; url: string; authHeader: string; authValue: string; signingSecret: string }
  | { enabled: false; reason: string };

export function fleetWebhookConfig(env: Env = process.env as Env): FleetConfig {
  const url = String(env.FLEET_WEBHOOK_URL ?? "").trim();
  const key = String(env.FLEET_WEBHOOK_KEY ?? "").trim();
  if (!url || !key) return { enabled: false, reason: "FLEET_WEBHOOK_URL and FLEET_WEBHOOK_KEY are not both set" };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { enabled: false, reason: "FLEET_WEBHOOK_URL is not a valid URL" }; }
  if (parsed.protocol !== "https:") return { enabled: false, reason: "FLEET_WEBHOOK_URL must be https" };
  const authHeader = String(env.FLEET_WEBHOOK_AUTH_HEADER ?? "").trim() || "Authorization";
  const scheme = env.FLEET_WEBHOOK_AUTH_SCHEME != null
    ? String(env.FLEET_WEBHOOK_AUTH_SCHEME).trim()
    : authHeader.toLowerCase() === "authorization" ? "Bearer" : "";
  const signingSecret = String(env.FLEET_WEBHOOK_SIGNING_SECRET ?? "").trim() || key;
  return { enabled: true, url, authHeader, authValue: scheme ? `${scheme} ${key}` : key, signingSecret };
}

export async function signFleetBody(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${timestamp}.${rawBody}`)));
  return "v1=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fleetRequest(cfg: Extract<FleetConfig, { enabled: true }>, a: { deliveryId: string; event: string; body: string; nowMs: number }) {
  const ts = String(Math.floor(a.nowMs / 1000));
  return {
    url: cfg.url,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [cfg.authHeader]: cfg.authValue,
        "X-Real-Event": a.event,
        "X-Real-Delivery-Id": a.deliveryId,
        "X-Real-Timestamp": ts,
        "X-Real-Signature": await signFleetBody(cfg.signingSecret, ts, a.body),
      } as Record<string, string>,
      body: a.body,
    },
  };
}

// ---------------------------------------------------------------- lead payload

const ET = "America/New_York";
/** pickup_date + pickup_time (Eastern) as ISO 8601 with offset; date-only when no time. */
export function pickupAt(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const m = String(time ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return date;
  const hh = m[1].padStart(2, "0");
  const probe = new Date(`${date}T${hh}:${m[2]}:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: ET, timeZoneName: "longOffset" }).formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  const off = name.replace("GMT", "") || "+00:00";
  return `${date}T${hh}:${m[2]}:00${off}`;
}

/** What FLEET reads as Step 2 documents. Income is optional (blueprint). */
export const FLEET_REQUIRED_DOCS = ["license_front", "license_back", "gig_profile_screenshot", "home_address"] as const;
export const FLEET_OPTIONAL_DOCS = ["income"] as const;
const SITE_TO_FLEET_DOC: Record<string, string> = { driver_profile_screenshot: "gig_profile_screenshot" };

export function docsSummary(app: Record<string, any>, docRows: readonly Record<string, any>[]) {
  const have = new Set<string>();
  for (const r of docRows) {
    const c = canonicalRequiredDoc(r);
    if (c && (REQUIRED_DOC_TYPES as readonly string[]).includes(c)) have.add(SITE_TO_FLEET_DOC[c] ?? c);
  }
  if (app.profile_screenshot_url) have.add("gig_profile_screenshot");
  if (String(app.address ?? "").trim()) have.add("home_address");
  const all = [...FLEET_REQUIRED_DOCS, ...FLEET_OPTIONAL_DOCS];
  return {
    received: all.filter((d) => have.has(d)),
    missing: FLEET_REQUIRED_DOCS.filter((d) => !have.has(d)),
    optional_missing: FLEET_OPTIONAL_DOCS.filter((d) => !have.has(d)),
  };
}

const APP_COLS = "id,full_name,phone,email,status,sms_consent,sms_consent_at,sms_opt_out_at,source,background_check_status,deposit_status,deposit_paid,pickup_date,pickup_time,created_at,address,profile_screenshot_url";

export async function lastTextSent(admin: Admin, applicationId: string) {
  const { data } = await admin
    .from("outbound_messages")
    .select("kind,workflow_id,step_id,status,sent_at,created_at,from_address,channel")
    .eq("application_id", applicationId)
    .eq("channel", "sms")
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1);
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return null;
  return { type: r.kind ?? null, template: r.step_id ?? r.workflow_id ?? null, workflow_id: r.workflow_id ?? null, step_id: r.step_id ?? null, sent_at: r.sent_at ?? r.created_at ?? null, status: r.status, from: r.from_address ?? null };
}

export async function buildLeadPayload(
  admin: Admin,
  a: { event: "lead_created" | "stage_changed"; applicationId: string; stage?: string | null; previousStage?: string | null },
) {
  const { data: app } = await admin.from("applications").select(APP_COLS).eq("id", a.applicationId).maybeSingle();
  if (!app) return null;
  const [{ data: docs }, { data: deposits }, { data: agreements }, last] = await Promise.all([
    admin.from("documents").select("category,review_status,is_current").eq("driver_id", a.applicationId),
    admin.from("payments").select("id,status,type").eq("driver_id", a.applicationId).eq("type", "deposit").eq("status", "paid").limit(1),
    admin.from("agreements").select("status,signed_at,voided_at").eq("application_id", a.applicationId),
    lastTextSent(admin, a.applicationId),
  ]);
  const consented = app.sms_consent === true && !app.sms_opt_out_at;
  const payload: Record<string, unknown> = {
    event: a.event,
    lead_id: app.id,
    name: app.full_name ?? null,
    phone: toE164(app.phone),
    email: app.email ?? null,
    stage: a.stage ?? app.status,
    ...(a.event === "stage_changed" ? { previous_stage: a.previousStage ?? null } : {}),
    current_stage: app.status,
    sms_consent: consented,
    consent_timestamp: consented ? app.sms_consent_at ?? null : null,
    source: app.source ?? null,
    docs: docsSummary(app, Array.isArray(docs) ? docs : []),
    background_check_status: app.background_check_status ?? null,
    reservation_fee_paid: (Array.isArray(deposits) && deposits.length > 0) || app.deposit_status === "paid" || app.deposit_paid === true,
    agreement_signed: (Array.isArray(agreements) ? agreements : []).some((g: any) => !!g.signed_at && !g.voided_at),
    pickup_at: pickupAt(app.pickup_date, app.pickup_time),
    created_at: app.created_at ?? null,
    last_text_sent: last,
  };
  return payload;
}

// ---------------------------------------------------------------- queue + dispatch

export async function enqueueFleetEvent(
  admin: Admin,
  row: { event_type: FleetEvent; dedupe_key: string; application_id?: string | null; quo_event_id?: string | null; payload: Record<string, unknown> },
): Promise<string | null> {
  const { data, error } = await admin
    .from("fleet_webhook_deliveries")
    .upsert({ ...row, status: "pending" }, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("[fleet-webhook] enqueue failed", error.message);
    return null;
  }
  return Array.isArray(data) && data[0] ? String(data[0].id) : null;
}

type DispatchDeps = { env?: Env; fetch?: typeof fetch; now?: () => number; timeoutMs?: number };
export type DispatchResult = { delivered: number; retrying: number; failed: number; skipped: number; disabled: boolean };

/**
 * Deliver due rows (or just `ids`). Safe to call from several places at once:
 * each row is claimed by bumping `attempts` only if nobody else did.
 */
export async function dispatchFleetWebhooks(admin: Admin, opts: { ids?: string[]; limit?: number } = {}, deps: DispatchDeps = {}): Promise<DispatchResult> {
  const now = deps.now ?? Date.now;
  const cfg = fleetWebhookConfig(deps.env ?? (process.env as Env));
  const out: DispatchResult = { delivered: 0, retrying: 0, failed: 0, skipped: 0, disabled: !cfg.enabled };
  let q = admin.from("fleet_webhook_deliveries").select("*").eq("status", "pending");
  if (opts.ids?.length) q = q.in("id", opts.ids);
  else q = q.lte("next_attempt_at", new Date(now()).toISOString());
  const { data: rows, error } = await q.order("created_at", { ascending: true }).limit(opts.limit ?? 25);
  if (error || !Array.isArray(rows)) return out;

  for (const row of rows) {
    if (!cfg.enabled) {
      await admin.from("fleet_webhook_deliveries")
        .update({ status: "skipped", last_error: `not sent: ${cfg.reason}`, updated_at: new Date(now()).toISOString() })
        .eq("id", row.id).eq("status", "pending");
      out.skipped++;
      continue;
    }
    const attempt = Number(row.attempts ?? 0) + 1;
    // Claim: a lease so a parallel dispatcher skips it.
    const { data: claimed } = await admin.from("fleet_webhook_deliveries")
      .update({ attempts: attempt, next_attempt_at: new Date(now() + 2 * 60_000).toISOString(), updated_at: new Date(now()).toISOString() })
      .eq("id", row.id).eq("status", "pending").eq("attempts", attempt - 1)
      .select("id");
    if (!Array.isArray(claimed) || !claimed.length) continue;

    let payload: Record<string, unknown> | null = row.payload ?? {};
    if (row.event_type === "lead_created" || row.event_type === "stage_changed") {
      payload = row.application_id
        ? await buildLeadPayload(admin, { event: row.event_type, applicationId: row.application_id, stage: (row.payload as any)?.stage, previousStage: (row.payload as any)?.previous_stage })
        : null;
      if (!payload) {
        await admin.from("fleet_webhook_deliveries").update({ status: "skipped", last_error: "lead no longer exists" }).eq("id", row.id);
        out.skipped++;
        continue;
      }
    }
    const body = JSON.stringify({ ...payload, event: row.event_type, delivery_id: row.id, sent_at: new Date(now()).toISOString() });
    const req = await fleetRequest(cfg, { deliveryId: row.id, event: row.event_type, body, nowMs: now() });
    let code: number | null = null;
    let err: string | null = null;
    try {
      const res = await (deps.fetch ?? fetch)(req.url, { ...req.init, signal: AbortSignal.timeout(deps.timeoutMs ?? 8000) });
      code = res.status;
      if (!res.ok) err = `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`;
    } catch (e) {
      err = String((e as Error)?.message ?? e).slice(0, 300);
    }
    const stamp = new Date(now()).toISOString();
    if (!err) {
      await admin.from("fleet_webhook_deliveries").update({ status: "delivered", delivered_at: stamp, last_status_code: code, last_error: null, payload, updated_at: stamp }).eq("id", row.id);
      out.delivered++;
    } else if (attempt >= FLEET_MAX_ATTEMPTS) {
      await admin.from("fleet_webhook_deliveries").update({ status: "failed", last_status_code: code, last_error: err, payload, updated_at: stamp }).eq("id", row.id);
      out.failed++;
    } else {
      await admin.from("fleet_webhook_deliveries").update({
        last_status_code: code, last_error: err, payload, updated_at: stamp,
        next_attempt_at: new Date(now() + retryDelayMs(attempt)).toISOString(),
      }).eq("id", row.id);
      out.retrying++;
    }
  }
  return out;
}
