// Server half of renter insurance ID card auto-filing. Pure rules live in
// renter-insurance-card.ts.
//
// Called from the one Fleet Inbox analysis path (analyzeItemCore) after an
// emailed file is classified "insurance_card". On an exact VIN + renter-name
// match it copies the original into the renter's own Documents (driver-docs
// bucket, `<application>/insurance-<uuid>.<ext>`, visible to the renter and
// staff) as the current Insurance Card, saved "uploaded" — never verified.
// Older cards stay as history (superseded_by), except a card staff already
// verified, which stays current until staff review the new one (same hold as
// a renter upload; see insurance-review-hold.ts). Otherwise the Fleet Inbox
// item is left Needs Attention with a warning and one staff bell notification.
//
// Idempotent: the same bytes (SHA-256) for the same renter are filed once,
// and the same unmatched file raises one notification. Never throws into the
// caller, never sends a message, never touches rentals, screenings or
// application status.

import {
  RENTER_INSURANCE_AUDIT_ACTION,
  RENTER_INSURANCE_CARDS_KEY,
  RENTER_INSURANCE_CATEGORY,
  RENTER_INSURANCE_LABEL,
  RENTER_INSURANCE_RENTAL_STATUSES,
  RENTER_INSURANCE_REVIEW_AUDIT_ACTION,
  RENTER_INSURANCE_REVIEW_TITLE,
  RENTER_INSURANCE_WARNING_PREFIX,
  decideInsuranceCardMatch,
  insuranceCardFacts,
  isAutoFileChannel,
  renterCardFileName,
  renterCardNote,
  reviewMessage,
  type RentalCandidate,
} from "@/lib/renter-insurance-card";
import { normalizeVin } from "@/lib/vin";

type Admin = any;

export const DRIVER_DOC_BUCKET = "driver-docs";

export type FileOutcome =
  | { status: "skipped"; reason: "not_insurance_card" | "channel" | "switched_off" | "controls_unreadable" | "no_document" }
  | { status: "filed"; documentId: string; applicationId: string; rentalId: string; superseded: number }
  | { status: "duplicate"; documentId: string; applicationId: string }
  | { status: "review"; reason: string; message: string; notified: boolean }
  | { status: "error"; error: string };

export type FileDeps = {
  gate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  audit?: (entry: { action: string; summary: string; entityType?: string; entityId?: string | null; metadata?: Record<string, unknown> }) => Promise<void>;
  today?: () => string;
  uuid?: () => string;
};

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}
async function defaultAudit(e: any) {
  await (await import("@/lib/audit.server")).logAudit(null, e);
}
const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

const extOf = (mime: string | null | undefined, path: string | null | undefined) => {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(path ?? ""));
  return m ? m[1].toLowerCase() : "pdf";
};

/** Active/reserved rentals on fleet cars carrying this VIN, with the renter's name. */
export async function loadCandidates(sb: Admin, vin: string): Promise<{ vehicleCount: number; candidates: RentalCandidate[] }> {
  const veh = await sb.from("vehicles").select("id,vin,unit_number,archived_at").ilike("vin", vin);
  if (veh.error) throw new Error("vehicles_unreadable");
  const cars = ((veh.data ?? []) as any[]).filter((v) => !v.archived_at && normalizeVin(v.vin ?? "") === vin);
  if (!cars.length) return { vehicleCount: 0, candidates: [] };
  const rent = await sb
    .from("rentals")
    .select("id,status,application_id,vehicle_id")
    .in("vehicle_id", cars.map((c) => c.id))
    .in("status", [...RENTER_INSURANCE_RENTAL_STATUSES]);
  if (rent.error) throw new Error("rentals_unreadable");
  const rentals = ((rent.data ?? []) as any[]).filter((r) => r.application_id);
  if (!rentals.length) return { vehicleCount: cars.length, candidates: [] };
  const apps = await sb.from("applications").select("id,full_name,deleted_at").in("id", [...new Set(rentals.map((r) => r.application_id))]);
  if (apps.error) throw new Error("applications_unreadable");
  const byApp = new Map(((apps.data ?? []) as any[]).filter((a) => !a.deleted_at).map((a) => [a.id, a]));
  const byCar = new Map(cars.map((c) => [c.id, c]));
  const candidates: RentalCandidate[] = [];
  for (const r of rentals) {
    const a = byApp.get(r.application_id);
    if (!a) continue;
    const c = byCar.get(r.vehicle_id);
    candidates.push({
      rentalId: r.id, rentalStatus: r.status, applicationId: a.id, renterName: a.full_name ?? null,
      vehicleId: r.vehicle_id, vehicleVin: c?.vin ?? null, unitNumber: c?.unit_number ?? null,
    });
  }
  return { vehicleCount: cars.length, candidates };
}

async function raiseReview(sb: Admin, deps: FileDeps, item: any, sha: string | null, decision: any): Promise<FileOutcome> {
  const message = reviewMessage(decision);
  const warnings = [message, ...((item.warnings ?? []) as string[]).filter((w) => !String(w).startsWith(RENTER_INSURANCE_WARNING_PREFIX))].slice(0, 10);
  await sb.from("fleet_import_items").update({ status: "needs_attention", warnings }).eq("id", item.id);
  // One bell per file (same bytes), however many times it is re-analyzed.
  let notified = false;
  const key = sha ?? `item:${item.id}`;
  const prior = await sb.from("audit_log").select("id").eq("action", RENTER_INSURANCE_REVIEW_AUDIT_ACTION).eq("metadata->>sha256", key).limit(1);
  if (!prior.error && !(prior.data ?? []).length) {
    await sb.from("notifications").insert({ kind: "document", title: RENTER_INSURANCE_REVIEW_TITLE, body: message, read: false, channels: ["in_app"] }).then(() => {}, () => {});
    notified = true;
    await (deps.audit ?? defaultAudit)({
      action: RENTER_INSURANCE_REVIEW_AUDIT_ACTION,
      summary: `Emailed insurance ID card not filed: ${decision.reason}.`,
      entityType: "fleet_import_item",
      entityId: item.id,
      metadata: { sha256: key, item_id: item.id, reason: decision.reason, vin: decision.card?.vin ?? null, candidates: (decision.candidates ?? []).map((c: RentalCandidate) => c.applicationId) },
    });
  }
  return { status: "review", reason: decision.reason, message, notified };
}

/**
 * File an analyzed Fleet Inbox item onto the renter's portal when it is an
 * emailed insurance ID card that matches exactly one renter.
 */
export async function fileRenterInsuranceCard(sb: Admin, itemId: string, deps: FileDeps = {}): Promise<FileOutcome> {
  try {
    const it = await sb.from("fleet_import_items").select("id,batch_id,document_id,doc_class,extraction,warnings,content_sha256,source_channel,file_name").eq("id", itemId).maybeSingle();
    const item = it.data;
    if (!item || item.doc_class !== "insurance_card") return { status: "skipped", reason: "not_insurance_card" };
    if (!isAutoFileChannel(item.source_channel)) return { status: "skipped", reason: "channel" };
    const gate = await (deps.gate ?? defaultGate)(sb, RENTER_INSURANCE_CARDS_KEY).catch(() => "held" as const);
    if (gate === "off") return { status: "skipped", reason: "switched_off" };
    if (gate !== "send") return { status: "skipped", reason: "controls_unreadable" };
    if (!item.document_id) return { status: "skipped", reason: "no_document" };

    const cards = insuranceCardFacts(item.extraction);
    const vin = cards.length === 1 ? cards[0].vin : "";
    const { vehicleCount, candidates } = vin && cards[0].vinValid ? await loadCandidates(sb, vin) : { vehicleCount: 0, candidates: [] };
    const decision = decideInsuranceCardMatch({ cards, vehicleVinCount: vehicleCount, candidates, today: (deps.today ?? todayEt)() });
    const sha: string | null = item.content_sha256 ?? null;
    if (decision.kind === "review") return raiseReview(sb, deps, item, sha, decision);

    const appId = decision.candidate.applicationId;
    // Idempotency: these bytes already filed for this renter.
    if (sha) {
      const dup = await sb.from("documents").select("id").eq("driver_id", appId).eq("category", RENTER_INSURANCE_CATEGORY).eq("content_sha256", sha).limit(1);
      if (dup.error) return { status: "error", error: "documents_unreadable" };
      if ((dup.data ?? []).length) return { status: "duplicate", documentId: dup.data[0].id, applicationId: appId };
    }

    const src = await sb.from("documents").select("storage_bucket,storage_path,mime_type,size_bytes").eq("id", item.document_id).maybeSingle();
    if (!src.data) return { status: "error", error: "original_missing" };
    const file = await sb.storage.from(src.data.storage_bucket || "vehicle-docs").download(src.data.storage_path);
    if (!file?.data) return { status: "error", error: "original_unreadable" };
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const contentSha = sha ?? (await sha256Hex(bytes));
    if (!sha) {
      const dup = await sb.from("documents").select("id").eq("driver_id", appId).eq("category", RENTER_INSURANCE_CATEGORY).eq("content_sha256", contentSha).limit(1);
      if ((dup.data ?? []).length) return { status: "duplicate", documentId: dup.data[0].id, applicationId: appId };
    }
    const ext = extOf(src.data.mime_type, src.data.storage_path);
    const path = `${appId}/${RENTER_INSURANCE_CATEGORY}-${(deps.uuid ?? (() => crypto.randomUUID()))()}.${ext}`;
    const up = await sb.storage.from(DRIVER_DOC_BUCKET).upload(path, bytes, { contentType: src.data.mime_type || "application/pdf", upsert: false });
    if (up?.error) return { status: "error", error: "store_failed" };

    const ins = await sb.from("documents").insert({
      driver_id: appId,
      kind: RENTER_INSURANCE_CATEGORY,
      category: RENTER_INSURANCE_CATEGORY,
      label: RENTER_INSURANCE_LABEL,
      notes: renterCardNote(decision.card),
      storage_bucket: DRIVER_DOC_BUCKET,
      storage_path: path,
      visibility: ["driver", "admin"],
      file_name: renterCardFileName(ext),
      mime_type: src.data.mime_type || "application/pdf",
      size_bytes: bytes.byteLength,
      expires_at: decision.card.expiresOn,
      content_sha256: contentSha,
      is_current: true,
      uploaded_by: null,
      uploaded_by_role: "email",
      source: "insurance_email",
      review_status: "uploaded",
    }).select("id").single();
    if (ins.error || !ins.data) {
      await sb.storage.from(DRIVER_DOC_BUCKET).remove([path]).catch(() => undefined);
      return { status: "error", error: "save_failed" };
    }
    const docId = ins.data.id as string;

    // Nothing is superseded: every insurance card stays active (one per
    // vehicle, one per swap). Staff archive the ones that no longer apply.
    const toSupersede: string[] = [];

    // The Fleet Inbox item says where it went (staff only).
    const note = `Filed to the renter's Documents as ${RENTER_INSURANCE_LABEL} (not reviewed).`;
    const warnings = [note, ...((item.warnings ?? []) as string[]).filter((w) => !String(w).startsWith(RENTER_INSURANCE_WARNING_PREFIX) && w !== note)].slice(0, 10);
    await sb.from("fleet_import_items").update({ warnings }).eq("id", item.id);

    await (deps.audit ?? defaultAudit)({
      action: RENTER_INSURANCE_AUDIT_ACTION,
      summary: `Emailed insurance ID card filed to a renter's Documents (VIN …${decision.card.vin.slice(-6)}). Not reviewed; nothing verified.`,
      entityType: "document",
      entityId: docId,
      metadata: {
        document_id: docId, application_id: appId, rental_id: decision.candidate.rentalId, vehicle_id: decision.candidate.vehicleId,
        item_id: item.id, source_document_id: item.document_id, sha256: contentSha, effective_on: decision.card.effectiveOn,
        expires_on: decision.card.expiresOn, superseded: toSupersede, verified: false,
      },
    });
    return { status: "filed", documentId: docId, applicationId: appId, rentalId: decision.candidate.rentalId, superseded: toSupersede.length };
  } catch (e) {
    console.error("[insurance-card] filing failed", String(e).slice(0, 200));
    return { status: "error", error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}
