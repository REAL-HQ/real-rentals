/**
 * Staff CRUD for driver_addresses, used by the admin driver profile.
 * Writes go through the staff-only RLS policy. Nothing is sent from here.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  type AddressParts,
  type DriverAddress,
  type DriverAddressSource,
  APPLICATION_ADDRESS_LABEL,
  isDriverAddressesTableMissing,
  normalizeAddress,
} from "@/lib/driver-addresses";

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

export async function listDriverAddressesClient(applicationId: string): Promise<DriverAddress[]> {
  const { data, error } = await supabase
    .from("driver_addresses" as any)
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

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function addDriverAddress(input: {
  applicationId: string;
  parts: AddressParts;
  label?: string | null;
}): Promise<DriverAddress> {
  const parts = normalizeAddress(input.parts);
  if (!parts) throw new Error("Enter an address");
  const { data, error } = await supabase
    .from("driver_addresses" as any)
    .insert({
      application_id: input.applicationId,
      line1: parts.line1 ?? "",
      line2: parts.line2 ?? null,
      city: parts.city,
      state: parts.state,
      zip: parts.zip,
      label: input.label?.trim() || null,
      source: "staff",
      is_primary: false,
      created_by: await currentUserId(),
    })
    .select(SELECT)
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("That address is already on this profile");
    throw new Error(error.message);
  }
  return asAddress(data as any);
}

export async function updateDriverAddress(
  id: string,
  patch: Partial<AddressParts> & { label?: string | null },
): Promise<DriverAddress> {
  const body: Record<string, unknown> = { source: "staff" };
  if (patch.line1 !== undefined) body.line1 = patch.line1;
  if (patch.line2 !== undefined) body.line2 = patch.line2;
  if (patch.city !== undefined) body.city = patch.city;
  if (patch.state !== undefined) body.state = patch.state;
  if (patch.zip !== undefined) body.zip = patch.zip;
  if (patch.label !== undefined) body.label = patch.label;
  const { data, error } = await supabase
    .from("driver_addresses" as any)
    .update(body)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("That address is already on this profile");
    throw new Error(error.message);
  }
  return asAddress(data as any);
}

export async function removeDriverAddress(id: string): Promise<void> {
  const { data: row, error: readError } = await supabase
    .from("driver_addresses" as any)
    .select("id,is_primary")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) return;
  if ((row as any).is_primary) {
    throw new Error("Make another address primary before removing this one");
  }
  const { error } = await supabase.from("driver_addresses" as any).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function fallbackAddress(
  applicationId: string,
  parts: AddressParts | null,
): DriverAddress | null {
  const n = normalizeAddress(parts);
  if (!n) return null;
  const now = new Date(0).toISOString();
  return {
    id: "primary-address",
    application_id: applicationId,
    line1: n.line1 ?? "",
    line2: n.line2 ?? null,
    city: n.city,
    state: n.state,
    zip: n.zip,
    label: APPLICATION_ADDRESS_LABEL,
    source: "application",
    is_primary: true,
    created_by: null,
    created_at: now,
    updated_at: now,
  };
}
