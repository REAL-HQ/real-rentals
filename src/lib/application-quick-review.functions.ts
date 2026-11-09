import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  applicationQuickReview,
  assertApplicationQuickReviewEnabled,
  isPendingReviewStatus,
  type QuickReview,
  type QuickReviewAgreement,
  type QuickReviewDocumentRow,
  type QuickReviewIdentityRow,
} from "@/lib/application-quick-review";

const HIDDEN: QuickReview = {
  show: false,
  fields: [],
  documents: [],
  identity: null,
  esign: null,
  missing: [],
};

/**
 * One read of an application a manager is about to approve.
 *
 * The caller's own client, so existing RLS still decides what they can see.
 * Document bytes stay on adminListDriverDocuments, which already signs the
 * vault URLs. Identity reviews are included only when that table read
 * succeeds. No service role, no Stripe, no email.
 */
export const getApplicationQuickReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<QuickReview> => {
    assertApplicationQuickReviewEnabled();
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const supabase = context.supabase;

    const { data: app, error: appError } = await supabase
      .from("applications")
      .select(
        "id,status,deleted_at,email,phone,address,city,state,zip,dob,license_number,license_state,license_expiration,years_licensed,platforms,weekly_hours,weekly_rent,drive_type,expected_duration,card_last4,license_photo_url,insurance_doc_url,profile_screenshot_url",
      )
      .eq("id", data.applicationId)
      .maybeSingle();
    if (appError) throw new Error("Could not load this application.");
    if (!app || app.deleted_at || !isPendingReviewStatus(app.status)) return HIDDEN;

    const [documentsQ, screeningQ, agreementsQ, identityQ] = await Promise.all([
      supabase
        .from("documents")
        .select("id,category,label,file_name,mime_type,expires_at,is_current,review_status,created_at")
        .eq("driver_id", app.id)
        .eq("is_current", true)
        .neq("category", "verification_recording"),
      supabase
        .from("driver_screenings")
        .select("interview_completed_at,insurance_verified,mvr_authorized")
        .eq("lead_id", app.id)
        .maybeSingle(),
      supabase
        .from("agreements")
        .select("status,signed_at,sent_at,created_at,signer_name")
        .eq("application_id", app.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("application_identity_reviews")
        .select("status,resolution,created_at,submitted_full_name,submitted_email,submitted_phone")
        .eq("application_id", app.id)
        .order("created_at", { ascending: false }),
    ]);
    if (documentsQ.error || screeningQ.error || agreementsQ.error) {
      throw new Error("Could not load this application.");
    }

    const screening = screeningQ.data;
    const numberOrNull = (value: unknown): number | null => {
      if (value == null || value === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    return applicationQuickReview({
      status: app.status,
      deletedAt: app.deleted_at,
      email: app.email,
      phone: app.phone,
      address: app.address,
      city: app.city,
      state: app.state,
      zip: app.zip,
      dob: app.dob,
      licenseNumber: app.license_number,
      licenseState: app.license_state,
      licenseExpiration: app.license_expiration,
      yearsLicensed: numberOrNull(app.years_licensed),
      platforms: app.platforms,
      weeklyHours: numberOrNull(app.weekly_hours),
      weeklyRent: numberOrNull(app.weekly_rent),
      driveType: app.drive_type,
      expectedDuration: app.expected_duration,
      cardLast4: app.card_last4,
      licensePhotoUrl: app.license_photo_url,
      insuranceDocUrl: app.insurance_doc_url,
      profileScreenshotUrl: app.profile_screenshot_url,
      interviewCompletedAt: (screening?.interview_completed_at as string | null) ?? null,
      insuranceVerified: screening?.insurance_verified === true,
      mvrAuthorized: screening?.mvr_authorized === true,
      documents: (documentsQ.data ?? []).map((row) => ({
        id: row.id,
        category: String(row.category ?? ""),
        label: (row.label as string | null) ?? null,
        fileName: (row.file_name as string | null) ?? null,
        mimeType: (row.mime_type as string | null) ?? null,
        expiresAt: (row.expires_at as string | null) ?? null,
        isCurrent: row.is_current !== false,
        reviewStatus: (row.review_status as string | null) ?? null,
        createdAt: (row.created_at as string | null) ?? null,
      })) satisfies QuickReviewDocumentRow[],
      agreements: (agreementsQ.data ?? []).map((row) => ({
        status: (row.status as string | null) ?? null,
        signedAt: (row.signed_at as string | null) ?? null,
        sentAt: (row.sent_at as string | null) ?? null,
        createdAt: (row.created_at as string | null) ?? null,
        signerName: (row.signer_name as string | null) ?? null,
      })) satisfies QuickReviewAgreement[],
      identity: identityQ.error
        ? null
        : ((identityQ.data ?? []).map((row) => ({
            status: String(row.status ?? ""),
            resolution: (row.resolution as string | null) ?? null,
            createdAt: (row.created_at as string | null) ?? null,
            submittedFullName: (row.submitted_full_name as string | null) ?? null,
            submittedEmail: (row.submitted_email as string | null) ?? null,
            submittedPhone: (row.submitted_phone as string | null) ?? null,
          })) satisfies QuickReviewIdentityRow[]),
    });
  });
