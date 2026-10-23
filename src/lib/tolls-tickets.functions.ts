import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { TOLLS_TICKETS_LEDGER_ENABLED } from "./tolls-tickets-flag";
import {
  TOLLS_TICKETS_PAGE_CAP,
  buildTollsTicketsLedger,
  type TollsChargeRow,
  type TollsIncidentRow,
  type TollsName,
  type TollsPaymentRow,
  type TollsRead,
  type TollsTicketsLedger,
} from "./tolls-tickets";

type Admin = SupabaseClient<Database>;

const CHARGE_COLUMNS =
  "id,vehicle_id,rental_id,application_id,charge_type,occurred_at,amount,admin_fee,status,payment_id,notes,reference_number" as const;
const PAYMENT_COLUMNS =
  "id,type,amount,status,driver_id,rental_id,vehicle_id,notes,due_date,paid_date,created_at" as const;
const INCIDENT_COLUMNS =
  "id,incident_type,description,notes,occurred_at,application_id,rental_id,vehicle_id,driver_responsible_amount" as const;
const CHARGE_TYPES = ["toll", "citation", "parking", "red_light", "speeding", "impound"] as const;
const PAYMENT_TYPES = ["toll", "fee"] as const;

/** Manager and owner read of tolls, tickets, and violations. Throws while the flag is off. */
export const getTollsTicketsLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TollsTicketsLedger> => {
    if (!TOLLS_TICKETS_LEDGER_ENABLED) throw new Error("Tolls And Tickets is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return readTollsTicketsLedger(supabaseAdmin);
  });

function failed<T>(): TollsRead<T> {
  return { rows: null, count: null, error: true };
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function readTollsTicketsLedger(admin: Admin): Promise<TollsTicketsLedger> {
  const chargesQ = await admin
    .from("toll_charges")
    .select(CHARGE_COLUMNS, { count: "exact" })
    .in("charge_type", [...CHARGE_TYPES])
    .order("occurred_at", { ascending: false })
    .limit(TOLLS_TICKETS_PAGE_CAP);
  const paymentsQ = await admin
    .from("payments")
    .select(PAYMENT_COLUMNS, { count: "exact" })
    .in("type", [...PAYMENT_TYPES])
    .order("created_at", { ascending: false })
    .limit(TOLLS_TICKETS_PAGE_CAP);
  const incidentsQ = await admin
    .from("incidents")
    .select(INCIDENT_COLUMNS, { count: "exact" })
    .order("occurred_at", { ascending: false })
    .limit(TOLLS_TICKETS_PAGE_CAP);

  const charges = mapCharges(chargesQ);
  const payments = mapPayments(paymentsQ);
  const incidents = mapIncidents(incidentsQ);
  const blocked = [charges, payments, incidents].some(
    (read) => read.error || read.count == null || read.rows == null || read.count > TOLLS_TICKETS_PAGE_CAP,
  );
  if (blocked) {
    return buildTollsTicketsLedger({
      charges,
      payments,
      incidents,
      linkedPayments: { rows: [], count: 0, error: false },
      renters: [],
      vehicles: [],
      rentals: [],
    });
  }

  const chargeRows = charges.rows ?? [];
  const paymentRows = payments.rows ?? [];
  const incidentRows = incidents.rows ?? [];
  const linkedIds = [...new Set(chargeRows.flatMap((row) => (row.paymentId ? [row.paymentId] : [])))];
  const linkedQ = linkedIds.length
    ? await admin.from("payments").select(PAYMENT_COLUMNS).in("id", linkedIds)
    : { data: [], error: null };
  const linkedPayments = mapPayments({ ...linkedQ, count: linkedQ.data?.length ?? null });

  const renterIds = unique([
    ...chargeRows.flatMap((row) => (row.applicationId ? [row.applicationId] : [])),
    ...paymentRows.flatMap((row) => (row.driverId ? [row.driverId] : [])),
    ...incidentRows.flatMap((row) => (row.applicationId ? [row.applicationId] : [])),
  ]);
  const vehicleIds = unique([
    ...chargeRows.map((row) => row.vehicleId),
    ...paymentRows.flatMap((row) => (row.vehicleId ? [row.vehicleId] : [])),
    ...incidentRows.map((row) => row.vehicleId),
  ]);
  const rentalIds = unique([
    ...chargeRows.flatMap((row) => (row.rentalId ? [row.rentalId] : [])),
    ...paymentRows.flatMap((row) => (row.rentalId ? [row.rentalId] : [])),
    ...incidentRows.flatMap((row) => (row.rentalId ? [row.rentalId] : [])),
  ]);

  const rentersQ = renterIds.length
    ? await admin.from("applications").select("id,full_name").in("id", renterIds)
    : { data: [], error: null };
  const vehiclesQ = vehicleIds.length
    ? await admin.from("vehicles").select("id,year,make,model,unit_number,license_plate").in("id", vehicleIds)
    : { data: [], error: null };
  const rentalsQ = rentalIds.length
    ? await admin.from("rentals").select("id,status,start_date").in("id", rentalIds)
    : { data: [], error: null };

  return buildTollsTicketsLedger({
    charges,
    payments,
    incidents,
    linkedPayments: rentersQ.error || vehiclesQ.error || rentalsQ.error ? failed() : linkedPayments,
    renters: (rentersQ.data ?? []).map((row) => ({ id: row.id, label: row.full_name || "Not Recorded" })),
    vehicles: (vehiclesQ.data ?? []).map((row) => ({
      id: row.id,
      label: joinedLabel([row.unit_number, row.year, row.make, row.model, row.license_plate]),
    })),
    rentals: (rentalsQ.data ?? []).map((row) => ({
      id: row.id,
      label: joinedLabel([row.status, row.start_date]),
    })),
  });
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function joinedLabel(parts: Array<string | number | null>): string {
  const kept: string[] = [];
  for (const part of parts) {
    if (part) kept.push(String(part));
  }
  return kept.join(" ") || "Not Recorded";
}

type QueryBag = { data: unknown; error: { message: string } | null; count: number | null };

function recordRows(data: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(data)) return null;
  const rows: Record<string, unknown>[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") return null;
    rows.push(row as Record<string, unknown>);
  }
  return rows;
}

function mapCharges(result: QueryBag): TollsRead<TollsChargeRow> {
  const data = recordRows(result.data);
  if (result.error || !data || result.count == null) return failed();
  const rows: TollsChargeRow[] = [];
  for (const row of data) {
    const amount = finiteNumber(row.amount);
    const adminFee = finiteNumber(row.admin_fee);
    if (amount == null || adminFee == null || typeof row.id !== "string" || typeof row.vehicle_id !== "string") return failed();
    rows.push({
      id: row.id,
      vehicleId: row.vehicle_id,
      rentalId: stringOrNull(row.rental_id),
      applicationId: stringOrNull(row.application_id),
      chargeType: String(row.charge_type ?? ""),
      occurredAt: String(row.occurred_at ?? ""),
      amount,
      adminFee,
      status: String(row.status ?? ""),
      paymentId: stringOrNull(row.payment_id),
      notes: stringOrNull(row.notes),
      referenceNumber: stringOrNull(row.reference_number),
    });
  }
  return { rows, count: result.count, error: false };
}

function mapPayments(result: QueryBag): TollsRead<TollsPaymentRow> {
  const data = recordRows(result.data);
  if (result.error || !data || result.count == null) return failed();
  const rows: TollsPaymentRow[] = [];
  for (const row of data) {
    const amount = finiteNumber(row.amount);
    if (amount == null || typeof row.id !== "string") return failed();
    rows.push({
      id: row.id,
      type: String(row.type ?? ""),
      amount,
      status: String(row.status ?? ""),
      driverId: stringOrNull(row.driver_id),
      rentalId: stringOrNull(row.rental_id),
      vehicleId: stringOrNull(row.vehicle_id),
      notes: stringOrNull(row.notes),
      dueDate: stringOrNull(row.due_date),
      paidDate: stringOrNull(row.paid_date),
      createdAt: String(row.created_at ?? ""),
    });
  }
  return { rows, count: result.count, error: false };
}

function mapIncidents(result: QueryBag): TollsRead<TollsIncidentRow> {
  const data = recordRows(result.data);
  if (result.error || !data || result.count == null) return failed();
  const rows: TollsIncidentRow[] = [];
  for (const row of data) {
    const amount = finiteNumber(row.driver_responsible_amount);
    if (amount == null || typeof row.id !== "string" || typeof row.vehicle_id !== "string") return failed();
    rows.push({
      id: row.id,
      incidentType: String(row.incident_type ?? ""),
      description: stringOrNull(row.description),
      notes: stringOrNull(row.notes),
      occurredAt: String(row.occurred_at ?? ""),
      applicationId: stringOrNull(row.application_id),
      rentalId: stringOrNull(row.rental_id),
      vehicleId: row.vehicle_id,
      driverResponsibleAmount: amount,
    });
  }
  return { rows, count: result.count, error: false };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type { TollsName };
