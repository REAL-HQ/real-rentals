import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PayRental, PayRow } from "@/lib/driver-payment-status";
import {
  assertPortalPickupChecklistEnabled,
  pickupChecklist,
  type PickupAgreement,
  type PickupChecklist,
  type PickupDocument,
} from "@/lib/portal-pickup-checklist";

function previewInput(d: unknown): { previewDriverId?: string } {
  const id = (d as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
}

const HIDDEN: PickupChecklist = { show: false, items: [] };

/**
 * Outstanding pickup items for the signed-in driver.
 *
 * The caller's own client. A driver read is limited by the existing SELECT
 * policies on applications, rentals, agreements, documents, and payments.
 * Driver Preview checks the caller is a manager, then uses that same client
 * filtered to the previewed driver. No service role, no Stripe.
 */
export const getPortalPickupChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(previewInput)
  .handler(async ({ context, data }): Promise<PickupChecklist> => {
    assertPortalPickupChecklistEnabled();
    let userId = context.userId;
    if (data.previewDriverId) {
      const { requireManager } = await import("@/lib/roles.server");
      await requireManager(context.userId);
      userId = data.previewDriverId;
    }
    const supabase = context.supabase;

    const { data: app, error: appError } = await supabase
      .from("applications")
      .select("id,status,license_photo_url,insurance_doc_url,license_expiration,insurance_expires_on")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (appError) throw new Error("Could not load your checklist.");
    if (!app || app.status !== "approved") return HIDDEN;

    const { data: rentals, error: rentalError } = await supabase
      .from("rentals")
      .select("id,status,deposit_amount,deposit_held,deposit_status,deposit_refund_amount,application_id")
      .eq("driver_id", userId);
    if (rentalError) throw new Error("Could not load your checklist.");
    const rentalRows = (rentals ?? []) as PayRental[];
    if (rentalRows.some((rental) => rental.status === "active")) return HIDDEN;

    const [{ data: agreements, error: agreementError }, { data: documents, error: documentError }, { data: payments, error: paymentError }] =
      await Promise.all([
        supabase
          .from("agreements")
          .select("status,signed_at")
          .eq("application_id", app.id),
        supabase
          .from("documents")
          .select("category,expires_at,is_current,created_at,visibility")
          .eq("driver_id", app.id)
          .in("category", ["license_front", "license_back", "insurance"]),
        supabase
          .from("payments")
          .select("rental_id,type,amount,balance_due,net_collected,refunded_amount,status,due_date")
          .eq("driver_id", app.id),
      ]);
    if (agreementError || documentError || paymentError) throw new Error("Could not load your checklist.");

    return pickupChecklist({
      applicationStatus: app.status,
      hasActiveRental: false,
      documents: (documents ?? []).map((row) => ({
        category: String(row.category ?? ""),
        expiresAt: (row.expires_at as string | null) ?? null,
        isCurrent: row.is_current !== false,
        visibleToDriver: Array.isArray(row.visibility) && row.visibility.includes("driver"),
        createdAt: (row.created_at as string | null) ?? null,
      })) satisfies PickupDocument[],
      licensePhotoPath: (app.license_photo_url as string | null) ?? null,
      licenseExpiration: (app.license_expiration as string | null) ?? null,
      insuranceDocPath: (app.insurance_doc_url as string | null) ?? null,
      insuranceExpiresOn: (app.insurance_expires_on as string | null) ?? null,
      agreements: (agreements ?? []).map((row) => ({
        status: (row.status as string | null) ?? null,
        signedAt: (row.signed_at as string | null) ?? null,
      })) satisfies PickupAgreement[],
      rentals: rentalRows,
      payments: (payments ?? []) as PayRow[],
    });
  });
