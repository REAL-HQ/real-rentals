import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff } from "@/lib/roles.server";
import {
  buildVehicleSearchOr,
  isReadinessFilter,
  readinessBand,
  readinessGaps,
  VEHICLE_LIST_PAGE_SIZE,
  vehicleSortOrders,
  ON_RENT_STATUS_FILTER,
  summarizeVehicleFleetStats,
  type ReadinessBand,
  type ReadinessCounts,
  type VehicleListRow,
  type VehicleListResult,
} from "@/lib/vehicles-list";
import { activeRentalVehicleIds } from "@/lib/fleet-summary";
import { OPEN_SWAP_STATUSES, VEHICLE_SWAPS_TABLE, vehicleSwapNotices, type OpenSwapRow, type VehicleSwapNotice } from "@/lib/vehicle-swap";
import { chooseVehicleThumbnailPaths, vehicleListThumbnailKey, type VehicleThumbnailMedia } from "@/lib/vehicle-thumbnail";

// Vehicles List 1: one page of list columns, server-searched/filtered/sorted.
// Only list columns are selected — never finance, title or acquisition data.
const LIST_COLUMNS =
  "id,unit_number,year,make,model,trim,color,license_plate,vin,status,body_type,weekly_rate,partner_id,photos,created_at";

/**
 * Just enough of every car in scope to grade it, for the fleet-wide chips and
 * the readiness filter. The grading itself is the shared browser-safe helper,
 * so the list cannot disagree with the vehicle's own profile about whether a
 * car is ready.
 *
 * One sweep, capped. A fleet past this many vehicles needs the two readiness
 * rules as a database view that can be filtered and counted in SQL — which is
 * a migration, so the cap stays and `readinessPartial` says when it bit rather
 * than quietly reporting a number that is only mostly true.
 */
const READINESS_COLUMNS = "id,year,make,model,vin,weekly_rate";
const READINESS_SWEEP_MAX = 2000;

/**
 * The Status and Body Type dropdown options: every value in use across the
 * whole table, so a filter never hides the option that would clear it. Read
 * once per request — both exits below need the same answer.
 */
type FacetRow = { id?: string | null; status?: string | null; body_type?: string | null };
type FleetClient = { from: (table: string) => any };

async function fleetOptions(supabaseAdmin: FleetClient) {
  const [facets, rentals] = await Promise.all([
    supabaseAdmin.from("vehicles").select("id,status,body_type", { count: "exact" }).limit(10000),
    supabaseAdmin.from("rentals").select("vehicle_id").eq("status", "active").limit(10000),
  ]);
  const onRentIds = activeRentalVehicleIds(rentals.data ?? []);
  const rows = (facets.data ?? []) as FacetRow[];
  const statuses = new Set<string>(["archived", "unavailable"]);
  const bodies = new Set<string>();
  for (const f of rows) {
    if (f.status) statuses.add(f.status);
    if (f.body_type) bodies.add(f.body_type);
  }
  const total = facets.count ?? rows.length;
  // Exact table count is independent of filters and the capped facet rows.
  // Includes archived records; the UI labels that scope explicitly.
  return {
    statuses: [...statuses].sort(),
    bodyTypes: [...bodies].sort(),
    fleetTotal: facets.count ?? null,
    fleetStats: summarizeVehicleFleetStats(rows, onRentIds, total),
    onRentIds,
  };
}

function listOptions(options: Awaited<ReturnType<typeof fleetOptions>>) {
  const { onRentIds, ...rest } = options;
  return rest;
}

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
        /** all | listing_ready | rental_ready | not_ready */
        ready: z.string().max(20).optional().default("all"),
        page: z.number().int().min(1).max(100000).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(VEHICLE_LIST_PAGE_SIZE),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<VehicleListResult> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const ready = isReadinessFilter(data.ready) ? data.ready : "all";
    const fleet = await fleetOptions(supabaseAdmin);
    const onRentIds = [...fleet.onRentIds];

    /** The same scope for every query below: filters, minus readiness itself. */
    const scoped = <T>(q: T): T => {
      // The client's builder type is not exported; these four methods are all
      // this chains, so the shape is declared rather than widened to `any`.
      type Filters = {
        eq: (c: string, v: unknown) => Filters;
        neq: (c: string, v: unknown) => Filters;
        is: (c: string, v: unknown) => Filters;
        or: (e: string) => Filters;
        in: (c: string, v: unknown[]) => Filters;
      };
      let x = q as unknown as Filters;
      // Archived vehicles leave the normal fleet view; the Archived filter shows them.
      // "Rented" on the stat cards is live occupancy (on_rent), not vehicle.status.
      if (data.status === ON_RENT_STATUS_FILTER) {
        x = onRentIds.length ? x.in("id", onRentIds) : x.in("id", ["__none__"]);
        x = x.neq("status", "archived");
      } else if (data.status !== "all") x = x.eq("status", data.status);
      else x = x.neq("status", "archived");
      if (data.body !== "all") x = x.eq("body_type", data.body);
      if (data.partner === "__none__") x = x.is("partner_id", null);
      else if (data.partner !== "all") x = x.eq("partner_id", data.partner);
      const or = buildVehicleSearchOr(data.q);
      if (or) x = x.or(or);
      return x as unknown as T;
    };

    // Readiness over the whole filtered scope, so the chips count the fleet
    // and not the page, and so the filter can page correctly: the matching ids
    // go into the page query BEFORE range().
    const [sweep, publishedMedia] = await Promise.all([
      scoped(supabaseAdmin.from("vehicles").select(READINESS_COLUMNS)).limit(
        READINESS_SWEEP_MAX + 1,
      ),
      // Published listing photos are a small set; one read beats an id list in
      // a URL. `published` is the explicit publish flag — never inferred.
      supabaseAdmin.from("vehicle_media").select("vehicle_id").eq("published", true).limit(20000),
    ]);
    const publishedFor = new Set<string>(
      (publishedMedia.data ?? []).map((m: { vehicle_id: string }) => m.vehicle_id),
    );
    const sweepRows = (sweep.data ?? []) as Array<Record<string, unknown>>;
    const readinessPartial = sweepRows.length > READINESS_SWEEP_MAX;
    const bandOf = new Map<string, ReadinessBand>();
    const readinessCounts: ReadinessCounts = { listing_ready: 0, rental_ready: 0, not_ready: 0 };
    for (const r of sweepRows.slice(0, READINESS_SWEEP_MAX)) {
      const id = String(r.id);
      const band = readinessBand(r, publishedFor.has(id));
      bandOf.set(id, band);
      readinessCounts[band] += 1;
    }

    let query = scoped(supabaseAdmin.from("vehicles").select(LIST_COLUMNS, { count: "exact" }));
    if (ready !== "all") {
      const matching = [...bandOf].filter(([, b]) => b === ready).map(([id]) => id);
      // An empty `in` list is not a filter PostgREST will take, and the answer
      // is known anyway.
      if (!matching.length) {
        const options = listOptions(fleet);
        return {
          rows: [],
          total: 0,
          page: data.page,
          pageSize: data.pageSize,
          ...options,
          readinessCounts,
          readinessPartial,
        };
      }
      query = query.in("id", matching);
    }

    // Deterministic secondary key (id) keeps pages stable across equal values.
    for (const { column, options } of vehicleSortOrders(data.sort)) {
      query = query.order(column, options);
    }

    const from = (data.page - 1) * data.pageSize;
    const [{ data: rows, count, error }, options] = await Promise.all([
      query.range(from, from + data.pageSize - 1),
      Promise.resolve(listOptions(fleet)),
    ]);
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r: any) => r.id);
    const onRent = new Set<string>();
    let thumbnailFor = new Map<string, string>();
    let swapNotices = new Map<string, VehicleSwapNotice>();
    if (ids.length) {
      const [{ data: running }, { data: media }, { data: thumbnailSettings }, openSwaps] = await Promise.all([
        // On Rent = an actual running rental, never inferred from vehicle status.
        supabaseAdmin
          .from("rentals")
          .select("vehicle_id")
          .eq("status", "active")
          .in("vehicle_id", ids),
        // One staff-only read for the page's ORIGINAL photos. Only paths cross
        // the RPC boundary; private bytes still require staff storage access.
        supabaseAdmin
          .from("vehicle_media")
          .select("id,vehicle_id,storage_path")
          .in("vehicle_id", ids)
          .eq("kind", "original")
          .order("is_primary", { ascending: false })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("app_settings")
          .select("key,value")
          .in("key", ids.map((id: string) => vehicleListThumbnailKey(id))),
        // Open swaps touching this page's cars. A missing table (swap not
        // installed) or a read error just means no notice; the list still loads.
        Promise.resolve(
          (supabaseAdmin as unknown as FleetClient)
            .from(VEHICLE_SWAPS_TABLE)
            .select("id,swap_number,status,rental_id,from_vehicle_id,to_vehicle_id")
            .in("status", [...OPEN_SWAP_STATUSES])
            .or(`from_vehicle_id.in.(${ids.join(",")}),to_vehicle_id.in.(${ids.join(",")})`),
        ).catch(() => ({ data: null })),
      ]);
      swapNotices = vehicleSwapNotices(((openSwaps as { data: unknown } | null)?.data ?? []) as OpenSwapRow[]);
      for (const r of running ?? []) if ((r as any).vehicle_id) onRent.add((r as any).vehicle_id);
      thumbnailFor = chooseVehicleThumbnailPaths(
        (media ?? []) as VehicleThumbnailMedia[],
        (thumbnailSettings ?? []) as Array<{ key: string; value: unknown }>,
      );
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
        thumbnailPath: thumbnailFor.get(r.id) ?? null,
        on_rent: onRent.has(r.id),
        readiness: bandOf.get(r.id) ?? readinessBand(r, publishedFor.has(r.id)),
        readinessGaps: readinessGaps(r, publishedFor.has(r.id)),
        swap_notice: swapNotices.get(r.id) ?? null,
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      ...options,
      readinessCounts,
      readinessPartial,
    };
  });
