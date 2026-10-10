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
  VEHICLE_SORTS,
  type ReadinessBand,
  type ReadinessCounts,
  type VehicleListRow,
  type VehicleListResult,
} from "@/lib/vehicles-list";

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
type FacetRow = { status?: string | null; body_type?: string | null };
type FacetReader = {
  from: (t: string) => {
    select: (c: string) => { limit: (n: number) => PromiseLike<{ data: FacetRow[] | null }> };
  };
};

async function filterOptions(
  supabaseAdmin: FacetReader,
): Promise<{ statuses: string[]; bodyTypes: string[] }> {
  const facets = await supabaseAdmin.from("vehicles").select("status,body_type").limit(10000);
  const statuses = new Set<string>(["archived"]);
  const bodies = new Set<string>();
  for (const f of facets.data ?? []) {
    if (f.status) statuses.add(f.status);
    if (f.body_type) bodies.add(f.body_type);
  }
  return { statuses: [...statuses].sort(), bodyTypes: [...bodies].sort() };
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
    const sort = (VEHICLE_SORTS as readonly string[]).includes(data.sort) ? data.sort : "unit";

    const ready = isReadinessFilter(data.ready) ? data.ready : "all";

    /** The same scope for every query below: filters, minus readiness itself. */
    const scoped = <T>(q: T): T => {
      // The client's builder type is not exported; these four methods are all
      // this chains, so the shape is declared rather than widened to `any`.
      type Filters = {
        eq: (c: string, v: unknown) => Filters;
        neq: (c: string, v: unknown) => Filters;
        is: (c: string, v: unknown) => Filters;
        or: (e: string) => Filters;
      };
      let x = q as unknown as Filters;
      // Archived vehicles leave the normal fleet view; the Archived filter shows them.
      if (data.status !== "all") x = x.eq("status", data.status);
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
        const options = await filterOptions(supabaseAdmin);
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
    if (sort === "unit") query = query.order("unit_number", { ascending: true, nullsFirst: false });
    else if (sort === "make")
      query = query
        .order("make", { ascending: true, nullsFirst: false })
        .order("model", { ascending: true, nullsFirst: false });
    else if (sort === "rate")
      query = query.order("weekly_rate", { ascending: true, nullsFirst: false });
    else query = query.order("created_at", { ascending: false, nullsFirst: false });
    query = query.order("id", { ascending: true });

    const from = (data.page - 1) * data.pageSize;
    const [{ data: rows, count, error }, options] = await Promise.all([
      query.range(from, from + data.pageSize - 1),
      filterOptions(supabaseAdmin),
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
        readiness: bandOf.get(r.id) ?? readinessBand(r, publishedFor.has(r.id)),
        readinessGaps: readinessGaps(r, publishedFor.has(r.id)),
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      ...options,
      readinessCounts,
      readinessPartial,
    };
  });
