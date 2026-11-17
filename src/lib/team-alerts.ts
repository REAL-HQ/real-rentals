/**
 * Team alerts to a person (Dolmar, t299s1618). Client-safe constants and the
 * one switch format. Sending lives in team-alerts.server.ts.
 *
 * A team alert is one email to the team inbox plus a staff text. bot_handoff
 * texts follow staff coverage (docs/staff-coverage.md). Other kinds text the
 * field-rep numbers from the Pickup Schedule settings. Alert code never takes
 * a phone number from a renter, an applicant or a request body.
 */

export const TEAM_ALERT_EMAIL = "team@drivereal.com";
export const TEAM_ALERTS_SETTINGS_KEY = "team_alerts";

export const TEAM_ALERT_KINDS = ["gps", "roadside_overnight", "late_pickup", "bot_handoff", "applicant_approved"] as const;
export type TeamAlertKind = (typeof TEAM_ALERT_KINDS)[number];

export const TEAM_ALERT_LABELS: Record<TeamAlertKind, string> = {
  gps: "GPS Alerts (outside the 100-mile service area around Tampa, tracker offline 24 hours, no movement 48 hours)",
  roadside_overnight: "Overnight Roadside Alerts (6 PM to 6 AM ET)",
  late_pickup: "Late Pickup Release Alerts",
  bot_handoff: "Bot Hand-Off Alerts (complaints, injuries, payment disputes)",
  applicant_approved: "Approved Applicant Call Alerts (staff call to go over terms, then Move Forward)",
};

/**
 * Staff work inboxes by staff_schedules.staff_key. An applicant_approved alert
 * also emails the on-duty coverage person here (team@ always gets a copy).
 * Work email addresses only; never a phone number.
 */
export const STAFF_WORK_EMAILS: Readonly<Record<string, string>> = { rosa: "rosa@drivereal.com" };

/** Every kind is OFF until an Owner turns it on. No row, malformed row, or unknown kind = off. */
export type TeamAlertSettings = Record<TeamAlertKind, boolean>;

export function readTeamAlertSettings(value: unknown): TeamAlertSettings {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const out = {} as TeamAlertSettings;
  for (const k of TEAM_ALERT_KINDS) {
    const e = v[k];
    out[k] = !!(e && typeof e === "object" && (e as Record<string, unknown>).enabled === true);
  }
  return out;
}

/** 6 PM to 6 AM Eastern: roadside has no tow partner overnight (D17). */
export function isOvernightEt(at: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return h >= 18 || h < 6;
}

/** Team alert text: "REAL: <subject> <link>", one line, no renter phone number. */
export function teamAlertSms(title: string, link: string | null): string {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 240);
  return `REAL: ${t}${link ? ` ${link}` : ""}`;
}

/**
 * Strip anything that looks like a phone number from alert text (belt and
 * braces). Leaves no placeholder and no empty brackets behind.
 */
export function scrubPhones(text: string): string {
  return text
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
