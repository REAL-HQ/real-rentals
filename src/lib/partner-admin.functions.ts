import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";

export type StaffSubmission = {
  id: string;
  createdAt: string;
  status: string;
  fullName: string;
  email: string;
  phone: string;
  businessName: string | null;
  address: string | null;
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  color: string | null;
  plate: string | null;
  mileage: number | null;
  titleStatus: string | null;
  lienStatus: string | null;
  registrationState: string | null;
  currentlyInsured: boolean | null;
  condition: string | null;
  message: string | null;
  smsConsent: boolean;
  photos: Array<{ path: string; url: string | null }>;
  hasRegistration: boolean;
  hasIdDocument: boolean;
  partnerId: string | null;
  listedVehicleId: string | null;
};

/** Manager+: every /partners submission with signed photo previews (10 minutes). */
export const listPartnerSubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ submissions: StaffSubmission[]; schema: "v2" | "legacy" }> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { columnMissing } = await import("@/lib/partner-intake.server");
    let schema: "v2" | "legacy" = "v2";
    let r = await supabaseAdmin.from("fleet_owner_submissions").select("*").order("created_at", { ascending: false }).limit(200);
    if (r.error && columnMissing(r.error)) schema = "legacy";
    if (r.error && schema === "v2") throw new Error(r.error.message);
    const rows = (r.data ?? []) as any[];
    if (rows.length && !("idempotency_key" in rows[0])) schema = "legacy";
    const out: StaffSubmission[] = [];
    for (const s of rows) {
      const paths: string[] = (s.photo_urls ?? []).slice(0, 12);
      const signed = paths.length
        ? await supabaseAdmin.storage.from("owner-vehicle-photos").createSignedUrls(paths, 600)
        : { data: [] as any[] };
      const urlByPath = new Map<string, string | null>((signed.data ?? []).map((x: any) => [x.path, x.signedUrl ?? null]));
      const addr = [s.address_line1, s.address_line2, [s.city, s.state].filter(Boolean).join(", "), s.postal_code].filter(Boolean).join(" ");
      out.push({
        id: s.id,
        createdAt: s.created_at,
        status: s.status ?? "new",
        fullName: s.full_name,
        email: s.email,
        phone: s.phone,
        businessName: s.business_name ?? null,
        address: addr || null,
        vin: s.vin,
        year: s.year,
        make: s.make,
        model: s.model,
        trim: s.trim ?? null,
        color: s.color ?? null,
        plate: s.license_plate ?? null,
        mileage: s.mileage ?? null,
        titleStatus: s.title_status ?? null,
        lienStatus: s.lien_status ?? null,
        registrationState: s.registration_state ?? null,
        currentlyInsured: s.currently_insured ?? null,
        condition: s.condition ?? null,
        message: s.message ?? null,
        smsConsent: !!s.sms_consent_at,
        photos: paths.map((p) => ({ path: p, url: urlByPath.get(p) ?? null })),
        hasRegistration: !!s.registration_path,
        hasIdDocument: !!s.id_document_path,
        partnerId: s.partner_id ?? null,
        listedVehicleId: s.listed_vehicle_id ?? null,
      });
    }
    return { submissions: out, schema };
  });

/** Manager+: open a submission's registration or ID (60-second signed URL, audited). */
export const getSubmissionDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ submissionId: z.string().uuid(), kind: z.enum(["registration", "id_document"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s } = await supabaseAdmin.from("fleet_owner_submissions").select("id,registration_path,id_document_path").eq("id", data.submissionId).maybeSingle();
    const path = data.kind === "registration" ? (s as any)?.registration_path : (s as any)?.id_document_path;
    const { isIntakePathFor, PARTNER_DOCS_BUCKET } = await import("@/lib/partner-portal");
    if (!path || !isIntakePathFor(data.submissionId, data.kind, path)) throw new Error("Not uploaded");
    const { data: signed, error } = await supabaseAdmin.storage.from(PARTNER_DOCS_BUCKET).createSignedUrl(path, 60);
    if (error || !signed) throw new Error("Could not open the file");
    await logAudit(actor, { action: "partner.submission.document_opened", summary: `Opened ${data.kind === "registration" ? "registration" : "ID"} on a partner submission`, entityType: "fleet_owner_submission", entityId: data.submissionId, metadata: { kind: data.kind } });
    return { url: signed.signedUrl as string };
  });

/**
 * Manager+: the one-button decision. Atomically activates the partner,
 * creates (or links) the vehicle, and marks the submission approved via
 * approve_partner_submission. With listNow the car goes in as Available at the
 * weekly rate staff typed (never invented), and the photos staff ticked are
 * copied into the vehicle gallery and published as the listing photos.
 */
export const approvePartnerSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        submissionId: z.string().uuid(),
        listNow: z.boolean(),
        weeklyRate: z.number().positive().max(5000).nullable(),
        revenueSplitPct: z.number().gt(0).lt(100),
        publishPhotoPaths: z.array(z.string().max(300)).max(12).default([]),
      })
      .refine((d) => !d.listNow || (d.weeklyRate ?? 0) > 0, { message: "Enter the weekly rate to list the car." })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await (supabaseAdmin as any).rpc("approve_partner_submission", {
      _submission_id: data.submissionId,
      _actor: actor.userId,
      _weekly_rate: data.weeklyRate,
      _revenue_split_pct: data.revenueSplitPct,
      _list_now: data.listNow,
    });
    if (error) {
      const { approvalErrorMessage } = await import("@/lib/partner-admin.server");
      throw new Error(approvalErrorMessage(error));
    }
    const vehicleId = String(res?.vehicle_id ?? "");
    const partnerId = String(res?.partner_id ?? "");
    const { copySubmissionPhotos } = await import("@/lib/partner-admin.server");
    const photos = vehicleId
      ? await copySubmissionPhotos(supabaseAdmin, { submissionId: data.submissionId, vehicleId, paths: data.publishPhotoPaths, publish: data.listNow, actorId: actor.userId })
      : { copied: 0, published: 0, failed: 0 };
    await logAudit(actor, {
      action: "partner.submission.listed",
      summary: data.listNow ? "Listed a partner car and activated the partner" : "Approved a partner car (not listed yet) and activated the partner",
      entityType: "vehicle",
      entityId: vehicleId,
      metadata: { submission_id: data.submissionId, partner_id: partnerId, photos },
    });
    return { ok: true, vehicleId, partnerId, status: String(res?.status ?? ""), photos };
  });

export const declinePartnerSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ submissionId: z.string().uuid(), reason: z.string().trim().max(500).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { columnMissing } = await import("@/lib/partner-intake.server");
    let up = await supabaseAdmin.from("fleet_owner_submissions").update({ status: "declined", decided_at: new Date().toISOString(), decided_by: actor.userId, decline_reason: data.reason } as any).eq("id", data.submissionId);
    if (up.error && columnMissing(up.error)) up = await supabaseAdmin.from("fleet_owner_submissions").update({ status: "declined" }).eq("id", data.submissionId);
    if (up.error) throw new Error(up.error.message);
    await logAudit(actor, { action: "partner.submission.declined", summary: "Declined a partner submission", entityType: "fleet_owner_submission", entityId: data.submissionId, metadata: { reason: data.reason } });
    return { ok: true };
  });

/** Manager+: record a payout to a partner, optionally with a receipt (signed upload). */
export const recordPartnerPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        partnerId: z.string().uuid(),
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        grossRent: z.number().min(0).max(1_000_000),
        partnerShare: z.number().min(0).max(1_000_000),
        expenses: z.number().min(0).max(1_000_000),
        net: z.number().min(-1_000_000).max(1_000_000),
        paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        method: z.enum(["ach", "stripe_transfer", "zelle", "check", "other"]).nullable(),
        reference: z.string().trim().max(120).nullable(),
        receipt: z.object({ name: z.string().max(200), type: z.string().max(100), size: z.number().int().min(1).max(25 * 1024 * 1024) }).nullable(),
      })
      .refine((d) => d.periodEnd >= d.periodStart, { message: "Period end is before period start." })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("payouts")
      .insert({
        partner_id: data.partnerId,
        period_start: data.periodStart,
        period_end: data.periodEnd,
        gross_rent: data.grossRent,
        partner_share: data.partnerShare,
        maintenance_share: data.expenses,
        expenses_total: data.expenses,
        net_amount: data.net,
        status: data.paidAt ? "paid" : "pending",
        paid_at: data.paidAt ? `${data.paidAt}T12:00:00-05:00` : null,
        method: data.method,
        reference: data.reference,
      } as any)
      .select("id")
      .single();
    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "A payout for that period already exists." : error.message);
    let upload: { path: string; token: string } | null = null;
    if (data.receipt) {
      const { intakeFileProblem, payoutReceiptPath, safeExt, PARTNER_DOCS_BUCKET } = await import("@/lib/partner-portal");
      const problem = intakeFileProblem({ kind: "registration", ...data.receipt });
      if (problem) throw new Error(problem);
      const path = payoutReceiptPath(data.partnerId, row.id, crypto.randomUUID(), safeExt(data.receipt.name, data.receipt.type));
      const s = await supabaseAdmin.storage.from(PARTNER_DOCS_BUCKET).createSignedUploadUrl(path);
      if (s.error || !s.data) throw new Error("Payout saved, but the receipt upload could not start.");
      upload = { path, token: s.data.token };
    }
    await logAudit(actor, { action: "partner.payout.recorded", summary: `Recorded a partner payout of $${data.net.toFixed(2)}`, entityType: "partner", entityId: data.partnerId, metadata: { payout_id: row.id, period: [data.periodStart, data.periodEnd] } });
    return { ok: true, payoutId: row.id as string, upload };
  });

export const attachPayoutReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ payoutId: z.string().uuid(), path: z.string().max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin.from("payouts").select("id,partner_id").eq("id", data.payoutId).maybeSingle();
    const { isPayoutReceiptPathFor } = await import("@/lib/partner-portal");
    if (!p || !isPayoutReceiptPathFor(p.partner_id, data.path) || !data.path.includes(`/payouts/${data.payoutId}-`)) throw new Error("Forbidden");
    const { error } = await supabaseAdmin.from("payouts").update({ receipt_path: data.path } as any).eq("id", data.payoutId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
