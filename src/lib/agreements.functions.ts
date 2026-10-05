import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  COMPANY_DEFAULTS,
  DEFAULT_AGREEMENT_BODY,
  renderTemplate,
  type MergeData,
} from "@/lib/agreement-merge";

export type AgreementRow = {
  id: string;
  application_id: string;
  vehicle_id: string | null;
  title: string;
  body: string;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  voided_at: string | null;
  signer_name: string | null;
  signer_email: string | null;
  created_at: string;
  document_id: string | null;
  archive_status: string;
  archive_error: string | null;
  sha256: string | null;
  email_status: "sent" | "failed" | "not_attempted";
  email_error: string | null;
  sms_status: "sent" | "failed" | "not_attempted";
  sms_error: string | null;
  company_signer_name: string | null;
  company_signer_title: string | null;
  timeline: { at: string; label: string }[];
};

const TIMELINE_LABELS: Record<string, string> = {
  "document.created": "Created",
  "document.sent": "Sent",
  "document.resent": "Link reissued",
  "document.delivery_failed": "Delivery failed",
  "document.viewed": "Viewed",
  "document.signed": "Signed",
  "document.archive_failed": "PDF save failed",
  "document.archive_recovered": "PDF recovered",
  "document.voided": "Voided",
};

const SITE_URL = () => process.env.PUBLIC_SITE_URL || "https://drivereal.com";

type Tier = "owner" | "manager" | "coordinator";
/** Server-side tier check (Owner > Manager > Coordinator). */
async function requireTierFor(userId: string, t: Tier) {
  const m = await import("@/lib/roles.server");
  return m.requireTier(userId, t);
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
// Generic engine helpers live in esign.server.ts; these two stay inline
// because this module is client-reachable and must not import it statically.

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What renderTemplate substitutes for a merge field it has no value for. */
const BLANK = "__________";

function money(v: unknown): string {
  const n = Number(v ?? 0);
  if (!n) return "";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * What an agreement cannot be signed without.
 *
 * Kept as a list rather than a series of throws so the preview can show a
 * staff member everything that is missing at once, instead of one item per
 * attempt.
 */
export type AgreementBlocker = { field: string; label: string; why: string };

async function buildMergeData(
  admin: any,
  applicationId: string,
): Promise<{ data: MergeData; app: any; vehicle: any; blockers: AgreementBlocker[] }> {
  const { data: app, error } = await admin
    .from("applications")
    .select(
      "id,full_name,email,phone,address,city,state,zip,license_number,license_state,license_expiration,vehicle_id,weekly_rent,deposit_amount,contract_start_date,contract_end_date,market_id",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new Error("Driver not found");

  // A LIVE rental is the authority on its own dates once it exists; before
  // activation the agreed contract dates on the application are.
  //
  // "Live" is doing real work here. endRental leaves the row in place with
  // status 'closed' and rewrites end_date to the day it was closed, so taking
  // the newest rental regardless of status meant a returning driver's second
  // agreement was rendered with their first rental's dates — staff set new
  // ones, pressed send, and the contract said something else. Both dates come
  // from the same source, too: mixing a live rental's start with the
  // application's end produces a pair nobody agreed together.
  const { data: rental } = await admin
    .from("rentals")
    .select("start_date,end_date,status")
    .eq("application_id", applicationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // A live rental is authoritative for the dates it actually has. end_date is
  // nullable and activation does not require one — "no end date" means the
  // rental is open-ended, not that the agreed end date is unknown. Reading it
  // as authoritative-and-null left the agreement permanently unissuable, with
  // the only field staff could fill being the one the code had decided to
  // ignore.
  const fromRental = Boolean(rental?.start_date);
  const startDate = fromRental ? rental.start_date : (app.contract_start_date ?? null);
  const endDate = (fromRental ? rental.end_date : null) ?? app.contract_end_date ?? null;

  /*
   * Application intent is NOT contract data.
   *
   * This used to read pickup_date and return_date straight off the
   * application. Both were typed into a date picker on a marketing page by
   * somebody who had not been quoted a rate or shown a car, and the return
   * one in particular was routinely a placeholder — and both then appeared in
   * a signed contract as the rental's dates. pickup_date is still collected
   * and is still useful for scheduling the call; it is not a term of the
   * agreement and does not appear below. Part 1 no longer collects a return
   * date at all.
   */
  const blockers: AgreementBlocker[] = [];
  if (!startDate)
    blockers.push({
      field: "contract_start_date",
      label: "Contract start date",
      why: "The applicant's desired start date is an estimate, not a term. Agree a start date with the driver and record it.",
    });
  if (!endDate)
    blockers.push({
      field: "contract_end_date",
      label: "Scheduled end date",
      why: "The applicant only told us roughly how long they expect to need the vehicle. That cannot become a contractual return date.",
    });
  if (startDate && endDate && endDate <= startDate)
    blockers.push({
      field: "contract_end_date",
      label: "A scheduled end date after the start date",
      why: `The agreement would run from ${startDate} to ${endDate}, which ends on or before it begins.`,
    });
  if (!app.address || !app.zip)
    blockers.push({
      field: "driver_address",
      label: "Driver address",
      why: "The agreement names the driver's address. Confirm it with the driver and enter it on the Payments tab, or ask them to add it in their driver profile — do not guess it.",
    });

  let vehicle: any = null;
  if (app.vehicle_id) {
    const { data: v } = await admin
      .from("vehicles")
      .select("id,year,make,model,trim,color,weekly_rate,deposit")
      .eq("id", app.vehicle_id)
      .maybeSingle();
    vehicle = v ?? null;
  }

  let marketName: string | null = null;
  if (app.market_id) {
    const { data: m } = await admin
      .from("markets")
      .select("name,state")
      .eq("id", app.market_id)
      .maybeSingle();
    marketName = m ? [m.name, m.state].filter(Boolean).join(", ") : null;
  }

  const data: MergeData = {
    ...COMPANY_DEFAULTS,
    driver_name: app.full_name ?? "",
    driver_email: app.email ?? "",
    driver_phone: app.phone ?? "",
    driver_address:
      app.address && app.zip
        ? [app.address, app.city, app.state, app.zip].filter(Boolean).join(", ")
        : "",
    license_number: app.license_number ?? "",
    license_state: app.license_state ?? "",
    license_expiration: app.license_expiration ?? "",
    vehicle: vehicle
      ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ")
      : "",
    vehicle_color: vehicle?.color ?? "",
    vehicle_vin: vehicle?.id ? String(vehicle.id).slice(0, 8).toUpperCase() : "",
    weekly_rate: money(app.weekly_rent ?? vehicle?.weekly_rate),
    deposit_amount: money(app.deposit_amount ?? vehicle?.deposit),
    start_date: startDate ?? "",
    return_date: endDate ?? "",
    market: marketName ?? [app.city, app.state].filter(Boolean).join(", "),
    today: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };
  return { data, app, vehicle, blockers };
}

async function activeTemplateBody(admin: any): Promise<{ id: string | null; body: string }> {
  const { data } = await admin
    .from("agreement_templates")
    .select("id,body")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { id: data?.id ?? null, body: data?.body ?? DEFAULT_AGREEMENT_BODY };
}

// ---------------------------------------------------------------- admin reads

export const getAgreementTemplate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await requireTierFor(context.userId, "manager");
    void actor;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const t = await activeTemplateBody(supabaseAdmin);
    return t;
  });

export const saveAgreementTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ body: z.string().min(50).max(60000) }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireTierFor(context.userId, "owner");
    void actor;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("agreement_templates")
      .update({ is_active: false })
      .eq("is_active", true);
    const { data: row, error } = await supabaseAdmin
      .from("agreement_templates")
      .insert({ name: "Rental Agreement", body: data.body, is_active: true })
      .select("id,body")
      .single();
    if (error) throw new Error(error.message);
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, { action: "template.updated", summary: "Rental agreement template updated", entityType: "agreement_template", entityId: row.id as string });
    return row;
  });

export const listAgreements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<AgreementRow[]> => {
    const actor = await requireTierFor(context.userId, "coordinator");
    void actor;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("agreements")
      .select(
        "id,application_id,vehicle_id,title,body,status,sent_at,viewed_at,signed_at,voided_at,signer_name,signer_email,created_at,document_id,archive_status,archive_error,sha256,email_status,email_error,sms_status,sms_error,company_signer_name,company_signer_title",
      )
      .eq("application_id", data.applicationId)
      .order("created_at", { ascending: false });
    const list = (rows ?? []) as any[];
    const ids = list.map((r) => r.id);
    const byId = new Map<string, { at: string; label: string }[]>();
    if (ids.length) {
      const { data: events } = await supabaseAdmin
        .from("audit_log")
        .select("entity_id,action,created_at")
        .eq("entity_type", "esign_document")
        .in("entity_id", ids)
        .order("created_at", { ascending: true });
      for (const e of events ?? []) {
        const label = TIMELINE_LABELS[e.action as string];
        if (!label) continue;
        const arr = byId.get(e.entity_id as string) ?? [];
        arr.push({ at: e.created_at as string, label });
        byId.set(e.entity_id as string, arr);
      }
    }
    return list.map((r) => ({ ...r, timeline: byId.get(r.id) ?? [] })) as AgreementRow[];
  });

export const previewAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireTierFor(context.userId, "manager");
    void actor;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: merge, app, blockers } = await buildMergeData(supabaseAdmin, data.applicationId);
    const tpl = await activeTemplateBody(supabaseAdmin);
    const missing = Object.entries(merge)
      .filter(([, v]) => !v || !String(v).trim())
      .map(([k]) => k);
    return {
      // Withheld while anything blocks the send: a preview the staff member
      // can edit and press Send on reads as permission to proceed, and the
      // blanks in it are exactly what must not reach a signature.
      body: blockers.length ? null : renderTemplate(tpl.body, merge),
      merge,
      missing,
      // Everything in `missing` is worth a staff member's attention; these are
      // the ones that stop the agreement being sent at all.
      blockers,
      email: (app.email as string | null) ?? null,
      name: (app.full_name as string | null) ?? null,
    };
  });

// ---------------------------------------------------------------- admin writes

/**
 * Build, store and email a rental agreement.
 *
 * Extracted from the sendAgreement server function so approval can send the
 * agreement automatically without going back through the HTTP layer. Not a
 * server function itself — callers are already authenticated and have done
 * their own staff check.
 */
export async function issueAgreement(
  admin: any,
  applicationId: string,
  opts: { body?: string; createdBy?: string | null } = {},
): Promise<{ id: string; url: string; delivery: { email: string; sms: string; delivered: boolean } }> {
  const { data: merge, app, blockers } = await buildMergeData(admin, applicationId);
  if (!app.email) throw new Error("This driver has no email on file");
  // A contract with a guessed start date or a blank address is not a contract
  // worth sending, and an applicant who signs one has signed terms nobody
  // agreed with them.
  if (blockers.length)
    throw new Error(
      `This agreement is missing ${blockers.map((b) => b.label.toLowerCase()).join(" and ")}. ${blockers[0].why}`,
    );
  const tpl = await activeTemplateBody(admin);

  /*
   * The staff member's edited text is honoured — but not if it still carries
   * the blanks renderTemplate leaves for missing merge fields.
   *
   * The guard above checks the row as it stands now; the body being stored is
   * whatever the preview produced, possibly minutes earlier and before the
   * missing dates were filled in. Those two can disagree, and when they do the
   * applicant signs a contract whose start date, return date and address read
   * "__________" while merge_data records the right ones. Re-render instead.
   */
  const rendered = renderTemplate(tpl.body, merge);
  const body = opts.body && !opts.body.includes(BLANK) ? opts.body : rendered;

  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  const { getCompanySigner } = await import("@/lib/esign.server");
  const company = await getCompanySigner(admin);
  const { data: row, error } = await admin
    .from("agreements")
    .insert({
      source: "rental",
      company_signer_name: company.name,
      company_signer_title: company.title,
      application_id: applicationId,
      vehicle_id: app.vehicle_id ?? null,
      template_id: tpl.id,
      body,
      merge_data: merge,
      status: "sent",
      token_hash: tokenHash,
      token_expires_at: expires,
      sent_at: new Date().toISOString(),
      signer_email: app.email,
      created_by: opts.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await admin.from("esign_recipients").insert({
    document_id: row.id,
    name: (app.full_name as string | null) ?? null,
    email: app.email,
    phone: (app.phone as string | null) ?? null,
    role: "signer",
    status: "sent",
    sent_at: new Date().toISOString(),
    token_hash: tokenHash,
    token_expires_at: expires,
  });
  {
    const { logAudit } = await import("@/lib/audit.server");
    const actor = opts.createdBy ? await (await import("@/lib/roles.server")).getActor(opts.createdBy) : null;
    await logAudit(actor, { action: "document.created", summary: "Rental agreement created", entityType: "esign_document", entityId: row.id as string });
    await logAudit(actor, { action: "document.sent", summary: "Rental agreement sent for signature", entityType: "esign_document", entityId: row.id as string });
  }

  const url = `${SITE_URL()}/sign/${token}`;
  const { deliverSigningLink } = await import("@/lib/esign.server");
  const delivery = await deliverSigningLink(admin, {
    id: row.id as string,
    url,
    email: app.email as string,
    phone: (app.phone as string | null) ?? null,
    name: (app.full_name as string | null) ?? null,
    vehicle: merge.vehicle || null,
    applicationId,
    actor: opts.createdBy ? await (await import("@/lib/roles.server")).getActor(opts.createdBy) : null,
  });

  return { id: row.id as string, url, delivery };
}

/**
 * Is there already an agreement this applicant can act on?
 * Used to keep approval from sending a second copy on every status change.
 */
export async function hasOpenOrSignedAgreement(
  admin: any,
  applicationId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("agreements")
    .select("id")
    .eq("application_id", applicationId)
    .in("status", ["sent", "viewed", "signed"])
    .limit(1);
  return !!(data && data.length);
}

export const sendAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        body: z.string().min(50).max(80000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireTierFor(context.userId, "manager");
    void actor;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return issueAgreement(supabaseAdmin, data.applicationId, {
      body: data.body,
      createdBy: context.userId,
    });
  });

/**
 * Retry Delivery and Resend are the same operation, on purpose. Only a hash of
 * the signing token is stored, so the current link can't be re-sent; every
 * delivery retry rotates the token: the old link dies immediately, the new one
 * becomes canonical on the same agreement row (no duplicate document), and the
 * audit history is kept. The company signer snapshot is not touched.
 */
export const resendAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ agreementId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireTierFor(context.userId, "manager");
    void actor;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ag } = await supabaseAdmin
      .from("agreements")
      .select("id,status,signer_email,merge_data,application_id")
      .eq("id", data.agreementId)
      .maybeSingle();
    if (!ag) throw new Error("Agreement not found");
    if (ag.status === "signed" || ag.status === "voided")
      throw new Error("This agreement can no longer be sent");

    const token = randomToken();
    const tokenHash = await hashToken(token);
    const exp = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    // Conditional: never resurrect a signing/signed/voided document. The new
    // hash replaces the old one, so the prior link stops working.
    const { data: upd } = await supabaseAdmin
      .from("agreements")
      .update({ token_hash: tokenHash, token_expires_at: exp, sent_at: new Date().toISOString(), status: "sent" })
      .eq("id", ag.id)
      .in("status", ["draft", "sent", "viewed"])
      .select("id");
    if (!upd?.length) throw new Error("This agreement can no longer be sent");
    await supabaseAdmin
      .from("esign_recipients")
      .update({ token_hash: tokenHash, token_expires_at: exp, sent_at: new Date().toISOString(), status: "sent" })
      .eq("document_id", ag.id)
      .eq("role", "signer");
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, { action: "document.resent", summary: "Signing link reissued", entityType: "esign_document", entityId: ag.id as string });

    const url = `${SITE_URL()}/sign/${token}`;
    const merge = (ag.merge_data ?? {}) as MergeData;
    let phone: string | null = null;
    if (ag.application_id) {
      const { data: app } = await supabaseAdmin.from("applications").select("phone").eq("id", ag.application_id).maybeSingle();
      phone = (app?.phone as string | null) ?? null;
    }
    const { deliverSigningLink } = await import("@/lib/esign.server");
    const delivery = await deliverSigningLink(supabaseAdmin, {
      id: ag.id as string,
      url,
      email: (ag.signer_email as string | null) ?? null,
      phone,
      name: merge.driver_name ?? null,
      vehicle: merge.vehicle || null,
      applicationId: (ag.application_id as string | null) ?? null,
      actor,
    });
    return { ok: true, url, delivery };
  });

export const voidAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ agreementId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireTierFor(context.userId, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { voidDocument } = await import("@/lib/esign.server");
    const res = await voidDocument(supabaseAdmin, data.agreementId, actor);
    if (res === "signed" || res === "signing")
      throw new Error("This agreement has already been signed and cannot be voided");
    if (res === "invalid") throw new Error("Agreement not found");
    return { ok: true };
  });

export const retryAgreementArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ agreementId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireTierFor(context.userId, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { retryArchive } = await import("@/lib/esign.server");
    const ok = await retryArchive(supabaseAdmin, data.agreementId, actor);
    if (!ok) throw new Error("Archiving failed again. The error is recorded on the agreement.");
    return { ok: true };
  });

/** Short-lived download link for the completed PDF. Staff, or the renter it belongs to. */
export const getAgreementPdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ agreementId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // RLS decides: staff policy or the driver-owns-application policy.
    const { data: ag } = await context.supabase
      .from("agreements")
      .select("id,status,document_id")
      .eq("id", data.agreementId)
      .maybeSingle();
    if (!ag || ag.status !== "signed" || !ag.document_id) throw new Error("No completed document yet");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("storage_bucket,storage_path")
      .eq("id", ag.document_id)
      .maybeSingle();
    if (!doc) throw new Error("Document not found");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(doc.storage_bucket as string)
      .createSignedUrl(doc.storage_path as string, 300);
    if (error || !signed) throw new Error("Could not create download link");
    return { url: signed.signedUrl };
  });

// ------------------------------------------------------------- public signing

export type SigningView = {
  id: string;
  title: string;
  body: string;
  status: string;
  signer_name: string | null;
  signed_at: string | null;
  driver_name: string | null;
  company_signer_name: string;
  expired?: boolean;
} | null;

export const getAgreementByToken = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(20).max(200) }).parse(d))
  .handler(async ({ data }): Promise<SigningView> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hash = await hashToken(data.token);
    const { data: ag } = await supabaseAdmin
      .from("agreements")
      .select(
        "id,title,body,status,signer_name,signed_at,merge_data,company_signer_name,token_expires_at,viewed_at",
      )
      .eq("token_hash", hash)
      .maybeSingle();
    if (!ag) return null;
    const merge = (ag.merge_data ?? {}) as MergeData;
    const base = {
      id: ag.id as string,
      title: ag.title as string,
      body: "",
      status: ag.status as string,
      signer_name: ag.signer_name as string | null,
      signed_at: ag.signed_at as string | null,
      driver_name: merge.driver_name ?? null,
      company_signer_name: ag.company_signer_name as string,
    };
    if (ag.status === "voided") return null;
    if (ag.token_expires_at && new Date(ag.token_expires_at as string).getTime() < Date.now()) {
      return { ...base, expired: true };
    }
    if (ag.status === "sent" && !ag.viewed_at) {
      const now = new Date().toISOString();
      const { data: upd } = await supabaseAdmin
        .from("agreements")
        .update({ status: "viewed", viewed_at: now })
        .eq("id", ag.id)
        .eq("status", "sent")
        .select("id");
      if (upd?.length) {
        await supabaseAdmin.from("esign_recipients").update({ status: "viewed", viewed_at: now }).eq("document_id", ag.id).eq("role", "signer");
        const { logAudit } = await import("@/lib/audit.server");
        await logAudit(null, { action: "document.viewed", summary: "Signer opened the document", entityType: "esign_document", entityId: ag.id as string });
      }
    }
    return {
      ...base,
      body: ag.body as string,
      status: ag.status === "sent" ? "viewed" : (ag.status as string),
    };
  });

/** Server-side truth: the agreement's application is linked to a sign-in account. */
async function agreementPortalAccess(admin: any, applicationId: string | null): Promise<boolean> {
  if (!applicationId) return false;
  const { data } = await admin.from("applications").select("user_id").eq("id", applicationId).maybeSingle();
  return !!data?.user_id;
}

async function sendSignedEmails(admin: any, id: string, signerName: string) {
  const { data: ag } = await admin
    .from("agreements")
    .select("application_id,signer_email,merge_data")
    .eq("id", id)
    .maybeSingle();
  if (!ag) return;
  const merge = (ag.merge_data ?? {}) as MergeData;
  try {
    const { sendAgreementSignedEmail, sendAgreementSignedOpsEmail } = await import("@/lib/email.server");
    if (ag.signer_email) {
      await sendAgreementSignedEmail({
        to: ag.signer_email as string,
        firstName: merge.driver_name ?? signerName,
        vehicle: merge.vehicle || null,
        portalAccess: await agreementPortalAccess(admin, ag.application_id as string | null),
      });
    }
    await sendAgreementSignedOpsEmail({
      driverName: signerName,
      applicationId: ag.application_id as string,
      vehicle: merge.vehicle || null,
    });
  } catch (e) {
    console.error("[agreement] signed emails failed", e);
  }
}

function claimError(result: string): never {
  if (result === "voided") throw new Error("This agreement was cancelled");
  if (result === "expired") throw new Error("This signing link has expired — please ask us to resend it");
  if (result === "in_progress") throw new Error("Your signature is being recorded — refresh in a moment");
  throw new Error("This signing link is no longer valid");
}

export const signAgreement = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(20).max(200),
        signerName: z.string().trim().min(2).max(120),
        agree: z.literal(true),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { completeSigning, requestMeta } = await import("@/lib/esign.server");
    const hash = await hashToken(data.token);
    const { data: ag } = await supabaseAdmin
      .from("agreements")
      .select("id,application_id")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!ag) throw new Error("This signing link is no longer valid");
    const meta = requestMeta(getRequest());
    const { result } = await completeSigning(supabaseAdmin, {
      id: ag.id as string,
      tokenHash: hash,
      signerName: data.signerName,
      ip: meta.ip,
      userAgent: meta.userAgent,
      authMethod: "email_link",
    });
    const portalAccess = await agreementPortalAccess(supabaseAdmin, ag.application_id as string | null);
    if (result === "already_signed") return { ok: true, alreadySigned: true, portalAccess };
    if (result !== "won") claimError(result);
    await sendSignedEmails(supabaseAdmin, ag.id as string, data.signerName);
    return { ok: true, alreadySigned: false, portalAccess };
  });

// ------------------------------------------------------------- driver portal

export const getMyAgreements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    type Mine = {
      id: string;
      title: string;
      status: string;
      signed_at: string | null;
      sent_at: string | null;
      body: string;
      document_id: string | null;
    };
    const { data: apps } = await context.supabase
      .from("applications")
      .select("id")
      .eq("user_id", context.userId);
    const ids = (apps ?? []).map((a: any) => a.id);
    if (!ids.length) return [] as Mine[];
    const { data } = await context.supabase
      .from("agreements")
      .select("id,title,status,signed_at,sent_at,body,document_id")
      .in("application_id", ids)
      .order("created_at", { ascending: false });
    return (data ?? []) as Mine[];
  });

export const signMyAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        agreementId: z.string().uuid(),
        signerName: z.string().trim().min(2).max(120),
        agree: z.literal(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Ownership through the driver's own RLS-scoped client — an id belonging
    // to someone else simply isn't found. The emailed link is left intact.
    const { data: own } = await context.supabase
      .from("agreements")
      .select("id,status,application_id")
      .eq("id", data.agreementId)
      .maybeSingle();
    if (!own) throw new Error("Agreement not found");
    const { data: mine } = await context.supabase
      .from("applications")
      .select("id")
      .eq("id", own.application_id as string)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!mine) throw new Error("Agreement not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { completeSigning, requestMeta } = await import("@/lib/esign.server");
    const meta = requestMeta(getRequest());
    const { result } = await completeSigning(supabaseAdmin, {
      id: data.agreementId,
      tokenHash: null,
      signerName: data.signerName,
      ip: meta.ip,
      userAgent: meta.userAgent,
      authMethod: "portal",
    });
    if (result === "already_signed") return { ok: true, alreadySigned: true };
    if (result !== "won") claimError(result);
    await sendSignedEmails(supabaseAdmin, data.agreementId, data.signerName);
    return { ok: true, alreadySigned: false };
  });
