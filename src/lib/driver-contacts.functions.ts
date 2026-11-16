/**
 * Staff CRUD for driver_contacts, used by the admin driver profile.
 * Writes go through the staff-only RLS policy. Nothing is sent from here.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  type DriverContact,
  type DriverContactKind,
  normalizeDriverContact,
  normalizeDriverEmail,
  last10Digits,
} from "@/lib/driver-contacts";

export type DuplicateDriverHit = { id: string; full_name: string | null; is_self: boolean };

export type ContactWriteResult = {
  contact: DriverContact;
  duplicates: DuplicateDriverHit[];
};

function asContact(row: Record<string, any>): DriverContact {
  return {
    id: row.id,
    application_id: row.application_id,
    kind: row.kind,
    value: row.value,
    label: row.label ?? null,
    is_primary: !!row.is_primary,
    receives_messages: !!row.receives_messages,
    consented_at: row.consented_at ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listDriverContactsClient(applicationId: string): Promise<DriverContact[]> {
  const { data, error } = await supabase
    .from("driver_contacts" as any)
    .select("id,application_id,kind,value,label,is_primary,receives_messages,consented_at,created_by,created_at,updated_at")
    .eq("application_id", applicationId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) {
    if (error.code === "42P01" || /driver_contacts.*does not exist/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as any[]).map(asContact);
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Warn when this phone or email already belongs to another driver
 * (or another row on this same profile). Does not block the write.
 */
export async function findDuplicateDrivers(
  kind: DriverContactKind,
  raw: string,
  applicationId: string,
): Promise<DuplicateDriverHit[]> {
  const value = normalizeDriverContact(kind, raw);
  if (!value) return [];
  const hits = new Map<string, DuplicateDriverHit>();

  const fromContacts = await supabase
    .from("driver_contacts" as any)
    .select("application_id,value")
    .eq("kind", kind)
    .neq("application_id", applicationId)
    .limit(50);
  if (!fromContacts.error) {
    const rows = ((fromContacts.data ?? []) as any[]).filter((r) =>
      kind === "phone"
        ? last10Digits(r.value) === last10Digits(value)
        : normalizeDriverEmail(r.value) === value,
    );
    const ids = [...new Set(rows.map((r) => r.application_id as string))];
    if (ids.length) {
      const apps = await supabase.from("applications").select("id,full_name,deleted_at").in("id", ids);
      for (const a of (apps.data ?? []) as any[]) {
        if (a.deleted_at) continue;
        hits.set(a.id, { id: a.id, full_name: a.full_name ?? null, is_self: false });
      }
    }
  }

  const digits = kind === "phone" ? last10Digits(value) : null;
  let fromApps;
  if (kind === "email") {
    fromApps = await supabase
      .from("applications")
      .select("id,full_name,email,deleted_at")
      .ilike("email", value)
      .neq("id", applicationId)
      .is("deleted_at", null)
      .limit(20);
  } else {
    fromApps = await supabase
      .from("applications")
      .select("id,full_name,phone,deleted_at")
      .ilike("phone", `%${(digits ?? value).slice(-4)}%`)
      .neq("id", applicationId)
      .is("deleted_at", null)
      .limit(20);
  }
  if (!fromApps.error) {
    for (const a of (fromApps.data ?? []) as any[]) {
      const other = kind === "phone" ? last10Digits(a.phone) : normalizeDriverEmail(a.email);
      const self = kind === "phone" ? digits : value;
      if (other && self && other === self) {
        hits.set(a.id, { id: a.id, full_name: a.full_name ?? null, is_self: false });
      }
    }
  }
  return [...hits.values()];
}

export async function addDriverContact(input: {
  applicationId: string;
  kind: DriverContactKind;
  value: string;
  label?: string | null;
  receivesMessages?: boolean;
}): Promise<ContactWriteResult> {
  const value = normalizeDriverContact(input.kind, input.value);
  if (!value) throw new Error(input.kind === "phone" ? "Enter a valid US phone number" : "Enter a valid email address");
  const duplicates = await findDuplicateDrivers(input.kind, value, input.applicationId);
  const { data, error } = await supabase
    .from("driver_contacts" as any)
    .insert({
      application_id: input.applicationId,
      kind: input.kind,
      value,
      label: input.label?.trim() || null,
      is_primary: false,
      receives_messages: input.receivesMessages === true,
      created_by: await currentUserId(),
    })
    .select("id,application_id,kind,value,label,is_primary,receives_messages,consented_at,created_by,created_at,updated_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("That contact is already on this profile");
    throw new Error(error.message);
  }
  return { contact: asContact(data as any), duplicates };
}

export async function updateDriverContact(
  id: string,
  patch: { value?: string; label?: string | null; receives_messages?: boolean },
): Promise<DriverContact> {
  const body: Record<string, unknown> = {};
  if (patch.value != null) body.value = patch.value;
  if (patch.label !== undefined) body.label = patch.label;
  if (patch.receives_messages !== undefined) body.receives_messages = patch.receives_messages;
  const { data, error } = await supabase
    .from("driver_contacts" as any)
    .update(body)
    .eq("id", id)
    .select("id,application_id,kind,value,label,is_primary,receives_messages,consented_at,created_by,created_at,updated_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("That contact is already on this profile");
    throw new Error(error.message);
  }
  return asContact(data as any);
}

export async function removeDriverContact(id: string): Promise<void> {
  const { data: row, error: readError } = await supabase
    .from("driver_contacts" as any)
    .select("id,is_primary,kind")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) return;
  if ((row as any).is_primary) {
    throw new Error("Make another contact primary before removing this one");
  }
  const { error } = await supabase.from("driver_contacts" as any).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
