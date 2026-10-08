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
  const signer = await getCompanySigner(admin);
  const c = COMPANY_DEFAULTS;
  const issues: string[] = [];
  if (!c.company_name?.trim()) issues.push("Company name is missing.");
  if (!/\d/.test(c.company_address ?? "")) issues.push(`Company address is incomplete ("${c.company_address}") — a full street address is needed.`);
  if (!c.company_phone?.trim()) issues.push("Company phone is missing.");
  if (!c.company_email?.includes("@")) issues.push("Company email is missing.");
  if (!signer.title) issues.push("Countersigner title is not set (Settings → Agreements & eSign).");
  return { company: { ...c, signer_name: signer.name, signer_title: signer.title }, issues };
}

async function loadAll(admin: any) {
  const { sha256Hex } = await import("@/lib/esign-pdf.server");
  const { activeTemplate } = await import("@/lib/agreements.functions");
  const [{ data: rows }, active] = await Promise.all([
    admin.from("agreement_templates").select("*").order("version", { ascending: true }),
    activeTemplate(admin),
  ]);
  const list = (rows ?? []) as any[];
  const versioningActive = active.meta.versioningActive;
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
  return { versions: versions.sort((a, b) => b.version - a.version), versioningActive, inUseLabel: active.meta.label };
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
      title: "Vehicle Rental Agreement", body: renderTemplate(v.body, { ...SAMPLE, ...COMPANY_DEFAULTS }),
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
