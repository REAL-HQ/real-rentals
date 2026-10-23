/**
 * Read-only view of the return and closeout facts already stored for one rental.
 * This module does not read or write the database. Callers pass rows they loaded.
 */

export const RETURN_INSPECTION_LIST_LIMIT = 100;
export const RETURN_INSPECTION_CHILD_LIMIT = 200;

/** Columns and files this screen will not invent. Shown for every rental. */
export const RETURN_INSPECTION_NOT_IN_SCHEMA = [
  "Rentals have no return mileage column. Return mileage is an odometer reading with source rental_return, or a return inspection odometer.",
  "Rentals have no return fuel column. Return fuel is inspections.fuel_level. vehicles.fuel_type is the vehicle fuel type and is not shown.",
  "Rentals have no return photo column. Photos are condition_media files with phase checkin or damage. Phase checkout is the pickup record, not the return.",
  "Rentals have no damage note column. Damage notes are return inspection notes, failed inspection item notes, and incident descriptions.",
  "There is no closeout table. Closeout on the rental is deposit_status, deposit_refund_amount, deposit_settled_at, and deposit_notes, plus deposit_deductions.",
  "There is no cleaning column. A cleaning charge would be a payment with type fee.",
  "Incidents have estimated_cost and actual_cost. Those are repair amounts, not a payments row.",
] as const;

const FUEL_LABELS: Record<string, string> = {
  empty: "Empty",
  quarter: "Quarter",
  half: "Half",
  three_quarter: "Three Quarter",
  full: "Full",
};

export type ReturnInspectionReading = {
  id: string;
  mileage: number;
  observedOn: string;
  sourceType: string;
  note: string | null;
};

export type ReturnInspectionInspection = {
  id: string;
  inspectionType: string;
  status: string;
  odometer: number | null;
  fuelLevel: string | null;
  exteriorNotes: string | null;
  interiorNotes: string | null;
  notes: string | null;
  driverNotes: string | null;
  completedAt: string | null;
  startedAt: string;
};

export type ReturnInspectionItem = {
  id: string;
  inspectionId: string;
  label: string;
  notes: string | null;
  result: string;
  section: string;
};

export type ReturnInspectionPhoto = {
  id: string;
  fileName: string | null;
  caption: string | null;
  phase: string;
  mediaType: string;
  createdAt: string;
  inspectionId: string | null;
};

export type ReturnInspectionIncident = {
  id: string;
  incidentType: string;
  description: string | null;
  notes: string | null;
  severity: string;
  status: string;
  occurredAt: string;
  driverResponsibleAmount: number;
  estimatedCost: number;
  actualCost: number;
};

export type ReturnInspectionPayment = {
  id: string;
  type: string;
  amount: number;
  status: string;
  netCollected: number | null;
  notes: string | null;
  dueDate: string | null;
  paidDate: string | null;
  balanceDue: number | null;
};

export type ReturnInspectionDeduction = {
  id: string;
  reason: string;
  amount: number;
  notes: string | null;
};

export type ReturnInspectionRental = {
  id: string;
  status: string;
  startDate: string;
  endDate: string | null;
  vehicleLabel: string;
  driverName: string;
  depositStatus: string;
  depositAmount: number | null;
  depositHeld: boolean | null;
  depositRefundAmount: number | null;
  depositSettledAt: string | null;
  depositNotes: string | null;
  pickupReadingId: string | null;
  returnReadingId: string | null;
};

export type ReturnInspectionInput = {
  rental: ReturnInspectionRental;
  readings: ReturnInspectionReading[];
  inspections: ReturnInspectionInspection[];
  items: ReturnInspectionItem[];
  photos: ReturnInspectionPhoto[];
  incidents: ReturnInspectionIncident[];
  payments: ReturnInspectionPayment[];
  deductions: ReturnInspectionDeduction[];
};

export type ReturnMileageEntry = {
  id: string;
  mileage: number;
  observedOn: string | null;
  sourceLabel: string;
  note: string | null;
};

export type ReturnFuelEntry = {
  inspectionId: string;
  raw: string;
  label: string;
  recordedAt: string | null;
};

export type ReturnPhotoEntry = {
  id: string;
  fileName: string;
  caption: string | null;
  phaseLabel: string;
  mediaType: string;
  createdAt: string;
};

export type DamageNoteEntry = {
  id: string;
  source: string;
  label: string | null;
  text: string;
  at: string | null;
};

export type DamageFeeEntry = {
  id: string;
  kind: string;
  amount: number;
  status: string | null;
  netCollected: number | null;
  notes: string | null;
  dueDate: string | null;
  paidDate: string | null;
  balanceDue: number | null;
};

export type RepairAmountEntry = {
  id: string;
  kind: string;
  amount: number;
  incidentType: string;
  at: string;
};

export type DepositCloseoutView = {
  statusLabel: string;
  amount: number | null;
  held: boolean | null;
  refundAmount: number | null;
  settledAt: string | null;
  notes: string | null;
  deductions: { id: string; reason: string; amount: number; notes: string | null }[];
};

export type ReturnInspectionView = {
  rental: {
    id: string;
    statusLabel: string;
    startDate: string;
    endDate: string | null;
    vehicleLabel: string;
    driverName: string;
  };
  mileage: ReturnMileageEntry[];
  pickupMileage: ReturnMileageEntry[];
  fuel: ReturnFuelEntry[];
  photos: ReturnPhotoEntry[];
  damageNotes: DamageNoteEntry[];
  fees: DamageFeeEntry[];
  repairAmounts: RepairAmountEntry[];
  closeout: DepositCloseoutView;
  missing: string[];
  notInSchema: readonly string[];
};

export type ReturnInspectionRentalOption = {
  id: string;
  label: string;
  status: string;
  startDate: string;
  endDate: string | null;
};

export type ReturnInspectionRentalList = {
  rentals: ReturnInspectionRentalOption[];
  truncated: boolean;
};

function titleFromSnake(value: string): string {
  const words = value.trim().split("_").filter(Boolean);
  if (!words.length) return value;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

export function returnInspectionVehicleLabel(vehicle: {
  year: number | null;
  make: string | null;
  model: string | null;
  unitNumber: string | null;
  licensePlate: string | null;
} | null): string {
  if (!vehicle) return "Vehicle";
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part !== null && part !== "").join(" ");
  const unit = vehicle.unitNumber ? `#${vehicle.unitNumber}` : "";
  return [unit, name, vehicle.licensePlate].filter(Boolean).join(" ") || "Vehicle";
}

export function returnInspectionOptionLabel(args: {
  vehicle: string;
  driver: string;
  status: string;
  startDate: string;
}): string {
  return `${args.vehicle} · ${args.driver} · ${titleFromSnake(args.status)} · ${args.startDate}`;
}

function fuelEntry(inspection: ReturnInspectionInspection): ReturnFuelEntry | null {
  const raw = clean(inspection.fuelLevel);
  if (!raw) return null;
  const known = FUEL_LABELS[raw.toLowerCase()];
  return {
    inspectionId: inspection.id,
    raw: known ? raw.toLowerCase() : raw,
    label: known ?? "Recorded",
    recordedAt: inspection.completedAt ?? inspection.startedAt,
  };
}

function readingEntry(reading: ReturnInspectionReading, sourceLabel: string): ReturnMileageEntry {
  return {
    id: reading.id,
    mileage: reading.mileage,
    observedOn: reading.observedOn,
    sourceLabel,
    note: clean(reading.note),
  };
}

export function buildReturnInspection(input: ReturnInspectionInput): ReturnInspectionView {
  const rental = input.rental;
  const returns = input.inspections.filter((row) => row.inspectionType === "return");
  const returnIds = new Set(returns.map((row) => row.id));

  const mileage: ReturnMileageEntry[] = [];
  const seenReturn = new Set<string>();
  for (const reading of input.readings) {
    const isReturn = reading.sourceType === "rental_return" || reading.id === rental.returnReadingId;
    if (!isReturn || seenReturn.has(reading.id)) continue;
    seenReturn.add(reading.id);
    const sourceLabel = reading.sourceType === "rental_return" ? "Return Reading" : titleFromSnake(reading.sourceType);
    mileage.push(readingEntry(reading, sourceLabel));
  }
  for (const inspection of returns) {
    if (inspection.odometer == null) continue;
    mileage.push({
      id: `inspection:${inspection.id}`,
      mileage: inspection.odometer,
      observedOn: inspection.completedAt ?? inspection.startedAt,
      sourceLabel: "Return Inspection",
      note: null,
    });
  }

  const pickupMileage = input.readings
    .filter((reading) => {
      if (seenReturn.has(reading.id)) return false;
      return reading.sourceType === "rental_checkout" || reading.id === rental.pickupReadingId;
    })
    .map((reading) => readingEntry(reading, "Pickup Reading"));

  const fuel = returns.flatMap((inspection) => {
    const entry = fuelEntry(inspection);
    return entry ? [entry] : [];
  });

  const photos: ReturnPhotoEntry[] = [];
  const seenPhotos = new Set<string>();
  for (const photo of input.photos) {
    if (seenPhotos.has(photo.id) || photo.phase === "checkout") continue;
    const linked = photo.inspectionId != null && returnIds.has(photo.inspectionId);
    const returnPhase = photo.phase === "checkin" || photo.phase === "damage";
    if (!returnPhase && !linked) continue;
    seenPhotos.add(photo.id);
    photos.push({
      id: photo.id,
      fileName: clean(photo.fileName) ?? "Photo",
      caption: clean(photo.caption),
      phaseLabel: titleFromSnake(photo.phase),
      mediaType: photo.mediaType,
      createdAt: photo.createdAt,
    });
  }

  const damageNotes: DamageNoteEntry[] = [];
  for (const inspection of returns) {
    const fields: { source: string; text: string | null }[] = [
      { source: "Exterior Notes", text: clean(inspection.exteriorNotes) },
      { source: "Interior Notes", text: clean(inspection.interiorNotes) },
      { source: "Inspection Notes", text: clean(inspection.notes) },
      { source: "Driver Notes", text: clean(inspection.driverNotes) },
    ];
    for (const field of fields) {
      if (!field.text) continue;
      damageNotes.push({
        id: `${inspection.id}:${field.source}`,
        source: field.source,
        label: null,
        text: field.text,
        at: inspection.completedAt ?? inspection.startedAt,
      });
    }
  }
  for (const item of input.items) {
    if (!returnIds.has(item.inspectionId)) continue;
    const text = clean(item.notes);
    const failed = item.result === "fail";
    if (!text && !failed) continue;
    damageNotes.push({
      id: item.id,
      source: failed ? "Failed Item" : "Inspection Item",
      label: item.label,
      text: text ?? "Failed",
      at: null,
    });
  }
  for (const incident of input.incidents) {
    const description = clean(incident.description);
    const notes = clean(incident.notes);
    if (description) {
      damageNotes.push({
        id: `${incident.id}:description`,
        source: "Incident",
        label: titleFromSnake(incident.incidentType),
        text: description,
        at: incident.occurredAt,
      });
    }
    if (notes) {
      damageNotes.push({
        id: `${incident.id}:notes`,
        source: "Incident Notes",
        label: titleFromSnake(incident.incidentType),
        text: notes,
        at: incident.occurredAt,
      });
    }
  }

  const fees: DamageFeeEntry[] = [];
  for (const payment of input.payments) {
    if (payment.type !== "damage" && payment.type !== "fee") continue;
    fees.push({
      id: payment.id,
      kind: payment.type === "damage" ? "Damage" : "Fee",
      amount: payment.amount,
      status: titleFromSnake(payment.status),
      netCollected: payment.netCollected,
      notes: clean(payment.notes),
      dueDate: payment.dueDate,
      paidDate: payment.paidDate,
      balanceDue: payment.balanceDue,
    });
  }
  for (const deduction of input.deductions) {
    fees.push({
      id: deduction.id,
      kind: "Deposit Deduction",
      amount: deduction.amount,
      status: null,
      netCollected: null,
      notes: clean(deduction.notes) ?? clean(deduction.reason),
      dueDate: null,
      paidDate: null,
      balanceDue: null,
    });
  }
  for (const incident of input.incidents) {
    if (!(incident.driverResponsibleAmount > 0)) continue;
    fees.push({
      id: `${incident.id}:responsible`,
      kind: "Driver Responsible",
      amount: incident.driverResponsibleAmount,
      status: titleFromSnake(incident.status),
      netCollected: null,
      notes: clean(incident.description),
      dueDate: null,
      paidDate: null,
      balanceDue: null,
    });
  }

  const repairAmounts: RepairAmountEntry[] = [];
  for (const incident of input.incidents) {
    const incidentType = titleFromSnake(incident.incidentType);
    if (incident.estimatedCost > 0) {
      repairAmounts.push({
        id: `${incident.id}:estimated`,
        kind: "Estimated Repair",
        amount: incident.estimatedCost,
        incidentType,
        at: incident.occurredAt,
      });
    }
    if (incident.actualCost > 0) {
      repairAmounts.push({
        id: `${incident.id}:actual`,
        kind: "Actual Repair",
        amount: incident.actualCost,
        incidentType,
        at: incident.occurredAt,
      });
    }
  }

  const depositNotes = clean(rental.depositNotes);
  const closeout: DepositCloseoutView = {
    statusLabel: titleFromSnake(rental.depositStatus),
    amount: rental.depositAmount,
    held: rental.depositHeld,
    refundAmount: rental.depositRefundAmount,
    settledAt: rental.depositSettledAt,
    notes: depositNotes,
    deductions: input.deductions.map((row) => ({
      id: row.id,
      reason: row.reason,
      amount: row.amount,
      notes: clean(row.notes),
    })),
  };

  const missing: string[] = [];
  if (mileage.length === 0) missing.push("Return Mileage");
  if (fuel.length === 0) missing.push("Return Fuel");
  if (photos.length === 0) missing.push("Return Photos");
  if (damageNotes.length === 0) missing.push("Damage Notes");
  if (fees.length === 0) missing.push("Damage Fees And Other Fees");
  if (rental.depositStatus === "none" && !depositNotes && !rental.depositSettledAt && input.deductions.length === 0) {
    missing.push("Deposit Closeout");
  }

  return {
    rental: {
      id: rental.id,
      statusLabel: titleFromSnake(rental.status),
      startDate: rental.startDate,
      endDate: rental.endDate,
      vehicleLabel: rental.vehicleLabel,
      driverName: rental.driverName,
    },
    mileage,
    pickupMileage,
    fuel,
    photos,
    damageNotes,
    fees,
    repairAmounts,
    closeout,
    missing,
    notInSchema: RETURN_INSPECTION_NOT_IN_SCHEMA,
  };
}
