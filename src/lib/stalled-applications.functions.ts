import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireManager } from "@/lib/roles.server";
import {
  assertStalledApplicationsEnabled,
  classifyStalled,
  insuranceOnFile,
  licenseOnFile,
  sortStalled,
  type StalledApplication,
} from "@/lib/stalled-applications";

/**
 * Stalled applications for Owners and Managers.
 *
 * Read only. Contact Status is saved by the existing setContactStatus
 * function, which already writes contact_status and the audit log.
 * While the flag is off this refuses before any role lookup or query.
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
  "updated_at",
  "created_at",
  CONTACT_COLUMNS,
].join(",");

const APP_COLUMNS_WITHOUT_CONTACT = APP_COLUMNS.replace(`,${CONTACT_COLUMNS}`, "");

export type StalledContact = {
  contact_status: string | null;
  contact_status_note: string | null;
  contact_follow_up_on: string | null;
  contact_status_at: string | null;
  contact_status_by: string | null;
};

export type StalledApplicationRow = StalledApplication & {
  /** Raw contact_* columns for the existing Contact Status cell. Null before that migration. */
  contact: StalledContact | null;
};

async function loadApplications(withContact: boolean) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin
    .from("applications")
    .select(withContact ? APP_COLUMNS : APP_COLUMNS_WITHOUT_CONTACT)
    .is("deleted_at", null)
    .in("status", ["partial", "new", "complete", "reviewing"]);
}

export const listStalledApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: StalledApplicationRow[] }> => {
    assertStalledApplicationsEnabled();
    await requireManager(context.userId);

    let withContact = true;
    let loaded = await loadApplications(true);
    if (loaded.error) {
      withContact = false;
      loaded = await loadApplications(false);
    }
    if (loaded.error) throw new Error(loaded.error.message);

    const apps = (loaded.data ?? []) as unknown as Array<Record<string, unknown>>;
    const ids = apps.map((row) => String(row.id));
    const docsByDriver = new Map<string, string[]>();
    const docActivity = new Map<string, string>();
    if (ids.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      for (let i = 0; i < ids.length; i += 100) {
        const { data: docs, error } = await supabaseAdmin
          .from("documents")
          .select("driver_id,category,created_at,is_current")
          .in("driver_id", ids.slice(i, i + 100));
        if (error) throw new Error(error.message);
        for (const doc of docs ?? []) {
          const driverId = String(doc.driver_id ?? "");
          if (!driverId) continue;
          if (doc.is_current && doc.category) {
            const list = docsByDriver.get(driverId) ?? [];
            list.push(String(doc.category));
            docsByDriver.set(driverId, list);
          }
          const created = doc.created_at ? String(doc.created_at) : "";
          if (!created) continue;
          const prev = docActivity.get(driverId);
          if (!prev || Date.parse(created) > Date.parse(prev)) docActivity.set(driverId, created);
        }
      }
    }

    const today = new Date();
    const rows: StalledApplicationRow[] = [];
    for (const row of apps) {
      const id = String(row.id);
      const categories = docsByDriver.get(id) ?? [];
      const stalled = classifyStalled(
        {
          id,
          fullName: row.full_name as string | null,
          firstName: row.first_name as string | null,
          lastName: row.last_name as string | null,
          phone: row.phone as string | null,
          status: row.status as string | null,
          licenseOnFile: licenseOnFile(row.license_photo_url as string | null, categories),
          insuranceOnFile: insuranceOnFile(row.insurance_doc_url as string | null, categories),
          backgroundCheckStatus: row.background_check_status as string | null,
          mvrStatus: row.mvr_status as string | null,
          activityAt: [
            row.updated_at as string | null,
            row.created_at as string | null,
            row.contact_status_at as string | null,
            docActivity.get(id) ?? null,
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
    return { rows: sortStalled(rows) };
  });
