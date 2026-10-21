import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ONBOARDING_ROW_CAP,
  ONBOARDING_STATUSES,
  assertOnboardingChecklistEnabled,
  buildOnboardingChecklist,
  type OnboardingAgreement,
  type OnboardingApplication,
  type OnboardingChecklistResult,
  type OnboardingDocument,
  type OnboardingIdentityReview,
  type OnboardingPayment,
  type OnboardingRental,
} from "./onboarding-checklist";

const ONBOARDING_CHUNK = 100;

const onboardingChecklistGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertOnboardingChecklistEnabled();
  return next();
});

const capped = (): OnboardingChecklistResult => ({
  truncated: true,
  cap: ONBOARDING_ROW_CAP,
  drivers: [],
});

async function readRelated(
  ids: string[],
  fetchPage: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  if (ids.length === 0) return { rows: [], truncated: false };
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < ids.length; index += ONBOARDING_CHUNK) {
    const result = await fetchPage(ids.slice(index, index + ONBOARDING_CHUNK));
    if (result.error) throw new Error("Onboarding checklist could not be loaded. Please retry.");
    const page = Array.isArray(result.data) ? result.data : [];
    if (page.length > ONBOARDING_ROW_CAP) return { rows: [], truncated: true };
    for (const row of page) rows.push(row as Record<string, unknown>);
    if (rows.length > ONBOARDING_ROW_CAP) return { rows: [], truncated: true };
  }
  return { rows, truncated: false };
}

export const getOnboardingChecklist = createServerFn({ method: "GET" })
  .middleware([onboardingChecklistGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingChecklistResult> => {
    assertOnboardingChecklistEnabled();
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const loaded = await supabaseAdmin
      .from("applications")
      .select(
        "id,full_name,status,deleted_at,card_last4,stripe_payment_method_id,card_on_file_at,background_check_status,pickup_date,vehicle_id,deposit_status",
      )
      .is("deleted_at", null)
      .in("status", [...ONBOARDING_STATUSES])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(ONBOARDING_ROW_CAP + 1);
    if (loaded.error) throw new Error("Onboarding checklist could not be loaded. Please retry.");
    const applications = (Array.isArray(loaded.data) ? loaded.data : []) as OnboardingApplication[];
    if (applications.length > ONBOARDING_ROW_CAP) return capped();
    const ids = applications.map((application) => application.id);
    const documents = await readRelated(ids, (chunk) =>
      supabaseAdmin
        .from("documents")
        .select("driver_id,category,review_status,reviewed_at,is_current,source")
        .in("driver_id", chunk)
        .in("category", ["license_front", "license_back"])
        .eq("is_current", true)
        .limit(ONBOARDING_ROW_CAP + 1),
    );
    if (documents.truncated) return capped();
    const reviews = await readRelated(ids, (chunk) =>
      supabaseAdmin
        .from("application_identity_reviews")
        .select("application_id,status,resolution,resolved_at,source")
        .in("application_id", chunk)
        .limit(ONBOARDING_ROW_CAP + 1),
    );
    if (reviews.truncated) return capped();
    const agreements = await readRelated(ids, (chunk) =>
      supabaseAdmin
        .from("agreements")
        .select("application_id,status,signed_at,voided_at,source")
        .in("application_id", chunk)
        .limit(ONBOARDING_ROW_CAP + 1),
    );
    if (agreements.truncated) return capped();
    const payments = await readRelated(ids, (chunk) =>
      supabaseAdmin
        .from("payments")
        .select("driver_id,type,status,net_collected,amount,refunded_amount,paid_date")
        .in("driver_id", chunk)
        .eq("type", "deposit")
        .limit(ONBOARDING_ROW_CAP + 1),
    );
    if (payments.truncated) return capped();
    const rentals = await readRelated(ids, (chunk) =>
      supabaseAdmin
        .from("rentals")
        .select(
          "application_id,vehicle_id,created_at,start_date,deposit_held,deposit_status,deposit_settled_at,card_last4,stripe_payment_method_id,card_on_file_at",
        )
        .in("application_id", chunk)
        .limit(ONBOARDING_ROW_CAP + 1),
    );
    if (rentals.truncated) return capped();
    return buildOnboardingChecklist({
      applications,
      documents: documents.rows as unknown as OnboardingDocument[],
      reviews: reviews.rows as unknown as OnboardingIdentityReview[],
      agreements: agreements.rows as unknown as OnboardingAgreement[],
      payments: payments.rows as unknown as OnboardingPayment[],
      rentals: rentals.rows as unknown as OnboardingRental[],
      truncated: false,
    });
  });
