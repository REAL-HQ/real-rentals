/**
 * FLEET reads the date of birth and the license expiry off the applicant's
 * license photo and saves them here (Dolmar, t298s1611).
 *
 *   POST /api/public/fleet/license-facts
 *   { "lead_id": "…", "document_id": "<the license_front document FLEET read>",
 *     "dob": "1990-02-03", "license_expiration": "2029-05-01",
 *     "license_number": "C123456789012", "license_state": "FL",
 *     "confidence": 0.95, "idempotency_key": "license-<lead_id>-1" }
 *
 * Bearer FLEET_API_KEY (src/lib/fleet-api.server.ts). Every reading is stored
 * in public.fleet_license_readings, labelled "Read by FLEET from license
 * photo", and is NEVER a verification: nothing here writes a review status,
 * verified flag, screening, insurance or background field. The field rep
 * confirms the license at pickup.
 *
 * The dates are copied onto the application (dob, license_expiration) so the
 * age and expiry rules can use them, but only into an empty field or one that
 * an earlier FLEET reading filled. A value staff or the applicant entered is
 * never overwritten: the reply lists it under `conflicts` and FLEET sends
 * needs_staff. See docs/fleet-license-facts.md.
 */
import {
  cleanText,
  fleetAdmin,
  fleetAudit,
  fleetJson,
  fleetRequestBody,
  idempotencyKey,
  tableMissing,
  UUID_RE,
  type FleetDeps,
} from "@/lib/fleet-api.server";
import { FLEET_ACTOR_LABEL, LICENSE_READING_LABEL } from "@/lib/fleet-review";

type Admin = any;
export const LICENSE_FIELDS = ["dob", "license_expiration", "license_number", "license_state"] as const;
const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));
type Field = (typeof LICENSE_FIELDS)[number];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A real calendar date in YYYY-MM-DD, or null. */
export function isoDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() + 1 !== +m[2] || d.getUTCDate() !== +m[3]) return null;
  return s;
}
export const day = (v: unknown) => (v == null ? null : String(v).slice(0, 10));
/** Compare a stored value to a reading: dates by day, the number without spaces/dashes. */
export const norm = (f: string, v: unknown): string | null => {
  if (v == null || String(v).trim() === "") return null;
  if (f === "dob" || f === "license_expiration") return day(v);
  if (f === "license_number") return String(v).toUpperCase().replace(/[\s-]/g, "");
  return String(v).trim().toUpperCase();
};
export const maskNo = (v: string) => (v.length <= 4 ? "****" : `${"*".repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`);

export function validateReading(body: Record<string, any>, now: Date): { ok: true; values: Partial<Record<Field, string>>; confidence: number | null } | { ok: false; error: string } {
  const values: Partial<Record<Field, string>> = {};
  const today = now.toISOString().slice(0, 10);
  if (body.dob != null && body.dob !== "") {
    const d = isoDate(body.dob);
    if (!d) return { ok: false, error: "dob must be a real date in YYYY-MM-DD." };
    const years = (Date.parse(today) - Date.parse(d)) / (365.2425 * 86400_000);
    if (d >= today || years < 16 || years > 100) return { ok: false, error: "dob is not a plausible date of birth (16 to 100 years ago)." };
    values.dob = d;
  }
  if (body.license_expiration != null && body.license_expiration !== "") {
    const d = isoDate(body.license_expiration);
    if (!d) return { ok: false, error: "license_expiration must be a real date in YYYY-MM-DD." };
    if (d < "2000-01-01" || d > "2100-12-31") return { ok: false, error: "license_expiration is out of range." };
    values.license_expiration = d;
  }
  // The agreement prints the license number and issuing state (it names the
  // only person allowed to drive), and the application never asks for them.
  if (body.license_number != null && body.license_number !== "") {
    const n = String(body.license_number).toUpperCase().replace(/[\s-]/g, "");
    if (!/^[A-Z0-9]{4,20}$/.test(n)) return { ok: false, error: "license_number must be 4-20 letters or digits." };
    values.license_number = n;
  }
  if (body.license_state != null && body.license_state !== "") {
    const st = String(body.license_state).trim().toUpperCase();
    if (!US_STATES.has(st)) return { ok: false, error: "license_state must be a two-letter US state code." };
    values.license_state = st;
  }
  if (!Object.keys(values).length) return { ok: false, error: "Send at least one of dob, license_expiration, license_number, license_state." };
  let confidence: number | null = null;
  if (body.confidence != null && body.confidence !== "") {
    const c = Number(body.confidence);
    if (!Number.isFinite(c) || c < 0 || c > 1) return { ok: false, error: "confidence must be between 0 and 1." };
    confidence = c;
  }
  return { ok: true, values, confidence };
}

/** The latest reading for an applicant (null when none, or the table is not installed). */
export async function latestLicenseReading(admin: Admin, leadId: string) {
  const res = await admin.from("fleet_license_readings")
    .select("id,document_id,dob,license_expiration,license_number,license_state,applied_fields,conflicts,confidence,source_label,read_by,created_at")
    .eq("application_id", leadId).order("created_at", { ascending: false }).limit(1);
  if (res.error || !Array.isArray(res.data) || !res.data.length) return null;
  const r = res.data[0];
  return {
    id: r.id,
    document_id: r.document_id ?? null,
    dob: day(r.dob),
    license_expiration: day(r.license_expiration),
    license_number_masked: r.license_number ? maskNo(String(r.license_number)) : null,
    license_state: r.license_state ?? null,
    applied: Array.isArray(r.applied_fields) ? r.applied_fields : [],
    conflicts: r.conflicts ?? [],
    confidence: r.confidence ?? null,
    label: r.source_label || LICENSE_READING_LABEL,
    read_by: r.read_by ?? FLEET_ACTOR_LABEL,
    read_at: r.created_at ?? null,
    verified: false as const,
  };
}

export async function handleFleetLicenseFacts(request: Request, deps: FleetDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);
  const now = (deps.now ?? (() => new Date()))();

  // { "action": "auto_read", "limit": 5, "dry_run": false, "lead_ids": [...] }
  // Reads license photos that have no reading yet (license-auto-read.server.ts).
  // Photo Reading's switch and daily limit apply. Never a verification.
  if (body.action === "auto_read") {
    const limit = body.limit == null ? 5 : Number(body.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) return fleetJson(400, { ok: false, error: "limit must be 1 to 10." });
    const ids = Array.isArray(body.lead_ids) ? body.lead_ids.map(String).filter((x: string) => UUID_RE.test(x)).slice(0, 200) : undefined;
    const { autoReadLicenses } = await import("@/lib/license-auto-read.server");
    const r = await autoReadLicenses(admin, { limit, dryRun: body.dry_run === true, applicationIds: ids?.length ? ids : undefined });
    return fleetJson(r.ok ? 200 : 503, r);
  }

  const leadId = String(body.lead_id ?? "");
  if (!UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const documentId = String(body.document_id ?? "");
  if (!UUID_RE.test(documentId)) return fleetJson(400, { ok: false, error: "document_id (the license front FLEET read) must be a UUID." });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  const v = validateReading(body, now);
  if (!v.ok) return fleetJson(400, { ok: false, error: v.error });
  const note = cleanText(body.note, 300) || null;

  if (idem) {
    const prior = await admin.from("fleet_license_readings").select("id,application_id,applied_fields,conflicts").eq("idempotency_key", idem).maybeSingle();
    if (prior.error) {
      if (tableMissing(prior.error, "fleet_license_readings")) return fleetJson(503, { ok: false, error: "License readings are not set up yet (fleet_license_readings). Nothing was changed." });
      return fleetJson(503, { ok: false, error: "Could not read license readings." });
    }
    if (prior.data) {
      if (prior.data.application_id !== leadId) return fleetJson(409, { ok: false, error: "idempotency_key was already used for another applicant." });
      return fleetJson(200, { ok: true, duplicate: true, lead_id: leadId, reading_id: prior.data.id, applied: prior.data.applied_fields ?? [], conflicts: prior.data.conflicts ?? [] });
    }
  }

  const appRes = await admin.from("applications").select("id,status,deleted_at,dob,license_expiration,license_number,license_state").eq("id", leadId).maybeSingle();
  if (appRes.error) return fleetJson(503, { ok: false, error: "Could not read the applicant." });
  const app = appRes.data;
  if (!app) return fleetJson(404, { ok: false, error: "Applicant not found." });
  if (app.deleted_at) return fleetJson(409, { ok: false, error: "This application was deleted." });

  const docRes = await admin.from("documents").select("id,driver_id,category,review_status,is_current").eq("id", documentId).maybeSingle();
  if (docRes.error) return fleetJson(503, { ok: false, error: "Could not read the document." });
  const doc = docRes.data;
  if (!doc || doc.driver_id !== leadId) return fleetJson(409, { ok: false, error: "document_id is not one of this applicant's documents." });
  if (String(doc.category) !== "license_front") return fleetJson(409, { ok: false, error: "document_id must be the front of the driver's license." });
  if (doc.is_current === false || doc.review_status === "rejected") return fleetJson(409, { ok: false, error: "That license photo was replaced or rejected; read the current one." });

  // Values earlier FLEET readings put on the application (those FLEET may correct).
  const priorRes = await admin.from("fleet_license_readings").select("dob,license_expiration,license_number,license_state,applied_fields").eq("application_id", leadId);
  if (priorRes.error) {
    if (tableMissing(priorRes.error, "fleet_license_readings")) return fleetJson(503, { ok: false, error: "License readings are not set up yet (fleet_license_readings). Nothing was changed." });
    return fleetJson(503, { ok: false, error: "Could not read license readings." });
  }
  const fleetWrote: Record<Field, Set<string>> = { dob: new Set(), license_expiration: new Set(), license_number: new Set(), license_state: new Set() };
  for (const r of (priorRes.data ?? []) as any[]) {
    for (const f of LICENSE_FIELDS) if ((r.applied_fields ?? []).includes(f) && r[f]) fleetWrote[f].add(norm(f, r[f])!);
  }

  const applied: Field[] = [];
  const unchanged: Field[] = [];
  const conflicts: { field: Field; on_file: string | null; read: string | null }[] = [];
  const patch: Record<string, string> = {};
  for (const f of LICENSE_FIELDS) {
    const read = v.values[f];
    if (!read) continue;
    const current = norm(f, app[f]);
    if (current === read) unchanged.push(f);
    else if (!current || fleetWrote[f].has(current)) { applied.push(f); patch[f] = read; }
    // The license number is never echoed in full.
    else conflicts.push(f === "license_number" ? { field: f, on_file: maskNo(current), read: maskNo(read) } : { field: f, on_file: current, read });
  }

  const ins = await admin.from("fleet_license_readings").insert({
    application_id: leadId,
    document_id: documentId,
    dob: v.values.dob ?? null,
    license_expiration: v.values.license_expiration ?? null,
    license_number: v.values.license_number ?? null,
    license_state: v.values.license_state ?? null,
    applied_fields: applied,
    conflicts,
    confidence: v.confidence,
    note,
    source_label: LICENSE_READING_LABEL,
    read_by: FLEET_ACTOR_LABEL,
    idempotency_key: idem,
  }).select("id").single();
  if (ins.error || !ins.data) {
    if (tableMissing(ins.error, "fleet_license_readings")) return fleetJson(503, { ok: false, error: "License readings are not set up yet (fleet_license_readings). Nothing was changed." });
    if (String(ins.error?.code) === "23505") return fleetJson(409, { ok: false, error: "idempotency_key was reused. Retry with a new key." });
    return fleetJson(503, { ok: false, error: "Could not save the reading. Nothing was changed." });
  }
  if (applied.length) {
    const up = await admin.from("applications").update(patch).eq("id", leadId);
    if (up.error) return fleetJson(503, { ok: false, error: "The reading was stored but the application could not be updated. Retry with a new idempotency_key.", reading_id: ins.data.id });
  }
  const labels: Record<Field, string> = { dob: "date of birth", license_expiration: "license expiry", license_number: "license number", license_state: "license state" };
  await audit({
    action: "application.fleet_license_read",
    summary: `${LICENSE_READING_LABEL} (not verified): ${[...applied, ...unchanged].map((f) => labels[f]).join(", ") || "nothing applied"}${conflicts.length ? `; differs from what is on file: ${conflicts.map((c) => labels[c.field]).join(", ")}` : ""}.`.slice(0, 300),
    entityType: "application",
    entityId: leadId,
    metadata: { read_by: FLEET_ACTOR_LABEL, label: LICENSE_READING_LABEL, verified: false, reading_id: ins.data.id, document_id: documentId, applied, unchanged, conflict_fields: conflicts.map((c) => c.field), confidence: v.confidence },
  });

  let assessment: any = null;
  try {
    const { buildReviewPacket } = await import("@/lib/fleet-review.server");
    const packet = await buildReviewPacket(admin, leadId, { now });
    if (packet) assessment = { recommendation: packet.assessment.recommendation, hard_blockers: packet.assessment.hard_blockers, escalations: packet.assessment.escalations };
  } catch { /* the reading is saved; FLEET can call action get */ }

  return fleetJson(201, {
    ok: true,
    lead_id: leadId,
    reading_id: ins.data.id,
    label: LICENSE_READING_LABEL,
    verified: false,
    applied,
    unchanged,
    conflicts,
    next: conflicts.length
      ? "A date on file differs from the photo. Nothing on file was changed: send needs_staff with the difference."
      : "Saved. Re-read the packet (action get) and decide.",
    assessment,
  });
}
