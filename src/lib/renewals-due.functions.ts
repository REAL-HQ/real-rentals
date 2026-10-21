import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RENEWALS_DUE_ENABLED } from "./renewals-due-flag";
import { RENEWAL_CANDIDATES_ENABLED } from "./renewal-candidates-flag";
import {
  RENEWALS_FETCH_LIMIT,
  buildRenewalsDue,
  easternCalendarDate,
  renewalHorizon,
  type RenewalApplication,
  type RenewalPayment,
  type RenewalRental,
  type RenewalVehicle,
  type RenewalsDueBoard,
} from "./renewals-due";

const PAYMENT_COLUMNS = "id,rental_id,status,created_at";
const PAYMENT_HISTORY_COLUMNS =
  "id,rental_id,status,created_at,type,late_fees,paid_date,due_date,attempt_count,failure_reason";

function renewalRequest(input: unknown): { windowDays: 7 | 14; goodHistoryOnly: boolean } {
  const raw = input && typeof input === "object" ? (input as { windowDays?: unknown; goodHistoryOnly?: unknown }) : {};
  return {
    windowDays: raw.windowDays === 14 ? 14 : 7,
    goodHistoryOnly: raw.goodHistoryOnly === true,
  };
}

const RENTAL_COLUMNS = "id,status,driver_id,application_id,vehicle_id,weekly_rate,end_date,next_payment_due";
const ID_BATCH = 80;

export function idBatches(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_BATCH) batches.push(ids.slice(i, i + ID_BATCH));
  return batches;
}

type IdPage<T> = { data: T[] | null; error: { message: string } | null; count: number | null };

async function rowsInBatches<T>(
  ids: string[],
  load: (batch: string[]) => PromiseLike<IdPage<T>>,
  sort?: (a: T, b: T) => number,
): Promise<{ rows: T[]; truncated: boolean }> {
  if (ids.length === 0) return { rows: [], truncated: false };
  const pages = await Promise.all(idBatches(ids).map((batch) => load(batch)));
  const rows: T[] = [];
  let count = 0;
  for (const page of pages) {
    if (page.error) throw new Error(page.error.message);
    const data = page.data ?? [];
    rows.push(...data);
    count += page.count ?? data.length;
  }
  if (sort) rows.sort(sort);
  return { rows: rows.slice(0, RENEWALS_FETCH_LIMIT), truncated: count > RENEWALS_FETCH_LIMIT };
}

export const getRenewalsDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(renewalRequest)
  .handler(async ({ data, context }): Promise<RenewalsDueBoard> => {
    if (!RENEWALS_DUE_ENABLED) throw new Error("Rental Renewal Due is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const historyEnabled = RENEWAL_CANDIDATES_ENABLED === true;
    const windowDays = historyEnabled && data.windowDays === 14 ? 14 : 7;
    const goodHistoryOnly = historyEnabled && data.goodHistoryOnly === true;
    const today = easternCalendarDate();
    const horizon = renewalHorizon(today, windowDays);
    // The 7/14 window and the Good Payment History filter apply to Renewal Due rows only.
    // Overdue Return stays every active rental whose end_date is before today.
    const [billingQ, endQ, overdueQ] = await Promise.all([
      supabaseAdmin
        .from("rentals")
        .select(RENTAL_COLUMNS, { count: "exact" })
        .eq("status", "active")
        .gte("next_payment_due", today)
        .lte("next_payment_due", horizon)
        .limit(RENEWALS_FETCH_LIMIT),
      supabaseAdmin
        .from("rentals")
        .select(RENTAL_COLUMNS)
        .eq("status", "active")
        .gte("end_date", today)
        .lte("end_date", horizon)
        .order("end_date", { ascending: true })
        .limit(RENEWALS_FETCH_LIMIT + 1),
      supabaseAdmin
        .from("rentals")
        .select(RENTAL_COLUMNS)
        .eq("status", "active")
        .lt("end_date", today)
        .order("end_date", { ascending: true })
        .limit(RENEWALS_FETCH_LIMIT + 1),
    ]);
    if (billingQ.error) throw new Error(billingQ.error.message);
    if (endQ.error) throw new Error(endQ.error.message);
    if (overdueQ.error) throw new Error(overdueQ.error.message);

    const endPage = endQ.data ?? [];
    const endTruncated = endPage.length > RENEWALS_FETCH_LIMIT;
    const endRows = endPage.slice(0, RENEWALS_FETCH_LIMIT);
    const overduePage = overdueQ.data ?? [];
    const overdueTruncated = overduePage.length > RENEWALS_FETCH_LIMIT;
    const overdueRentals = overduePage.slice(0, RENEWALS_FETCH_LIMIT);

    const byId = new Map<string, RenewalRental>();
    for (const row of [...(billingQ.data ?? []), ...endRows]) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
    const rentals = [...byId.values()];
    const over = (count: number | null, rows: number) => (count ?? rows) > RENEWALS_FETCH_LIMIT;
    const listed = [...rentals, ...overdueRentals];
    if (listed.length === 0) {
      return buildRenewalsDue({
        today,
        rentals,
        overdueRentals,
        applications: [],
        vehicles: [],
        payments: [],
        billingTruncated: over(billingQ.count, billingQ.data?.length ?? 0),
        endTruncated,
        overdueTruncated,
        historyEnabled,
        windowDays,
        goodHistoryOnly,
      });
    }

    const applicationIds = [...new Set(listed.map((row) => row.application_id).filter((id): id is string => !!id))];
    const vehicleIds = [...new Set(listed.map((row) => row.vehicle_id).filter((id): id is string => !!id))];
    const rentalIds = rentals.map((row) => row.id);

    const applicationsQ = await rowsInBatches(applicationIds, (batch) =>
      supabaseAdmin.from("applications").select("id,full_name", { count: "exact" }).in("id", batch).limit(RENEWALS_FETCH_LIMIT),
    );
    const vehiclesQ = await rowsInBatches(vehicleIds, (batch) =>
      supabaseAdmin
        .from("vehicles")
        .select("id,year,make,model,unit_number,license_plate", { count: "exact" })
        .in("id", batch)
        .limit(RENEWALS_FETCH_LIMIT),
    );
    const paymentSort = (a: RenewalPayment, b: RenewalPayment) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    const paymentsQ = historyEnabled
      ? await rowsInBatches(
          rentalIds,
          (batch) =>
            supabaseAdmin
              .from("payments")
              .select(PAYMENT_HISTORY_COLUMNS, { count: "exact" })
              .in("rental_id", batch)
              .order("created_at", { ascending: false })
              .limit(RENEWALS_FETCH_LIMIT),
          paymentSort,
        )
      : await rowsInBatches(
          rentalIds,
          (batch) =>
            supabaseAdmin
              .from("payments")
              .select(PAYMENT_COLUMNS, { count: "exact" })
              .in("rental_id", batch)
              .order("created_at", { ascending: false })
              .limit(RENEWALS_FETCH_LIMIT),
          paymentSort,
        );

    const applications: RenewalApplication[] = applicationsQ.rows;
    const vehicles: RenewalVehicle[] = vehiclesQ.rows;
    const payments: RenewalPayment[] = paymentsQ.rows;

    return buildRenewalsDue({
      today,
      rentals,
      overdueRentals,
      applications,
      vehicles,
      payments,
      billingTruncated: over(billingQ.count, billingQ.data?.length ?? 0),
      endTruncated,
      overdueTruncated,
      applicationsTruncated: applicationsQ.truncated,
      vehiclesTruncated: vehiclesQ.truncated,
      paymentsTruncated: paymentsQ.truncated,
      historyEnabled,
      windowDays,
      goodHistoryOnly,
    });
  });
