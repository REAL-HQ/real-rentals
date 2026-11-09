import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  NEXT_STEPS_CARD_ENABLED,
  buildNextSteps,
  paymentFromRows,
  pickNextStepsApplication,
  type NextStepsView,
} from "@/lib/next-steps";

/**
 * Your Next Steps, for the signed-in driver only.
 *
 * The same portal scope as the dashboard: a driver is their own user id, and
 * a staff preview is a manager reading one real driver. Every query filters
 * to that id. Nothing here writes, sends, or calls Stripe. The answer is
 * Done / Needed / Unknown — not licence numbers, card digits, or file paths.
 *
 * While NEXT_STEPS_CARD_ENABLED is false this returns before any read.
 */

const previewInput = (d: unknown): { previewDriverId?: string } => {
  const id = (d as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
};

export type MyNextSteps = { enabled: false } | ({ enabled: true } & NextStepsView);

type AppRow = {
  id: string;
  status: string | null;
  deleted_at: string | null;
  created_at: string | null;
  license_expiration: string | null;
  insurance_expires_on: string | null;
  license_photo_url: string | null;
  insurance_doc_url: string | null;
  card_last4: string | null;
  stripe_payment_method_id: string | null;
  card_on_file_at: string | null;
};

type DocRow = { category: string | null; expires_at: string | null; is_current: boolean | null };
type AgreementRow = { status: string | null; signed_at: string | null };
type RentalRow = {
  status: string | null;
  card_last4: string | null;
  stripe_payment_method_id: string | null;
  card_on_file_at: string | null;
  stripe_subscription_id: string | null;
  autopay_active: boolean | null;
};

function fail(error: { message?: string | null } | null, what: string): never {
  throw new Error(error?.message || `${what} could not be loaded.`);
}

export const getMyNextSteps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(previewInput)
  .handler(async ({ context, data }): Promise<MyNextSteps> => {
    if (NEXT_STEPS_CARD_ENABLED !== true) return { enabled: false };

    const scope = await import("@/lib/driver-preview.server");
    const { supabase, userId } = await scope.portalScope(context, data, "next_steps");

    const apps = await supabase
      .from("applications")
      .select(
        "id,status,deleted_at,created_at,license_expiration,insurance_expires_on,license_photo_url,insurance_doc_url,card_last4,stripe_payment_method_id,card_on_file_at",
      )
      .eq("user_id", userId);
    if (apps.error) fail(apps.error, "Your application");
    const picked = pickNextStepsApplication(
      ((apps.data ?? []) as AppRow[]).map((r) => ({
        ...r,
        status: r.status,
        deletedAt: r.deleted_at,
        createdAt: r.created_at,
      })),
    );

    const rentals = await supabase
      .from("rentals")
      .select("status,card_last4,stripe_payment_method_id,card_on_file_at,stripe_subscription_id,autopay_active")
      .eq("driver_id", userId);
    if (rentals.error) fail(rentals.error, "Your rental");
    const rentalRows = (rentals.data ?? []) as RentalRow[];
    const hasActiveRental = rentalRows.some((r) => r.status === "active");

    if (!picked || picked.status !== "approved" || hasActiveRental) {
      return { enabled: true, show: false, steps: [], pickupLine: "" };
    }

    const docs = await supabase
      .from("documents")
      .select("category,expires_at,is_current")
      .eq("driver_id", picked.id)
      .in("category", ["license_front", "license_back", "insurance"]);
    if (docs.error) fail(docs.error, "Your documents");
    const docRows = (docs.data ?? []) as DocRow[];

    const agreements = await supabase
      .from("agreements")
      .select("status,signed_at")
      .eq("application_id", picked.id);
    if (agreements.error) fail(agreements.error, "Your agreement");

    const current = (category: string) =>
      docRows.filter((d) => d.is_current !== false && d.category === category);
    const licenseDocs = [...current("license_front"), ...current("license_back")];
    const insuranceDocs = current("insurance");
    const onFile = (photo: string | null, rows: DocRow[]) =>
      Boolean(photo && photo.trim()) || rows.length > 0;

    const view = buildNextSteps({
      status: picked.status,
      hasActiveRental,
      licenseOnFile: onFile(picked.license_photo_url, licenseDocs),
      licenseDates: [picked.license_expiration, ...licenseDocs.map((d) => d.expires_at)],
      insuranceOnFile: onFile(picked.insurance_doc_url, insuranceDocs),
      insuranceDates: [picked.insurance_expires_on, ...insuranceDocs.map((d) => d.expires_at)],
      agreements: ((agreements.data ?? []) as AgreementRow[]).map((a) => ({
        status: a.status,
        signedAt: a.signed_at,
      })),
      payment: paymentFromRows(picked, rentalRows),
      now: new Date(),
    });
    return { enabled: true, ...view };
  });
