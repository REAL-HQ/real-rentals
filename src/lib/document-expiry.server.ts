// Loads Documents Expiring and, when the flag is exactly "true", enrolls the
// existing automation engine. The cron sweep sends the steps. This file does
// not send email or SMS and does not write document rows.

import {
  EXPIRY_DOCUMENT_CATEGORIES,
  classifyActiveRenter,
  etCalendarDate,
  renterNeedsExpiryNotice,
  sortExpiringRenters,
  type ExpiringRenter,
  type RenterExpiryInput,
} from "@/lib/document-expiry";

export function documentExpiryNoticesEnabled(): boolean {
  return process.env.DOCUMENT_EXPIRY_NOTICES_ENABLED === "true";
}

type Admin = {
  from: (table: string) => any;
};

export async function loadExpiringRenters(admin: Admin, now: Date = new Date()): Promise<ExpiringRenter[]> {
  const todayEt = etCalendarDate(now);
  const { data: rentals, error: rentalErr } = await admin
    .from("rentals")
    .select("id, application_id")
    .eq("status", "active")
    .not("application_id", "is", null);
  if (rentalErr) throw new Error(rentalErr.message);

  const rentalByApplication = new Map<string, string>();
  for (const row of rentals ?? []) {
    const applicationId = row.application_id as string | null;
    const rentalId = row.id as string | null;
    if (applicationId && rentalId && !rentalByApplication.has(applicationId)) {
      rentalByApplication.set(applicationId, rentalId);
    }
  }
  const ids = [...rentalByApplication.keys()];
  if (!ids.length) return [];

  const [{ data: apps, error: appErr }, { data: docs, error: docErr }] = await Promise.all([
    admin
      .from("applications")
      .select("id, full_name, license_expiration, insurance_expires_on")
      .in("id", ids)
      .is("deleted_at", null),
    admin
      .from("documents")
      .select("driver_id, category, expires_at")
      .eq("is_current", true)
      .in("driver_id", ids)
      .in("category", [...EXPIRY_DOCUMENT_CATEGORIES]),
  ]);
  if (appErr) throw new Error(appErr.message);
  if (docErr) throw new Error(docErr.message);

  const docsByDriver = new Map<string, RenterExpiryInput["documents"]>();
  for (const doc of docs ?? []) {
    const driverId = doc.driver_id as string | null;
    if (!driverId) continue;
    const list = docsByDriver.get(driverId) ?? [];
    list.push({ category: String(doc.category ?? ""), expiresAt: (doc.expires_at as string | null) ?? null });
    docsByDriver.set(driverId, list);
  }

  const classified: ExpiringRenter[] = [];
  for (const app of apps ?? []) {
    const applicationId = app.id as string;
    const rentalId = rentalByApplication.get(applicationId);
    if (!rentalId) continue;
    const row = classifyActiveRenter(
      {
        applicationId,
        rentalId,
        fullName: (app.full_name as string | null) ?? null,
        licenseExpiration: (app.license_expiration as string | null) ?? null,
        insuranceExpiresOn: (app.insurance_expires_on as string | null) ?? null,
        documents: docsByDriver.get(applicationId) ?? [],
      },
      todayEt,
    );
    if (row) classified.push(row);
  }
  return sortExpiringRenters(classified);
}

type EnrollArgs = {
  trigger: "document_expiring";
  applicationId: string;
  rentalId: string;
};

export type ExpiryEnrollDeps = {
  load?: () => Promise<ExpiringRenter[]>;
  enroll?: (args: EnrollArgs) => Promise<{ enrolled: number }>;
};

async function defaultLoad(): Promise<ExpiringRenter[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return loadExpiringRenters(supabaseAdmin);
}

async function defaultEnroll(args: EnrollArgs): Promise<{ enrolled: number }> {
  const { enrollInWorkflows } = await import("@/lib/automations.server");
  return enrollInWorkflows({
    trigger: args.trigger,
    applicationId: args.applicationId,
    rentalId: args.rentalId,
  });
}

/**
 * Enroll active renters who have a document expired or inside 30 days.
 * Unknown dates are a manager cue, not a customer notice. Flag off returns
 * before any read. A failure here must not fail the automation sweep.
 */
export async function enrollDocumentExpiringNotices(
  deps?: ExpiryEnrollDeps,
): Promise<{ enrolled: number; considered: number; skipped: "flag" | "error" | null }> {
  if (!documentExpiryNoticesEnabled()) return { enrolled: 0, considered: 0, skipped: "flag" };
  try {
    const load = deps?.load ?? defaultLoad;
    const enroll = deps?.enroll ?? defaultEnroll;
    const renters = await load();
    let enrolled = 0;
    let considered = 0;
    for (const renter of renters) {
      if (!renterNeedsExpiryNotice(renter)) continue;
      considered++;
      try {
        const result = await enroll({
          trigger: "document_expiring",
          applicationId: renter.applicationId,
          rentalId: renter.rentalId,
        });
        enrolled += result.enrolled;
      } catch (err) {
        console.error("[document-expiry] enroll failed", renter.applicationId, err);
      }
    }
    return { enrolled, considered, skipped: null };
  } catch (err) {
    console.error("[document-expiry] enroll failed", err);
    return { enrolled: 0, considered: 0, skipped: "error" };
  }
}
