/**
 * Applicant funnel. The flag is a hard constant. Nothing reads applications,
 * rentals, or the audit log unless a caller has already passed
 * assertApplicantFunnelEnabled.
 *
 * Counts use the status stored on the application. Submitting part 1 sets
 * that status to new, which is the completed application. Renting means a
 * rental row exists. Declined is the stored word for a denied application.
 * There is no submitted_at column, so the submitted-to-approved median is
 * omitted. Approval time is the application.approved audit row. First rental
 * time is the earliest rental created_at.
 */

export const APPLICANT_FUNNEL_ENABLED: boolean = false;

export function assertApplicantFunnelEnabled(): void {
  if (APPLICANT_FUNNEL_ENABLED !== true) {
    throw new Error("Applicant funnel is not enabled.");
  }
}

export const FUNNEL_TIME_ZONE = "America/New_York";
export const FUNNEL_RANGES = [7, 30, 90] as const;
export type FunnelRange = (typeof FUNNEL_RANGES)[number];

export const FUNNEL_PATH = ["started", "complete", "reviewing", "approved", "renting"] as const;
export type FunnelPathStage = (typeof FUNNEL_PATH)[number];
export type FunnelStageId = FunnelPathStage | "declined";

export const FUNNEL_STAGE_LABEL: Record<FunnelStageId, string> = {
  started: "Started or Partial",
  complete: "Complete",
  reviewing: "Reviewing",
  approved: "Approved",
  declined: "Declined",
  renting: "Renting",
};

const OMITTED_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  closed: "Closed",
  duplicate: "Duplicate",
};

export const SUBMITTED_TO_APPROVED_NOTE =
  "Submitted time is not recorded, so this median is omitted.";

export const FUNNEL_CSV_COLUMNS = [
  "application_id",
  "stage",
  "status",
  "created_at",
  "approved_at",
  "first_rental_at",
] as const;

export type FunnelCsvRow = {
  application_id: string;
  stage: string;
  status: string;
  created_at: string;
  approved_at: string;
  first_rental_at: string;
};

export type FunnelWindow = {
  days: FunnelRange;
  timeZone: typeof FUNNEL_TIME_ZONE;
  start: string;
  end: string;
  startDate: string;
  endDate: string;
};

export type FunnelStageRow = {
  id: FunnelStageId;
  label: string;
  here: number;
  reached: number | null;
  conversion: string | null;
};

export type ApplicantFunnelReport = {
  days: FunnelRange;
  timeZone: typeof FUNNEL_TIME_ZONE;
  start: string;
  end: string;
  rangeLabel: string;
  cohort: number;
  stages: FunnelStageRow[];
  omittedCount: number;
  omittedStatuses: string[];
  dropOffLabel: string | null;
  dropOffDetail: string | null;
  submittedToApproved: null;
  submittedToApprovedNote: string;
  approvedToRental: string | null;
  approvedToRentalNote: string | null;
  rows: FunnelCsvRow[];
};

export type FunnelApplication = {
  id: string;
  status: string;
  createdAt: string;
  approvedAt: string | null;
  firstRentalAt: string | null;
};

type EasternParts = { year: number; month: number; day: number; hour: number };

function easternParts(instant: Date): EasternParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FUNNEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const num = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const hour = num("hour") === 24 ? 0 : num("hour");
  return { year: num("year"), month: num("month"), day: num("day"), hour };
}

/** Midnight at the start of an Eastern calendar day. EST is UTC-5, EDT is UTC-4. */
export function easternMidnight(year: number, month: number, day: number): Date {
  for (const utcHour of [4, 5]) {
    const instant = new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0));
    const parts = easternParts(instant);
    if (parts.year === year && parts.month === month && parts.day === day && parts.hour === 0) return instant;
  }
  throw new Error("Eastern midnight could not be resolved.");
}

function shiftDate(year: number, month: number, day: number, delta: number) {
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() + delta);
  return { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() };
}

function isoDate(parts: { year: number; month: number; day: number }): string {
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

export function formatEasternDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FUNNEL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

/** Last 7, 30, or 90 Eastern calendar days, including today through now. */
export function funnelWindow(days: FunnelRange, now = new Date()): FunnelWindow {
  const today = easternParts(now);
  const startParts = shiftDate(today.year, today.month, today.day, -(days - 1));
  const start = easternMidnight(startParts.year, startParts.month, startParts.day);
  return {
    days,
    timeZone: FUNNEL_TIME_ZONE,
    start: start.toISOString(),
    end: now.toISOString(),
    startDate: isoDate(startParts),
    endDate: isoDate(today),
  };
}

export function funnelStage(status: string, hasRental: boolean): FunnelStageId | null {
  if (hasRental) return "renting";
  const value = status.toLowerCase();
  if (value === "partial") return "started";
  if (value === "new" || value === "complete") return "complete";
  if (value === "reviewing") return "reviewing";
  if (value === "approved") return "approved";
  if (value === "declined") return "declined";
  return null;
}

function percent(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  const rounded = Math.round((part / whole) * 1000) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}%`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round((ms / 86_400_000) * 10) / 10;
  return `${Number.isInteger(days) ? String(days) : days.toFixed(1)} days`;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function applicantFunnelCsv(rows: FunnelCsvRow[]): string {
  const lines = [FUNNEL_CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(FUNNEL_CSV_COLUMNS.map((column) => csvCell(row[column] ?? "")).join(","));
  }
  return lines.join("\n");
}

export function buildApplicantFunnel(applications: FunnelApplication[], window: FunnelWindow): ApplicantFunnelReport {
  const here: Record<FunnelStageId, number> = {
    started: 0,
    complete: 0,
    reviewing: 0,
    approved: 0,
    declined: 0,
    renting: 0,
  };
  const omitted = new Map<string, number>();
  const durations: number[] = [];
  let missingTimestamp = 0;
  let rentalBeforeApproval = 0;
  const rows: FunnelCsvRow[] = [];

  for (const application of applications) {
    const hasRental = application.firstRentalAt != null;
    const stage = funnelStage(application.status, hasRental);
    if (stage) here[stage] += 1;
    else {
      const key = application.status.toLowerCase();
      omitted.set(key, (omitted.get(key) ?? 0) + 1);
    }
    if (application.approvedAt && application.firstRentalAt) {
      const ms = Date.parse(application.firstRentalAt) - Date.parse(application.approvedAt);
      if (Number.isFinite(ms) && ms >= 0) durations.push(ms);
      else rentalBeforeApproval += 1;
    } else if (stage === "approved" || stage === "renting") {
      missingTimestamp += 1;
    }
    rows.push({
      application_id: application.id,
      stage: stage ? FUNNEL_STAGE_LABEL[stage] : "",
      status: application.status,
      created_at: application.createdAt,
      approved_at: application.approvedAt ?? "",
      first_rental_at: application.firstRentalAt ?? "",
    });
  }

  const reached: Record<FunnelPathStage, number> = {
    started: 0,
    complete: 0,
    reviewing: 0,
    approved: 0,
    renting: 0,
  };
  for (let index = FUNNEL_PATH.length - 1; index >= 0; index -= 1) {
    const id = FUNNEL_PATH[index];
    const later = index === FUNNEL_PATH.length - 1 ? 0 : reached[FUNNEL_PATH[index + 1]];
    reached[id] = here[id] + later;
  }

  const stages: FunnelStageRow[] = ["started", "complete", "reviewing", "approved", "declined", "renting"].map(
    (id) => {
      const stage = id as FunnelStageId;
      if (stage === "declined") {
        return { id: stage, label: FUNNEL_STAGE_LABEL[stage], here: here[stage], reached: null, conversion: null };
      }
      const pathIndex = FUNNEL_PATH.indexOf(stage);
      const previous = pathIndex === 0 ? null : reached[FUNNEL_PATH[pathIndex - 1]];
      return {
        id: stage,
        label: FUNNEL_STAGE_LABEL[stage],
        here: here[stage],
        reached: reached[stage],
        conversion: previous == null ? null : percent(reached[stage], previous),
      };
    },
  );

  let dropOffLabel: string | null = null;
  let dropOffDetail: string | null = null;
  if (reached.started === 0) {
    dropOffDetail = "No applications on the path in this range.";
  } else {
    let lost = 0;
    let from: FunnelPathStage | null = null;
    for (let index = 0; index < FUNNEL_PATH.length - 1; index += 1) {
      const drop = reached[FUNNEL_PATH[index]] - reached[FUNNEL_PATH[index + 1]];
      if (drop > lost) {
        lost = drop;
        from = FUNNEL_PATH[index];
      }
    }
    if (from && lost > 0) {
      const next = FUNNEL_PATH[FUNNEL_PATH.indexOf(from) + 1];
      dropOffLabel = FUNNEL_STAGE_LABEL[from];
      dropOffDetail = `${lost} did not reach ${FUNNEL_STAGE_LABEL[next]}.`;
    } else {
      dropOffDetail = "No drop-off between stages.";
    }
  }

  const leftOut = missingTimestamp + rentalBeforeApproval;
  let approvedToRental: string | null = null;
  let approvedToRentalNote: string | null = null;
  if (durations.length === 0) {
    approvedToRentalNote = "Approval time or a first rental time is not recorded, so this median is omitted.";
  } else {
    approvedToRental = formatDuration(median(durations));
    if (leftOut > 0) {
      approvedToRentalNote = "Applications missing a timestamp, or with a rental recorded before approval, are left out.";
    }
  }

  const omittedStatuses = [...omitted.keys()]
    .sort()
    .map((status) => OMITTED_STATUS_LABEL[status] ?? status);

  return {
    days: window.days,
    timeZone: window.timeZone,
    start: window.start,
    end: window.end,
    rangeLabel: `${formatEasternDate(window.start)} – ${formatEasternDate(window.end)}`,
    cohort: applications.length,
    stages,
    omittedCount: [...omitted.values()].reduce((sum, count) => sum + count, 0),
    omittedStatuses,
    dropOffLabel,
    dropOffDetail,
    submittedToApproved: null,
    submittedToApprovedNote: SUBMITTED_TO_APPROVED_NOTE,
    approvedToRental,
    approvedToRentalNote,
    rows,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
