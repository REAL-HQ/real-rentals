// The submitted rental application, as a document.
//
// The application is a database record (applications), not a file, so the
// Documents grid's "Rental Application" card — which only looked for an
// uploaded file filed under rental_application — said "Not Received" for
// everyone who applied through the app (286 of 287 applicants had no such
// file). This turns the submitted record into labelled rows; the server draws
// them into a PDF the card can show on screen. Pure and browser-safe.

export type ApplicationRecord = Record<string, unknown>;
export type SummaryRow = { label: string; value: string };
export type SummarySection = { title: string; rows: SummaryRow[] };

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v).trim();
  return s ? s : null;
};
const yn = (v: unknown): string | null => (v == null ? null : v ? "Yes" : "No");
const date = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: s.length === 10 ? "UTC" : "America/New_York" });
};
const dateTime = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : `${d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
};
const last4 = (v: unknown): string | null => {
  const s = str(v);
  return s ? `…${s.slice(-4)}` : null;
};

function keep(rows: Array<[string, string | null]>): SummaryRow[] {
  return rows.filter(([, v]) => v != null).map(([label, value]) => ({ label, value: value as string }));
}

/** A submitted application has left the draft step and has a name. */
export function applicationWasSubmitted(a: ApplicationRecord | null | undefined): boolean {
  if (!a) return false;
  if (!str(a.full_name)) return false;
  const status = String(a.status ?? "").toLowerCase();
  return status !== "draft" && status !== "";
}

export function buildApplicationSummary(a: ApplicationRecord): SummarySection[] {
  const address = [str(a.address), [str(a.city), str(a.state)].filter(Boolean).join(", "), str(a.zip)].filter(Boolean).join(" · ") || null;
  return [
    {
      title: "Applicant",
      rows: keep([
        ["Name", str(a.full_name)],
        ["Email", str(a.email)],
        ["Phone", str(a.phone)],
        ["Date Of Birth", date(a.dob)],
        ["Address", address],
      ]),
    },
    {
      title: "License",
      rows: keep([
        ["License State", str(a.license_state)],
        ["License Number", last4(a.license_number)],
        ["License Expires", date(a.license_expiration)],
        ["Years Licensed", str(a.years_licensed)],
      ]),
    },
    {
      title: "Driving",
      rows: keep([
        ["Platforms", str(a.platforms)],
        ["Drive Type", str(a.drive_type)],
        ["Weekly Hours", str(a.weekly_hours)],
        ["Trips Completed", str(a.trips_completed)],
        ["Rating", str(a.rating)],
      ]),
    },
    {
      title: "Rental Request",
      rows: keep([
        ["Start Date", date(a.start_date ?? a.contract_start_date)],
        ["Rental Term", str(a.rental_term ?? a.rental_length ?? a.rental_duration ?? a.expected_duration)],
        ["Vehicle Size", str(a.vehicle_size)],
        ["Payment Method", str(a.payment_method)],
        ["How They Heard", str(a.how_heard)],
      ]),
    },
    {
      title: "Consents",
      rows: keep([
        ["Rental Terms", yn(a.consent_terms)],
        ["GPS Tracking", yn(a.consent_gps)],
        ["Background Check", yn(a.consent_background)],
        ["Prepayment", yn(a.consent_prepay)],
        ["Text Messages", yn(a.sms_consent)],
      ]),
    },
    {
      title: "Record",
      rows: keep([
        ["Submitted", dateTime(a.created_at)],
        ["Status", str(a.status)],
        ["Application ID", str(a.id)],
      ]),
    },
  ].filter((s) => s.rows.length > 0);
}
