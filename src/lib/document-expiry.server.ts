// Loads Documents Expiring and, while DOCUMENT_EXPIRY_NOTICES_ENABLED is true,
// enrolls the existing automation engine. The constant is false. The cron
// sweep sends the steps. This file does not send email or SMS and does not
// write document rows.

import { DOCUMENT_EXPIRY_NOTICES_ENABLED } from "@/lib/document-expiry-flag";
import {
  APPROVED_DRIVER_STATUSES,
  EXPIRY_DOCUMENT_CATEGORIES,
  classifyActiveRenter,
  defaultExpiryScope,
  etCalendarDate,
  expiryScopes,
  renterNeedsExpiryNotice,
  sortExpiringRenters,
  type ExpiringRenter,
  type ExpiryScope,
  type RenterExpiryInput,
} from "@/lib/document-expiry";

export type ExpiringPopulation = {
  todayEt: string;
  renting: ExpiringRenter[];
  approved: ExpiringRenter[];
  defaultScope: ExpiryScope;
};

type Admin = {
  from: (table: string) => any;
};

export async function loadExpiringPopulation(admin: Admin, now: Date = new Date()): Promise<ExpiringPopulation> {
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

  const { data: statusApps, error: statusErr } = await admin
    .from("applications")
    .select("id, full_name, status, license_expiration, insurance_expires_on")
    .in("status", [...APPROVED_DRIVER_STATUSES])
    .is("deleted_at", null);
  if (statusErr) throw new Error(statusErr.message);

  const seen = new Set<string>();
  const apps: any[] = [];
  for (const app of statusApps ?? []) {
    if (!app.id || seen.has(app.id)) continue;
    seen.add(app.id);
    apps.push(app);
  }
  const rentalOnly = [...rentalByApplication.keys()].filter((id) => !seen.has(id));
  if (rentalOnly.length) {
    const { data: extra, error: extraErr } = await admin
      .from("applications")
      .select("id, full_name, status, license_expiration, insurance_expires_on")
      .in("id", rentalOnly)
      .is("deleted_at", null);
    if (extraErr) throw new Error(extraErr.message);
    for (const app of extra ?? []) {
      if (!app.id || seen.has(app.id)) continue;
      seen.add(app.id);
      apps.push(app);
    }
  }

  const ids = [...seen];
  if (!ids.length) {
    return { todayEt, renting: [], approved: [], defaultScope: defaultExpiryScope(0, 0) };
  }

  const { data: docs, error: docErr } = await admin
    .from("documents")
    .select("driver_id, category, expires_at")
    .eq("is_current", true)
    .in("driver_id", ids)
    .in("category", [...EXPIRY_DOCUMENT_CATEGORIES]);
  if (docErr) throw new Error(docErr.message);

  const docsByDriver = new Map<string, RenterExpiryInput["documents"]>();
  for (const doc of docs ?? []) {
    const driverId = doc.driver_id as string | null;
    if (!driverId) continue;
    const list = docsByDriver.get(driverId) ?? [];
    list.push({ category: String(doc.category ?? ""), expiresAt: (doc.expires_at as string | null) ?? null });
    docsByDriver.set(driverId, list);
  }

  const renting: ExpiringRenter[] = [];
  const approved: ExpiringRenter[] = [];
  for (const app of apps) {
    const applicationId = app.id as string;
    const rentalId = rentalByApplication.get(applicationId) ?? "";
    const scopes = expiryScopes({
      hasActiveRental: rentalByApplication.has(applicationId),
      status: (app.status as string | null) ?? null,
    });
    if (!scopes.length) continue;
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
    if (!row) continue;
    if (scopes.includes("renting")) renting.push(row);
    if (scopes.includes("approved")) approved.push(row);
  }
  return {
    todayEt,
    renting: sortExpiringRenters(renting),
    approved: sortExpiringRenters(approved),
    defaultScope: defaultExpiryScope(renting.length, approved.length),
  };
}

type EnrollArgs = {
  trigger: "document_expiring";
  applicationId: string;
  rentalId: string | null;
};

export type ExpiryEnrollDeps = {
  load?: () => Promise<ExpiringRenter[]>;
  enroll?: (args: EnrollArgs) => Promise<{ enrolled: number }>;
};

async function defaultLoad(): Promise<ExpiringRenter[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const population = await loadExpiringPopulation(supabaseAdmin);
  return population.approved;
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
 * Enroll approved drivers (and anyone with an active rental) who have a
 * document expired or inside 30 days.
 * Unknown dates are a manager cue, not a customer notice. The constant is
 * checked before any read. A failure here must not fail the automation sweep.
 */
export async function enrollDocumentExpiringNotices(
  deps?: ExpiryEnrollDeps,
): Promise<{ enrolled: number; considered: number; skipped: "flag" | "error" | null }> {
  if (!DOCUMENT_EXPIRY_NOTICES_ENABLED) return { enrolled: 0, considered: 0, skipped: "flag" };
  return runDocumentExpiryEnrollment(deps);
}

/** Enrollment after the flag check. Tests call this; production does not. */
export async function runDocumentExpiryEnrollment(
  deps?: ExpiryEnrollDeps,
): Promise<{ enrolled: number; considered: number; skipped: "flag" | "error" | null }> {
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
          rentalId: renter.rentalId || null,
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
