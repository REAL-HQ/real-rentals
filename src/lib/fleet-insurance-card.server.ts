/**
 * FLEET hands over an insurance ID card it found in the team@ Gmail inbox —
 * Spam included — because the app's own intake (Resend, inbox@) cannot read
 * Gmail (Dolmar, t379u).
 *
 *   POST /api/public/fleet/insurance-card
 *   { "message_id": "<gmail message id>", "attachment_id": "<gmail attachment id>",
 *     "folder": "inbox" | "spam", "from": "sender@example.com", "subject": "…",
 *     "received_at": "2026-11-16T16:35:12Z", "file_name": "card.pdf",
 *     "content_base64": "<the file, base64>" }
 *
 * Bearer FLEET_API_KEY. Gated by the Automations switch "Insurance ID Cards To
 * Portal" (renter_insurance_cards, default On).
 *
 * This is evidence intake, not a filing call: the file goes into the same
 * Fleet Inbox email batch shape as an inbound@ email (inbound_emails provider
 * "gmail", vehicle-docs original, fleet_inbox_jobs queue). The one analysis
 * path classifies it; renter-insurance-card.server.ts files it only on an
 * exact VIN + renter-name match. FLEET never picks the renter. Idempotent on
 * (gmail message, attachment) and on the bytes. Never verifies, never sends.
 */
import { cleanText, fleetAdmin, fleetAudit, fleetJson, fleetRequestBody, type FleetDeps } from "@/lib/fleet-api.server";
import { decodeBase64, sniffType } from "@/lib/fleet-document.server";
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";
import { RENTER_INSURANCE_CARDS_KEY } from "@/lib/renter-insurance-card";

type Admin = any;
export const FLEET_INSURANCE_CARD_MAX_BYTES = 20 * 1024 * 1024;
export const FLEET_INSURANCE_CARD_AUDIT_ACTION = "document.fleet_insurance_card_intake";
const BUCKET = "vehicle-docs";
const ID_RE = /^[A-Za-z0-9_\-]{6,200}$/;

export type InsuranceCardDeps = FleetDeps & {
  gate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  uuid?: () => string;
};

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}
async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function handleFleetInsuranceCard(request: Request, deps: InsuranceCardDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);

  const gate = await (deps.gate ?? defaultGate)(admin, RENTER_INSURANCE_CARDS_KEY).catch(() => "held" as const);
  if (gate === "off") return fleetJson(409, { ok: false, error: "The Insurance ID Cards To Portal switch is Off (Back Office → Automations). Nothing was saved.", reason: "switched_off" });
  if (gate !== "send") return fleetJson(503, { ok: false, error: "Automation switches could not be read; try again later. Nothing was saved.", reason: "controls_unreadable" });

  const messageId = String(body.message_id ?? "");
  const attachmentKey = String(body.attachment_id ?? "").slice(0, 200);
  if (!ID_RE.test(messageId)) return fleetJson(400, { ok: false, error: "message_id must be the Gmail message id." });
  const folder = String(body.folder ?? "inbox").toLowerCase();
  if (!["inbox", "spam"].includes(folder)) return fleetJson(400, { ok: false, error: "folder must be inbox or spam." });
  if (typeof body.content_base64 === "string" && body.content_base64.length > Math.ceil(FLEET_INSURANCE_CARD_MAX_BYTES / 3) * 4 + 200)
    return fleetJson(413, { ok: false, error: "The file is over 20 MB. Nothing was saved." });
  const bytes = decodeBase64(body.content_base64);
  if (!bytes || !bytes.length) return fleetJson(400, { ok: false, error: "content_base64 must be the file, base64-encoded." });
  if (bytes.length > FLEET_INSURANCE_CARD_MAX_BYTES) return fleetJson(413, { ok: false, error: "The file is over 20 MB. Nothing was saved." });
  const type = sniffType(bytes);
  if (!type || type.mime === "image/heic") return fleetJson(415, { ok: false, error: "Only PDF, JPEG, PNG or WebP cards can be read. Nothing was saved." });
  const sha = await sha256Hex(bytes);
  const fileName = (cleanText(body.file_name, 150).replace(/[\\/\u0000-\u001f]/g, "_") || `insurance-card.${type.ext}`);
  const providerEmailId = `${messageId}:${attachmentKey || sha.slice(0, 16)}`;

  // Same Gmail attachment handed over before.
  const seen = await admin.from("inbound_emails").select("id,batch_id").eq("provider", "gmail").eq("provider_email_id", providerEmailId).maybeSingle();
  if (seen?.error) return fleetJson(503, { ok: false, error: "Could not check for an earlier copy. Nothing was saved." });
  if (seen?.data) return fleetJson(200, { ok: true, duplicate: true, matched_by: "message", inbound_id: seen.data.id, batch_id: seen.data.batch_id ?? null });
  // Same bytes already in Fleet Inbox (from inbox@ or an earlier hand-over).
  const dupDoc = await admin.from("documents").select("id").eq("content_sha256", sha).is("driver_id", null).maybeSingle();
  if (dupDoc?.error) return fleetJson(503, { ok: false, error: "Could not check for an earlier copy. Nothing was saved." });
  if (dupDoc?.data) return fleetJson(200, { ok: true, duplicate: true, matched_by: "content", document_id: dupDoc.data.id });

  const from = cleanText(body.from, 320).toLowerCase() || null;
  const subject = cleanText(body.subject, 500) || null;
  const receivedAt = !Number.isNaN(Date.parse(String(body.received_at ?? ""))) ? new Date(String(body.received_at)).toISOString() : (deps.now ?? (() => new Date()))().toISOString();
  const inb = await admin.from("inbound_emails").insert({
    provider: "gmail", provider_event_id: null, provider_email_id: providerEmailId, message_id: messageId,
    from_address: from, from_name: null, to_addresses: ["team@drivereal.com"], intake_address: `team@drivereal.com (${folder})`,
    subject, received_at: receivedAt, text_body: null, html_sanitized: null, status: "processing",
  }).select("id").single();
  if (inb.error || !inb.data) return fleetJson(503, { ok: false, error: "Could not record the email. Nothing was saved." });
  const inboundId = inb.data.id as string;

  const label = `Email — ${(subject ?? "(No Subject)").slice(0, 70)} · team@ ${folder === "spam" ? "Spam" : "Inbox"}`.slice(0, 120);
  const batch = await admin.from("fleet_import_batches").insert({ label, source_channel: "email", inbound_email_id: inboundId }).select("id").single();
  if (batch.error || !batch.data) {
    await admin.from("inbound_emails").update({ status: "needs_review", error: "batch_failed" }).eq("id", inboundId);
    return fleetJson(503, { ok: false, error: "Could not open a Fleet Inbox batch. Nothing was saved." });
  }
  const batchId = batch.data.id as string;
  const path = `inbox/email/${inboundId}/${(deps.uuid ?? (() => crypto.randomUUID()))()}.${type.ext}`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: type.mime, upsert: false });
  if (up?.error) {
    await admin.from("inbound_emails").update({ status: "needs_review", error: "store_failed", batch_id: batchId }).eq("id", inboundId);
    return fleetJson(503, { ok: false, error: "Could not store the file. Nothing was saved." });
  }
  const doc = await admin.from("documents").insert({
    kind: "unknown", category: "unknown", label: fileName, storage_bucket: BUCKET, storage_path: path,
    file_name: fileName, mime_type: type.mime, size_bytes: bytes.length, content_sha256: sha,
    is_current: true, visibility: ["admin"], uploaded_by_role: "email", source: "email", review_status: "uploaded",
  }).select("id").single();
  if (doc.error || !doc.data) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    await admin.from("inbound_emails").update({ status: "needs_review", error: "save_failed", batch_id: batchId }).eq("id", inboundId);
    return fleetJson(503, { ok: false, error: "Could not save the file. Nothing was saved." });
  }
  const item = await admin.from("fleet_import_items").insert({
    batch_id: batchId, document_id: doc.data.id, file_name: fileName, mime_type: type.mime, size_bytes: bytes.length,
    content_sha256: sha, status: "uploaded", source_channel: "email", inbound_email_id: inboundId, source_attachment_id: attachmentKey || null,
    doc_class: "insurance_card",
  }).select("id").single();
  if (item?.data?.id) await admin.from("fleet_inbox_jobs").insert({ item_id: item.data.id, batch_id: batchId, source: "email" });
  await admin.from("fleet_import_batches").update({ status: "processing" }).eq("id", batchId);
  await admin.from("inbound_emails").update({
    attachments: [{ id: attachmentKey || null, file_name: fileName, sha256: sha, mime: type.mime, size: bytes.length, outcome: "stored" }],
    batch_id: batchId, status: "ready_for_analysis",
  }).eq("id", inboundId);

  await audit({
    action: FLEET_INSURANCE_CARD_AUDIT_ACTION,
    summary: `${FLEET_ACTOR_LABEL} handed over an emailed insurance ID card from team@ ${folder} for Fleet Inbox to read. Not filed yet; nothing verified.`.slice(0, 300),
    entityType: "fleet_import_item",
    entityId: item?.data?.id ?? null,
    metadata: { uploaded_by: FLEET_ACTOR_LABEL, gmail_message_id: messageId, attachment_id: attachmentKey || null, folder, sha256: sha, inbound_id: inboundId, batch_id: batchId, document_id: doc.data.id },
  });
  return fleetJson(201, {
    ok: true, inbound_id: inboundId, batch_id: batchId, item_id: item?.data?.id ?? null, document_id: doc.data.id, sha256: sha,
    next: "Queued for Fleet Inbox. If the VIN and name match exactly one renter it is saved to their Documents as Insurance ID Card (not reviewed); otherwise staff see it in Fleet Inbox.",
  });
}
