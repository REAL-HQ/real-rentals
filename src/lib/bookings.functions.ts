import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff } from "@/lib/roles.server";
import { tierAllows } from "@/lib/roles";
import {
  BOOKING_LIST_PAGE_SIZE,
  BOOKING_SORTS,
  bookingPhase,
  bookingSearchTargets,
  bookingUnavailable,
  isBookingPhaseFilter,
  PHASE_STATUSES,
  vehicleLabelOf,
  type BookingCounts,
  type BookingListResult,
  type BookingRow,
  type BookingPhase,
} from "@/lib/bookings-list";

// Bookings: reading the rentals that exist.
//
// EVERYTHING HERE IS A READ. There is no insert, update, upsert or delete in
// this file and there must never be one: a rental starts only through
// activate_rental_tx and ends only through end_rental_tx (guard_rental_lifecycle
// and guard_vehicle_rented_status refuse any other path), so a Bookings screen
// that wrote would be the split-write bug those triggers exist to prevent.
// Ending a rental stays endRental in rentals.functions.ts.
//
// Two boundaries this file is responsible for:
//
//   MONEY. A Coordinator is staff and may see the operational record — who has
//   which car, for how long, with which inspection and which agreement. Rent,
//   deposits, balances and charges are Manager-and-above, and they are ABSENT
//   from what the server sends rather than hidden in the browser. `canSeeMoney`
//   says which answer the caller got.
//
//   IDENTITY. rentals.driver_id is an auth user id; payments.driver_id is an
//   applications row id. The person is resolved through rentals.application_id
//   only, and the auth id is returned under a different name so the two can
//   never be confused by a caller either.

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

/**
 * Two literal column lists, not one built by concatenation: the typed client
 * parses a select string at the type level and cannot read a template literal.
 * The operational list is what a Coordinator may learn about a rental — no
 * rates, no balances, no deposit.
 */
/**
 * What happened, and what it cost, as two separate questions.
 *
 * A Coordinator may see that the car was in an accident — they may be the one
 * arranging the tow. The estimate, the actual bill, the deductible, the
 * insurance payout and the driver's share are Manager+, so they are not
 * SELECTed at all for a Coordinator rather than selected and then dropped.
 */
const INCIDENT_OPERATIONAL =
  "id,incident_type,occurred_at,reported_at,severity,status,at_fault,drivable,claim_number,description";
const INCIDENT_WITH_MONEY =
  "id,incident_type,occurred_at,reported_at,severity,status,at_fault,drivable,claim_number,description,estimated_cost,actual_cost,driver_responsible_amount";
/** Service done on this rental's car. The work is operational; the bill is not. */
const SERVICE_OPERATIONAL =
  "id,item,category,status,priority,due_date,performed_on,odometer,vendor_name_raw";
const SERVICE_WITH_MONEY =
  "id,item,category,status,priority,due_date,performed_on,odometer,vendor_name_raw,total_cost";

const RENTAL_OPERATIONAL =
  "id,status,start_date,end_date,created_at,vehicle_id,driver_id,application_id,pickup_reading_id,return_reading_id";
const RENTAL_WITH_MONEY =
  "id,status,start_date,end_date,created_at,vehicle_id,driver_id,application_id,pickup_reading_id,return_reading_id,weekly_rate,deposit_amount,deposit_held,deposit_status,deposit_refund_amount,payment_status,next_payment_due,autopay_active";

const listInput = (d: unknown) =>
  z
    .object({
      q: z.string().max(100).optional().default(""),
      phase: z.string().max(20).optional().default("all"),
      vehicleId: z.string().uuid().optional(),
      sort: z.string().max(20).optional().default("recent"),
      page: z.number().int().min(1).max(100000).optional().default(1),
      pageSize: z.number().int().min(1).max(100).optional().default(BOOKING_LIST_PAGE_SIZE),
    })
    .parse(d);

/** Columns the search box may match. Never taken from the request. */
const APPLICATION_SEARCH_COLUMNS = ["full_name", "email", "phone"] as const;
const VEHICLE_SEARCH_COLUMNS = [
  "unit_number",
  "license_plate",
  "vin",
  "make",
  "model",
] as const;

/**
 * PostgREST `or` of case-insensitive contains-filters.
 *
 * `.or()` is one filter expression, and a comma inside it starts another
 * condition. The term is therefore not interpolated at the call: it has
 * already been reduced by bookingSearchTargets, and it is reduced again here,
 * then placed only as the value of an ilike on an allowlisted column. For any
 * term that function returns, the expression is the same string a direct
 * interpolation would have built.
 */
function bookingIlikeOr(columns: readonly string[], term: string): string {
  const safe = term.replace(/[,()*%\\"':]/g, "");
  return columns.map((column) => column + ".ilike.*" + safe + "*").join(",");
}

export const listBookings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(listInput)
  .handler(async ({ data, context }): Promise<BookingListResult> => {
    const actor = await requireStaff(context.userId);
    const canSeeMoney = tierAllows(actor.tier, "manager");
    const sb = await admin();
    const phase = isBookingPhaseFilter(data.phase) ? data.phase : "all";
    const sort = (BOOKING_SORTS as readonly string[]).includes(data.sort) ? data.sort : "recent";

    // The search box matches a person or a car, neither of which is on the
    // rentals row — so the candidate ids come from those tables first and the
    // rental query is narrowed by them. Without a search this stays null and
    // nothing is narrowed.
    const q = bookingSearchTargets(data.q);
    let searchRentalIds: string[] | null = null;
    if (q) {
      const [{ data: apps }, { data: vehs }] = await Promise.all([
        sb
          .from("applications")
          .select("id")
          .or(bookingIlikeOr(APPLICATION_SEARCH_COLUMNS, q))
          .limit(500),
        sb
          .from("vehicles")
          .select("id")
          .or(bookingIlikeOr(VEHICLE_SEARCH_COLUMNS, q))
          .limit(500),
      ]);
      const appIds = (apps ?? []).map((a: { id: string }) => a.id);
      const vehIds = (vehs ?? []).map((v: { id: string }) => v.id);
      const ids = new Set<string>();
      if (appIds.length) {
        const { data: r } = await sb
          .from("rentals")
          .select("id")
          .in("application_id", appIds)
          .limit(2000);
        for (const x of r ?? []) ids.add((x as { id: string }).id);
      }
      if (vehIds.length) {
        const { data: r } = await sb
          .from("rentals")
          .select("id")
          .in("vehicle_id", vehIds)
          .limit(2000);
        for (const x of r ?? []) ids.add((x as { id: string }).id);
      }
      searchRentalIds = [...ids];
    }

    /** The same scope for the page and the counts: filters, minus the phase. */
    const scoped = <T>(query: T): T => {
      // Only the filter methods used here; the client's builder type is not
      // exported, so the shape is declared rather than widened to `any`.
      type Filters = {
        eq: (c: string, v: unknown) => Filters;
        in: (c: string, v: unknown[]) => Filters;
      };
      let x = query as unknown as Filters;
      if (data.vehicleId) x = x.eq("vehicle_id", data.vehicleId);
      if (searchRentalIds) x = x.in("id", searchRentalIds);
      return x as unknown as T;
    };

    // A search that matched nobody is an empty answer, not an unfiltered one —
    // and PostgREST will not take an empty `in` list.
    const empty: BookingCounts = { active: 0, completed: 0, cancelled: 0 };
    if (searchRentalIds && !searchRentalIds.length) {
      return {
        rows: [],
        total: 0,
        page: data.page,
        pageSize: data.pageSize,
        counts: empty,
        canSeeMoney,
      };
    }

    // Counts cover the scope, never the page: paging must not change them.
    const { data: statusRows } = await scoped(sb.from("rentals").select("status")).limit(5000);
    const counts: BookingCounts = { ...empty };
    for (const r of (statusRows ?? []) as Array<{ status: string | null }>) {
      const p = bookingPhase(r.status);
      if (p === "reserved") continue; // Phase A never claims an upcoming booking.
      counts[p] += 1;
    }

    let query = scoped(
      sb
        .from("rentals")
        .select(canSeeMoney ? RENTAL_WITH_MONEY : RENTAL_OPERATIONAL, { count: "exact" }),
    );
    if (phase !== "all") query = query.in("status", PHASE_STATUSES[phase] as string[]);
    // Deterministic secondary key keeps pages stable across equal values.
    if (sort === "oldest")
      query = query.order("created_at", { ascending: true, nullsFirst: false });
    else query = query.order("created_at", { ascending: false, nullsFirst: false });
    query = query.order("id", { ascending: true });

    const from = (data.page - 1) * data.pageSize;
    const { data: rentals, count } = await query.range(from, from + data.pageSize - 1);
    const rows = (rentals ?? []) as unknown as Array<Record<string, unknown>>;

    const appIds = [...new Set(rows.map((r) => r.application_id).filter(Boolean))] as string[];
    const vehIds = [...new Set(rows.map((r) => r.vehicle_id).filter(Boolean))] as string[];
    const [apps, vehicles] = await Promise.all([
      appIds.length
        ? sb.from("applications").select("id,full_name,email").in("id", appIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      vehIds.length
        ? sb
            .from("vehicles")
            .select("id,unit_number,year,make,model,license_plate")
            .in("id", vehIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);
    const appById = new Map((apps.data ?? []).map((a) => [String(a.id), a]));
    const vehById = new Map((vehicles.data ?? []).map((v) => [String(v.id), v]));

    // Outstanding balance per rental, Manager+ only.
    const balance = new Map<string, number>();
    if (canSeeMoney && rows.length) {
      const { data: due } = await sb
        .from("payments")
        .select("rental_id,balance_due,amount,status")
        .in(
          "rental_id",
          rows.map((r) => String(r.id)),
        )
        .neq("status", "paid");
      for (const p of (due ?? []) as Array<Record<string, unknown>>) {
        const id = String(p.rental_id ?? "");
        if (!id) continue;
        const owed = Number(p.balance_due ?? p.amount ?? 0);
        balance.set(id, (balance.get(id) ?? 0) + (Number.isFinite(owed) ? owed : 0));
      }
    }

    const out: BookingRow[] = rows.map((r) => {
      const app = r.application_id ? appById.get(String(r.application_id)) : undefined;
      const veh = r.vehicle_id ? vehById.get(String(r.vehicle_id)) : undefined;
      const phaseOf = bookingPhase(r.status as string | null);
      const row: BookingRow = {
        id: String(r.id),
        source: "rental",
        phase: phaseOf,
        status: (r.status as string | null) ?? null,
        startDate: (r.start_date as string | null) ?? null,
        endDate: (r.end_date as string | null) ?? null,
        openEnded: !r.end_date && phaseOf === "active",
        driverName: (app?.full_name as string | null) ?? null,
        driverEmail: (app?.email as string | null) ?? null,
        applicationId: (r.application_id as string | null) ?? null,
        driverUserId: (r.driver_id as string | null) ?? null,
        vehicleId: (r.vehicle_id as string | null) ?? null,
        unitNumber: (veh?.unit_number as string | null) ?? null,
        vehicleLabel: vehicleLabelOf(veh as never) ?? null,
        plate: (veh?.license_plate as string | null) ?? null,
      };
      if (canSeeMoney) {
        row.weeklyRate = r.weekly_rate == null ? null : Number(r.weekly_rate);
        row.paymentStatus = (r.payment_status as string | null) ?? null;
        row.depositStatus = (r.deposit_status as string | null) ?? null;
        row.balanceDue = balance.get(String(r.id)) ?? 0;
      }
      return row;
    });

    // Sorting by a person or a car is sorting by a value that is not on the
    // rentals row; the page is already chosen, so it is ordered here.
    if (sort === "driver")
      out.sort((a, b) => (a.driverName ?? "~").localeCompare(b.driverName ?? "~"));
    if (sort === "vehicle")
      out.sort((a, b) => (a.unitNumber ?? "~").localeCompare(b.unitNumber ?? "~"));

    return {
      rows: out,
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      counts,
      canSeeMoney,
    };
  });

export type BookingDetail = {
  booking: BookingRow;
  driver: {
    applicationId: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    applicationStatus: string | null;
    /** The portal login. Deliberately not called driver_id. */
    portalUserId: string | null;
  };
  vehicle: {
    id: string | null;
    unitNumber: string | null;
    label: string | null;
    plate: string | null;
    vin: string | null;
    color: string | null;
    status: string | null;
  } | null;
  mileage: { pickup: number | null; return: number | null };
  inspections: Array<{
    id: string;
    type: string | null;
    status: string | null;
    startedAt: string | null;
    completedAt: string | null;
    odometer: number | null;
    inspector: string | null;
    driverSignedAt: string | null;
    photoCount: number;
  }>;
  agreements: Array<{
    id: string;
    title: string | null;
    status: string | null;
    sentAt: string | null;
    signedAt: string | null;
    voidedAt: string | null;
    archiveStatus: string | null;
    documentId: string | null;
  }>;
  /**
   * Incidents already recorded against this rental.
   *
   * What happened is operational — a Coordinator arranging a tow needs to know
   * the car was in an accident. What it COST is not: estimated, actual, the
   * deductible, the insurance payout and the driver's share are Manager+ and
   * are absent from a Coordinator's answer, the same way the rate is.
   */
  incidents: Array<{
    id: string;
    type: string | null;
    occurredAt: string | null;
    reportedAt: string | null;
    severity: string | null;
    status: string | null;
    atFault: string | null;
    drivable: boolean | null;
    claimNumber: string | null;
    description: string | null;
    /** Manager+ only. */
    estimatedCost?: number | null;
    actualCost?: number | null;
    driverResponsible?: number | null;
  }>;
  /**
   * Service on this rental's car, linked to this rental. Operating cost is
   * Manager's to see (AGENTS.md: Managers keep operating costs), so `totalCost`
   * is absent for a Coordinator while the work itself is not.
   */
  maintenance: Array<{
    id: string;
    item: string | null;
    category: string | null;
    status: string | null;
    priority: string | null;
    dueDate: string | null;
    performedOn: string | null;
    odometer: number | null;
    vendorName: string | null;
    /** Manager+ only. */
    totalCost?: number | null;
  }>;
  /** Manager+ only. */
  money?: {
    payments: Array<{
      id: string;
      type: string | null;
      status: string | null;
      amount: number;
      balanceDue: number | null;
      dueDate: string | null;
      paidDate: string | null;
      netCollected: number | null;
    }>;
    charges: Array<{
      id: string;
      chargeType: string | null;
      agency: string | null;
      amount: number;
      adminFee: number | null;
      status: string | null;
      occurredAt: string | null;
    }>;
    deposit: {
      amount: number | null;
      held: boolean | null;
      status: string | null;
      refunded: number | null;
    };
  };
  counts: {
    inspections: number;
    agreements: number;
    conditionPhotos: number;
    payments: number;
    charges: number;
    incidents: number;
    maintenance: number;
  };
  /** What this record genuinely cannot say yet. */
  unavailable: string[];
  canSeeMoney: boolean;
  /**
   * May this caller run the rental actions (end it, settle its deposit)?
   *
   * The same Manager boundary as the money today, but a separate answer on
   * purpose: the screen asks two different questions, and each action is
   * re-authorised by its own server function regardless of what this says.
   * Nothing here is a permission — it only decides what is worth offering.
   */
  canManage: boolean;
};

export const getBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<BookingDetail | null> => {
    const actor = await requireStaff(context.userId);
    const canSeeMoney = tierAllows(actor.tier, "manager");
    const sb = await admin();

    const { data: r } = await sb
      .from("rentals")
      .select(canSeeMoney ? RENTAL_WITH_MONEY : RENTAL_OPERATIONAL)
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!r) return null;
    const rental = r as unknown as Record<string, unknown>;
    const phaseOf: BookingPhase = bookingPhase(rental.status as string | null);

    const readingIds = [rental.pickup_reading_id, rental.return_reading_id].filter(
      Boolean,
    ) as string[];

    const [app, veh, insp, agree, readings, media, inc, svc] = await Promise.all([
      rental.application_id
        ? sb
            .from("applications")
            .select("id,full_name,email,phone,status,user_id")
            .eq("id", String(rental.application_id))
            .maybeSingle()
        : Promise.resolve({ data: null }),
      rental.vehicle_id
        ? sb
            .from("vehicles")
            .select("id,unit_number,year,make,model,license_plate,vin,color,status")
            .eq("id", String(rental.vehicle_id))
            .maybeSingle()
        : Promise.resolve({ data: null }),
      sb
        .from("inspections")
        .select(
          "id,inspection_type,status,started_at,completed_at,odometer,inspector_name,driver_signed_at",
        )
        .eq("rental_id", data.rentalId)
        .order("created_at", { ascending: false }),
      sb
        .from("agreements")
        .select("id,title,status,sent_at,signed_at,voided_at,archive_status,document_id")
        .eq("rental_id", data.rentalId)
        .order("created_at", { ascending: false }),
      // A rental may point at neither reading. PostgREST cannot parse an empty
      // `in()` list, so an unguarded ask here would fail the whole record for
      // exactly the rentals with the least on them.
      readingIds.length
        ? sb.from("odometer_readings").select("id,mileage").in("id", readingIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      sb.from("condition_media").select("id,inspection_id").eq("rental_id", data.rentalId),
      // Two literal column lists rather than one built from a flag: the typed
      // client parses the select string at the type level, so a conditional
      // expression is not something it can read.
      sb
        .from("incidents")
        .select(canSeeMoney ? INCIDENT_WITH_MONEY : INCIDENT_OPERATIONAL)
        .eq("rental_id", data.rentalId)
        .order("occurred_at", { ascending: false, nullsFirst: false }),
      sb
        .from("maintenance_records")
        .select(canSeeMoney ? SERVICE_WITH_MONEY : SERVICE_OPERATIONAL)
        .eq("rental_id", data.rentalId)
        .order("performed_on", { ascending: false, nullsFirst: false }),
    ]);

    const mileageById = new Map(
      ((readings.data ?? []) as Array<Record<string, unknown>>).map((x) => [
        String(x.id),
        Number(x.mileage),
      ]),
    );
    const photosByInspection = new Map<string, number>();
    for (const m of (media.data ?? []) as Array<Record<string, unknown>>) {
      const key = String(m.inspection_id ?? "");
      if (key) photosByInspection.set(key, (photosByInspection.get(key) ?? 0) + 1);
    }

    const inspections = ((insp.data ?? []) as Array<Record<string, unknown>>).map((i) => ({
      id: String(i.id),
      type: (i.inspection_type as string | null) ?? null,
      status: (i.status as string | null) ?? null,
      startedAt: (i.started_at as string | null) ?? null,
      completedAt: (i.completed_at as string | null) ?? null,
      odometer: i.odometer == null ? null : Number(i.odometer),
      inspector: (i.inspector_name as string | null) ?? null,
      driverSignedAt: (i.driver_signed_at as string | null) ?? null,
      photoCount: photosByInspection.get(String(i.id)) ?? 0,
    }));
    const agreements = ((agree.data ?? []) as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.id),
      title: (a.title as string | null) ?? null,
      status: (a.status as string | null) ?? null,
      sentAt: (a.sent_at as string | null) ?? null,
      signedAt: (a.signed_at as string | null) ?? null,
      voidedAt: (a.voided_at as string | null) ?? null,
      archiveStatus: (a.archive_status as string | null) ?? null,
      documentId: (a.document_id as string | null) ?? null,
    }));

    const incidents = ((inc.data ?? []) as unknown as Array<Record<string, unknown>>).map((i) => {
      const row: BookingDetail["incidents"][number] = {
        id: String(i.id),
        type: (i.incident_type as string | null) ?? null,
        occurredAt: (i.occurred_at as string | null) ?? null,
        reportedAt: (i.reported_at as string | null) ?? null,
        severity: (i.severity as string | null) ?? null,
        status: (i.status as string | null) ?? null,
        atFault: (i.at_fault as string | null) ?? null,
        drivable: (i.drivable as boolean | null) ?? null,
        claimNumber: (i.claim_number as string | null) ?? null,
        description: (i.description as string | null) ?? null,
      };
      if (canSeeMoney) {
        row.estimatedCost = i.estimated_cost == null ? null : Number(i.estimated_cost);
        row.actualCost = i.actual_cost == null ? null : Number(i.actual_cost);
        row.driverResponsible =
          i.driver_responsible_amount == null ? null : Number(i.driver_responsible_amount);
      }
      return row;
    });
    const maintenance = ((svc.data ?? []) as unknown as Array<Record<string, unknown>>).map((m) => {
      const row: BookingDetail["maintenance"][number] = {
        id: String(m.id),
        item: (m.item as string | null) ?? null,
        category: (m.category as string | null) ?? null,
        status: (m.status as string | null) ?? null,
        priority: (m.priority as string | null) ?? null,
        dueDate: (m.due_date as string | null) ?? null,
        performedOn: (m.performed_on as string | null) ?? null,
        odometer: m.odometer == null ? null : Number(m.odometer),
        vendorName: (m.vendor_name_raw as string | null) ?? null,
      };
      if (canSeeMoney) row.totalCost = m.total_cost == null ? null : Number(m.total_cost);
      return row;
    });

    let money: BookingDetail["money"];
    let paymentCount = 0;
    let chargeCount = 0;
    if (canSeeMoney) {
      const [pay, charges] = await Promise.all([
        sb
          .from("payments")
          .select("id,type,status,amount,balance_due,due_date,paid_date,net_collected")
          .eq("rental_id", data.rentalId)
          .order("due_date", { ascending: false, nullsFirst: false }),
        sb
          .from("toll_charges")
          .select("id,charge_type,agency,amount,admin_fee,status,occurred_at")
          .eq("rental_id", data.rentalId)
          .order("occurred_at", { ascending: false, nullsFirst: false }),
      ]);
      const payments = ((pay.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
        id: String(p.id),
        type: (p.type as string | null) ?? null,
        status: (p.status as string | null) ?? null,
        amount: Number(p.amount ?? 0),
        balanceDue: p.balance_due == null ? null : Number(p.balance_due),
        dueDate: (p.due_date as string | null) ?? null,
        paidDate: (p.paid_date as string | null) ?? null,
        netCollected: p.net_collected == null ? null : Number(p.net_collected),
      }));
      const chargeRows = ((charges.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
        id: String(c.id),
        chargeType: (c.charge_type as string | null) ?? null,
        agency: (c.agency as string | null) ?? null,
        amount: Number(c.amount ?? 0),
        adminFee: c.admin_fee == null ? null : Number(c.admin_fee),
        status: (c.status as string | null) ?? null,
        occurredAt: (c.occurred_at as string | null) ?? null,
      }));
      paymentCount = payments.length;
      chargeCount = chargeRows.length;
      money = {
        payments,
        charges: chargeRows,
        deposit: {
          amount: rental.deposit_amount == null ? null : Number(rental.deposit_amount),
          held: (rental.deposit_held as boolean | null) ?? null,
          status: (rental.deposit_status as string | null) ?? null,
          refunded:
            rental.deposit_refund_amount == null ? null : Number(rental.deposit_refund_amount),
        },
      };
    }

    const appRow = (app.data ?? null) as Record<string, unknown> | null;
    const vehRow = (veh.data ?? null) as Record<string, unknown> | null;
    const pickup = rental.pickup_reading_id
      ? (mileageById.get(String(rental.pickup_reading_id)) ?? null)
      : null;
    const ret = rental.return_reading_id
      ? (mileageById.get(String(rental.return_reading_id)) ?? null)
      : null;

    const booking: BookingRow = {
      id: String(rental.id),
      source: "rental",
      phase: phaseOf,
      status: (rental.status as string | null) ?? null,
      startDate: (rental.start_date as string | null) ?? null,
      endDate: (rental.end_date as string | null) ?? null,
      openEnded: !rental.end_date && phaseOf === "active",
      driverName: (appRow?.full_name as string | null) ?? null,
      driverEmail: (appRow?.email as string | null) ?? null,
      applicationId: (rental.application_id as string | null) ?? null,
      driverUserId: (rental.driver_id as string | null) ?? null,
      vehicleId: (rental.vehicle_id as string | null) ?? null,
      unitNumber: (vehRow?.unit_number as string | null) ?? null,
      vehicleLabel: vehicleLabelOf(vehRow as never) ?? null,
      plate: (vehRow?.license_plate as string | null) ?? null,
    };
    if (canSeeMoney) {
      booking.weeklyRate = rental.weekly_rate == null ? null : Number(rental.weekly_rate);
      booking.paymentStatus = (rental.payment_status as string | null) ?? null;
      booking.depositStatus = (rental.deposit_status as string | null) ?? null;
      booking.balanceDue = (money?.payments ?? [])
        .filter((p) => p.status !== "paid")
        .reduce((n, p) => n + (p.balanceDue ?? p.amount ?? 0), 0);
    }

    return {
      booking,
      driver: {
        applicationId: (rental.application_id as string | null) ?? null,
        name: (appRow?.full_name as string | null) ?? null,
        email: (appRow?.email as string | null) ?? null,
        phone: (appRow?.phone as string | null) ?? null,
        applicationStatus: (appRow?.status as string | null) ?? null,
        portalUserId: (rental.driver_id as string | null) ?? null,
      },
      vehicle: vehRow
        ? {
            id: String(vehRow.id),
            unitNumber: (vehRow.unit_number as string | null) ?? null,
            label: vehicleLabelOf(vehRow as never),
            plate: (vehRow.license_plate as string | null) ?? null,
            vin: (vehRow.vin as string | null) ?? null,
            color: (vehRow.color as string | null) ?? null,
            status: (vehRow.status as string | null) ?? null,
          }
        : null,
      mileage: { pickup, return: ret },
      inspections,
      agreements,
      incidents,
      maintenance,
      money,
      counts: {
        inspections: inspections.length,
        agreements: agreements.length,
        conditionPhotos: (media.data ?? []).length,
        payments: paymentCount,
        charges: chargeCount,
        incidents: incidents.length,
        maintenance: maintenance.length,
      },
      canManage: canSeeMoney,
      unavailable: bookingUnavailable({
        phase: phaseOf,
        applicationId: (rental.application_id as string | null) ?? null,
        startDate: (rental.start_date as string | null) ?? null,
        endDate: (rental.end_date as string | null) ?? null,
        pickupMileage: pickup,
        returnMileage: ret,
        inspectionCount: inspections.length,
        agreementCount: agreements.length,
      }),
      canSeeMoney,
    };
  });
