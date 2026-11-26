/**
 * FLEET checks off "Insurance Quote: Applied" (Dolmar, t493u).
 *
 * POST /api/public/fleet/insurance-applied, Bearer FLEET_API_KEY:
 *   { "lead_id": "<application uuid>", "note"?: "…", "idempotency_key"?: "…" }
 *
 * Writes ONE audit_log row (application.insurance_quote_applied, by
 * "FLEET (automated)"). Nothing else: no checkmark, no applications column,
 * no insurance status. The profile reads the row as Insurance Quote "Applied ·
 * Awaiting Quote" (yellow). Only the quote file itself (FLEET's
 * /api/public/fleet/driver-document with category insurance_quote, or a staff
 * upload) turns it green, and Insurance Setup is still verified only by staff.
 */
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";
import { cleanText, fleetAdmin, fleetAudit, fleetJson, fleetRequestBody, idempotencyKey, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";

export const INSURANCE_APPLIED_ACTION = "application.insurance_quote_applied";
/** Applications FLEET may mark: approved and not closed out. */
const MARKABLE_STATUSES = new Set(["approved", "active"]);

export async function handleFleetInsuranceApplied(request: Request, deps: FleetDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const leadId = String(body.lead_id ?? "");
  if (!UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1–120 printable characters." });
  const note = cleanText(body.note, 300);
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);
  const now = (deps.now ?? (() => new Date()))();

  const appRes = await admin.from("applications").select("id,status,deleted_at").eq("id", leadId).maybeSingle();
  if (appRes.error) return fleetJson(503, { ok: false, error: "Could not read the applicant." });
  const app = appRes.data;
  if (!app) return fleetJson(404, { ok: false, error: "Applicant not found." });
  if (app.deleted_at) return fleetJson(409, { ok: false, error: "This application was deleted." });
  if (!MARKABLE_STATUSES.has(String(app.status ?? "").toLowerCase())) {
    return fleetJson(409, { ok: false, error: `The application is "${app.status}". Insurance is applied for only after approval. Nothing was changed.` });
  }

  if (idem) {
    const dup = await admin.from("audit_log").select("id,created_at")
      .eq("entity_type", "application").eq("entity_id", leadId).eq("action", INSURANCE_APPLIED_ACTION)
      .eq("metadata->>idempotency_key", idem).limit(1);
    if (!dup.error && Array.isArray(dup.data) && dup.data.length) {
      return fleetJson(200, { ok: true, duplicate: true, lead_id: leadId, applied_at: dup.data[0].created_at });
    }
  }

  try {
    await audit({
      action: INSURANCE_APPLIED_ACTION,
      summary: `Insurance Quote applied for by ${FLEET_ACTOR_LABEL}${note ? `: ${note}` : ""}`.slice(0, 300),
      entityType: "application",
      entityId: leadId,
      metadata: { by: FLEET_ACTOR_LABEL, at: now.toISOString(), note: note || null, source: "fleet-api", ...(idem ? { idempotency_key: idem } : {}) },
    });
  } catch {
    return fleetJson(503, { ok: false, error: "Could not record it. Nothing was changed." });
  }
  return fleetJson(201, {
    ok: true,
    lead_id: leadId,
    applied_at: now.toISOString(),
    shows_as: "Insurance Quote: Applied · Awaiting Quote",
    next: "Upload the quote with /api/public/fleet/driver-document (category insurance_quote) when it arrives; that turns it green. Insurance Setup is still verified by staff.",
  });
}

/** Latest FLEET insurance-applied mark for one application, or null. */
export async function readFleetInsuranceApplied(admin: any, applicationId: string): Promise<{ at: string; summary: string } | null> {
  const res = await admin.from("audit_log").select("created_at,summary,metadata")
    .eq("entity_type", "application").eq("entity_id", applicationId).eq("action", INSURANCE_APPLIED_ACTION)
    .order("created_at", { ascending: false }).limit(10);
  if (res?.error) return null;
  for (const r of (res?.data ?? []) as any[]) {
    if (String(r?.metadata?.by ?? "") !== FLEET_ACTOR_LABEL) continue;
    return { at: String(r.created_at ?? ""), summary: String(r.summary ?? "") };
  }
  return null;
}
