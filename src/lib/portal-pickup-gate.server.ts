/**
 * Server readers for the pickup gate (see portal-pickup-gate.ts).
 */
import { pickedUpFrom } from "@/lib/portal-pickup-gate";

/** ilike pattern that matches the literal address only (same rule as portal sign-in). */
function exactLike(e: string): string {
  return e.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type Admin = { from: (table: string) => any };

/** True once a rental for this application has started. */
export async function applicationPickedUp(admin: Admin, applicationId: string, applicationStatus?: string | null): Promise<boolean> {
  if (!applicationId) return false;
  let status = applicationStatus ?? null;
  if (status == null) {
    const { data } = await admin.from("applications").select("status").eq("id", applicationId).maybeSingle();
    status = (data?.status as string | null) ?? null;
  }
  if (pickedUpFrom(status, [])) return true;
  const { data: rentals } = await admin.from("rentals").select("status").eq("application_id", applicationId).limit(50);
  return pickedUpFrom(status, (rentals ?? []).map((r: any) => r.status));
}

export type PortalGate = "open" | "pre_pickup" | "none";

async function gateFor(admin: Admin, apps: { id: string; status: string | null }[]): Promise<PortalGate> {
  if (!apps.length) return "none";
  for (const app of apps) {
    if (await applicationPickedUp(admin, app.id, app.status)) return "open";
  }
  return "pre_pickup";
}

/**
 * The gate for an email typed on /login. "none" means there is no
 * application at that address (a waitlist lead, an unknown address), which
 * keeps the existing sign-in behaviour.
 */
export async function portalGateForEmail(admin: Admin, email: string): Promise<PortalGate> {
  const target = String(email ?? "").trim().toLowerCase();
  if (!target) return "none";
  const { data } = await admin
    .from("applications")
    .select("id,status,email")
    .ilike("email", exactLike(target))
    .is("deleted_at", null)
    .limit(20);
  const apps = (data ?? []).filter((a: any) => String(a.email ?? "").trim().toLowerCase() === target);
  return gateFor(admin, apps);
}

/** The gate for a signed-in account: every application linked to it. */
export async function portalGateForUser(admin: Admin, userId: string): Promise<PortalGate> {
  if (!userId) return "none";
  const { data } = await admin
    .from("applications")
    .select("id,status")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .limit(20);
  return gateFor(admin, data ?? []);
}

/**
 * The newest application at this address that has not picked up yet and can
 * still take documents, for sending a fresh secure link instead of a sign-in.
 */
export async function prePickupApplicationForEmail(admin: Admin, email: string): Promise<{ id: string; full_name: string | null; email: string } | null> {
  const target = String(email ?? "").trim().toLowerCase();
  if (!target) return null;
  const { data } = await admin
    .from("applications")
    .select("id,status,email,full_name,created_at")
    .ilike("email", exactLike(target))
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  const { canUploadBeforePickupStatus } = await import("@/lib/application-edit-status");
  for (const app of (data ?? []).filter((a: any) => String(a.email ?? "").trim().toLowerCase() === target)) {
    if (!canUploadBeforePickupStatus(app.status)) continue;
    if (await applicationPickedUp(admin, app.id, app.status)) continue;
    return { id: app.id, full_name: app.full_name ?? null, email: app.email };
  }
  return null;
}
