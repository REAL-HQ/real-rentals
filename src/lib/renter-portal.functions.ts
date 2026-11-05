import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  RENTER_PORTAL_ENABLED,
  clampSummary,
  isFetchableHost,
  normalizeWebsite,
  parseVendorView,
  pickLogoFromHtml,
  validateVendor,
  type RenterPortalSummary,
  type RenterVendor,
  type VendorView,
} from "@/lib/renter-portal";

function assertEnabled() {
  if (RENTER_PORTAL_ENABLED !== true) throw new Error("Renter portal is not enabled.");
}

const uuid = (v: unknown, what = "id"): string => {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw new Error(`Invalid ${what}`);
  return v;
};

const previewId = (input: unknown): string | null => {
  const id = (input as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return null;
  return uuid(id, "driver");
};

/**
 * The signed-in renter's portal, or a staff read-only preview of one driver.
 * Renters use the SECURITY DEFINER RPC (auth.uid()). Staff preview rebuilds
 * the same payload with the service role for that driver only.
 */
export const getRenterPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ({ previewDriverId: previewId(input) }))
  .handler(async ({ data, context }): Promise<RenterPortalSummary> => {
    assertEnabled();
    const { portalScope } = await import("@/lib/driver-preview.server");
    const scope = await portalScope(context, data, "renter-portal");
    if (!scope.preview) {
      const { data: raw, error } = await (context.supabase as any).rpc("renter_portal_summary");
      if (error) throw new Error(error.message);
      return clampSummary(raw);
    }
    const { loadRenterPortalSummaryForDriver } = await import("@/lib/renter-portal.server");
    return loadRenterPortalSummaryForDriver(scope.supabase, scope.userId);
  });

/** 10-minute link for one file, only after the database (or staff preview check) says the caller may see it. */
export const getRenterPortalFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const o = (input ?? {}) as { kind?: unknown; id?: unknown; previewDriverId?: unknown };
    if (o.kind !== "photo" && o.kind !== "registration" && o.kind !== "insurance") throw new Error("Invalid file");
    return {
      kind: o.kind as "photo" | "registration" | "insurance",
      id: uuid(o.id, "file"),
      previewDriverId: previewId(o),
    };
  })
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    assertEnabled();
    const { portalScope } = await import("@/lib/driver-preview.server");
    const scope = await portalScope(context, data, "renter-portal-file");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let row: { storage_bucket: string; storage_path: string } | null = null;
    if (!scope.preview) {
      const { data: rows, error } = await (context.supabase as any).rpc("renter_portal_file", {
        _kind: data.kind,
        _id: data.id,
      });
      if (error) throw new Error(error.message);
      row = (rows as { storage_bucket: string; storage_path: string }[] | null)?.[0] ?? null;
    } else {
      const { authorizeRenterPortalFileForDriver } = await import("@/lib/renter-portal.server");
      row = await authorizeRenterPortalFileForDriver(scope.supabase, scope.userId, data.kind, data.id);
    }
    if (!row?.storage_bucket || !row.storage_path) throw new Error("File not available");
    const signed = await supabaseAdmin.storage.from(row.storage_bucket).createSignedUrl(row.storage_path, 600);
    if (signed.error || !signed.data?.signedUrl) throw new Error("Could not open file");
    return { url: signed.data.signedUrl };
  });

/** Vendors for renters (or staff preview of a renter). Prefs are the driver's; writes refuse in preview. */
export const getRenterVendors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ({ previewDriverId: previewId(input) }))
  .handler(async ({ data, context }): Promise<{ vendors: RenterVendor[]; view: VendorView | null }> => {
    assertEnabled();
    const { portalScope } = await import("@/lib/driver-preview.server");
    const scope = await portalScope(context, data, "renter-vendors");
    const sb = scope.preview ? scope.supabase : (context.supabase as any);
    const [v, p] = await Promise.all([
      sb
        .from("renter_vendors")
        .select("id,category,name,phone,website,address,notes,logo_url,sort_order,is_active")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      sb.from("renter_portal_prefs").select("vendor_view").eq("user_id", scope.userId).maybeSingle(),
    ]);
    if (v.error) throw new Error(v.error.message);
    return { vendors: (v.data ?? []) as RenterVendor[], view: parseVendorView(p.data?.vendor_view) };
  });

export const setRenterVendorView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const view = parseVendorView((input as { view?: unknown } | null)?.view);
    if (!view) throw new Error("Invalid view");
    return { view };
  })
  .handler(async ({ data, context }) => {
    assertEnabled();
    const { refuseStaffPortalWrite } = await import("@/lib/driver-preview.server");
    await refuseStaffPortalWrite(context.userId);
    const { error } = await (context.supabase as any)
      .from("renter_portal_prefs")
      .upsert({ user_id: context.userId, vendor_view: data.view, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------- team

async function staff(userId: string) {
  const { requireStaff } = await import("@/lib/roles.server");
  return requireStaff(userId);
}

export const adminListRenterVendors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RenterVendor[]> => {
    await staff(context.userId);
    const { data, error } = await (context.supabase as any)
      .from("renter_vendors")
      .select("id,category,name,phone,website,address,notes,logo_url,sort_order,is_active")
      .order("sort_order")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as RenterVendor[];
  });

export const adminSaveRenterVendor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateVendor)
  .handler(async ({ data, context }) => {
    await staff(context.userId);
    const row = { ...data, updated_at: new Date().toISOString(), updated_by: context.userId };
    const q = data.id
      ? (context.supabase as any).from("renter_vendors").update(row).eq("id", data.id).select("id").single()
      : (context.supabase as any).from("renter_vendors").insert(row).select("id").single();
    const { data: saved, error } = await q;
    if (error) throw new Error(error.message);
    return { id: saved.id as string };
  });

export const adminDeleteRenterVendor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ({ id: uuid((input as { id?: unknown } | null)?.id, "vendor") }))
  .handler(async ({ data, context }) => {
    await staff(context.userId);
    const { error } = await (context.supabase as any).from("renter_vendors").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminReorderRenterVendors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const ids = (input as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length > 500) throw new Error("Invalid order");
    return { ids: ids.map((i) => uuid(i, "vendor")) };
  })
  .handler(async ({ data, context }) => {
    await staff(context.userId);
    for (let i = 0; i < data.ids.length; i++) {
      const { error } = await (context.supabase as any).from("renter_vendors").update({ sort_order: (i + 1) * 10 }).eq("id", data.ids[i]);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** Suggest a logo from the business website. Staff only; https, public hosts, 5s, 512 KB. */
export const adminFindVendorLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const website = normalizeWebsite((input as { website?: unknown } | null)?.website);
    if (!website) throw new Error("Add a website first");
    return { website };
  })
  .handler(async ({ data, context }): Promise<{ logoUrl: string | null }> => {
    await staff(context.userId);
    const url = new URL(data.website);
    url.protocol = "https:";
    if (!isFetchableHost(url.hostname)) return { logoUrl: null };
    try {
      const res = await fetch(url.toString(), {
        redirect: "follow",
        signal: AbortSignal.timeout(5000),
        headers: { "user-agent": "RealRentalsLogoBot/1.0", accept: "text/html" },
      });
      if (!res.ok) return { logoUrl: `https://${url.hostname}/favicon.ico` };
      const finalUrl = new URL(res.url || url.toString());
      if (!isFetchableHost(finalUrl.hostname)) return { logoUrl: null };
      const html = (await res.text()).slice(0, 512 * 1024);
      return { logoUrl: pickLogoFromHtml(html, finalUrl.toString()) };
    } catch {
      return { logoUrl: null };
    }
  });
