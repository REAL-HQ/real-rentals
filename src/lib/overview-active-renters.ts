// Expanded Active Renters card on Overview. Pure: no database access.
//
// Current, Due Today, and Overdue are not a second payment rule. Callers pass
// nextDue and overdueDays from buildActiveRentalRows, which is the Bookings >
// Active path through rentStanding. A week already paid for is Current or Due
// Today even when the stored next due date is still in the past. When that
// read did not load, every renter stays Unavailable — a guess from the stored
// date would disagree with the board.

import { dateOnly, inRenewalWindow } from "@/lib/renewals-due";

/** Same cap the Recent Applications list uses. */
export const ACTIVE_RENTER_LIST_CAP = 5;

/**
 * Open swap statuses. The same pair as OPEN_SWAP_STATUSES in vehicle-swap.ts
 * (waiting for a signature, or signed and waiting for handover). A test locks
 * the two lists together.
 */
export const OVERVIEW_OPEN_SWAP_STATUSES = ["pending_signature", "signed"] as const;

export const ACTIVE_RENTER_COPY = {
  hint: "With An Active Rental",
  emptyHint: "No Active Rentals",
  current: "Current",
  dueToday: "Due Today",
  overdue: "Overdue",
  noDueDate: "No Due Date",
  weeklyRent: "Weekly Rent",
  autopayOn: "Autopay On",
  returnsDueSoon: "Returns Due Soon",
  overdueReturns: "Overdue Returns",
  openSwaps: "Open Swaps",
  viewAll: "View All",
  none: "No Active Renters",
  unavailable: "Unavailable",
  paymentStanding: "Payment Standing",
  loading: "Loading Active Renters…",
  failed: "Active Renter Details Unavailable",
  vehicleNotSet: "Vehicle Not Set",
  unnamed: "Unnamed Driver",
  notSet: "Not Set",
  due: "Due",
  moreNotShown: "More Active Rentals Not Shown",
} as const;

export type RentStandingKind = "current" | "due_today" | "overdue" | "no_due_date" | "unavailable";

export type ActiveRenterFact = {
  id: string;
  name: string;
  /** Plate only. Never a unit number. */
  plate: string | null;
  /** Last 6 of the VIN, or shorter when that is all that is on file. Never the full VIN. */
  vinLast6: string | null;
  weeklyRate: number | null;
  autopayOn: boolean;
  endDate: string | null;
  /** Standing next due when payments loaded; otherwise the stored next due, for the date line only. */
  nextDue: string | null;
  /** From rentStanding. Ignored unless paymentsLoaded is true. */
  overdueDays: number | null;
};

export type StandingCounts = {
  current: number;
  dueToday: number;
  overdue: number;
  noDueDate: number;
};

export type ActiveRenterListItem = {
  id: string;
  name: string;
  vehicle: string;
  nextDue: string | null;
  standing: RentStandingKind;
};

export type ActiveRentersSummary = {
  today: string;
  paymentsLoaded: boolean;
  standing: StandingCounts;
  /** Sum of known positive weekly rates. Zero when every rate is missing. */
  weeklyRent: number;
  /** Rentals whose weekly rate is missing or not a positive number. */
  ratesNotSet: number;
  /** Rentals that contributed to weeklyRent. */
  ratesKnown: number;
  autopayOn: number;
  /** Active rentals whose end date is today through seven days out, inclusive. */
  returnsDueSoon: number;
  /** Active rentals whose end date is before today. */
  overdueReturns: number;
  /** Null when the open-swap read failed. Zero is a real empty result. */
  openSwaps: number | null;
  renters: ActiveRenterListItem[];
  totalRenters: number;
  hiddenCount: number;
  rentalsCapped: boolean;
};

const STANDING_RANK: Record<RentStandingKind, number> = {
  overdue: 0,
  due_today: 1,
  current: 2,
  no_due_date: 3,
  unavailable: 4,
};

export function classifyRentStanding(args: {
  today: string;
  paymentsLoaded: boolean;
  nextDue: string | null;
  overdueDays: number | null;
}): RentStandingKind {
  if (!args.paymentsLoaded) return "unavailable";
  const due = dateOnly(args.nextDue);
  if ((args.overdueDays ?? 0) > 0) return "overdue";
  if (due && due < args.today) return "overdue";
  if (!due) return "no_due_date";
  if (due === args.today) return "due_today";
  return "current";
}

export function standingLabel(kind: RentStandingKind): string {
  switch (kind) {
    case "current":
      return ACTIVE_RENTER_COPY.current;
    case "due_today":
      return ACTIVE_RENTER_COPY.dueToday;
    case "overdue":
      return ACTIVE_RENTER_COPY.overdue;
    case "no_due_date":
      return ACTIVE_RENTER_COPY.noDueDate;
    default:
      return ACTIVE_RENTER_COPY.unavailable;
  }
}

/** Plate and VIN last 6. A longer VIN is cut to the last 6 so a full VIN cannot render. */
export function activeRenterVehicleLine(plate: string | null | undefined, vinLast6: string | null | undefined): string {
  const plateText = String(plate ?? "").trim().toUpperCase();
  const vin = String(vinLast6 ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const last6 = vin.length > 6 ? vin.slice(-6) : vin;
  const vinText = last6 ? `VIN …${last6}` : "";
  if (plateText && vinText) return `${plateText} · ${vinText}`;
  return plateText || vinText || ACTIVE_RENTER_COPY.vehicleNotSet;
}

/** Positive weekly rates only. Missing, zero, and non-finite values stay unset. */
export function knownWeeklyRate(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

export function formatWeeklyRent(amount: number): string {
  const cents = Math.round(amount * 100);
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function weeklyRentLabel(weeklyRent: number, ratesNotSet: number, ratesKnown: number): string {
  if (ratesKnown === 0 && ratesNotSet === 0) return formatWeeklyRent(0);
  if (ratesKnown === 0) return ACTIVE_RENTER_COPY.notSet;
  const money = formatWeeklyRent(weeklyRent);
  if (ratesNotSet > 0) return `${money} · ${ratesNotSet} ${ACTIVE_RENTER_COPY.notSet}`;
  return money;
}

function standingCounts(kinds: RentStandingKind[]): StandingCounts {
  const counts: StandingCounts = { current: 0, dueToday: 0, overdue: 0, noDueDate: 0 };
  for (const kind of kinds) {
    if (kind === "current") counts.current += 1;
    else if (kind === "due_today") counts.dueToday += 1;
    else if (kind === "overdue") counts.overdue += 1;
    else if (kind === "no_due_date") counts.noDueDate += 1;
  }
  return counts;
}

export function summarizeActiveRenters(args: {
  today: string;
  renters: readonly ActiveRenterFact[];
  paymentsLoaded: boolean;
  openSwaps: number | null;
  rentalsCapped?: boolean;
}): ActiveRentersSummary {
  const today = dateOnly(args.today) ?? args.today;
  let weeklyRent = 0;
  let ratesNotSet = 0;
  let ratesKnown = 0;
  let autopayOn = 0;
  let returnsDueSoon = 0;
  let overdueReturns = 0;
  const ranked = args.renters.map((renter) => {
    const rate = knownWeeklyRate(renter.weeklyRate);
    if (rate == null) ratesNotSet += 1;
    else {
      ratesKnown += 1;
      weeklyRent += rate;
    }
    if (renter.autopayOn) autopayOn += 1;
    if (inRenewalWindow(renter.endDate, today)) returnsDueSoon += 1;
    const end = dateOnly(renter.endDate);
    if (end && end < today) overdueReturns += 1;
    const standing = classifyRentStanding({
      today,
      paymentsLoaded: args.paymentsLoaded,
      nextDue: renter.nextDue,
      overdueDays: renter.overdueDays,
    });
    return { renter, standing };
  });
  ranked.sort((a, b) => {
    const group = STANDING_RANK[a.standing] - STANDING_RANK[b.standing];
    if (group !== 0) return group;
    const aDays = a.renter.overdueDays ?? 0;
    const bDays = b.renter.overdueDays ?? 0;
    if (a.standing === "overdue" && aDays !== bDays) return bDays - aDays;
    const aDue = dateOnly(a.renter.nextDue) ?? "";
    const bDue = dateOnly(b.renter.nextDue) ?? "";
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
    return a.renter.name.localeCompare(b.renter.name);
  });
  const shown = ranked.slice(0, ACTIVE_RENTER_LIST_CAP);
  return {
    today,
    paymentsLoaded: args.paymentsLoaded,
    standing: standingCounts(ranked.map((row) => row.standing)),
    weeklyRent: Math.round(weeklyRent * 100) / 100,
    ratesNotSet,
    ratesKnown,
    autopayOn,
    returnsDueSoon,
    overdueReturns,
    openSwaps: args.openSwaps,
    renters: shown.map((row) => ({
      id: row.renter.id,
      name: row.renter.name.trim(),
      vehicle: activeRenterVehicleLine(row.renter.plate, row.renter.vinLast6),
      nextDue: dateOnly(row.renter.nextDue),
      standing: row.standing,
    })),
    totalRenters: ranked.length,
    hiddenCount: Math.max(0, ranked.length - shown.length),
    rentalsCapped: args.rentalsCapped === true,
  };
}
