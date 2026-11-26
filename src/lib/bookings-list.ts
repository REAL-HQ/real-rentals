export { pastRentalBadge } from "@/lib/return-flow";
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

export const BOOKING_PHASES = ["active", "completed", "cancelled", "reserved", "swap"] as const;
export type BookingPhase = (typeof BOOKING_PHASES)[number];

export const BOOKING_PHASE_LABEL: Record<BookingPhase, string> = {
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  reserved: "Reserved",
  swap: "Swap",
};

/** Past adds Swap. Reserved still waits for the reservation engine. */
export const BOOKING_PHASE_FILTERS = ["all", "active", "completed", "cancelled", "swap"] as const;
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
  // Swap is not a stored status. The rows are cancelled rentals a completed
  // swap ended; the list reads rental_vehicle_swaps and relabels them.
  swap: ["cancelled", "canceled", "void", "voided"],
};

/** Statuses that belong on the Past tab (ended or cancelled — never active/reserved). */
export const PAST_STATUS_VALUES: readonly string[] = [
  ...PHASE_STATUSES.completed,
  ...PHASE_STATUSES.cancelled,
];

/**
 * Server-side status filter for the Bookings list.
 * Returns null when every non-reserved rental is in scope (legacy "all").
 * Past scope never includes active or reserved rows.
 */
export type BookingListScope = "past" | "all" | "completed" | "cancelled";

export function statusesForBookingList(input: {
  scope?: BookingListScope | null;
  phase: BookingPhaseFilter;
}): readonly string[] | null {
  if (input.scope === "completed") return PHASE_STATUSES.completed;
  // Cancelled includes swap-ended rows: they are cancelled statuses, not completed ones.
  if (input.scope === "cancelled") return PHASE_STATUSES.cancelled;
  const scope = input.scope === "past" ? "past" : "all";
  if (scope === "past") {
    if (input.phase === "completed") return PHASE_STATUSES.completed;
    if (input.phase === "cancelled" || input.phase === "swap") return PHASE_STATUSES.cancelled;
    // "all" or a mistaken "active" under Past → completed + cancelled only.
    return PAST_STATUS_VALUES;
  }
  if (input.phase === "all") return null;
  return PHASE_STATUSES[input.phase];
}

export function isPastPhase(phase: BookingPhase): boolean {
  return phase === "completed" || phase === "cancelled" || phase === "swap";
}

/**
 * Drivers who have at least one rental on the Bookings Completed or Cancelled
 * tab. Those tabs filter by PHASE_STATUSES, so an unknown status is neither.
 * One driver can be in both lists. Swap-ended rows are cancelled statuses.
 */
export function bookingOutcomeApplicationIds(
  rentals: readonly { application_id?: string | null; status?: string | null }[],
): { completed: string[]; cancelled: string[] } {
  const completedStatuses = new Set(PHASE_STATUSES.completed.map((status) => status.toLowerCase()));
  const cancelledStatuses = new Set(PHASE_STATUSES.cancelled.map((status) => status.toLowerCase()));
  const completed = new Set<string>();
  const cancelled = new Set<string>();
  for (const rental of rentals) {
    const id = String(rental.application_id ?? "").trim();
    if (!id) continue;
    const status = String(rental.status ?? "").toLowerCase();
    if (completedStatuses.has(status)) completed.add(id);
    if (cancelledStatuses.has(status)) cancelled.add(id);
  }
  return { completed: [...completed], cancelled: [...cancelled] };
}

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
  /** Last 6 of the VIN, for the shared vehicle cell. */
  vinLast6?: string | null;
  /**
   * Past tab only. Title Case length from the start to the actual end
   * (recorded end date, or the swap completion date). Absent when there is
   * no end — a length is never guessed.
   */
  lengthLabel?: string | null;
  /** Staff-confirmed car photo path, for the shared vehicle cell. */
  thumbnailPath?: string | null;
  /** Manager+ only. Undefined for a Coordinator — the server does not send it. */
  weeklyRate?: number | null;
  paymentStatus?: string | null;
  depositStatus?: string | null;
  balanceDue?: number | null;
  /** Manager+ only. From rentals.autopay_active. */
  autopayActive?: boolean | null;
  /** Manager+ only. From rentals.next_payment_due. */
  nextPaymentDue?: string | null;
};

/** Bookings detail: "Autopay On · Next Charge Nov 30, 2026 · $350.00" or "Autopay Off". */
export function autopayBadge(input: {
  autopayActive?: boolean | null;
  nextPaymentDue?: string | null;
  weeklyRate?: number | null;
}): string {
  if (!input.autopayActive) return "Autopay Off";
  const date = input.nextPaymentDue ? formatAutopayDate(input.nextPaymentDue) : "Not Set";
  const rate = input.weeklyRate == null || !Number.isFinite(Number(input.weeklyRate))
    ? ""
    : ` · ${Number(input.weeklyRate).toLocaleString("en-US", { style: "currency", currency: "USD" })}`;
  return `Autopay On · Next Charge ${date}${rate}`;
}

function formatAutopayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

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

/** Display name for a booking's car. A past rental may have no vehicle. */
export const UNKNOWN_VEHICLE_LABEL = "Unknown";

export function bookingVehicleName(b: {
  unitNumber?: string | null;
  vehicleLabel?: string | null;
}): string {
  const text = [b.unitNumber, b.vehicleLabel].filter(Boolean).join(" · ");
  return text || UNKNOWN_VEHICLE_LABEL;
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
