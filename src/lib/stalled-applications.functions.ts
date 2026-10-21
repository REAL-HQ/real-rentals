import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireManager } from "@/lib/roles.server";
import {
  assertStalledApplicationsEnabled,
  cardOnFile,
  classifyStalled,
  documentsOnFile,
  identityIsClear,
  signedAgreement,
  sortStalled,
  STALLED_STATUSES,
  type StalledAgreement,
  type StalledApplication,
} from "@/lib/stalled-applications";

/**
 * Stalled applications for Owners and Managers.
 *
 * Read only. While the flag is off this refuses before the role check and
 * before any query. It does not write, email, or text.
 */

const CONTACT_COLUMNS =
  "contact_status,contact_status_note,contact_follow_up_on,contact_status_at,contact_status_by";

const APP_COLUMNS = [
  "id",
  "full_name",
  "first_name",
  "last_name",
  "phone",
  "status",
  "license_photo_url",
  "insurance_doc_url",
  "background_check_status",
  "mvr_status",
  "card_last4",
  "stripe_payment_method_id",
  "card_on_file_at",
  "contacted_at",
  "updated_at",
  "created_at",
  CONTACT_COLUMNS,
].join(",");

const APP_COLUMNS_WITHOUT_CONTACT = APP_COLUMNS.replace(`,${CONTACT_COLUMNS}`, "");

/** First 500 applications. range() is inclusive, so the request asks for one extra row. */
const STALLED_ROW_CAP = 500;
/**
 * Related pages stay at 500. range() is inclusive, so each request asks for
 * one extra row. A server max below 1000 still returns the page.
 */
const RELATED_PAGE = 500;

export type StalledContact = {
  contact_status: string | null;
  contact_status_note: string | null;
  contact_follow_up_on: string | null;
  contact_status_at: string | null;
  contact_status_by: string | null;
};

export type StalledApplicationRow = StalledApplication & {
  /** Null when the contact columns are not on this database yet. */
  contact: StalledContact | null;
};

type LoadedApplications = {
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
  error: { message: string } | null;
};

async function loadApplications(withContact: boolean): Promise<LoadedApplications> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const loaded = await supabaseAdmin
    .from("applications")
    .select(withContact ? APP_COLUMNS : APP_COLUMNS_WITHOUT_CONTACT)
    .is("deleted_at", null)
    .in("status", [...STALLED_STATUSES])
    .order("created_at")
    .order("id")
    .range(0, STALLED_ROW_CAP);
  if (loaded.error) return { rows: [], truncated: false, error: loaded.error };
  const data = (loaded.data ?? []) as unknown as Array<Record<string, unknown>>;
  const truncated = data.length > STALLED_ROW_CAP;
  return { rows: truncated ? data.slice(0, STALLED_ROW_CAP) : data, truncated, error: null };
}

type DocRow = { driver_id: string | null; category: string | null; created_at: string | null; is_current: boolean | null };
type AgreementRow = {
  application_id: string | null;
  status: string | null;
  signed_at: string | null;
  sent_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  voided_at: string | null;
};
type IdentityRow = { application_id: string | null; status: string | null; created_at: string | null };

async function readPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const loaded = await fetchPage(from, from + RELATED_PAGE);
    if (loaded.error) throw new Error(loaded.error.message);
    const page = loaded.data ?? [];
    const more = page.length > RELATED_PAGE;
    rows.push(...(more ? page.slice(0, RELATED_PAGE) : page));
    if (!more) return { rows, truncated: false };
    from += RELATED_PAGE;
    if (from >= RELATED_PAGE * 20) return { rows, truncated: true };
  }
}

async function loadRelated(ids: string[]) {
  const docsByDriver = new Map<string, string[]>();
  const docActivity = new Map<string, string[]>();
  const agreements = new Map<string, StalledAgreement[]>();
  const agreementActivity = new Map<string, string[]>();
  const openIdentity = new Set<string>();
  const identityActivity = new Map<string, string[]>();
  if (!ids.length) {
    return { docsByDriver, docActivity, agreements, agreementActivity, openIdentity, identityActivity, truncated: false };
  }
  let truncated = false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [docs, agreementRows, identityRows] = await Promise.all([
      readPages<DocRow>((from, to) =>
        supabaseAdmin
          .from("documents")
          .select("driver_id,category,created_at,is_current")
          .in("driver_id", chunk)
          .order("id")
          .range(from, to),
      ),
      readPages<AgreementRow>((from, to) =>
        supabaseAdmin
          .from("agreements")
          .select("application_id,status,signed_at,sent_at,created_at,updated_at,voided_at")
          .in("application_id", chunk)
          .order("id")
          .range(from, to),
      ),
      readPages<IdentityRow>((from, to) =>
        supabaseAdmin
          .from("application_identity_reviews")
          .select("application_id,status,created_at")
          .in("application_id", chunk)
          .order("id")
          .range(from, to),
      ),
    ]);
    truncated = truncated || docs.truncated || agreementRows.truncated || identityRows.truncated;
    for (const doc of docs.rows) {
      const driverId = String(doc.driver_id ?? "");
      if (!driverId) continue;
      if (doc.is_current && doc.category) {
        const list = docsByDriver.get(driverId) ?? [];
        list.push(String(doc.category));
        docsByDriver.set(driverId, list);
      }
      if (doc.created_at) {
        const stamps = docActivity.get(driverId) ?? [];
        stamps.push(String(doc.created_at));
        docActivity.set(driverId, stamps);
      }
    }
    for (const row of agreementRows.rows) {
      const applicationId = String(row.application_id ?? "");
      if (!applicationId) continue;
      const list = agreements.get(applicationId) ?? [];
      list.push({ status: row.status, signedAt: row.signed_at, voidedAt: row.voided_at });
      agreements.set(applicationId, list);
      const stamps = agreementActivity.get(applicationId) ?? [];
      for (const stamp of [row.signed_at, row.sent_at, row.created_at, row.updated_at, row.voided_at]) {
        if (stamp) stamps.push(String(stamp));
      }
      agreementActivity.set(applicationId, stamps);
    }
    for (const row of identityRows.rows) {
      const applicationId = String(row.application_id ?? "");
      if (!applicationId) continue;
      if (String(row.status ?? "").trim().toLowerCase() === "open") openIdentity.add(applicationId);
      if (row.created_at) {
        const stamps = identityActivity.get(applicationId) ?? [];
        stamps.push(String(row.created_at));
        identityActivity.set(applicationId, stamps);
      }
    }
  }
  return { docsByDriver, docActivity, agreements, agreementActivity, openIdentity, identityActivity, truncated };
}

export const listStalledApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: StalledApplicationRow[]; truncated: boolean; relatedTruncated: boolean }> => {
    assertStalledApplicationsEnabled();
    await requireManager(context.userId);

    let withContact = true;
    let loaded = await loadApplications(true);
    if (loaded.error) {
      withContact = false;
      loaded = await loadApplications(false);
    }
    if (loaded.error) throw new Error(loaded.error.message);

    const apps = loaded.rows;
    const ids = apps.map((row) => String(row.id));
    const related = await loadRelated(ids);
    const today = new Date();
    const rows: StalledApplicationRow[] = [];
    for (const row of apps) {
      const id = String(row.id);
      const categories = related.docsByDriver.get(id) ?? [];
      const stalled = classifyStalled(
        {
          id,
          fullName: row.full_name as string | null,
          firstName: row.first_name as string | null,
          lastName: row.last_name as string | null,
          phone: row.phone as string | null,
          status: row.status as string | null,
          documentsOnFile: documentsOnFile({
            licensePhotoUrl: row.license_photo_url as string | null,
            insuranceDocUrl: row.insurance_doc_url as string | null,
            categories,
          }),
          identityClear: identityIsClear(
            row.background_check_status as string | null,
            row.mvr_status as string | null,
            related.openIdentity.has(id),
          ),
          agreementSigned: signedAgreement(related.agreements.get(id) ?? []),
          cardOnFile: cardOnFile([
            row.card_last4 as string | null,
            row.stripe_payment_method_id as string | null,
            row.card_on_file_at as string | null,
          ]),
          activityAt: [
            row.updated_at as string | null,
            row.created_at as string | null,
            row.contacted_at as string | null,
            withContact ? (row.contact_status_at as string | null) : null,
            row.card_on_file_at as string | null,
            ...(related.docActivity.get(id) ?? []),
            ...(related.agreementActivity.get(id) ?? []),
            ...(related.identityActivity.get(id) ?? []),
          ],
          contactAt: [
            row.contacted_at as string | null,
            withContact ? (row.contact_status_at as string | null) : null,
          ],
        },
        today,
      );
      if (!stalled) continue;
      const contact: StalledContact | null = withContact
        ? {
            contact_status: (row.contact_status as string | null) ?? null,
            contact_status_note: (row.contact_status_note as string | null) ?? null,
            contact_follow_up_on: (row.contact_follow_up_on as string | null) ?? null,
            contact_status_at: (row.contact_status_at as string | null) ?? null,
            contact_status_by: (row.contact_status_by as string | null) ?? null,
          }
        : null;
      rows.push({ ...stalled, contact });
    }
    return { rows: sortStalled(rows), truncated: loaded.truncated, relatedTruncated: related.truncated };
  });
