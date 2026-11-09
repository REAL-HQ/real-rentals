import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TIER_BY_ROLE, TIER_RANK, tierAllows } from "@/lib/roles";
import {
  assertPortalNoticesEnabled,
  buildPortalNotices,
  type NoticeAgreement,
  type NoticeDocument,
  type NoticePayment,
  type NoticeRental,
  type PortalNotice,
} from "@/lib/portal-notices";

const previewInput = (value: unknown): { previewDriverId?: string } => {
  const id = (value as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
};

/**
 * A signed-in driver's own notices, or a manager's read-only preview of one
 * driver. Every read uses the caller's client. RLS is the boundary.
 */
export const getPortalNotices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => input ?? {})
  .handler(async ({ data, context }): Promise<PortalNotice[]> => {
    assertPortalNoticesEnabled();
    const input = previewInput(data);
    let userId = context.userId;
    if (input.previewDriverId) {
      const { data: roles } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId);
      const tier = ((roles ?? []) as { role: string }[])
        .map((row) => TIER_BY_ROLE[row.role])
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((a, b) => TIER_RANK[b] - TIER_RANK[a])[0] ?? null;
      if (tierAllows(tier, "manager")) userId = input.previewDriverId;
    }

    const applications = await context.supabase
      .from("applications")
      .select("id,status,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    const applicationReadable = !applications.error;
    const apps = applicationReadable ? (applications.data ?? []) : [];
    const appIds = apps.map((row) => row.id as string);

    const [documents, rentals, payments, agreements] = await Promise.all([
      appIds.length
        ? context.supabase
            .from("documents")
            .select("category,expires_at,is_current,review_status,visibility")
            .in("driver_id", appIds)
        : Promise.resolve({ data: [] as NoticeDocument[], error: null }),
      context.supabase
        .from("rentals")
        .select("next_payment_due,payment_status")
        .eq("driver_id", userId),
      appIds.length
        ? context.supabase.from("payments").select("status,due_date").in("driver_id", appIds)
        : Promise.resolve({ data: [] as NoticePayment[], error: null }),
      appIds.length
        ? context.supabase.from("agreements").select("status,signed_at").in("application_id", appIds)
        : Promise.resolve({ data: [] as NoticeAgreement[], error: null }),
    ]);

    return buildPortalNotices({
      applicationReadable,
      application: apps[0] ? { status: (apps[0].status as string | null) ?? null } : null,
      documents:
        !applicationReadable || appIds.length === 0 || documents.error
          ? null
          : ((documents.data ?? []) as NoticeDocument[]),
      rentals: rentals.error ? null : ((rentals.data ?? []) as NoticeRental[]),
      payments: payments.error ? null : ((payments.data ?? []) as NoticePayment[]),
      agreements: agreements.error ? null : ((agreements.data ?? []) as NoticeAgreement[]),
    });
  });
