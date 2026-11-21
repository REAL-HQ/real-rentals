/**
 * FLEET files a document onto a driver's profile, team only (Dolmar, t326u).
 *
 *   POST /api/public/fleet/driver-document
 *   { "lead_id": "…", "category": "other", "file_name": "agreement.pdf",
 *     "content_base64": "<the file, base64>", "label": "Original agreement (superseded)",
 *     "expires_at": "2029-01-21", "idempotency_key": "doc-<lead_id>-1" }
 *
 * Bearer FLEET_API_KEY (src/lib/fleet-api.server.ts). Off until the
 * Automations switch "FLEET Document Uploads" (fleet_document_uploads) is On.
 *
 * Same storage and save step as the staff Documents upload: bucket
 * driver-docs, path `<app>/internal/<category>-<uuid>.<ext>` (team only),
 * documents row via persistConfirmedDocument, visibility ["admin"].
 *
 * Never a verification or approval: the row is saved review_status
 * "uploaded" (the column default), nothing on the application changes, and no
 * checklist item is ticked by this call. Signed agreements and applications
 * are never filed here (eSign and staff only), so "other" can never replace or
 * count as the current signed agreement: "other" is multi-file and supersedes
 * nothing. A single-file category whose current file staff already verified
 * is refused; staff replace those. See docs/fleet-api.md.
 */
import {
  cleanText,
  fleetAdmin,
  fleetAudit,
  fleetJson,
  fleetRequestBody,
  idempotencyKey,
  UUID_RE,
  type FleetDeps,
} from "@/lib/fleet-api.server";
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";

type Admin = any;

export const FLEET_DOCUMENT_UPLOADS_KEY = "fleet_document_uploads";
export const FLEET_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const FLEET_DOCUMENT_AUDIT_ACTION = "document.fleet_upload";

/**
 * Staff upload categories FLEET may file. Excluded: agreement and
 * rental_application (filed by eSign and staff only) and
 * verification_recording (Owner only).
 */
export const FLEET_DOCUMENT_CATEGORIES = [
  "license_front",
  "license_back",
  "insurance",
  "gig_profile",
  "income",
  "insurance_quote",
  "screening",
  "trip_history",
  "other",
] as const;
const EXPIRING = new Set(["license_front", "license_back", "insurance"]);

export type SniffedType = { mime: string; ext: string };

/** File type from its first bytes. The name or a claimed mime type is never trusted. */
export function sniffType(b: Uint8Array): SniffedType | null {
  const at = (i: number, s: string) => [...s].every((c, j) => b[i + j] === c.charCodeAt(0));
  if (b.length >= 5 && at(0, "%PDF-")) return { mime: "application/pdf", ext: "pdf" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && at(1, "PNG\r\n\x1a\n")) return { mime: "image/png", ext: "png" };
  if (b.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return { mime: "image/webp", ext: "webp" };
  if (b.length >= 12 && at(4, "ftyp")) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return { mime: "image/heic", ext: "heic" };
  }
  return null;
}

/** Strict base64 (standard or URL-safe, optional data: prefix) → bytes, or null. */
export function decodeBase64(v: unknown): Uint8Array | null {
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/^data:[^;,]{1,100};base64,/, "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!s || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  if (s.length % 4 === 1) return null;
  while (s.length % 4) s += "=";
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

function cleanFileName(v: unknown, ext: string): string {
  const base = cleanText(v, 200).replace(/[\\/\u0000-\u001f]/g, "_");
  return base || `document.${ext}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DocumentDeps = FleetDeps & {
  gate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  /** The staff save step; injectable for tests. */
  persist?: (admin: Admin, fields: any) => Promise<{ id: string }>;
};

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}

async function defaultPersist(admin: Admin, fields: any) {
  const { persistConfirmedDocument } = await import("@/lib/documents.functions");
  return persistConfirmedDocument(admin, fields);
}

/** An earlier FLEET upload with this key or these exact bytes for this driver and category. */
async function priorUpload(admin: Admin, idem: string | null, leadId: string, category: string, sha: string) {
  const look = async (col: string, val: string) => {
    const res = await admin.from("audit_log").select("entity_id,metadata").eq("action", FLEET_DOCUMENT_AUDIT_ACTION).eq(col, val).limit(5);
    if (res.error) throw new Error("audit_unreadable");
    return (res.data ?? []) as Array<{ entity_id: string | null; metadata: any }>;
  };
  if (idem) {
    const hit = (await look("metadata->>idempotency_key", idem))[0];
    if (hit) return { by: "idempotency_key" as const, row: hit };
  }
  const same = (await look("metadata->>sha256", sha)).find((r) => r.metadata?.lead_id === leadId && r.metadata?.category === category);
  return same ? { by: "content" as const, row: same } : null;
}

export async function handleFleetDriverDocument(request: Request, deps: DocumentDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  return fileFleetDriverDocument(parsed.body, deps);
}

/**
 * Everything after authentication. Exported so another already-authenticated
 * FLEET call (the RentID report endpoint) files its report the same way,
 * under the same Document Uploads switch, dedupe and save step.
 */
export async function fileFleetDriverDocument(body: Record<string, any>, deps: DocumentDeps = {}): Promise<Response> {
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);

  const gate = await (deps.gate ?? defaultGate)(admin, FLEET_DOCUMENT_UPLOADS_KEY).catch(() => "held" as const);
  if (gate === "off") return fleetJson(409, { ok: false, error: "The FLEET Document Uploads switch is Off (Back Office → Automations). Nothing was saved.", reason: "switched_off" });
  if (gate !== "send") return fleetJson(503, { ok: false, error: "Automation switches could not be read; try again later. Nothing was saved.", reason: "controls_unreadable" });

  const leadId = String(body.lead_id ?? "");
  if (!UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const category = String(body.category ?? "");
  if (category === "agreement" || category === "rental_application")
    return fleetJson(400, { ok: false, error: "Signed agreements and rental applications are filed by eSign or staff, never through FLEET. File an old or paper agreement as category \"other\" with a label; it never counts as the current agreement." });
  if (!(FLEET_DOCUMENT_CATEGORIES as readonly string[]).includes(category))
    return fleetJson(400, { ok: false, error: `category must be one of: ${FLEET_DOCUMENT_CATEGORIES.join(", ")}.` });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  const label = body.label == null || body.label === "" ? null : cleanText(body.label, 140);
  let expiresAt: string | null = null;
  if (body.expires_at != null && body.expires_at !== "") {
    if (!EXPIRING.has(category)) return fleetJson(400, { ok: false, error: "expires_at is only for license_front, license_back and insurance." });
    const s = String(body.expires_at).trim();
    if (!DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return fleetJson(400, { ok: false, error: "expires_at must be a date in YYYY-MM-DD." });
    expiresAt = s;
  }
  if (typeof body.content_base64 === "string" && body.content_base64.length > Math.ceil(FLEET_DOCUMENT_MAX_BYTES / 3) * 4 + 200)
    return fleetJson(413, { ok: false, error: "The file is over 20 MB. Nothing was saved." });
  const bytes = decodeBase64(body.content_base64);
  if (!bytes || !bytes.length) return fleetJson(400, { ok: false, error: "content_base64 must be the file, base64-encoded." });
  if (bytes.length > FLEET_DOCUMENT_MAX_BYTES) return fleetJson(413, { ok: false, error: "The file is over 20 MB. Nothing was saved." });
  const type = sniffType(bytes);
  if (!type) return fleetJson(415, { ok: false, error: "Only PDF, JPEG, PNG, WebP or HEIC files are accepted. Nothing was saved." });
  const fileName = cleanFileName(body.file_name, type.ext);
  const sha = await sha256Hex(bytes);

  let prior;
  try {
    prior = await priorUpload(admin, idem, leadId, category, sha);
  } catch {
    return fleetJson(503, { ok: false, error: "Could not check for an earlier copy. Nothing was saved." });
  }
  if (prior) {
    const m = prior.row.metadata ?? {};
    if (prior.by === "idempotency_key" && (m.lead_id !== leadId || m.sha256 !== sha || m.category !== category))
      return fleetJson(409, { ok: false, error: "idempotency_key was already used for a different file, driver or category." });
    return fleetJson(200, { ok: true, duplicate: true, matched_by: prior.by, lead_id: leadId, document_id: m.document_id ?? prior.row.entity_id ?? null, category: m.category, label: m.label ?? null });
  }

  const appRes = await admin.from("applications").select("id,deleted_at").eq("id", leadId).maybeSingle();
  if (appRes.error) return fleetJson(503, { ok: false, error: "Could not read the driver." });
  if (!appRes.data) return fleetJson(404, { ok: false, error: "Driver not found." });
  if (appRes.data.deleted_at) return fleetJson(409, { ok: false, error: "This application was deleted." });

  const { DOC_BUCKET, MULTI_FILE_CATEGORIES } = await import("@/lib/documents.functions");
  if (!MULTI_FILE_CATEGORIES.includes(category)) {
    // A new file of a single-file category supersedes the current one. Never
    // unseat a file staff already verified; staff replace those.
    const cur = await admin.from("documents").select("id,review_status").eq("driver_id", leadId).eq("category", category).eq("is_current", true);
    if (cur.error) return fleetJson(503, { ok: false, error: "Could not read the driver's current documents. Nothing was saved." });
    if ((cur.data ?? []).some((r: any) => r.review_status === "verified"))
      return fleetJson(409, { ok: false, error: "Staff already verified the current file in this category. FLEET does not replace it; send it to staff, or file it as \"other\". Nothing was saved.", reason: "verified_on_file" });
  }

  const path = `${leadId}/internal/${category}-${crypto.randomUUID()}.${type.ext}`;
  const up = await admin.storage.from(DOC_BUCKET).upload(path, bytes, { contentType: type.mime, upsert: false });
  if (up?.error) return fleetJson(503, { ok: false, error: "Could not store the file. Nothing was saved." });

  let saved: { id: string };
  try {
    saved = await (deps.persist ?? defaultPersist)(admin, {
      driver_id: leadId,
      kind: category,
      category,
      label,
      storage_bucket: DOC_BUCKET,
      storage_path: path,
      visibility: ["admin"],
      file_name: fileName,
      mime_type: type.mime,
      size_bytes: bytes.length,
      expires_at: expiresAt,
      uploaded_by: null,
      uploaded_by_role: "team",
    });
  } catch {
    await admin.storage.from(DOC_BUCKET).remove([path]).catch(() => undefined);
    return fleetJson(503, { ok: false, error: "Could not save the document. Nothing was saved." });
  }

  await audit({
    action: FLEET_DOCUMENT_AUDIT_ACTION,
    summary: `${FLEET_ACTOR_LABEL} filed a team-only document (${category}${label ? `: ${label}` : ""}). Not reviewed.`.slice(0, 300),
    entityType: "document",
    entityId: saved.id,
    metadata: { uploaded_by: FLEET_ACTOR_LABEL, lead_id: leadId, document_id: saved.id, category, label, sha256: sha, size_bytes: bytes.length, mime_type: type.mime, idempotency_key: idem, team_only: true, verified: false },
  });

  return fleetJson(201, {
    ok: true,
    lead_id: leadId,
    document_id: saved.id,
    category,
    label,
    file_name: fileName,
    mime_type: type.mime,
    size_bytes: bytes.length,
    sha256: sha,
    visibility: ["admin"],
    review_status: "uploaded",
    verified: false,
    next: "Saved team only and not reviewed. Staff review it under Documents on the driver's profile.",
  });
}
