// Server-only: Email-to-Evidence intake. An inbound email is EVIDENCE, never
// instructions. We preserve the email, store each allowed attachment once
// (SHA-256 dedupe against the existing documents vault) and drop the files into
// a normal Fleet Inbox batch. Classification, grouping (service transactions),
// matching and Review/Apply are the existing Fleet Inbox pipeline — nothing is
// applied automatically.

const BUCKET = "vehicle-docs";
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;
const RESEND_API = "https://api.resend.com";

/** Verify a svix-signed webhook (Resend's documented scheme). */
export async function verifySvix(body: string, headers: Headers, secret: string): Promise<boolean> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  try {
    const keyB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    return signature.split(" ").some((p) => { const [v, s] = p.split(","); return v === "v1" && s === expected; });
  } catch { return false; }
}

/** Sniff real file type from bytes; sender-supplied MIME is never trusted. */
export function sniffType(b: Uint8Array): { mime: string; ext: string } | null {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: "application/pdf", ext: "pdf" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  return null; // HEIC, Office, archives, executables: not safely analyzable → rejected
}

export function safeFileName(name: string | null | undefined): string {
  const base = String(name ?? "attachment").split(/[\\/]/).pop() ?? "attachment";
  return base.replace(/[^\w.\- ()]/g, "_").replace(/^\.+/, "").slice(0, 150) || "attachment";
}

/** Plain text from HTML without ever rendering it. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function isIntakeRecipient(addr: string): boolean {
  const configured = (process.env.INBOUND_INTAKE_ADDRESSES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const a = addr.replace(/^.*<|>.*$/g, "").trim().toLowerCase();
  if (configured.length) return configured.includes(a);
  return a.split("@")[0] === "inbox"; // inbox@drivereal.com or inbox@<receiving subdomain>
}

function parseFrom(from: string | null | undefined) {
  const s = String(from ?? "");
  const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim() || null, address: m[2].trim().toLowerCase() } : { name: null, address: s.trim().toLowerCase() || null };
}

async function resendGet(path: string): Promise<any> {
  // Receiving needs a full-access key; the sending key (RESEND_API_KEY) is send-only by design.
  const key = process.env.RESEND_INBOUND_API_KEY;
  if (!key) throw new Error("RESEND_INBOUND_API_KEY missing");
  const r = await fetch(`${RESEND_API}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`provider ${r.status}`);
  return r.json();
}

async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type IngestResult = { status: "duplicate" | "ignored" | "stored"; inboundId?: string; batchId?: string };

/** Handle one Resend `email.received` event. Idempotent on provider ids. */
export async function ingestResendEmail(eventId: string | null, data: any): Promise<IngestResult> {
  const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
  const emailId = String(data?.email_id ?? data?.id ?? "");
  if (!emailId) throw new Error("missing email id");

  const { data: seen } = await sb.from("inbound_emails").select("id").eq("provider", "resend").eq("provider_email_id", emailId).maybeSingle();
  if (seen) return { status: "duplicate", inboundId: seen.id };

  const to: string[] = (Array.isArray(data?.to) ? data.to : [data?.to]).filter(Boolean).map(String);
  const intake = to.find(isIntakeRecipient);
  if (!intake) return { status: "ignored" }; // not addressed to evidence intake (e.g. team@) — never ingested

  // Full content comes from the provider API, not the webhook payload.
  let full: any = {};
  const fetchErrors: string[] = [];
  try { full = (await resendGet(`/emails/receiving/${encodeURIComponent(emailId)}`)) ?? {}; } catch (e) { fetchErrors.push(`content: ${String(e).slice(0, 120)}`); console.error("[inbound] content fetch failed", String(e).slice(0, 120)); }
  const headers = full.headers ?? {};
  const h = (k: string) => { const v = headers[k] ?? headers[k.toLowerCase()]; return v ? String(v).slice(0, 2000) : null; };
  const html = typeof full.html === "string" ? full.html : null;
  const text = (typeof full.text === "string" && full.text.trim() ? full.text : html ? htmlToText(html) : "").slice(0, 200_000);
  const from = parseFrom(full.from ?? data?.from);
  const subject = String(full.subject ?? data?.subject ?? "").slice(0, 500) || null;

  const { data: row, error } = await sb.from("inbound_emails").insert({
    provider: "resend", provider_event_id: eventId, provider_email_id: emailId,
    message_id: (full.message_id ?? data?.message_id ?? h("message-id")) || null,
    in_reply_to: h("in-reply-to"), references_header: h("references"),
    from_address: from.address, from_name: from.name, to_addresses: to.slice(0, 20), intake_address: intake.toLowerCase(),
    subject, received_at: data?.created_at ?? full.created_at ?? new Date().toISOString(),
    text_body: text || null, html_sanitized: null, status: "processing",
  }).select("id").single();
  if (error) {
    // Lost a race with a concurrent retry of the same event.
    const { data: again } = await sb.from("inbound_emails").select("id").eq("provider", "resend").eq("provider_email_id", emailId).maybeSingle();
    if (again) return { status: "duplicate", inboundId: again.id };
    throw new Error("could not store email");
  }
  const inboundId = row.id as string;

  const label = `Email — ${(subject ?? "(No Subject)").slice(0, 80)}${from.address ? ` · ${from.address}` : ""}`.slice(0, 120);
  const { data: batch } = await sb.from("fleet_import_batches").insert({ label, source_channel: "email", inbound_email_id: inboundId }).select("id").single();
  const batchId = batch!.id as string;

  let list: any[] = [];
  try { const r = await resendGet(`/emails/receiving/${encodeURIComponent(emailId)}/attachments`); list = Array.isArray(r?.data) ? r.data : []; }
  catch (e) { fetchErrors.push(`attachments: ${String(e).slice(0, 120)}`); console.error("[inbound] attachment list failed", String(e).slice(0, 120)); list = []; }

  const manifest: any[] = [];
  let stored = 0;
  for (const a of list.slice(0, MAX_ATTACHMENTS)) {
    const fileName = safeFileName(a?.filename);
    const entry: any = { id: String(a?.id ?? ""), file_name: fileName, declared_type: a?.content_type ?? null, size: a?.size ?? null };
    try {
      if (a?.content_disposition === "inline" && /^image\//.test(a?.content_type ?? "") && (a?.size ?? 0) < 15_000) { entry.outcome = "skipped_inline_image"; manifest.push(entry); continue; }
      if ((a?.size ?? 0) > MAX_ATTACHMENT_BYTES) { entry.outcome = "rejected_too_large"; manifest.push(entry); continue; }
      const url = String(a?.download_url ?? "");
      if (!/^https:\/\//.test(url)) { entry.outcome = "rejected_no_download"; manifest.push(entry); continue; }
      const res = await fetch(url);
      if (!res.ok) { entry.outcome = "failed_download"; manifest.push(entry); continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) { entry.outcome = "rejected_too_large"; manifest.push(entry); continue; }
      const type = sniffType(bytes);
      if (!type) { entry.outcome = "rejected_unsupported_type"; manifest.push(entry); continue; }
      const sha = await sha256Hex(bytes);
      entry.sha256 = sha; entry.mime = type.mime;

      const { data: dup } = await sb.from("documents").select("id").eq("content_sha256", sha).is("driver_id", null).maybeSingle();
      if (dup) {
        await sb.from("fleet_import_items").insert({
          batch_id: batchId, file_name: fileName, mime_type: type.mime, size_bytes: bytes.byteLength, content_sha256: sha,
          status: "duplicate", duplicate_of_document_id: dup.id, document_id: dup.id,
          source_channel: "email", inbound_email_id: inboundId, source_attachment_id: entry.id,
        });
        entry.outcome = "duplicate_of_existing"; manifest.push(entry); continue;
      }
      const path = `inbox/email/${inboundId}/${crypto.randomUUID()}.${type.ext}`;
      const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: type.mime, upsert: false });
      if (up.error) { entry.outcome = "failed_store"; manifest.push(entry); continue; }
      const { data: doc, error: dErr } = await sb.from("documents").insert({
        kind: "unknown", category: "unknown", label: fileName, storage_bucket: BUCKET, storage_path: path,
        file_name: fileName, mime_type: type.mime, size_bytes: bytes.byteLength, content_sha256: sha,
        is_current: true, visibility: ["admin"], uploaded_by_role: "email", source: "email", review_status: "uploaded",
      }).select("id").single();
      if (dErr || !doc) { await sb.storage.from(BUCKET).remove([path]); entry.outcome = "failed_store"; manifest.push(entry); continue; }
      const { data: newItem } = await sb.from("fleet_import_items").insert({
        batch_id: batchId, document_id: doc.id, file_name: fileName, mime_type: type.mime, size_bytes: bytes.byteLength,
        content_sha256: sha, status: "uploaded", source_channel: "email", inbound_email_id: inboundId, source_attachment_id: entry.id,
      }).select("id").single();
      // Queue background analysis (the webhook itself never runs AI).
      if (newItem?.id) await sb.from("fleet_inbox_jobs").insert({ item_id: newItem.id, batch_id: batchId, source: "email" });
      stored++; entry.outcome = "stored"; manifest.push(entry);
    } catch (e) {
      console.error("[inbound] attachment failed", String(e).slice(0, 200));
      entry.outcome = "failed"; manifest.push(entry);
    }
  }
  if (list.length > MAX_ATTACHMENTS) manifest.push({ outcome: "rejected_over_limit", count: list.length - MAX_ATTACHMENTS });

  await sb.from("fleet_import_batches").update({ status: stored ? "processing" : "needs_attention" }).eq("id", batchId);
  await sb.from("inbound_emails").update({ attachments: manifest, batch_id: batchId, status: fetchErrors.length ? "fetch_failed" : stored ? "ready_for_analysis" : "needs_review", error: fetchErrors.join("; ") || null }).eq("id", inboundId);
  return { status: "stored", inboundId, batchId };
}
