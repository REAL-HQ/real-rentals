import { supabase } from "@/integrations/supabase/client";
import { PICKUP_CHECKLIST_ENABLED, pickupChecklist, type PickupChecklist } from "@/lib/pickup-checklist";

/**
 * Read pickup readiness for the signed-in driver. Every query is the driver's
 * own session, so RLS is the boundary. No preview id, no service role, no write.
 */
export async function loadPickupChecklist(): Promise<PickupChecklist | null> {
  if (PICKUP_CHECKLIST_ENABLED !== true) return null;

  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id ?? null;
  if (!uid) return null;

  const { data: apps, error: appError } = await supabase
    .from("applications")
    .select("id,status,pickup_date,pickup_time")
    .eq("user_id", uid)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (appError) return null;
  const app = apps?.[0];
  if (!app) return null;
  if (String(app.status ?? "").trim().toLowerCase() !== "approved") return null;

  const [agreements, documents, payments, rentals] = await Promise.all([
    supabase.from("agreements").select("status,signed_at,voided_at").eq("application_id", app.id),
    supabase
      .from("documents")
      .select("category,review_status,is_current")
      .eq("driver_id", app.id)
      .eq("is_current", true),
    supabase.from("payments").select("type,status,net_collected,amount").eq("driver_id", app.id),
    supabase.from("rentals").select("deposit_held").eq("driver_id", uid),
  ]);
  if (agreements.error || documents.error || payments.error || rentals.error) return null;

  return pickupChecklist({
    status: app.status,
    pickupDate: app.pickup_date,
    pickupTime: app.pickup_time,
    agreements: (agreements.data ?? []).map((row) => ({
      status: row.status,
      signedAt: row.signed_at,
      voidedAt: row.voided_at,
    })),
    documents: (documents.data ?? []).map((row) => ({
      category: row.category,
      reviewStatus: row.review_status,
      current: row.is_current,
    })),
    payments: (payments.data ?? []).map((row) => ({
      type: row.type,
      status: row.status,
      netCollected: row.net_collected,
      amount: row.amount,
    })),
    depositHeld: (rentals.data ?? []).some((row) => row.deposit_held === true),
  });
}
