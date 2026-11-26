/**
 * Profile notes FLEET appends to applications.notes (the staff Internal Notes
 * box) and the applicant-facing decline notice. No I/O.
 *
 * The notice never includes the internal reason. Staff read the reason on the
 * profile; the applicant gets a short decision, not the review notes.
 */
export const FLEET_NOTE_MAX = 2000;

/** Eastern calendar date, "Nov 16, 2026". */
export function fleetDateLabel(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(at);
}

export function firstNameOf(fullName: string | null | undefined): string {
  const name = String(fullName ?? "").trim().split(/\s+/)[0];
  return name || "there";
}

/** Line written when an application is declined. `actor` is "FLEET (automated)" or a staff email. */
export function declineProfileLine(actor: string, at: Date, reason: string): string {
  return `Declined by ${actor} on ${fleetDateLabel(at)}: ${reason.trim()}`;
}

/** Line written for a profile note that is not itself a decline. */
export function profileNoteLine(actor: string, at: Date, note: string): string {
  return `${actor} on ${fleetDateLabel(at)}: ${note.trim()}`;
}

export function declineApplicantSms(fullName: string | null | undefined, companyPhone: string): string {
  const name = firstNameOf(fullName);
  return `Hi ${name}, REAL RENTALS here. Thank you for applying. We are not able to approve your application at this time. Questions? Call ${companyPhone}. Reply STOP to opt out.`;
}

export function declineApplicantEmailText(fullName: string | null | undefined, companyPhone: string): { subject: string; greeting: string; body: string } {
  const name = firstNameOf(fullName);
  return {
    subject: "Your REAL RENTALS Application",
    greeting: `Hi ${name}, thank you for applying to rent with REAL RENTALS.`,
    body: `We are not able to approve your application at this time. If you have questions, reply to this email or call ${companyPhone}.`,
  };
}
