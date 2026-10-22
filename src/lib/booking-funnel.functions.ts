import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireManager } from "@/lib/roles.server";
import {
  buildApprovedNotRenting,
  latestApprovalAt,
  type ApprovedNotRentingResult,
  type FunnelApplicant,
  type FunnelContact,
} from "@/lib/booking-funnel";

/**
 * The Approved, Not Yet Renting read.
 *
 * Manager or Owner. supabaseAdmin bypasses RLS, so the tier is checked here.
 * The read is the applications row, the active-rental ids, and the approval
 * audit entries. It writes nothing and sends nothing.
 *
 * A failed query throws. An empty list is a real empty list, not a hidden
 * error.
 */

const APP_COLUMNS =
  "id, full_name, status, deleted_at, license_expiration, insurance_expires_on, contact_status, contact_status_note, contact_follow_up_on, contact_status_at, contact_status_by";

type AppRow = {
  id: string;
  full_name: string | null;
  status: string | null;
  deleted_at: string | null;
  license_expiration: string | null;
  insurance_expires_on: string | null;
  contact_status: string | null;
  contact_status_note: string | null;
  contact_follow_up_on: string | null;
  contact_status_at: string | null;
  contact_status_by: string | null;
};

function fail(error: { message?: string | null } | null, what: string): never {
  throw new Error(error?.message || `${what} could not be loaded.`);
}

export const listApprovedNotRenting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ApprovedNotRentingResult> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const apps = await supabaseAdmin
      .from("applications")
      .select(APP_COLUMNS)
      .eq("status", "approved")
      .is("deleted_at", null);
    if (apps.error) fail(apps.error, "Approved drivers");
    const applicants = ((apps.data ?? []) as unknown as AppRow[]).map(toApplicant);

    const rentals = await supabaseAdmin
      .from("rentals")
      .select("application_id")
      .eq("status", "active");
    if (rentals.error) fail(rentals.error, "Active rentals");
    const activeIds = (rentals.data ?? [])
      .map((r) => r.application_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const ids = applicants.map((a) => a.id);
    let approvedAtById: Record<string, string> = {};
    if (ids.length) {
      const logs = await supabaseAdmin
        .from("audit_log")
        .select("entity_id, created_at")
        .eq("action", "application.approved")
        .eq("entity_type", "application")
        .in("entity_id", ids);
      if (logs.error) fail(logs.error, "Approval dates");
      approvedAtById = latestApprovalAt(
        ((logs.data ?? []) as { entity_id: string | null; created_at: string | null }[]).map((r) => ({
          entityId: r.entity_id,
          createdAt: r.created_at,
        })),
      );
    }

    return buildApprovedNotRenting({
      applicants,
      activeRentalApplicationIds: activeIds,
      approvedAtById,
      now: new Date(),
    });
  });

function toApplicant(row: AppRow): FunnelApplicant {
  const contact: FunnelContact = {
    contact_status: row.contact_status,
    contact_status_note: row.contact_status_note,
    contact_follow_up_on: row.contact_follow_up_on,
    contact_status_at: row.contact_status_at,
    contact_status_by: row.contact_status_by,
  };
  return {
    id: row.id,
    fullName: row.full_name,
    status: row.status,
    deletedAt: row.deleted_at,
    licenseExpiration: row.license_expiration,
    insuranceExpiresOn: row.insurance_expires_on,
    contact,
  };
}
