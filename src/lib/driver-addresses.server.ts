/**
 * Server helper: persist a license-reading address as a second profile row
 * without touching the primary. Safe to call when the table is not applied.
 */
import {
  type AddressParts,
  type DriverAddress,
  type DriverAddressSource,
  isDriverAddressesTableMissing,
  planLicenseAddressSave,
} from "@/lib/driver-addresses";

type Admin = { from: (table: string) => any };

const SELECT =
  "id,application_id,line1,line2,city,state,zip,label,source,is_primary,created_by,created_at,updated_at";

function asAddress(row: Record<string, any>): DriverAddress {
  return {
    id: row.id,
    application_id: row.application_id,
    line1: row.line1 ?? "",
    line2: row.line2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    zip: row.zip ?? null,
    label: row.label ?? null,
    source: (row.source ?? "staff") as DriverAddressSource,
    is_primary: !!row.is_primary,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listDriverAddresses(admin: Admin, applicationId: string): Promise<DriverAddress[]> {
  const { data, error } = await admin
    .from("driver_addresses")
    .select(SELECT)
    .eq("application_id", applicationId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) {
    if (isDriverAddressesTableMissing(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as any[]).map(asAddress);
}

/**
 * Save a license reading's address as a second "License address" row when it
 * differs from the primary. Never overwrites the primary or a staff-entered
 * value. Returns the plan that was applied, or a skip reason.
 */
export async function saveLicenseAddressIfDifferent(
  admin: Admin,
  applicationId: string,
  primary: AddressParts | null,
  reading: AddressParts | null,
): Promise<{ saved: boolean; action: string; reason?: string; id?: string }> {
  let existing: DriverAddress[] = [];
  try {
    existing = await listDriverAddresses(admin, applicationId);
  } catch (e) {
    return { saved: false, action: "skip", reason: e instanceof Error ? e.message : "could not list addresses" };
  }
  const plan = planLicenseAddressSave({ primary, reading, existing });
  if (plan.action === "skip") return { saved: false, action: "skip", reason: plan.reason };
  if (plan.action === "insert") {
    const { data, error } = await admin
      .from("driver_addresses")
      .insert({
        application_id: applicationId,
        line1: plan.row.line1 ?? "",
        line2: plan.row.line2 ?? null,
        city: plan.row.city,
        state: plan.row.state,
        zip: plan.row.zip,
        label: plan.row.label,
        source: plan.row.source,
        is_primary: false,
      })
      .select("id")
      .single();
    if (error) {
      if (isDriverAddressesTableMissing(error) || error.code === "23505") {
        return { saved: false, action: "skip", reason: error.code === "23505" ? "already_on_profile" : "table_missing" };
      }
      return { saved: false, action: "skip", reason: error.message };
    }
    return { saved: true, action: "insert", id: data?.id };
  }
  const { error } = await admin
    .from("driver_addresses")
    .update({
      line1: plan.patch.line1 ?? "",
      line2: plan.patch.line2 ?? null,
      city: plan.patch.city,
      state: plan.patch.state,
      zip: plan.patch.zip,
    })
    .eq("id", plan.id)
    .eq("source", "license_reading");
  if (error) return { saved: false, action: "skip", reason: error.message };
  return { saved: true, action: "update", id: plan.id };
}
