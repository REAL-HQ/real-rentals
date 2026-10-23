import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { RETURN_INSPECTION_VIEW_ENABLED } from "./return-inspection-flag";
import {
  RETURN_INSPECTION_CHILD_LIMIT,
  RETURN_INSPECTION_LIST_LIMIT,
  buildReturnInspection,
  returnInspectionOptionLabel,
  returnInspectionVehicleLabel,
  type ReturnInspectionDeduction,
  type ReturnInspectionIncident,
  type ReturnInspectionInput,
  type ReturnInspectionInspection,
  type ReturnInspectionItem,
  type ReturnInspectionPayment,
  type ReturnInspectionPhoto,
  type ReturnInspectionReading,
  type ReturnInspectionRentalList,
  type ReturnInspectionView,
} from "./return-inspection";

type Admin = SupabaseClient<Database>;

const rentalIdInput = z.object({ rentalId: z.string().uuid() });

const LIST_COLUMNS = "id,status,start_date,end_date,vehicle_id,application_id" as const;
const RENTAL_COLUMNS =
  "id,status,start_date,end_date,vehicle_id,application_id,deposit_status,deposit_amount,deposit_held,deposit_refund_amount,deposit_settled_at,deposit_notes,pickup_reading_id,return_reading_id" as const;
const VEHICLE_COLUMNS = "id,year,make,model,unit_number,license_plate" as const;
const READING_COLUMNS = "id,mileage,observed_on,source_type,note" as const;
const INSPECTION_COLUMNS =
  "id,inspection_type,status,odometer,fuel_level,exterior_notes,interior_notes,notes,driver_notes,completed_at,started_at" as const;
const ITEM_COLUMNS = "id,inspection_id,label,notes,result,section" as const;
const PHOTO_COLUMNS = "id,file_name,caption,phase,media_type,created_at,inspection_id" as const;
const INCIDENT_COLUMNS =
  "id,incident_type,description,notes,severity,status,occurred_at,driver_responsible_amount,estimated_cost,actual_cost" as const;
const PAYMENT_COLUMNS = "id,type,amount,status,net_collected,notes,due_date,paid_date,balance_due" as const;
const DEDUCTION_COLUMNS = "id,reason,amount,notes" as const;

function queryError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** Manager-only list of rentals the viewer can open. Throws while the flag is off. */
export const listReturnInspectionRentals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReturnInspectionRentalList> => {
    if (!RETURN_INSPECTION_VIEW_ENABLED) throw new Error("Return Inspection is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return readReturnInspectionRentals(supabaseAdmin);
  });

/** Manager-only return and closeout read for one rental. Throws while the flag is off. */
export const getReturnInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => rentalIdInput.parse(data))
  .handler(async ({ data, context }): Promise<ReturnInspectionView> => {
    if (!RETURN_INSPECTION_VIEW_ENABLED) throw new Error("Return Inspection is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return readReturnInspection(supabaseAdmin, data.rentalId);
  });

async function readReturnInspectionRentals(supabaseAdmin: Admin): Promise<ReturnInspectionRentalList> {
  const rentalsQ = await supabaseAdmin
    .from("rentals")
    .select(LIST_COLUMNS, { count: "exact" })
    .order("start_date", { ascending: false })
    .limit(RETURN_INSPECTION_LIST_LIMIT);
  queryError(rentalsQ.error);
  const rentals = rentalsQ.data ?? [];
  const vehicleIds = [...new Set(rentals.map((row) => row.vehicle_id))];
  const applicationIds = [...new Set(rentals.flatMap((row) => (row.application_id ? [row.application_id] : [])))];

  const vehiclesQ = vehicleIds.length
    ? await supabaseAdmin.from("vehicles").select(VEHICLE_COLUMNS).in("id", vehicleIds)
    : { data: [], error: null };
  queryError(vehiclesQ.error);
  const applicationsQ = applicationIds.length
    ? await supabaseAdmin.from("applications").select("id,full_name").in("id", applicationIds)
    : { data: [], error: null };
  queryError(applicationsQ.error);

  const vehicles = new Map((vehiclesQ.data ?? []).map((row) => [row.id, row]));
  const drivers = new Map((applicationsQ.data ?? []).map((row) => [row.id, row.full_name]));

  return {
    truncated: (rentalsQ.count ?? rentals.length) > RETURN_INSPECTION_LIST_LIMIT,
    rentals: rentals.map((row) => {
      const vehicle = vehicles.get(row.vehicle_id);
      const vehicleLabel = returnInspectionVehicleLabel(
        vehicle
          ? {
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              unitNumber: vehicle.unit_number,
              licensePlate: vehicle.license_plate,
            }
          : null,
      );
      return {
        id: row.id,
        status: row.status,
        startDate: row.start_date,
        endDate: row.end_date,
        label: returnInspectionOptionLabel({
          vehicle: vehicleLabel,
          driver: (row.application_id && drivers.get(row.application_id)) || "Driver",
          status: row.status,
          startDate: row.start_date,
        }),
      };
    }),
  };
}

async function readReturnInspection(supabaseAdmin: Admin, rentalId: string): Promise<ReturnInspectionView> {
  const rentalQ = await supabaseAdmin.from("rentals").select(RENTAL_COLUMNS).eq("id", rentalId).maybeSingle();
  queryError(rentalQ.error);
  const rental = rentalQ.data;
  if (!rental) throw new Error("Rental not found");

  const [readingsQ, inspectionsQ, incidentsQ, paymentsQ, deductionsQ, vehicleQ, applicationQ] = await Promise.all([
    supabaseAdmin
      .from("odometer_readings")
      .select(READING_COLUMNS)
      .eq("rental_id", rentalId)
      .in("source_type", ["rental_return", "rental_checkout"])
      .order("observed_on", { ascending: false })
      .limit(RETURN_INSPECTION_CHILD_LIMIT),
    supabaseAdmin
      .from("inspections")
      .select(INSPECTION_COLUMNS)
      .eq("rental_id", rentalId)
      .eq("inspection_type", "return")
      .order("started_at", { ascending: false })
      .limit(RETURN_INSPECTION_CHILD_LIMIT),
    supabaseAdmin
      .from("incidents")
      .select(INCIDENT_COLUMNS)
      .eq("rental_id", rentalId)
      .order("occurred_at", { ascending: false })
      .limit(RETURN_INSPECTION_CHILD_LIMIT),
    supabaseAdmin
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("rental_id", rentalId)
      .in("type", ["damage", "fee"])
      .order("due_date", { ascending: true })
      .limit(RETURN_INSPECTION_CHILD_LIMIT),
    supabaseAdmin
      .from("deposit_deductions")
      .select(DEDUCTION_COLUMNS)
      .eq("rental_id", rentalId)
      .limit(RETURN_INSPECTION_CHILD_LIMIT),
    supabaseAdmin.from("vehicles").select(VEHICLE_COLUMNS).eq("id", rental.vehicle_id).maybeSingle(),
    rental.application_id
      ? supabaseAdmin.from("applications").select("id,full_name").eq("id", rental.application_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [readingsQ, inspectionsQ, incidentsQ, paymentsQ, deductionsQ, vehicleQ, applicationQ]) {
    queryError(result.error);
  }

  const readings: ReturnInspectionReading[] = (readingsQ.data ?? []).map(mapReading);
  const known = new Set(readings.map((row) => row.id));
  for (const id of [rental.return_reading_id, rental.pickup_reading_id]) {
    if (!id || known.has(id)) continue;
    const extra = await supabaseAdmin.from("odometer_readings").select(READING_COLUMNS).eq("id", id).maybeSingle();
    queryError(extra.error);
    if (!extra.data) continue;
    known.add(extra.data.id);
    readings.push(mapReading(extra.data));
  }

  const inspections = inspectionsQ.data ?? [];
  const inspectionIds = inspections.map((row) => row.id);
  const itemsQ = inspectionIds.length
    ? await supabaseAdmin
        .from("inspection_items")
        .select(ITEM_COLUMNS)
        .in("inspection_id", inspectionIds)
        .limit(RETURN_INSPECTION_CHILD_LIMIT)
    : { data: [], error: null };
  queryError(itemsQ.error);

  const photosQ = await supabaseAdmin
    .from("condition_media")
    .select(PHOTO_COLUMNS)
    .eq("rental_id", rentalId)
    .in("phase", ["checkin", "damage"])
    .order("created_at", { ascending: false })
    .limit(RETURN_INSPECTION_CHILD_LIMIT);
  queryError(photosQ.error);
  const linkedQ = inspectionIds.length
    ? await supabaseAdmin
        .from("condition_media")
        .select(PHOTO_COLUMNS)
        .in("inspection_id", inspectionIds)
        .order("created_at", { ascending: false })
        .limit(RETURN_INSPECTION_CHILD_LIMIT)
    : { data: [], error: null };
  queryError(linkedQ.error);

  const vehicle = vehicleQ.data;
  const input: ReturnInspectionInput = {
    rental: {
      id: rental.id,
      status: rental.status,
      startDate: rental.start_date,
      endDate: rental.end_date,
      vehicleLabel: returnInspectionVehicleLabel(
        vehicle
          ? {
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              unitNumber: vehicle.unit_number,
              licensePlate: vehicle.license_plate,
            }
          : null,
      ),
      driverName: applicationQ.data?.full_name || "Driver",
      depositStatus: rental.deposit_status,
      depositAmount: rental.deposit_amount,
      depositHeld: rental.deposit_held,
      depositRefundAmount: rental.deposit_refund_amount,
      depositSettledAt: rental.deposit_settled_at,
      depositNotes: rental.deposit_notes,
      pickupReadingId: rental.pickup_reading_id,
      returnReadingId: rental.return_reading_id,
    },
    readings,
    inspections: inspections.map(mapInspection),
    items: (itemsQ.data ?? []).map(mapItem),
    photos: [...(photosQ.data ?? []), ...(linkedQ.data ?? [])].map(mapPhoto),
    incidents: (incidentsQ.data ?? []).map(mapIncident),
    payments: (paymentsQ.data ?? []).map(mapPayment),
    deductions: (deductionsQ.data ?? []).map(mapDeduction),
  };
  return buildReturnInspection(input);
}

function mapReading(row: {
  id: string;
  mileage: number;
  observed_on: string;
  source_type: string;
  note: string | null;
}): ReturnInspectionReading {
  return {
    id: row.id,
    mileage: row.mileage,
    observedOn: row.observed_on,
    sourceType: row.source_type,
    note: row.note,
  };
}

function mapInspection(row: {
  id: string;
  inspection_type: string;
  status: string;
  odometer: number | null;
  fuel_level: string | null;
  exterior_notes: string | null;
  interior_notes: string | null;
  notes: string | null;
  driver_notes: string | null;
  completed_at: string | null;
  started_at: string;
}): ReturnInspectionInspection {
  return {
    id: row.id,
    inspectionType: row.inspection_type,
    status: row.status,
    odometer: row.odometer,
    fuelLevel: row.fuel_level,
    exteriorNotes: row.exterior_notes,
    interiorNotes: row.interior_notes,
    notes: row.notes,
    driverNotes: row.driver_notes,
    completedAt: row.completed_at,
    startedAt: row.started_at,
  };
}

function mapItem(row: {
  id: string;
  inspection_id: string;
  label: string;
  notes: string | null;
  result: string;
  section: string;
}): ReturnInspectionItem {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    label: row.label,
    notes: row.notes,
    result: row.result,
    section: row.section,
  };
}

function mapPhoto(row: {
  id: string;
  file_name: string | null;
  caption: string | null;
  phase: string;
  media_type: string;
  created_at: string;
  inspection_id: string | null;
}): ReturnInspectionPhoto {
  return {
    id: row.id,
    fileName: row.file_name,
    caption: row.caption,
    phase: row.phase,
    mediaType: row.media_type,
    createdAt: row.created_at,
    inspectionId: row.inspection_id,
  };
}

function mapIncident(row: {
  id: string;
  incident_type: string;
  description: string | null;
  notes: string | null;
  severity: string;
  status: string;
  occurred_at: string;
  driver_responsible_amount: number;
  estimated_cost: number;
  actual_cost: number;
}): ReturnInspectionIncident {
  return {
    id: row.id,
    incidentType: row.incident_type,
    description: row.description,
    notes: row.notes,
    severity: row.severity,
    status: row.status,
    occurredAt: row.occurred_at,
    driverResponsibleAmount: row.driver_responsible_amount,
    estimatedCost: row.estimated_cost,
    actualCost: row.actual_cost,
  };
}

function mapPayment(row: {
  id: string;
  type: string;
  amount: number;
  status: string;
  net_collected: number | null;
  notes: string | null;
  due_date: string | null;
  paid_date: string | null;
  balance_due: number;
}): ReturnInspectionPayment {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    status: row.status,
    netCollected: row.net_collected,
    notes: row.notes,
    dueDate: row.due_date,
    paidDate: row.paid_date,
    balanceDue: row.balance_due,
  };
}

function mapDeduction(row: { id: string; reason: string; amount: number; notes: string | null }): ReturnInspectionDeduction {
  return { id: row.id, reason: row.reason, amount: row.amount, notes: row.notes };
}
