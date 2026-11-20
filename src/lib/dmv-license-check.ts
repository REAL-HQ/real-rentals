/**
 * State DMV license check (Dolmar, Nov 20 2026). Client-safe rules, shared by the
 * back-office card (to say why) and the server (to refuse).
 *
 * Besides RentID, staff check every applicant's license on the state DMV site
 * (Florida: FLHSMV Driver License Check) and log the result. Approval, agreement
 * sends and Reservation Fee links need a Valid result under 24 hours old. Any
 * other result goes to Needs Staff. A license from another state shows as
 * Unverified until a Valid check against that state's DMV is logged.
 */
export const DMV_CHECK_STATUSES = [
  { key: "valid", label: "Valid" },
  { key: "suspended", label: "Suspended" },
  { key: "revoked", label: "Revoked" },
  { key: "cancelled", label: "Cancelled" },
  { key: "expired", label: "Expired" },
  { key: "not_found", label: "Not Found" },
  { key: "other", label: "Other (Not Valid)" },
] as const;
export type DmvCheckStatus = (typeof DMV_CHECK_STATUSES)[number]["key"];
export const DMV_CHECK_STATUS_KEYS = DMV_CHECK_STATUSES.map((s) => s.key) as DmvCheckStatus[];

/** A Valid check older than this must be run again before an agreement or fee link goes out. */
export const DMV_CHECK_MAX_AGE_MS = 24 * 3600 * 1000;
export const DMV_HOME_STATE = "FL";
export const DMV_NEEDS_STAFF_CODE = "dmv_check_not_valid";
export const DMV_NEEDS_STAFF_PREFIX = "state dmv check";
export const DMV_FLORIDA_CHECK_URL = "https://services.flhsmv.gov/DLCheck/";

export type DmvCheck = {
  id: string;
  status: DmvCheckStatus;
  licenseState: string;
  checkedAt: string;
  checkedByLabel: string;
  note: string | null;
  screenshotPath: string | null;
};

export function dmvStatusLabel(s: string): string {
  return DMV_CHECK_STATUSES.find((x) => x.key === s)?.label ?? "Other (Not Valid)";
}

/** Two-letter state, upper-case. "fl", " Florida " is not accepted: null. */
export function normalizeLicenseState(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

export type DmvGateCode = "no_check" | "stale" | "not_valid" | "out_of_state" | "state_mismatch";
export type DmvGate =
  | { ok: true; check: DmvCheck; ageHours: number }
  | { ok: false; code: DmvGateCode; message: string; check: DmvCheck | null };

/**
 * The one decision: may this applicant be approved / sent an agreement / sent a
 * Reservation Fee link right now? `licenseState` is the state on the application
 * (null = unknown; treated as the home state only when a check says so).
 */
export function evaluateDmvGate(latest: DmvCheck | null, licenseState: string | null | undefined, now: number): DmvGate {
  const appState = normalizeLicenseState(licenseState);
  if (!latest) {
    return {
      ok: false,
      code: appState && appState !== DMV_HOME_STATE ? "out_of_state" : "no_check",
      check: null,
      message:
        appState && appState !== DMV_HOME_STATE
          ? `Out-Of-State License (${appState}): Unverified. Log A State DMV Check First.`
          : "State DMV License Check Needed. Log The Result On The Driver's Overview First.",
    };
  }
  if (latest.status !== "valid") {
    return { ok: false, code: "not_valid", check: latest, message: `State DMV Check Is Not Valid (${dmvStatusLabel(latest.status)}). Needs Staff: No Agreement And No Reservation Fee Link.` };
  }
  if (appState && latest.licenseState !== appState) {
    return { ok: false, code: "state_mismatch", check: latest, message: `The Last DMV Check Was For ${latest.licenseState}, But The License Is From ${appState}. Log A New Check.` };
  }
  const t = Date.parse(latest.checkedAt);
  const age = now - t;
  if (!Number.isFinite(t) || age > DMV_CHECK_MAX_AGE_MS || age < -5 * 60 * 1000) {
    return { ok: false, code: "stale", check: latest, message: "The Last State DMV Check Is Over 24 Hours Old. Run It Again And Log The Result." };
  }
  return { ok: true, check: latest, ageHours: Math.max(0, age) / 3600000 };
}

/** "Unverified" for an out-of-state license that has no Valid check for its own state. */
export function dmvDisplay(latest: DmvCheck | null, licenseState: string | null | undefined, now: number): { label: string; tone: "ok" | "bad" | "warn" | "none" } {
  const g = evaluateDmvGate(latest, licenseState, now);
  if (g.ok) return { label: "Valid", tone: "ok" };
  if (g.code === "out_of_state") return { label: "Unverified", tone: "warn" };
  if (g.code === "no_check") return { label: "Not Checked", tone: "none" };
  if (g.code === "stale") return { label: "Valid, Over 24 Hours Old", tone: "warn" };
  if (g.code === "state_mismatch") return { label: "Unverified", tone: "warn" };
  return { label: dmvStatusLabel(latest?.status ?? "other"), tone: "bad" };
}

export type DmvLogInput = { status: string; licenseState: string; note?: string | null };
export function dmvLogBlockers(i: DmvLogInput): string[] {
  const out: string[] = [];
  if (!DMV_CHECK_STATUS_KEYS.includes(i.status as DmvCheckStatus)) out.push("Pick The Result.");
  if (!normalizeLicenseState(i.licenseState)) out.push("Enter The Two-Letter License State.");
  if (String(i.note ?? "").trim().length < 5) out.push("Add A Note (For Example, What The DMV Site Showed).");
  return out;
}
