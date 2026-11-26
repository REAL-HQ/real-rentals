/**
 * RentID results for FLEET's applicant review. Everything here is OFF until
 * Dolmar switches it on in app_settings.fleet_rentid (see
 * docs/fleet-rentid.md and proposed/fleet-rentid-switch.sql):
 *
 *   { "record_results": false,        // accept POST /api/public/fleet/screening-result
 *     "require_for_approval": false } // FLEET approve needs both checks "passed"
 *
 *   POST /api/public/fleet/screening-result
 *   { "lead_id": "…", "provider": "rentid", "order_id": "INV-2FFV7P9C",
 *     "license_status": "active" | "suspended" | "revoked" | "expired" | "inactive"
 *                       | "provisional" | "unavailable",
 *     "criminal_record": "not_detected" | "detected" | "unavailable",
 *     "checked_at": "2026-11-16T15:00:00Z", "note": "…" }
 *
 * Bearer FLEET_API_KEY. RentID's two checks Rosa ran by hand map onto the two
 * columns the database already has (CHECK pending|passed|failed):
 *
 *   Driver's License Status  active -> mvr_status passed
 *                            suspended/revoked/expired/inactive/invalid -> failed
 *                            provisional/restricted/unavailable -> not written
 *                            (stays pending; staff decide)
 *   Criminal Record Check    not detected -> background_check_status passed
 *                            detected -> failed
 *                            unavailable -> not written
 *
 * mvr_status carries the license-status result; it is not a full Motor
 * Vehicle Report (RentID sells that separately). A "failed" value is a hard
 * blocker: FLEET sends the applicant to staff, and any decline based on it
 * stays with staff. A finished failed result is never overwritten with
 * passed through this endpoint. Nothing here writes insurance, verification
 * or document review fields. No RentID credential is read or stored here.
 */
import {
  cleanText,
  fleetAdmin,
  fleetAudit,
  fleetJson,
  fleetRequestBody,
  UUID_RE,
  type FleetDeps,
} from "@/lib/fleet-api.server";
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";

type Admin = any;
export const RENTID_SETTINGS_KEY = "fleet_rentid";
export type RentidSettings = { record_results: boolean; require_for_approval: boolean };
export const RENTID_OFF: RentidSettings = { record_results: false, require_for_approval: false };

/** The switch. Missing row, unreadable row or anything but literal true = off. */
export async function readRentidSettings(admin: Admin): Promise<RentidSettings> {
  try {
    const r = await admin.from("app_settings").select("value").eq("key", RENTID_SETTINGS_KEY).maybeSingle();
    if (r?.error || !r?.data) return { ...RENTID_OFF };
    const v = (r.data.value ?? {}) as Record<string, unknown>;
    return { record_results: v.record_results === true, require_for_approval: v.require_for_approval === true };
  } catch {
    return { ...RENTID_OFF };
  }
}

type Mapped = "passed" | "failed" | null;
const LICENSE_PASS = new Set(["active", "valid"]);
const LICENSE_FAIL = new Set(["suspended", "revoked", "expired", "inactive", "invalid", "cancelled", "canceled", "disqualified"]);
const LICENSE_OPEN = new Set(["provisional", "restricted", "unavailable", "not_available", "unsupported_state", "pending"]);
const CRIMINAL_PASS = new Set(["not_detected", "none", "clear"]);
const CRIMINAL_FAIL = new Set(["detected", "flagged", "caution"]);
const CRIMINAL_OPEN = new Set(["unavailable", "not_available", "pending"]);
const key = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** RentID answer -> column value. `undefined` = not an answer we know (400). */
export function mapLicenseStatus(v: unknown): Mapped | undefined {
  const k = key(v);
  if (LICENSE_PASS.has(k)) return "passed";
  if (LICENSE_FAIL.has(k)) return "failed";
  if (LICENSE_OPEN.has(k)) return null;
  return undefined;
}
export function mapCriminalRecord(v: unknown): Mapped | undefined {
  const k = key(v);
  if (CRIMINAL_PASS.has(k)) return "passed";
  if (CRIMINAL_FAIL.has(k)) return "failed";
  if (CRIMINAL_OPEN.has(k)) return null;
  return undefined;
}

/** RentID receipt / order numbers look like INV-2FFV7P9C. */
export const RENTID_ORDER_RE = /^INV-[A-Z0-9]{6,16}$/;

export async function handleFleetScreeningResult(request: Request, deps: FleetDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);
  const now = (deps.now ?? (() => new Date()))();

  const settings = await readRentidSettings(admin);
  if (!settings.record_results) {
    return fleetJson(403, { ok: false, error: "Recording RentID results is switched off (app_settings.fleet_rentid.record_results). Nothing was changed." });
  }
  const leadId = String(body.lead_id ?? "");
  if (!UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  if (String(body.provider ?? "").toLowerCase() !== "rentid") return fleetJson(400, { ok: false, error: "provider must be rentid." });
  const orderId = String(body.order_id ?? "").trim().toUpperCase();
  if (!RENTID_ORDER_RE.test(orderId)) return fleetJson(400, { ok: false, error: "order_id must be the RentID order number (INV-…)." });
  const hasLicense = body.license_status != null && body.license_status !== "";
  const hasCriminal = body.criminal_record != null && body.criminal_record !== "";
  if (!hasLicense && !hasCriminal) return fleetJson(400, { ok: false, error: "Send license_status, criminal_record, or both." });
  const lic = hasLicense ? mapLicenseStatus(body.license_status) : null;
  const crim = hasCriminal ? mapCriminalRecord(body.criminal_record) : null;
  if (lic === undefined) return fleetJson(400, { ok: false, error: "license_status is not a RentID answer this endpoint knows." });
  if (crim === undefined) return fleetJson(400, { ok: false, error: "criminal_record is not a RentID answer this endpoint knows." });
  const checkedAt = body.checked_at ? new Date(String(body.checked_at)) : now;
  if (Number.isNaN(checkedAt.getTime()) || checkedAt.getTime() > now.getTime() + 5 * 60_000) return fleetJson(400, { ok: false, error: "checked_at must be a real time, not in the future." });
  const note = cleanText(body.note, 500);

  const appRes = await admin.from("applications").select("id,status,deleted_at,background_check_status,mvr_status").eq("id", leadId).maybeSingle();
  if (appRes.error) return fleetJson(503, { ok: false, error: "Could not read the applicant." });
  const app = appRes.data;
  if (!app) return fleetJson(404, { ok: false, error: "Applicant not found." });
  if (app.deleted_at) return fleetJson(409, { ok: false, error: "This application was deleted." });

  const patch: Record<string, string> = {};
  const kept: { field: string; on_file: string; result: string }[] = [];
  for (const [field, value] of [["mvr_status", lic], ["background_check_status", crim]] as const) {
    if (!value) continue;
    const current = String(app[field] ?? "pending").toLowerCase();
    // A finished failed result is staff's to clear, never FLEET's.
    if (current === "failed" && value === "passed") { kept.push({ field, on_file: current, result: value }); continue; }
    if (current !== value) patch[field] = value;
  }
  if (Object.keys(patch).length) {
    const up = await admin.from("applications").update(patch).eq("id", leadId);
    if (up.error) return fleetJson(503, { ok: false, error: "Could not save the result. Nothing was changed." });
  }
  const failed = Object.values(patch).includes("failed") || kept.length > 0;
  await audit({
    action: "application.rentid_result_recorded",
    summary: `RentID ${orderId} recorded by ${FLEET_ACTOR_LABEL}: license ${hasLicense ? key(body.license_status) : "not sent"}, criminal record ${hasCriminal ? key(body.criminal_record) : "not sent"}.`.slice(0, 300),
    entityType: "application",
    entityId: leadId,
    metadata: {
      provider: "rentid", order_id: orderId, checked_at: checkedAt.toISOString(), recorded_by: FLEET_ACTOR_LABEL,
      license_status: hasLicense ? key(body.license_status) : null, criminal_record: hasCriminal ? key(body.criminal_record) : null,
      applied: patch, kept, note: note || null,
    },
  });
  return fleetJson(201, {
    ok: true,
    lead_id: leadId,
    order_id: orderId,
    applied: patch,
    kept,
    next: failed
      ? "A RentID check did not pass. FLEET cannot approve this applicant. Decline with a reason, or send needs_staff. This endpoint does not decline by itself."
      : (lic === null && hasLicense) || (crim === null && hasCriminal)
        ? "Part of the result was not usable (provisional, restricted or unavailable); nothing was written for it. Send needs_staff if approval needs it."
        : "Saved. Re-read the packet (action get) and decide.",
  });
}
