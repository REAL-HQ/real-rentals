/**
 * FLEET reads per-signer agreement status. Nothing is sent or changed.
 *
 *   POST /api/public/fleet/agreement-signers   (Bearer FLEET_API_KEY, JSON)
 *     { "agreement_id": "…" }   or   { "lead_id": "…" }
 *
 * Each row is one signer: role, name, masked email, signed_at, when the
 * link was last sent and on which channel, delivery if it was recorded,
 * and the first and last time they opened the link if those were recorded.
 * sent_at and viewed_at already exist. Channel, delivery, and last view
 * come from the columns in
 * supabase/migrations/20261126120000_esign_recipient_link_resend.sql
 * (not applied by this change) and, failing that, from the resend audit.
 */
import { fleetAdmin, fleetJson, fleetRequestBody, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";
import { maskEmail } from "@/lib/agreement-resend.server";

type Admin = any;

const BASE_COLS = "id,name,email,role,status,signing_order,signed_at,sent_at,viewed_at";
const EXTRA_COLS = "id,link_channel,link_email_status,link_sms_status,last_viewed_at";

function deliveryOf(email: unknown, sms: unknown): { email: string | null; sms: string | null } | null {
  const e = typeof email === "string" ? email : null;
  const s = typeof sms === "string" ? sms : null;
  if (!e && !s) return null;
  return { email: e, sms: s };
}

export async function handleFleetAgreementSigners(request: Request, deps: FleetDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  try {
    const agreement = await loadAgreement(admin, body);
    if (agreement instanceof Response) return agreement;
    const signers = await signerRows(admin, agreement);
    return fleetJson(200, { ok: true, agreement_id: agreement.id, lead_id: agreement.application_id ?? null, signers });
  } catch (e) {
    console.error("[fleet-agreement-signers] failed", String((e as Error)?.message ?? e));
    return fleetJson(503, { ok: false, error: "Could not read signers." });
  }
}

async function loadAgreement(admin: Admin, body: Record<string, any>): Promise<any | Response> {
  if (body.agreement_id != null) {
    if (!UUID_RE.test(String(body.agreement_id))) return fleetJson(400, { ok: false, error: "agreement_id must be a UUID." });
    const r = await admin.from("agreements")
      .select("id,application_id,status,signer_email,signer_name,signed_at,sent_at,viewed_at,email_status,sms_status,merge_data")
      .eq("id", String(body.agreement_id)).maybeSingle();
    if (r.error) return fleetJson(503, { ok: false, error: "Could not read agreements." });
    if (!r.data) return fleetJson(404, { ok: false, error: "Agreement not found." });
    return r.data;
  }
  if (body.lead_id != null) {
    if (!UUID_RE.test(String(body.lead_id))) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
    const r = await admin.from("agreements")
      .select("id,application_id,status,signer_email,signer_name,signed_at,sent_at,viewed_at,email_status,sms_status,merge_data,created_at")
      .eq("application_id", String(body.lead_id)).order("created_at", { ascending: false }).limit(1);
    if (r.error) return fleetJson(503, { ok: false, error: "Could not read agreements." });
    const row = (r.data ?? [])[0] ?? null;
    if (!row) return fleetJson(404, { ok: false, error: "No agreement for this person." });
    return row;
  }
  return fleetJson(400, { ok: false, error: "Give agreement_id or lead_id." });
}

async function signerRows(admin: Admin, agreement: any) {
  const base = await admin.from("esign_recipients").select(BASE_COLS).eq("document_id", agreement.id).eq("role", "signer").order("signing_order", { ascending: true });
  if (base.error) throw new Error(base.error.message);
  const rows = (base.data ?? []) as any[];
  const extraRes = await admin.from("esign_recipients").select(EXTRA_COLS).eq("document_id", agreement.id);
  const extraById = new Map<string, any>();
  if (!extraRes.error) for (const row of extraRes.data ?? []) extraById.set(row.id, row);
  const audits = await admin.from("audit_log").select("metadata,created_at").eq("action", "document.resent").eq("entity_id", agreement.id).order("created_at", { ascending: false }).limit(50);
  const events = (audits.error ? [] : (audits.data ?? [])) as any[];

  if (!rows.length) {
    const merge = (agreement.merge_data ?? {}) as Record<string, unknown>;
    return [{
      id: null,
      role: "signer",
      name: (merge.driver_name as string | null) ?? agreement.signer_name ?? null,
      email: maskEmail(agreement.signer_email),
      signed_at: agreement.signed_at ?? null,
      last_link_sent_at: agreement.sent_at ?? null,
      last_link_channel: null,
      delivery_status: deliveryOf(agreement.email_status, agreement.sms_status),
      first_viewed_at: agreement.viewed_at ?? null,
      last_viewed_at: null,
    }];
  }

  return rows.map((row) => {
    const extra = extraById.get(row.id) ?? {};
    const audit = events.find((e) => e?.metadata?.signer_id === row.id);
    const channel = (extra.link_channel as string | null) ?? (audit?.metadata?.channel as string | undefined) ?? null;
    const emailStatus = (extra.link_email_status as string | null) ?? (audit?.metadata?.email as string | undefined) ?? null;
    const smsStatus = (extra.link_sms_status as string | null) ?? (audit?.metadata?.sms as string | undefined) ?? null;
    return {
      id: row.id,
      role: row.role ?? "signer",
      name: row.name ?? null,
      email: maskEmail(row.email),
      signed_at: row.signed_at ?? null,
      last_link_sent_at: row.sent_at ?? null,
      last_link_channel: channel,
      delivery_status: deliveryOf(emailStatus, smsStatus),
      first_viewed_at: row.viewed_at ?? null,
      last_viewed_at: (extra.last_viewed_at as string | null) ?? null,
    };
  });
}
