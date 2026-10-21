import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  OVERVIEW_TODAY_ENABLED,
  TODAY_OUTSTANDING_STATUSES,
  addCalendarDays,
  loadOverviewToday,
  type TodayApplication,
  type TodayDocument,
  type TodayIssue,
  type TodayPayment,
  type TodayRental,
  type TodaySources,
  type TodayVehicleDate,
} from "@/lib/overview-today";

type Admin = { from: (table: string) => any };

const DOC_KIND: Record<string, string> = {
  plate: "Plate",
  registration: "Registration",
  insurance: "Insurance",
};

function docWhat(kind: string | null | undefined): string {
  if (!kind) return "Document";
  return DOC_KIND[kind.toLowerCase()] ?? "Document";
}

function vehicleLabel(row: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  license_plate?: string | null;
}): string {
  const name = [row.year, row.make, row.model].filter((part) => part != null && String(part).trim() !== "").join(" ");
  return row.license_plate ? (name + " · " + row.license_plate).trim() : name || "Vehicle";
}

async function rowsOf<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

/**
 * Reads the same tables the existing expiring-doc, booking, payment, and
 * issue screens use. Date bounds are computed calendar strings. No writes.
 */
export async function readOverviewToday(admin: Admin, today: string): Promise<TodaySources> {
  const tomorrow = addCalendarDays(today, 1);
  const horizon = addCalendarDays(today, 7);
  const rentalFrom = addCalendarDays(today, -1);
  const rentalTo = addCalendarDays(today, 2);
  const outstanding = [...TODAY_OUTSTANDING_STATUSES];

  const paymentColumns = "id,type,status,amount,balance_due,due_date,driver_id,rental_id";
  const [due, overdue, pickupWindow, returnWindow, vehicles, directDocs, linkedDocs, issues] = await Promise.all([
    rowsOf<TodayPayment>(
      admin.from("payments").select(paymentColumns).eq("type", "rent").in("status", outstanding).gte("due_date", today).lt("due_date", tomorrow).limit(100),
    ),
    rowsOf<TodayPayment>(
      admin.from("payments").select(paymentColumns).eq("type", "rent").in("status", outstanding).lt("due_date", today).order("due_date", { ascending: true }).limit(100),
    ),
    rowsOf<TodayRental>(
      admin.from("rentals").select("id,status,start_date,end_date,application_id,vehicle_id").gte("start_date", rentalFrom).lt("start_date", rentalTo).limit(200),
    ),
    rowsOf<TodayRental>(
      admin.from("rentals").select("id,status,start_date,end_date,application_id,vehicle_id").gte("end_date", rentalFrom).lt("end_date", rentalTo).limit(200),
    ),
    rowsOf<Record<string, unknown>>(
      admin.from("vehicles").select("id,year,make,model,license_plate,plate_expires_on,registration_expires_on,insurance_expires_on"),
    ),
    rowsOf<{ id: string; vehicle_id: string | null; kind: string | null; expires_at: string | null }>(
      admin.from("documents").select("id,vehicle_id,kind,expires_at").not("vehicle_id", "is", null).not("expires_at", "is", null).eq("is_current", true).gte("expires_at", today).lte("expires_at", horizon),
    ),
    rowsOf<{ id: string; kind: string | null; expires_at: string | null }>(
      admin.from("documents").select("id,kind,expires_at").is("vehicle_id", null).not("expires_at", "is", null).eq("is_current", true).gte("expires_at", today).lte("expires_at", horizon),
    ),
    rowsOf<TodayIssue>(
      admin.from("issues").select("id,title,status,kind,driver_id,rental_id,vehicle_id").neq("status", "resolved").neq("status", "closed").order("created_at", { ascending: false }).limit(200),
    ),
  ]);

  const rentals = new Map<string, TodayRental>();
  for (const row of [...pickupWindow, ...returnWindow]) rentals.set(row.id, row);

  const vehicleById = new Map(vehicles.map((row) => [String(row.id), row]));
  const vehicleDates: TodayVehicleDate[] = [];
  for (const row of vehicles) {
    const label = vehicleLabel(row as { year?: number | null; make?: string | null; model?: string | null; license_plate?: string | null });
    vehicleDates.push(
      { id: String(row.id), label, what: "Plate", expires_on: (row.plate_expires_on as string | null) ?? null },
      { id: String(row.id), label, what: "Registration", expires_on: (row.registration_expires_on as string | null) ?? null },
      { id: String(row.id), label, what: "Insurance", expires_on: (row.insurance_expires_on as string | null) ?? null },
    );
  }

  const documents: TodayDocument[] = directDocs.map((row) => ({
    id: row.id,
    vehicle_id: row.vehicle_id,
    label: vehicleLabel((vehicleById.get(String(row.vehicle_id)) ?? {}) as { year?: number | null; make?: string | null; model?: string | null; license_plate?: string | null }),
    what: docWhat(row.kind),
    expires_on: row.expires_at,
  }));

  const linkedIds = linkedDocs.map((row) => row.id).filter(Boolean);
  if (linkedIds.length) {
    const links = await rowsOf<{ document_id: string; vehicle_id: string }>(
      admin.from("document_vehicle_links").select("document_id,vehicle_id").in("document_id", linkedIds),
    );
    const docById = new Map(linkedDocs.map((row) => [row.id, row]));
    for (const link of links) {
      const doc = docById.get(link.document_id);
      if (!doc) continue;
      documents.push({
        id: doc.id + ":" + link.vehicle_id,
        vehicle_id: link.vehicle_id,
        label: vehicleLabel((vehicleById.get(link.vehicle_id) ?? {}) as { year?: number | null; make?: string | null; model?: string | null; license_plate?: string | null }),
        what: docWhat(doc.kind),
        expires_on: doc.expires_at,
      });
    }
  }

  const appIds = [...new Set([...due, ...overdue].map((row) => row.driver_id).filter((id): id is string => !!id))];
  const rentalAppIds = [...rentals.values()].map((row) => row.application_id).filter((id): id is string => !!id);
  const applicationIds = [...new Set([...appIds, ...rentalAppIds])].slice(0, 100);
  const issueDriverIds = [...new Set(issues.map((row) => row.driver_id).filter((id): id is string => !!id))].slice(0, 100);

  const [byId, byUser] = await Promise.all([
    applicationIds.length
      ? rowsOf<TodayApplication>(admin.from("applications").select("id,full_name,user_id").in("id", applicationIds))
      : Promise.resolve([] as TodayApplication[]),
    issueDriverIds.length
      ? rowsOf<TodayApplication>(admin.from("applications").select("id,full_name,user_id").in("user_id", issueDriverIds))
      : Promise.resolve([] as TodayApplication[]),
  ]);
  const applications = [...byId];
  for (const row of byUser) {
    if (!applications.some((app) => app.id === row.id)) applications.push(row);
  }

  return {
    payments: [...due, ...overdue],
    rentals: [...rentals.values()],
    vehicleDates,
    documents,
    issues,
    applications,
  };
}

export const getOverviewToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return loadOverviewToday({
      enabled: OVERVIEW_TODAY_ENABLED,
      userId: context.userId,
      requireManager: async (userId) => {
        const { requireManager } = await import("@/lib/roles.server");
        await requireManager(userId);
      },
      read: async (today) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        return readOverviewToday(supabaseAdmin, today);
      },
    });
  });
