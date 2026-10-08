import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Stage-based access for signed-in people who are not (yet) drivers: Lead /
 * Waitlist and Applicant. Drivers keep the existing portal untouched. Every
 * read resolves from the caller's verified identity on the server — the
 * browser never names an application or waitlist row.
 */
async function identity(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const u: any = data?.user;
  const { normEmail } = await import("@/lib/portal-signin.server");
  return {
    admin: supabaseAdmin,
    email: normEmail(u?.email ?? ""),
    verified: Boolean(u?.app_metadata?.portal_verified && u?.email_confirmed_at),
  };
}

async function myWaitlist(admin: any, email: string) {
  const { exactLike, normEmail } = await import("@/lib/portal-signin.server");
  const { data } = await admin
    .from("waitlist")
    .select("id,full_name,email,phone,city,state,pickup_date,status,created_at,promoted_application_id")
    .ilike("email", exactLike(email))
    .order("created_at", { ascending: false });
  return (data ?? []).filter((w: any) => normEmail(w.email) === email);
}

export const getMyPortalAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin, email, verified } = await identity(context.userId);
    let review = false;
    if (verified && email) {
      const { linkVerifiedApplication } = await import("@/lib/portal-signin.server");
      review = (await linkVerifiedApplication(admin, context.userId, email)) === "review";
    }
    const { data: apps } = await admin
      .from("applications")
      .select("id,full_name,status,current_step,created_at,city,state")
      .eq("user_id", context.userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    const app: any = apps?.[0] ?? null;

    let documents: { category: string; created_at: string }[] = [];
    let onWaitlist = false;
    if (app) {
      const { data: docs } = await admin
        .from("documents")
        .select("category,created_at")
        .eq("driver_id", app.id)
        .contains("visibility", ["driver"]);
      documents = (docs ?? []) as any;
      const { count } = await admin
        .from("application_waitlist_holds")
        .select("id", { count: "exact", head: true })
        .eq("application_id", app.id)
        .is("closed_at", null);
      onWaitlist = (count ?? 0) > 0;
    }
    const waitlist = verified && email ? (await myWaitlist(admin, email)).find((w: any) => !w.promoted_application_id) ?? null : null;

    const stage = app
      ? app.status === "approved"
        ? "approved"
        : "applicant"
      : waitlist
        ? "waitlist"
        : "none";
    return {
      stage: stage as "approved" | "applicant" | "waitlist" | "none",
      email,
      review,
      application: app
        ? { status: app.status, step: app.current_step, name: app.full_name, createdAt: app.created_at, onWaitlist, documents }
        : null,
      waitlist: waitlist
        ? { name: waitlist.full_name, phone: waitlist.phone, city: waitlist.city, state: waitlist.state, pickupDate: waitlist.pickup_date, status: waitlist.status, createdAt: waitlist.created_at }
        : null,
    };
  });

/** Opens the existing application wizard with a short-lived, single-use resume token. */
export const openMyApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: app } = await supabaseAdmin
      .from("applications")
      .select("id,status")
      .eq("user_id", context.userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!app) throw new Error("No application is linked to this account.");
    if (["declined", "closed"].includes(String(app.status))) throw new Error("This application is closed. Contact us to reopen it.");
    const { issueResumeToken } = await import("@/lib/resume-tokens.server");
    const raw = await issueResumeToken(supabaseAdmin, app.id, { recovery: true });
    return { path: `/thank-you?t=${encodeURIComponent(raw)}` };
  });

/** Waitlist leads update contact details and rental preferences — nothing else. */
export const updateMyWaitlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name?: string; phone?: string; city?: string; state?: string; pickupDate?: string | null }) => d ?? {})
  .handler(async ({ data, context }) => {
    const { admin, email, verified } = await identity(context.userId);
    if (!verified || !email) throw new Error("Verify your email to update your details.");
    const entry = (await myWaitlist(admin, email)).find((w: any) => !w.promoted_application_id);
    if (!entry) throw new Error("No waitlist entry is linked to this email.");
    const patch: Record<string, unknown> = {};
    const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    if (data.name !== undefined) {
      if (s(data.name, 120).length < 2) throw new Error("Enter your full name.");
      patch.full_name = s(data.name, 120);
    }
    if (data.phone !== undefined) {
      const digits = String(data.phone).replace(/\D/g, "");
      if (digits.length !== 10 && !(digits.length === 11 && digits.startsWith("1"))) throw new Error("Enter a valid US phone number.");
      const d = digits.slice(-10);
      patch.phone = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    if (data.city !== undefined) patch.city = s(data.city, 80) || null;
    if (data.state !== undefined) patch.state = s(data.state, 2).toUpperCase() || null;
    if (data.pickupDate !== undefined) {
      if (data.pickupDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.pickupDate)) throw new Error("Invalid date.");
      patch.pickup_date = data.pickupDate || null;
    }
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await admin.from("waitlist").update(patch).eq("id", entry.id);
    if (error) throw new Error("Could not save your details.");
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(null, {
      action: "portal.waitlist_self_update",
      summary: "Waitlist lead updated their own details",
      entityType: "waitlist",
      entityId: entry.id,
      metadata: { fields: Object.keys(patch), actor_user_id: context.userId },
    });
    return { ok: true };
  });
