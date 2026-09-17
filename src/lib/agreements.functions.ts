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
};

const SITE_URL = () => process.env.PUBLIC_SITE_URL || "https://drivereal.com";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function money(v: unknown): string {
  const n = Number(v ?? 0);
  if (!n) return "";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

async function buildMergeData(admin: any, applicationId: string): Promise<{ data: MergeData; app: any; vehicle: any }> {
  const { data: app, error } = await admin
    .from("applications")
    .select(
      "id,full_name,email,phone,address,city,state,zip,license_number,license_state,license_expiration,vehicle_id,weekly_rent,deposit_amount,pickup_date,return_date,market_id",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new Error("Driver not found");

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
    const { data: m } = await admin.from("markets").select("name,state").eq("id", app.market_id).maybeSingle();
    marketName = m ? [m.name, m.state].filter(Boolean).join(", ") : null;
  }

  const data: MergeData = {
    ...COMPANY_DEFAULTS,
    driver_name: app.full_name ?? "",
    driver_email: app.email ?? "",
    driver_phone: app.phone ?? "",
    driver_address: [app.address, app.city, app.state, app.zip].filter(Boolean).join(", "),
    license_number: app.license_number ?? "",
    license_state: app.license_state ?? "",
    license_expiration: app.license_expiration ?? "",
    vehicle: vehicle ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") : "",
    vehicle_color: vehicle?.color ?? "",
    vehicle_vin: vehicle?.id ? String(vehicle.id).slice(0, 8).toUpperCase() : "",
    weekly_rate: money(app.weekly_rent ?? vehicle?.weekly_rate),
    deposit_amount: money(app.deposit_amount ?? vehicle?.deposit),
    start_date: app.pickup_date ?? "",
    return_date: app.return_date ?? "",
    market: marketName ?? [app.city, app.state].filter(Boolean).join(", "),
    today: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  };
  return { data, app, vehicle };
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
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const t = await activeTemplateBody(supabaseAdmin);
    return t;
  });

export const saveAgreementTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ body: z.string().min(50).max(60000) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("agreement_templates").update({ is_active: false }).eq("is_active", true);
    const { data: row, error } = await supabaseAdmin
      .from("agreement_templates")
      .insert({ name: "Rental Agreement", body: data.body, is_active: true })
      .select("id,body")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listAgreements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<AgreementRow[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("agreements")
      .select(
        "id,application_id,vehicle_id,title,body,status,sent_at,viewed_at,signed_at,voided_at,signer_name,signer_email,created_at,document_id",
      )
      .eq("application_id", data.applicationId)
      .order("created_at", { ascending: false });
    return (rows ?? []) as AgreementRow[];
  });

export const previewAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: merge, app } = await buildMergeData(supabaseAdmin, data.applicationId);
    const tpl = await activeTemplateBody(supabaseAdmin);
    const missing = Object.entries(merge)
      .filter(([, v]) => !v || !String(v).trim())
      .map(([k]) => k);
    return {
      body: renderTemplate(tpl.body, merge),
      merge,
      missing,
      email: (app.email as string | null) ?? null,
      name: (app.full_name as string | null) ?? null,
    };
  });

// ---------------------------------------------------------------- admin writes

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
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: merge, app } = await buildMergeData(supabaseAdmin, data.applicationId);
    if (!app.email) throw new Error("This driver has no email on file");
    const tpl = await activeTemplateBody(supabaseAdmin);
    const body = data.body ?? renderTemplate(tpl.body, merge);

    const token = randomToken();
    const tokenHash = await hashToken(token);
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    const { data: row, error } = await supabaseAdmin
      .from("agreements")
      .insert({
        application_id: data.applicationId,
        vehicle_id: app.vehicle_id ?? null,
        template_id: tpl.id,
        body,
        merge_data: merge,
        status: "sent",
        token_hash: tokenHash,
        token_expires_at: expires,
        sent_at: new Date().toISOString(),
        signer_email: app.email,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const url = `${SITE_URL()}/sign/${token}`;
    try {
      const { sendAgreementEmail } = await import("@/lib/email.server");
      await sendAgreementEmail({
        to: app.email as string,
        firstName: (app.full_name as string | null) ?? null,
        url,
        vehicle: merge.vehicle || null,
      });
    } catch (e) {
      console.error("[agreement] email failed", e);
    }
    return { id: row.id as string, url };
  });

export const resendAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ agreementId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ag } = await supabaseAdmin
      .from("agreements")
      .select("id,status,signer_email,merge_data,application_id")
      .eq("id", data.agreementId)
      .maybeSingle();
    if (!ag) throw new Error("Agreement not found");
    if (ag.status === "signed" || ag.status === "voided") throw new Error("This agreement can no longer be sent");

    const token = randomToken();
    const tokenHash = await hashToken(token);
    await supabaseAdmin
      .from("agreements")
      .update({
        token_hash: tokenHash,
        token_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        sent_at: new Date().toISOString(),
        status: "sent",
      })
      .eq("id", ag.id);

    const url = `${SITE_URL()}/sign/${token}`;
    const merge = (ag.merge_data ?? {}) as MergeData;
    if (ag.signer_email) {
      try {
        const { sendAgreementEmail } = await import("@/lib/email.server");
        await sendAgreementEmail({
          to: ag.signer_email as string,
          firstName: merge.driver_name ?? null,
          url,
          vehicle: merge.vehicle || null,
        });
      } catch (e) {
        console.error("[agreement] resend email failed", e);
      }
    }
    return { ok: true, url };
  });

export const voidAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ agreementId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("agreements")
      .update({ status: "voided", voided_at: new Date().toISOString(), token_hash: null })
      .eq("id", data.agreementId)
      .neq("status", "signed");
    if (error) throw new Error(error.message);
    return { ok: true };
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
} | null;

export const getAgreementByToken = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(20).max(200) }).parse(d))
  .handler(async ({ data }): Promise<SigningView> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hash = await hashToken(data.token);
    const { data: ag } = await supabaseAdmin
      .from("agreements")
      .select("id,title,body,status,signer_name,signed_at,merge_data,company_signer_name,token_expires_at,viewed_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!ag) return null;
    if (ag.token_expires_at && new Date(ag.token_expires_at as string).getTime() < Date.now() && ag.status !== "signed") {
      return null;
    }
    if (ag.status === "sent" && !ag.viewed_at) {
      await supabaseAdmin
        .from("agreements")
        .update({ status: "viewed", viewed_at: new Date().toISOString() })
        .eq("id", ag.id);
    }
    const merge = (ag.merge_data ?? {}) as MergeData;
    return {
      id: ag.id as string,
      title: ag.title as string,
      body: ag.body as string,
      status: ag.status === "sent" ? "viewed" : (ag.status as string),
      signer_name: ag.signer_name as string | null,
      signed_at: ag.signed_at as string | null,
      driver_name: merge.driver_name ?? null,
      company_signer_name: ag.company_signer_name as string,
    };
  });

function signedHtml(args: {
  title: string;
  body: string;
  signerName: string;
  signedAt: string;
  companySigner: string;
  ip: string | null;
  agent: string | null;
  id: string;
}): string {
  const esc = (v: unknown) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(args.title)}</title>
<style>body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#111;line-height:1.6}
pre{white-space:pre-wrap;font-family:inherit;font-size:14px}
.sig{margin-top:32px;border-top:2px solid #111;padding-top:18px;font-size:13px}
.meta{margin-top:22px;color:#777;font-size:11px}</style></head>
<body><pre>${esc(args.body)}</pre>
<div class="sig">
<p><strong>Renter signature:</strong> /s/ ${esc(args.signerName)}<br>Signed electronically on ${esc(args.signedAt)}</p>
<p><strong>Company signature:</strong> /s/ ${esc(args.companySigner)}</p>
</div>
<div class="meta">Agreement ID ${esc(args.id)} · IP ${esc(args.ip ?? "n/a")} · ${esc(args.agent ?? "n/a")}</div>
</body></html>`;
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
    const hash = await hashToken(data.token);
    const { data: ag } = await supabaseAdmin
      .from("agreements")
      .select("id,application_id,title,body,status,company_signer_name,signer_email,merge_data,token_expires_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!ag) throw new Error("This signing link is no longer valid");
    if (ag.status === "signed") return { ok: true, alreadySigned: true };
    if (ag.status === "voided") throw new Error("This agreement was cancelled");
    if (ag.token_expires_at && new Date(ag.token_expires_at as string).getTime() < Date.now()) {
      throw new Error("This signing link has expired — please ask us to resend it");
    }

    const req = getRequest();
    const ip =
      req?.headers.get("cf-connecting-ip") ||
      req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null;
    const agent = req?.headers.get("user-agent") ?? null;
    const signedAt = new Date().toISOString();

    const html = signedHtml({
      title: ag.title as string,
      body: ag.body as string,
      signerName: data.signerName,
      signedAt: new Date(signedAt).toLocaleString("en-US"),
      companySigner: (ag.company_signer_name as string) || "REAL RENTALS",
      ip,
      agent,
      id: ag.id as string,
    });

    const path = `${ag.application_id}/agreement-${ag.id}.html`;
    let documentId: string | null = null;
    const up = await supabaseAdmin.storage
      .from("rental-agreements")
      .upload(path, new Blob([html], { type: "text/html" }), { contentType: "text/html", upsert: true });
    if (up.error) {
      console.error("[agreement] archive upload failed", up.error);
    } else {
      const { data: doc, error: docErr } = await supabaseAdmin
        .from("documents")
        .insert({
          driver_id: ag.application_id,
          kind: "rental_agreement",
          category: "agreement",
          label: "Signed rental agreement",
          storage_bucket: "rental-agreements",
          storage_path: path,
          visibility: ["driver", "admin"],
          file_name: `signed-agreement-${(ag.id as string).slice(0, 8)}.html`,
          mime_type: "text/html",
          uploaded_by_role: "system",
        })
        .select("id")
        .single();
      if (docErr) console.error("[agreement] archive doc row failed", docErr);
      documentId = (doc?.id as string) ?? null;
    }

    await supabaseAdmin
      .from("agreements")
      .update({
        status: "signed",
        signed_at: signedAt,
        signer_name: data.signerName,
        signer_ip: ip,
        signer_user_agent: agent,
        token_hash: null,
        document_id: documentId,
      })
      .eq("id", ag.id);

    const merge = (ag.merge_data ?? {}) as MergeData;
    try {
      const { sendAgreementSignedEmail, sendAgreementSignedOpsEmail } = await import("@/lib/email.server");
      if (ag.signer_email) {
        await sendAgreementSignedEmail({
          to: ag.signer_email as string,
          firstName: merge.driver_name ?? data.signerName,
          vehicle: merge.vehicle || null,
        });
      }
      await sendAgreementSignedOpsEmail({
        driverName: data.signerName,
        applicationId: ag.application_id as string,
        vehicle: merge.vehicle || null,
      });
    } catch (e) {
      console.error("[agreement] signed emails failed", e);
    }

    return { ok: true, alreadySigned: false };
  });

// ------------------------------------------------------------- driver portal

export const getMyAgreements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: apps } = await context.supabase
      .from("applications")
      .select("id")
      .eq("user_id", context.userId);
    const ids = (apps ?? []).map((a: any) => a.id);
    if (!ids.length) return [] as Array<{ id: string; title: string; status: string; signed_at: string | null; sent_at: string | null; body: string }>;
    const { data } = await context.supabase
      .from("agreements")
      .select("id,title,status,signed_at,sent_at,body")
      .in("application_id", ids)
      .order("created_at", { ascending: false });
    return (data ?? []) as Array<{
      id: string;
      title: string;
      status: string;
      signed_at: string | null;
      sent_at: string | null;
      body: string;
    }>;
  });

export const signMyAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ agreementId: z.string().uuid(), signerName: z.string().trim().min(2).max(120), agree: z.literal(true) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Confirm ownership through RLS before using the privileged path.
    const { data: own } = await context.supabase
      .from("agreements")
      .select("id,status")
      .eq("id", data.agreementId)
      .maybeSingle();
    if (!own) throw new Error("Agreement not found");
    if (own.status === "signed") return { ok: true, alreadySigned: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token = randomToken();
    const hash = await hashToken(token);
    await supabaseAdmin
      .from("agreements")
      .update({ token_hash: hash, token_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
      .eq("id", data.agreementId);
    return signAgreement({ data: { token, signerName: data.signerName, agree: true } });
  });
