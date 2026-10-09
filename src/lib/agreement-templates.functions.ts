import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { DEFAULT_AGREEMENT_BODY, MERGE_FIELDS, COMPANY_DEFAULTS, renderTemplate } from "@/lib/agreement-merge";

// Owner-only agreement template management. Every saved edit is a NEW draft
// version row with is_active=false, so it never changes what Send uses.
// Approve / Retire / Effective Date need the Phase A versioning columns and
// refuse until that database update is applied.

export type TemplateVersion = {
  id: string | null; // null = built-in Draft v1 baseline
  name: string;
  version: number;
  status: "draft" | "approved" | "retired";
  inUse: boolean;
  effectiveDate: string | null;
  fingerprint: string;
  createdAt: string | null;
  createdBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  body: string;
  unknownFields: string[];
};

const KNOWN = new Set<string>(MERGE_FIELDS.map((f) => f.key));
export function unknownFieldsIn(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) if (!KNOWN.has(m[1].toLowerCase())) out.add(m[1]);
  return [...out];
}

async function owner(userId: string) {
  const { requireOwner } = await import("@/lib/roles.server");
  return requireOwner(userId);
}

async function companyChecks(admin: any) {
  const { getCompanySigner } = await import("@/lib/esign.server");
  const { getCompanyIdentity } = await import("@/lib/company-identity.server");
  const [signer, id] = await Promise.all([getCompanySigner(admin), getCompanyIdentity(admin)]);
  const issues = id.missing.map((m) => `${m} is missing in Settings → Company.`);
  if (!signer.title) issues.push("Countersigner title is not set (Settings → Agreements & eSign).");
  return { company: { ...id.merge, signer_name: signer.name, signer_title: signer.title }, issues, missing: id.missing };
}

async function loadAll(admin: any) {
  const { sha256Hex } = await import("@/lib/esign-pdf.server");
  const { activeTemplate } = await import("@/lib/agreements.functions");
  const [{ data: rows }, active] = await Promise.all([
    admin.from("agreement_templates").select("*").order("version", { ascending: true }),
    activeTemplate(admin),
  ]);
  const list = (rows ?? []) as any[];
  const versioningActive = active.meta.schemaReady;
  const enforcementOn = active.meta.versioningActive;
  const versions: TemplateVersion[] = [];
  const baselineFp = await sha256Hex(DEFAULT_AGREEMENT_BODY);
  if (!list.some((r) => Number(r.version) === 1)) {
    versions.push({
      id: null, name: "Rental Agreement", version: 1, status: "draft", inUse: active.meta.id === null,
      effectiveDate: null, fingerprint: baselineFp, createdAt: null, createdBy: "Built In", approvedAt: null, approvedBy: null,
      body: DEFAULT_AGREEMENT_BODY, unknownFields: unknownFieldsIn(DEFAULT_AGREEMENT_BODY),
    });
  }
  for (const r of list) {
    const body = String(r.body ?? "");
    versions.push({
      id: r.id, name: r.name ?? "Rental Agreement", version: Number(r.version ?? 1),
      status: versioningActive ? r.approval_status : "draft",
      inUse: active.meta.id === r.id,
      effectiveDate: r.effective_date ?? null,
      fingerprint: r.content_sha256 ?? (await sha256Hex(body)),
      createdAt: r.created_at ?? null, createdBy: r.created_by ?? null,
      approvedAt: r.approved_at ?? null, approvedBy: r.approved_by ?? null,
      body, unknownFields: unknownFieldsIn(body),
    });
  }
  let enforcementSwitch = false;
  try { const { data: e } = await admin.from("app_settings").select("value").eq("key", "esign_template_enforcement").maybeSingle(); enforcementSwitch = (e?.value as any)?.enabled === true; } catch {}
  return { versions: versions.sort((a, b) => b.version - a.version), versioningActive, enforcementOn, enforcementSwitch, inUseLabel: active.meta.label };
}

export const listTemplateVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await owner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [all, checks, hist] = await Promise.all([
      loadAll(supabaseAdmin),
      companyChecks(supabaseAdmin),
      supabaseAdmin.from("audit_log").select("action,summary,actor_email,created_at,metadata")
        .eq("entity_type", "agreement_template").order("created_at", { ascending: false }).limit(100),
    ]);
    return { ...all, ...checks, fields: MERGE_FIELDS.map((f) => ({ ...f })), history: (hist.data ?? []) as any[] };
  });

export const saveTemplateDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ body: z.string().min(50).max(60000), basedOn: z.number().int().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await owner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { versions } = await loadAll(supabaseAdmin);
    if (versions.some((v) => v.body === data.body)) return { ok: false as const, error: "No changes — this wording already exists as a version." };
    const { unknownTermsIn } = await import("@/lib/agreement-builder");
    const badTerms = unknownTermsIn(data.body);
    if (badTerms.length || unknownFieldsIn(data.body).length) return { ok: false as const, error: "The draft contains unknown fields." };
    const next = Math.max(1, ...versions.map((v) => v.version)) + 1;
    // is_active stays false: a draft never changes what Send uses.
    const { data: row, error } = await supabaseAdmin.from("agreement_templates")
      .insert({ name: "Rental Agreement", body: data.body, version: next, is_active: false } as any)
      .select("id").single();
    if (error) return { ok: false as const, error: "Could not save the draft." };
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, { action: "template.draft_created", summary: `Created Draft v${next} (based on v${data.basedOn})`, entityType: "agreement_template", entityId: row.id as string, metadata: { version: next, based_on: data.basedOn } });
    return { ok: true as const, version: next };
  });

const SAMPLE = Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, `[${f.label}]`]));

/**
 * Agreement Builder live preview: renders an unsaved body through the same
 * renderTemplate + renderPreviewPdf pipeline as Preview. Owner-only, writes
 * nothing, never sends.
 */
export const previewTemplateBody = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ body: z.string().min(1).max(80000), label: z.string().max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    await owner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getCompanySigner } = await import("@/lib/esign.server");
    const { renderPreviewPdf, sha256Hex } = await import("@/lib/esign-pdf.server");
    const signer = await getCompanySigner(supabaseAdmin);
    const fingerprint = await sha256Hex(data.body);
    const bytes = await renderPreviewPdf({
      title: "Vehicle Rental Agreement", body: renderTemplate(data.body, { ...SAMPLE, ...COMPANY_DEFAULTS, ...(await companyChecks(supabaseAdmin)).company } as any),
      fingerprint, templateLabel: `${data.label} — Sample Fields`,
      companySignerName: signer.name, companySignerTitle: signer.title, generatedAt: new Date().toISOString(),
    });
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ok: true as const, pdfBase64: btoa(bin), fingerprint };
  });

export const previewTemplateVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ version: z.number().int().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await owner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { versions } = await loadAll(supabaseAdmin);
    const v = versions.find((x) => x.version === data.version);
    if (!v) return { ok: false as const, error: "Version not found." };
    const { getCompanySigner } = await import("@/lib/esign.server");
    const signer = await getCompanySigner(supabaseAdmin);
    const { renderPreviewPdf } = await import("@/lib/esign-pdf.server");
    const label = v.status === "approved" ? `Approved v${v.version}` : v.status === "retired" ? `Retired v${v.version}` : `Draft v${v.version} — Legal Review Required`;
    const bytes = await renderPreviewPdf({
      title: "Vehicle Rental Agreement", body: renderTemplate(v.body, { ...SAMPLE, ...COMPANY_DEFAULTS, ...(await companyChecks(supabaseAdmin)).company } as any),
      fingerprint: v.fingerprint, templateLabel: `${label} — Sample Fields`,
      companySignerName: signer.name, companySignerTitle: signer.title, generatedAt: new Date().toISOString(),
    });
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ok: true as const, pdfBase64: btoa(bin) };
  });

const NEEDS_DB = "Available after the template database update (Phase A) is approved and applied.";

export const approveTemplateVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ version: z.number().int(), fingerprint: z.string(), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), confirm: z.literal("APPROVE") }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await owner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { versions, versioningActive } = await loadAll(supabaseAdmin);
    if (!versioningActive) return { ok: false as const, error: NEEDS_DB };
    const v = versions.find((x) => x.version === data.version);
    if (!v?.id || v.status !== "draft") return { ok: false as const, error: "Only a saved Draft can be approved." };
    if (v.fingerprint !== data.fingerprint) return { ok: false as const, error: "The wording changed since you reviewed it. Review again." };
    if (v.unknownFields.length) return { ok: false as const, error: `Unknown fields: ${v.unknownFields.join(", ")}` };
    {
      const { readTerms, missingTerms, stripTerms } = await import("@/lib/agreement-builder");
      const miss = missingTerms(readTerms(v.body) ?? {}, stripTerms(v.body));
      if (miss.length) return { ok: false as const, error: `Set every contract value first (missing: ${miss.join(", ")}). Service Area / Mileage Limit must be chosen explicitly.` };
      const open = Object.entries(readTerms(v.body) ?? {}).filter(([, val]) => /\[[^\]]*\]/.test(String(val))).map(([k]) => k);
      if (open.length) return { ok: false as const, error: `Bracketed open values remain (${open.join(", ")}). Resolve them, or have legal review confirm them, before approval.` };
    }
    const { issues } = await companyChecks(supabaseAdmin);
    if (issues.length) return { ok: false as const, error: issues[0] };
    const { error } = await supabaseAdmin.from("agreement_templates")
      .update({ approval_status: "approved", approved_by: actor.userId, approved_at: new Date().toISOString(), effective_date: data.effectiveDate } as any)
      .eq("id", v.id).eq("approval_status" as any, "draft");
    if (error) return { ok: false as const, error: "Could not approve." };
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, { action: "template.approved", summary: `Owner approved v${v.version}, effective ${data.effectiveDate} (Owner approval — not a legal review)`, entityType: "agreement_template", entityId: v.id, metadata: { version: v.version, fingerprint: v.fingerprint, effective_date: data.effectiveDate } });
    return { ok: true as const };
  });

export const retireTemplateVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ version: z.number().int(), reason: z.string().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await owner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { versions, versioningActive } = await loadAll(supabaseAdmin);
    if (!versioningActive) return { ok: false as const, error: NEEDS_DB };
    const v = versions.find((x) => x.version === data.version);
    if (!v?.id || v.status === "retired") return { ok: false as const, error: "This version cannot be retired." };
    const { error } = await supabaseAdmin.from("agreement_templates").update({ approval_status: "retired" } as any).eq("id", v.id);
    if (error) return { ok: false as const, error: "Could not retire." };
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, { action: "template.retired", summary: `Retired v${v.version}: ${data.reason}`, entityType: "agreement_template", entityId: v.id, metadata: { version: v.version } });
    return { ok: true as const };
  });

/** Stage 5: Owner explicitly turns on approved-template enforcement. Refused unless an approved version exists. */
export const setTemplateEnforcement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean(), reason: z.string().trim().max(500), confirm: z.enum(["ENABLE", "DISABLE"]) }).refine((v) => v.confirm === (v.enabled ? "ENABLE" : "DISABLE")).refine((v) => v.enabled || v.reason.length >= 3, "A reason is required to turn enforcement off.").parse(d))
  .handler(async ({ data, context }) => {
    const actor = await owner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { versions, versioningActive } = await loadAll(supabaseAdmin);
    if (!versioningActive) return { ok: false as const, error: NEEDS_DB };
    if (data.enabled && !versions.some((v) => v.status === "approved"))
      return { ok: false as const, error: "Approve a version first — enforcement would block all sending." };
    const { error } = await supabaseAdmin.from("app_settings").upsert({ key: "esign_template_enforcement", value: { enabled: data.enabled } } as any, { onConflict: "key" });
    if (error) return { ok: false as const, error: "Could not save." };
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, { action: data.enabled ? "template.enforcement_on" : "template.enforcement_off", summary: `${data.enabled ? "Approved-template enforcement turned ON" : "Approved-template enforcement turned OFF"}${data.reason ? ": " + data.reason : ""}`, entityType: "agreement_template", entityId: null as any, metadata: {} });
    return { ok: true as const };
  });

/**
 * Smart Agreement Upload — keep the original file privately (Owner only).
 * The private rental-agreements bucket is staff-only; nothing here creates a
 * template, approves anything or changes what Send uses.
 */
export const storeTemplateUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    fileName: z.string().min(1).max(200),
    base64: z.string().min(10).max(14_500_000), // ≈10 MB
  }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await owner(context.userId);
    const bin = atob(data.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    const isDocx = bytes[0] === 0x50 && bytes[1] === 0x4b && /\.docx$/i.test(data.fileName);
    if (!isPdf && !isDocx) return { ok: false as const, error: "Only PDF and Word (.docx) agreements can be uploaded." };
    const { sha256Hex } = await import("@/lib/esign-pdf.server");
    const digest = await sha256Hex(bytes as any);
    const safe = data.fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
    const path = `template-uploads/${digest.slice(0, 16)}/${safe}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage.from("rental-agreements").upload(path, bytes, {
      contentType: isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (error) return { ok: false as const, error: "Could not store the original file." };
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, { action: "template.source_uploaded", summary: `Uploaded agreement source ${safe}`, entityType: "agreement_template", entityId: null as any, metadata: { path, sha256: digest, bytes: bytes.length } });
    return { ok: true as const, path, sha256: digest };
  });

// ---------------------------------------------------------------- library drafts
// Contract values for the built-in agreement families, saved as Draft
// versions in app_settings (key agreement_library_draft:<family>). The legal
// wording never changes; nothing here approves, activates or sends.

export type LibraryDraftVersion = { n: number; terms: Record<string, string>; savedAt: string; savedBy: string | null; sha256: string };

export async function loadLibraryDraft(admin: any, key: string): Promise<LibraryDraftVersion[]> {
  const { data } = await admin.from("app_settings").select("value").eq("key", `agreement_library_draft:${key}`).maybeSingle();
  const v = (data?.value as any)?.versions;
  return Array.isArray(v) ? v : [];
}

export const getLibraryDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await owner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { LIBRARY } = await import("@/lib/agreement-library");
    const out: Record<string, LibraryDraftVersion[]> = {};
    for (const t of LIBRARY) out[t.key] = await loadLibraryDraft(supabaseAdmin, t.key);
    return out;
  });

export const saveLibraryDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ key: z.string().max(40), terms: z.record(z.string(), z.string().max(2000)) }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await owner(context.userId);
    const { libraryTemplate } = await import("@/lib/agreement-library");
    const lib = libraryTemplate(data.key);
    if (!lib) return { ok: false as const, error: "Unknown agreement template." };
    const { termsIn, writeTerms, UNPRINTED_TERMS } = await import("@/lib/agreement-builder");
    const used = new Set(termsIn(lib.source));
    if (used.has("mileage_allowance")) for (const k of UNPRINTED_TERMS) used.add(k);
    // Values this agreement does not print (e.g. the 3.5% toll fee from v1.6) are ignored, never saved.
    const { ALL_TERM_FIELDS } = await import("@/lib/agreement-builder");
    const known = new Set(ALL_TERM_FIELDS.map((f) => f.key));
    const unknown = Object.keys(data.terms).filter((k) => !known.has(k));
    if (unknown.length) return { ok: false as const, error: `Unknown contract values: ${unknown.join(", ")}` };
    const terms = Object.fromEntries([...used].map((k) => [k, (data.terms[k] ?? lib.terms[k] ?? "").replace(/%%/g, "%")]));
    // Unlimited miles never carries an excess-mileage fee.
    if ("excess_mileage_fee" in terms) {
      const { excessFeeFor } = await import("@/lib/service-area");
      terms.excess_mileage_fee = excessFeeFor(terms.mileage_allowance ?? "", terms.excess_mileage_fee);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const versions = await loadLibraryDraft(supabaseAdmin, lib.key);
    const prev = versions.at(-1)?.terms ?? lib.terms;
    if ([...used].every((k) => (prev[k] ?? "") === terms[k])) return { ok: false as const, error: "No changes to save." };
    const { sha256Hex } = await import("@/lib/esign-pdf.server");
    const sha256 = await sha256Hex(writeTerms(lib.source, terms));
    const n = (versions.at(-1)?.n ?? 0) + 1;
    const next = [...versions, { n, terms, savedAt: new Date().toISOString(), savedBy: actor.email ?? actor.userId, sha256 }];
    const { error } = await supabaseAdmin.from("app_settings").upsert({ key: `agreement_library_draft:${lib.key}`, value: { versions: next } } as any, { onConflict: "key" });
    if (error) { console.error("saveLibraryDraft", error.message); return { ok: false as const, error: "Could not save the draft." }; }
    const changed = [...used].filter((k) => (prev[k] ?? "") !== terms[k]);
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, { action: "template.library_draft_saved", summary: `Saved ${lib.name} v${lib.displayVersion} draft values #${n} (not approved): ${changed.join(", ")}`, entityType: "agreement_template", entityId: null as any, metadata: { key: lib.key, draft: n, sha256, changed } });
    return { ok: true as const, version: n };
  });
