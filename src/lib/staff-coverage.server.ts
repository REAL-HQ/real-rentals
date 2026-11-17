/**
 * Load editable staff schedules and resolve who a handoff text should go to.
 *
 * Destinations:
 *   - other_quo_line: SMS from the renter's company line to the other company
 *     line (E.164 from QUO_KNOWN_SENDERS). Quo's 2026-03-30 API can send that
 *     text; it cannot place a human call between the two lines.
 *   - field_rep_sms: the Pickup Schedule notify.sms numbers (existing
 *     setting). Never a number taken from a renter, an applicant, or a request.
 *
 * Injuries and accidents always include the field-rep numbers, at any hour,
 * and also the other company line when Rosa is on duty. Non-urgent handoff
 * texts still wait for 8 AM–9 PM ET.
 */
import { loadPickupSchedule } from "@/lib/reservation-confirmation.server";
import { QUO_KNOWN_SENDERS, type QuoSender } from "@/lib/sms-provider.server";
import { tableMissing } from "@/lib/fleet-api.server";
import { withinTextingHours } from "@/lib/failed-payment-link";
import {
  activeCompanyLine,
  coverageSnapshot,
  DEFAULT_STAFF_SCHEDULES,
  fieldRepSchedule,
  isValidDateKey,
  isValidHhmm,
  otherCompanyLine,
  readReachVia,
  readRoles,
  readWeeklyWindows,
  resolveOnDuty,
  STAFF_EXCEPTIONS_TABLE,
  STAFF_SCHEDULES_TABLE,
  type CoverageSnapshot,
  type StaffException,
  type StaffReachVia,
  type StaffSchedule,
} from "@/lib/staff-coverage";

type Admin = any;

export type LoadedStaffCoverage = {
  schedules: StaffSchedule[];
  exceptions: StaffException[];
  /** True when the tables could not be read and defaults were used. */
  fromDefaults: boolean;
};

export type StaffSmsTarget = {
  to: string;
  fromId: string | null;
  via: StaffReachVia;
  staffKey: string;
  staffName: string;
};

export type StaffHandoffPlan = {
  coverage: CoverageSnapshot;
  targets: StaffSmsTarget[];
  quietHours: boolean;
  fromLine: { id: string; label: string; e164: string } | null;
  toLine: { id: string; label: string; e164: string } | null;
};

const URGENT = new Set(["injury", "accident"]);

function asSchedule(row: any): StaffSchedule | null {
  const staffKey = String(row?.staff_key ?? "").trim();
  const displayName = String(row?.display_name ?? "").trim();
  if (!staffKey || !displayName) return null;
  const roles = readRoles(row.roles);
  if (!roles.length) return null;
  return {
    staffKey,
    displayName,
    roles,
    timezone: String(row.timezone || "America/New_York"),
    windows: readWeeklyWindows(row.weekly_windows),
    reachVia: readReachVia(row.reach_via),
    isActive: row.is_active !== false,
  };
}

function asException(row: any): StaffException | null {
  const staffKey = String(row?.staff_key ?? "").trim();
  const date = String(row?.exception_date ?? row?.date ?? "").slice(0, 10);
  const kind = row?.kind === "on" || row?.kind === "off" ? row.kind : null;
  if (!staffKey || !isValidDateKey(date) || !kind) return null;
  const start = isValidHhmm(row.start_time) ? row.start_time : isValidHhmm(row.start) ? row.start : null;
  const end = isValidHhmm(row.end_time) ? row.end_time : isValidHhmm(row.end) ? row.end : null;
  return {
    staffKey,
    date,
    kind,
    start,
    end,
    note: row.note != null ? String(row.note).slice(0, 200) : null,
  };
}

export async function loadStaffCoverage(admin: Admin): Promise<LoadedStaffCoverage> {
  const s = await admin.from(STAFF_SCHEDULES_TABLE).select("staff_key,display_name,roles,timezone,weekly_windows,reach_via,is_active");
  if (s.error) {
    if (tableMissing(s.error, STAFF_SCHEDULES_TABLE) || String(s.error.code) === "42P01" || /does not exist|schema cache/i.test(String(s.error.message ?? ""))) {
      return { schedules: [...DEFAULT_STAFF_SCHEDULES], exceptions: [], fromDefaults: true };
    }
    return { schedules: [...DEFAULT_STAFF_SCHEDULES], exceptions: [], fromDefaults: true };
  }
  const schedules = (Array.isArray(s.data) ? s.data : []).map(asSchedule).filter((x: StaffSchedule | null): x is StaffSchedule => !!x);
  const used = schedules.length ? schedules : [...DEFAULT_STAFF_SCHEDULES];
  const e = await admin.from(STAFF_EXCEPTIONS_TABLE).select("staff_key,exception_date,kind,start_time,end_time,note");
  const exceptions = e.error ? [] : (Array.isArray(e.data) ? e.data : []).map(asException).filter((x: StaffException | null): x is StaffException => !!x);
  return { schedules: used, exceptions, fromDefaults: !schedules.length };
}

export async function loadFieldRepSmsNumbers(admin: Admin): Promise<string[]> {
  try {
    const settings = await loadPickupSchedule(admin);
    const nums = (settings.notify?.sms ?? []).map(String).filter(Boolean);
    return nums;
  } catch {
    return [];
  }
}

export function companyLines(senders: readonly QuoSender[] = QUO_KNOWN_SENDERS) {
  return senders.map((s) => ({ id: s.id, label: s.label, display: s.display, e164: s.e164 }));
}

export function publicCoverage(snapshot: CoverageSnapshot, plan?: Pick<StaffHandoffPlan, "fromLine" | "toLine">) {
  return {
    timezone: snapshot.timezone,
    on_duty: snapshot.onDuty,
    reach_via: snapshot.reachVia,
    may_call_applicant: snapshot.mayCallApplicant,
    renter_texting_hours: snapshot.renterTextingHours,
    from_line_id: plan?.fromLine?.id ?? null,
    to_line_id: plan?.toLine?.id ?? null,
    to_line_label: plan?.toLine?.label ?? null,
  };
}

/**
 * Who to text for a staff handoff.
 * `reason` "injury" or "accident" always includes the field-rep numbers and
 * ignores quiet hours. Regular handoffs go to the other company line during
 * Rosa's hours, and to the field-rep numbers otherwise.
 */
export async function planStaffHandoffSms(args: {
  admin: Admin;
  now: Date;
  reason?: string | null;
  /** PN id or E.164 of the line the renter is already on. */
  activeLine?: string | null;
  fieldRepNumbers?: string[];
  coverage?: LoadedStaffCoverage;
  lines?: readonly QuoSender[];
  /** Team alerts to staff may be sent at any hour (bot-rules D20). */
  ignoreQuietHours?: boolean;
}): Promise<StaffHandoffPlan> {
  const loaded = args.coverage ?? (await loadStaffCoverage(args.admin));
  const lines = companyLines(args.lines ?? QUO_KNOWN_SENDERS);
  const fromLine = activeCompanyLine(lines, args.activeLine);
  const toLine = otherCompanyLine(lines, args.activeLine);
  const snapshot = coverageSnapshot(loaded.schedules, loaded.exceptions, args.now);
  const on = resolveOnDuty(loaded.schedules, loaded.exceptions, args.now);
  const urgent = URGENT.has(String(args.reason ?? ""));
  const quietHours = !args.ignoreQuietHours && !urgent && !withinTextingHours(args.now);
  const targets: StaffSmsTarget[] = [];

  if (!quietHours && on) {
    if (on.schedule.reachVia === "other_quo_line" && toLine && fromLine) {
      targets.push({
        to: toLine.e164,
        fromId: fromLine.id,
        via: "other_quo_line",
        staffKey: on.schedule.staffKey,
        staffName: on.schedule.displayName,
      });
    } else {
      const nums = args.fieldRepNumbers ?? (await loadFieldRepSmsNumbers(args.admin));
      const rep = fieldRepSchedule(loaded.schedules);
      for (const to of nums) {
        targets.push({
          to,
          fromId: fromLine?.id ?? null,
          via: "field_rep_sms",
          staffKey: rep?.staffKey ?? on.schedule.staffKey,
          staffName: rep?.displayName ?? on.schedule.displayName,
        });
      }
    }
  }

  // Injuries and accidents always also go to the field rep, at any hour,
  // even when Rosa is already getting the other-line text.
  if (urgent) {
    const nums = args.fieldRepNumbers ?? (await loadFieldRepSmsNumbers(args.admin));
    const rep = fieldRepSchedule(loaded.schedules);
    const have = new Set(targets.map((t) => t.to));
    for (const to of nums) {
      if (have.has(to)) continue;
      targets.push({
        to,
        fromId: fromLine?.id ?? null,
        via: "field_rep_sms",
        staffKey: rep?.staffKey ?? "dolmar",
        staffName: rep?.displayName ?? "Dolmar Cross",
      });
    }
  }

  return {
    coverage: snapshot,
    targets,
    quietHours,
    fromLine: fromLine ? { id: fromLine.id, label: fromLine.label, e164: fromLine.e164 } : null,
    toLine: toLine ? { id: toLine.id, label: toLine.label, e164: toLine.e164 } : null,
  };
}
