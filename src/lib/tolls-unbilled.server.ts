import { tierAllows, type StaffTier } from "./roles";
import {
  buildUnbilledTolls,
  type DeductionInput,
  type DriverInput,
  type PaymentInput,
  type RentalInput,
  type TollInput,
  type UnbilledLoad,
  type UnbilledTollsResponse,
  type VehicleInput,
} from "./tolls-unbilled";

/** Page size for every read. Callers ask for one extra row and do not keep it. */
export const PAGE = 100;
export const MAX_PAGES = 20;
export const ID_CHUNK = 50;

type PageResult = {
  data: unknown[] | null;
  error: { message: string } | null;
  count: number | null;
};

type Db = { from: (table: string) => any };

export async function readPages(
  fetchPage: (cursor: string | null) => PromiseLike<PageResult>,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean } | null> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let expected: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(cursor);
    if (!result || result.error || !Array.isArray(result.data)) return null;
    if (page === 0) {
      if (result.count == null || !Number.isInteger(result.count) || result.count < 0) return null;
      expected = result.count;
    }
    if (result.data.length > PAGE + 1) return null;
    const extra = result.data.length === PAGE + 1;
    const chunk = (extra ? result.data.slice(0, PAGE) : result.data) as Record<string, unknown>[];
    for (const row of chunk) {
      const id = typeof row?.id === "string" ? row.id : "";
      if (!id || (cursor != null && id <= cursor)) return null;
      rows.push(row);
      cursor = id;
    }
    if (extra) {
      const probe = result.data[PAGE] as Record<string, unknown> | undefined;
      const extraId = typeof probe?.id === "string" ? probe.id : "";
      if (!extraId || (cursor != null && extraId <= cursor)) return null;
      continue;
    }
    if (rows.length !== expected) return null;
    return { rows, truncated: false };
  }
  if (expected == null || !(expected > rows.length)) return null;
  return { rows, truncated: true };
}

function chunks(ids: string[]): string[][] {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) out.push(unique.slice(i, i + ID_CHUNK));
  return out;
}

async function readFiltered(
  db: Db,
  table: string,
  columns: string,
  refine: (query: any) => any,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean } | null> {
  return readPages((cursor) => {
    let query = db.from(table).select(columns, { count: "exact" }).order("id");
    if (cursor) query = query.gt("id", cursor);
    query = refine(query);
    return query.limit(PAGE + 1);
  });
}

async function readIdChunks(
  db: Db,
  table: string,
  columns: string,
  ids: string[],
  refine: (query: any, ids: string[]) => any,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean } | null> {
  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  const groups = chunks(ids);
  if (!groups.length) return { rows, truncated };
  for (const group of groups) {
    const page = await readFiltered(db, table, columns, (query) => refine(query, group));
    if (!page) return null;
    rows.push(...page.rows);
    truncated = truncated || page.truncated;
  }
  return { rows, truncated };
}

function mapToll(row: Record<string, unknown>): TollInput {
  return {
    id: String(row.id ?? ""),
    vehicleId: row.vehicle_id == null ? "" : String(row.vehicle_id),
    rentalId: row.rental_id == null ? null : String(row.rental_id),
    occurredAt: row.occurred_at == null ? null : String(row.occurred_at),
    amount: (row.amount as string | number | null) ?? null,
    adminFee: (row.admin_fee as string | number | null) ?? null,
    status: row.status == null ? null : String(row.status),
    paymentId: row.payment_id == null ? null : String(row.payment_id),
  };
}

function mapRental(row: Record<string, unknown>): RentalInput {
  return {
    id: String(row.id ?? ""),
    vehicleId: row.vehicle_id == null ? "" : String(row.vehicle_id),
    driverId: row.driver_id == null ? "" : String(row.driver_id),
    applicationId: row.application_id == null ? null : String(row.application_id),
    status: row.status == null ? null : String(row.status),
    startDate: row.start_date == null ? null : String(row.start_date),
    endDate: row.end_date == null ? null : String(row.end_date),
  };
}

function mapDeduction(row: Record<string, unknown>): DeductionInput {
  return {
    id: String(row.id ?? ""),
    rentalId: row.rental_id == null ? null : String(row.rental_id),
    tollChargeId: row.toll_charge_id == null ? null : String(row.toll_charge_id),
  };
}

function mapVehicle(row: Record<string, unknown>): VehicleInput {
  return {
    id: String(row.id ?? ""),
    year: (row.year as number | string | null) ?? null,
    make: row.make == null ? null : String(row.make),
    model: row.model == null ? null : String(row.model),
    licensePlate: row.license_plate == null ? null : String(row.license_plate),
  };
}

function mapPayment(row: Record<string, unknown>): PaymentInput {
  return {
    id: String(row.id ?? ""),
    driverId: row.driver_id == null ? null : String(row.driver_id),
    status: row.status == null ? null : String(row.status),
  };
}

function mapDriver(row: Record<string, unknown>): DriverInput {
  return {
    id: String(row.id ?? ""),
    fullName: row.full_name == null ? null : String(row.full_name),
  };
}

/**
 * Reads only. Tolls first; a failed toll page never opens a later table.
 * No charge is created here.
 */
export async function loadUnbilledTolls(db: Db): Promise<UnbilledLoad | null> {
  try {
    const tollsPage = await readFiltered(
      db,
      "toll_charges",
      "id,vehicle_id,rental_id,occurred_at,amount,admin_fee,status,payment_id",
      (query) => query,
    );
    if (!tollsPage) return null;
    const tolls = tollsPage.rows.map(mapToll);
    const tollIds = tolls.map((toll) => toll.id);
    const rentalsPage = tollIds.length
      ? await readFiltered(db, "rentals", "id,vehicle_id,driver_id,application_id,status,start_date,end_date", (query) =>
          query.eq("status", "active"),
        )
      : { rows: [], truncated: false };
    if (!rentalsPage) return null;
    const deductionsPage = tollIds.length
      ? await readIdChunks(db, "deposit_deductions", "id,rental_id,toll_charge_id", tollIds, (query, ids) =>
          query.not("toll_charge_id", "is", null).in("toll_charge_id", ids),
        )
      : { rows: [], truncated: false };
    if (!deductionsPage) return null;

    const rentals = rentalsPage.rows.map(mapRental);
    const vehicleIds = [...new Set([...tolls.map((toll) => toll.vehicleId), ...rentals.map((rental) => rental.vehicleId)])];
    const vehiclesPage = await readIdChunks(db, "vehicles", "id,year,make,model,license_plate", vehicleIds, (query, ids) =>
      query.in("id", ids),
    );
    const paymentIds = tolls.map((toll) => toll.paymentId).filter((id): id is string => Boolean(id));
    const paymentsPage = await readIdChunks(db, "payments", "id,driver_id,status", paymentIds, (query, ids) =>
      query.in("id", ids),
    );
    if (!paymentsPage) return null;
    const driverIds = [
      ...new Set(rentals.flatMap((rental) => [rental.driverId, rental.applicationId].filter((id): id is string => Boolean(id)))),
    ];
    const driversPage = await readIdChunks(db, "applications", "id,full_name", driverIds, (query, ids) => query.in("id", ids));

    return {
      tolls,
      rentals,
      payments: paymentsPage.rows.map(mapPayment),
      deductions: deductionsPage.rows.map(mapDeduction),
      vehicles: vehiclesPage ? vehiclesPage.rows.map(mapVehicle) : [],
      drivers: driversPage ? driversPage.rows.map(mapDriver) : [],
      caps: {
        tolls: tollsPage.truncated,
        rentals: rentalsPage.truncated,
        payments: paymentsPage.truncated,
        deductions: deductionsPage.truncated,
        vehicles: !vehiclesPage || vehiclesPage.truncated,
        drivers: !driversPage || driversPage.truncated,
      },
    };
  } catch {
    return null;
  }
}

export async function runUnbilledTolls(args: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  now?: Date;
  load: () => Promise<UnbilledLoad | null>;
}): Promise<UnbilledTollsResponse> {
  if (!args.enabled) return { status: "disabled", report: null };
  if (!args.userId || !tierAllows(args.tier, "manager")) throw new Error("Forbidden");
  const loaded = await args.load();
  if (!loaded) return { status: "unavailable", reason: "The toll read did not complete.", report: null };
  return { status: "ready", report: buildUnbilledTolls(loaded, args.now ?? new Date()) };
}
