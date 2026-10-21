/**
 * My Agreement card for the signed-in driver.
 *
 * DRIVER_AGREEMENT_VIEW_ENABLED is the only declaration. The portal imports
 * it from here. The card module is still loaded only when the flag is
 * exactly true.
 *
 * Version gap: public.agreements has no version column. The number lives on
 * agreement_templates.version, and the only policy on that table is
 * "Admins manage agreement templates", so a driver session cannot read it.
 * A missing version is shown as "Not On File". Nothing here invents one.
 *
 * PDF gap: storage.objects for bucket rental-agreements allows SELECT only
 * through "Partners read their driver documents"
 * (supabase/migrations/20260614225404_0809c198-8fdf-4f4c-a052-6c1fbc39ebae.sql).
 * There is no driver SELECT policy. createSignedUrl with the driver's session
 * fails that check. This module does not add a policy and does not use the
 * service role. The card shows "Available from staff".
 */

export const DRIVER_AGREEMENT_VIEW_ENABLED: boolean = false;

export const AGREEMENT_TIME_ZONE = "America/New_York";

/** Signed PDF links expire in 5 minutes. Never raise this. */
export const AGREEMENT_PDF_URL_TTL_SECONDS = 300;

export const RENTAL_AGREEMENTS_BUCKET = "rental-agreements";

export const STAFF_PDF_LABEL = "Available from staff";

export const AGREEMENT_VERSION_GAP =
  'public.agreements has no version column. agreement_templates.version is readable only by "Admins manage agreement templates", so a driver session cannot read it.';

export const AGREEMENT_PDF_STORAGE_GAP =
  'Bucket rental-agreements has no driver SELECT policy. The only policy is "Partners read their driver documents" in supabase/migrations/20260614225404_0809c198-8fdf-4f4c-a052-6c1fbc39ebae.sql.';

export function assertDriverAgreementViewEnabled(): void {
  if (DRIVER_AGREEMENT_VIEW_ENABLED !== true) {
    throw new Error("Driver agreement view is not enabled.");
  }
}

export function assertAgreementPdfTtl(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > AGREEMENT_PDF_URL_TTL_SECONDS) {
    throw new Error("Agreement PDF link must expire in 5 minutes or less.");
  }
  return seconds;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  signing: "Signing",
  signed: "Signed",
  voided: "Voided",
};

export function agreementStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? "Unknown";
}

export function agreementVersionLabel(version: number | null): string {
  if (version == null || !Number.isInteger(version) || version < 1) return "Not On File";
  return `v${version}`;
}

/** Oct 20, 2026, 11:30 PM ET. Always America/New_York. */
export function formatSignedAtEt(iso: string | null | undefined): string {
  if (!iso) return "Not Signed";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not Signed";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: AGREEMENT_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: AGREEMENT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${date}, ${time} ET`;
}

export type ApplicationOwnerRow = {
  id: string;
  user_id: string;
};

export function ownApplicationIds(rows: readonly ApplicationOwnerRow[], userId: string): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.user_id !== userId || !row.id || ids.includes(row.id)) continue;
    ids.push(row.id);
  }
  return ids;
}

export type AgreementSourceRow = {
  id: string;
  application_id: string | null;
  title: string | null;
  status: string;
  signed_at: string | null;
  template_id: string | null;
  document_id: string | null;
  archive_status: string | null;
};

export type TemplateVersionRow = {
  id: string;
  version: number | null;
};

export type DriverAgreementItem = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  signedAt: string | null;
  signedLabel: string;
  version: number | null;
  versionLabel: string;
  canRequestPdf: boolean;
};

export type DriverAgreementList = {
  agreements: DriverAgreementItem[];
};

export function buildDriverAgreements(
  rows: readonly AgreementSourceRow[],
  ownIds: readonly string[],
  templates: readonly TemplateVersionRow[],
): DriverAgreementItem[] {
  const own = new Set(ownIds);
  const versions = new Map(templates.map((row) => [row.id, row.version]));
  const items: DriverAgreementItem[] = [];
  for (const row of rows) {
    if (!row.application_id || !own.has(row.application_id) || !row.id) continue;
    const version = row.template_id ? versions.get(row.template_id) ?? null : null;
    const signedAt = row.signed_at ?? null;
    items.push({
      id: row.id,
      title: row.title?.trim() || "Rental Agreement",
      status: row.status,
      statusLabel: agreementStatusLabel(row.status),
      signedAt,
      signedLabel: formatSignedAtEt(signedAt),
      version: agreementVersionLabel(version) === "Not On File" ? null : version,
      versionLabel: agreementVersionLabel(version),
      canRequestPdf: row.status === "signed" && row.archive_status === "archived" && !!row.document_id,
    });
  }
  return items;
}

export function agreementIsOwned(
  agreement: { application_id: string | null } | null,
  ownIds: readonly string[],
): boolean {
  return !!agreement?.application_id && ownIds.includes(agreement.application_id);
}

export function pdfAgreementAllowed(
  agreement: {
    application_id: string | null;
    status: string;
    document_id: string | null;
    archive_status: string | null;
  } | null,
  ownIds: readonly string[],
): boolean {
  return (
    agreementIsOwned(agreement, ownIds) &&
    agreement?.status === "signed" &&
    agreement.archive_status === "archived" &&
    !!agreement.document_id
  );
}

export type DocumentSignRow = {
  driver_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  visibility: string[] | null;
};

export function documentCanBeSigned(doc: DocumentSignRow | null, ownIds: readonly string[]): boolean {
  if (!doc?.driver_id || !ownIds.includes(doc.driver_id)) return false;
  if (!Array.isArray(doc.visibility) || !doc.visibility.includes("driver")) return false;
  if (doc.storage_bucket !== RENTAL_AGREEMENTS_BUCKET) return false;
  if (!doc.storage_path) return false;
  return true;
}

export type SignedUrlAttempt = {
  signedUrl?: string | null;
  error?: { message?: string } | null;
};

export type AgreementPdfResult = {
  url: string | null;
  availability: typeof STAFF_PDF_LABEL | "View PDF";
};

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function agreementPdfLink(attempt: SignedUrlAttempt | null, ttlSeconds: number): AgreementPdfResult {
  assertAgreementPdfTtl(ttlSeconds);
  const url = attempt?.error ? null : safeHttpUrl(attempt?.signedUrl);
  if (!url) return { url: null, availability: STAFF_PDF_LABEL };
  return { url, availability: "View PDF" };
}
