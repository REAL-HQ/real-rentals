import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff } from "@/lib/roles.server";
import { buildVehicleSearchOr, VEHICLE_LIST_PAGE_SIZE, VEHICLE_SORTS, type VehicleListRow, type VehicleListResult } from "@/lib/vehicles-list";

// Vehicles List 1: one page of list columns, server-searched/filtered/sorted.
// Only list columns are selected — never finance, title or acquisition data.
const LIST_COLUMNS =
  "id,unit_number,year,make,model,trim,color,license_plate,vin,status,body_type,weekly_rate,partner_id,photos,created_at";

export const listVehicles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        q: z.string().max(100).optional().default(""),
        status: z.string().max(40).optional().default("all"),
        body: z.string().max(40).optional().default("all"),
        partner: z.string().max(40).optional().default("all"),
        sort: z.string().max(20).optional().default("unit"),
        page: z.number().int().min(1).max(100000).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(VEHICLE_LIST_PAGE_SIZE),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<VehicleListResult> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sort = (VEHICLE_SORTS as readonly string[]).includes(data.sort) ? data.sort : "unit";

    let query = supabaseAdmin.from("vehicles").select(LIST_COLUMNS, { count: "exact" });
    // Archived vehicles leave the normal fleet view; the Archived filter shows them.
    if (data.status !== "all") query = query.eq("status", data.status);
    else query = query.neq("status", "archived");
    if (data.body !== "all") query = query.eq("body_type", data.body);
    if (data.partner === "__none__") query = query.is("partner_id", null);
    else if (data.partner !== "all") query = query.eq("partner_id", data.partner);
    const or = buildVehicleSearchOr(data.q);
    if (or) query = query.or(or);

    // Deterministic secondary key (id) keeps pages stable across equal values.
    if (sort === "unit") query = query.order("unit_number", { ascending: true, nullsFirst: false });
    else if (sort === "make") query = query.order("make", { ascending: true, nullsFirst: false }).order("model", { ascending: true, nullsFirst: false });
    else if (sort === "rate") query = query.order("weekly_rate", { ascending: true, nullsFirst: false });
    else query = query.order("created_at", { ascending: false, nullsFirst: false });
    query = query.order("id", { ascending: true });

    const from = (data.page - 1) * data.pageSize;
    const [{ data: rows, count, error }, facets] = await Promise.all([
      query.range(from, from + data.pageSize - 1),
      supabaseAdmin.from("vehicles").select("status,body_type").limit(10000),
    ]);
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r: any) => r.id);
    const onRent = new Set<string>();
    if (ids.length) {
      // On Rent = an actual running rental, never inferred from vehicle status.
      const { data: running } = await supabaseAdmin
        .from("rentals")
        .select("vehicle_id")
        .eq("status", "active")
        .in("vehicle_id", ids);
      for (const r of running ?? []) if ((r as any).vehicle_id) onRent.add((r as any).vehicle_id);
    }

    const statuses = new Set<string>(["archived"]);
    const bodies = new Set<string>();
    for (const f of facets.data ?? []) {
      if ((f as any).status) statuses.add((f as any).status);
      if ((f as any).body_type) bodies.add((f as any).body_type);
    }

    return {
      rows: (rows ?? []).map((r: any): VehicleListRow => ({
        id: r.id,
        unit_number: r.unit_number,
        year: r.year,
        make: r.make,
        model: r.model,
        trim: r.trim,
        color: r.color,
        license_plate: r.license_plate,
        vin: r.vin,
        status: r.status,
        body_type: r.body_type,
        weekly_rate: r.weekly_rate == null ? null : Number(r.weekly_rate),
        partner_id: r.partner_id,
        photo: Array.isArray(r.photos) && r.photos.length ? r.photos[0] : null,
        on_rent: onRent.has(r.id),
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      statuses: [...statuses].sort(),
      bodyTypes: [...bodies].sort(),
    };
  });
