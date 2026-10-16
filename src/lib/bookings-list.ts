// Browser-safe shapes and helpers for Bookings (List + Details).
//
// A booking, in this phase, IS a rental. There is no bookings table and no
// second record: `rentals` is the source of truth, and every part of the
// record already points back at it — inspections, agreements, payments,
// condition media, odometer readings, toll charges and incidents all carry
// rental_id. So this is a reading problem, not a data problem, and nothing
// here writes.
//
// Two columns in this schema are called driver_id and mean different things:
//
//   rentals.driver_id   the AUTH USER id (set from applications.user_id when
//                       activate_rental_tx runs). It is the portal login.
//   payments.driver_id  an APPLICATIONS row id.
//
// They are never interchangeable. Identity — name, email, phone — is resolved
// through rentals.application_id, and `driverUserId` is kept separate so the
// portal link is never mistaken for the person's record.
//
// Phase B (advance reservations) will add rows from a different source to the
// same list. `source` and the "reserved" phase exist for that day; nothing in
// this phase ever produces them, because inventing an upcoming booking out of
// a rental that does not exist is exactly the lie this file refuses to tell.

/** Where a row came from. Phase A only ever reads rentals. */
export type BookingSource = "rental";

export const BOOKING_PHASES = ["active", "completed", "cancelled", "reserved"] as const;
export type BookingPhase = (typeof BOOKING_PHASES)[number];

export const BOOKING_PHASE_LABEL: Record<BookingPhase, string> = {
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  reserved: "Reserved",
};

/** Phase A shows three; Reserved waits for the reservation engine. */
export const BOOKING_PHASE_FILTERS = ["all", "active", "completed", "cancelled"] as const;
export type BookingPhaseFilter = (typeof BOOKING_PHASE_FILTERS)[number];

export function isBookingPhaseFilter(v: unknown): v is BookingPhaseFilter {
  return (BOOKING_PHASE_FILTERS as readonly string[]).includes(String(v));
}

export const BOOKING_SORTS = ["recent", "oldest", "driver", "vehicle"] as const;
export type BookingSort = (typeof BOOKING_SORTS)[number];

/**
 * What a rental's status means for this list.
 *
 * Only `active` is set by activate_rental_tx; `ended` is what end_rental_tx
 * leaves behind. Both spellings of cancelled appear in this codebase, so both
 * are read here and neither is rewritten in the database.
 */
export function bookingPhase(status: string | null | undefined): BookingPhase {
  const s = String(status ?? "").toLowerCase();
  if (s === "active") return "active";
  if (s === "cancelled" || s === "canceled" || s === "void" || s === "voided") return "cancelled";
  if (s === "reserved" || s === "pending" || s === "upcoming") return "reserved";
  return "completed";
}

/** The rental statuses that belong to a phase, for a server-side filter. */
export const PHASE_STATUSES: Record<Exclude<BookingPhaseFilter, "all">, readonly string[]> = {
  active: ["active"],
  cancelled: ["cancelled", "canceled", "void", "voided"],
  completed: ["ended", "completed", "closed", "returned", "finished"],
};

export type BookingRow = {
  id: string;
  source: BookingSource;
  phase: BookingPhase;
  /** As recorded, never rewritten — the phase above is the reading of it. */
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  /** True when the rental runs until somebody ends it. Not a missing value. */
  openEnded: boolean;
  /** Persisted Booking # once the numbering backend exists. Never derived. */
  bookingNumber?: number | null;
  driverName: string | null;
  driverEmail: string | null;
  /** applications.id — the person's record. NOT rentals.driver_id. */
  applicationId: string | null;
  /** The portal login behind this rental (auth user id). Never a record link. */
  driverUserId: string | null;
  vehicleId: string | null;
  unitNumber: string | null;
  vehicleLabel: string | null;
  plate: string | null;
  /** Manager+ only. Undefined for a Coordinator — the server does not send it. */
  weeklyRate?: number | null;
  paymentStatus?: string | null;
  depositStatus?: string | null;
  balanceDue?: number | null;
};

export type BookingCounts = Record<Exclude<BookingPhaseFilter, "all">, number>;

export type BookingListResult = {
  rows: BookingRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: BookingCounts;
  /** False for a Coordinator: money is absent from the rows, not hidden in CSS. */
  canSeeMoney: boolean;
};

export const BOOKING_LIST_PAGE_SIZE = 25;

/**
 * One date range, said the way an operator would say it.
 *
 * An open-ended rental is a real arrangement, not a blank: it runs week to
 * week until somebody ends it. Printing "—" there would read as missing data.
 */
export function bookingDates(
  startDate: string | null,
  endDate: string | null,
  phase: BookingPhase,
): string {
  if (!startDate) return "Start date not recorded";
  if (endDate) return `${startDate} → ${endDate}`;
  return phase === "active" ? `${startDate} → Open-ended` : `${startDate} → End date not recorded`;
}

export function vehicleLabelOf(
  v: { year?: number | null; make?: string | null; model?: string | null } | null,
): string | null {
  if (!v) return null;
  const s = [v.year, v.make, v.model].filter(Boolean).join(" ").trim();
  return s || null;
}

/**
 * What this booking cannot tell you yet, in the words the profile uses.
 *
 * Every entry is a fact about the record, never a guess: a rental with no
 * application row genuinely cannot name its driver, and a rental still running
 * genuinely has no return mileage.
 */
export function bookingUnavailable(b: {
  phase: BookingPhase;
  applicationId: string | null;
  startDate: string | null;
  endDate: string | null;
  pickupMileage: number | null;
  returnMileage: number | null;
  inspectionCount: number;
  agreementCount: number;
}): string[] {
  const out: string[] = [];
  if (!b.applicationId) out.push("Driver record not linked");
  if (!b.startDate) out.push("Start date not recorded");
  if (b.phase !== "active" && !b.endDate) out.push("End date not recorded");
  if (b.pickupMileage == null) out.push("Pickup mileage not recorded");
  if (b.returnMileage == null)
    out.push(
      b.phase === "active" ? "Return mileage pending return" : "Return mileage not recorded",
    );
  if (!b.inspectionCount) out.push("No inspection on file");
  if (!b.agreementCount) out.push("No agreement on file");
  return out;
}

/** PostgREST `or` for the search box: driver name/email, unit, plate, VIN. */
export function bookingSearchTargets(raw: string): string {
  return raw
    .replace(/[,()*%\\"':]/g, " ")
    .trim()
    .slice(0, 100);
}
