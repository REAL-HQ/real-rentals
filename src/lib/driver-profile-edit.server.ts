/**
 * Writes a driver profile edit.
 *
 * Source of truth: public.applications (full_name, email, phone, city, state).
 * Then, so every screen that reads a copy stays aligned:
 *   - driver_contacts primary phone and email (same rules as
 *     applications_sync_primary_contacts; skipped when that table is absent)
 *   - driver_addresses primary city and state (same idea as
 *     applications_sync_primary_address)
 *   - waitlist rows linked by promoted_application_id
 *   - audit_log, via the callback ("Profile updated by <staff>")
 *
 * Not written: Stripe customers, auth.users (login email and user_metadata),
 * agreement signer_name / merge_data, rentals (no renter-name column),
 * contact_leads, investor_leads, background-report snapshots.
 * Nothing here sends email or SMS. A phone-number change clears sms_consent
 * on the application row, matching the driver portal, and does not text anyone.
 */
import { tierAllows, type StaffTier } from "@/lib/roles";
import { sameEmail, samePhone } from "@/lib/driver-contacts";
import {
  emailBelongsToAnotherProfile,
  literalIlike,
  normalizeDriverProfileEdit,
  phoneIdentityChanged,
  profileFieldsChanged,
  profileIdentityFromRow,
  profileUpdatedSummary,
  waitingEmailTaken,
  type DriverProfileDraft,
  type NormalizedDriverProfile,
} from "@/lib/driver-profile-edit";

export type ProfileEditActor = {
  userId: string;
  email: string | null;
  role: string;
  tier: StaffTier;
};

type Admin = { from: (table: string) => any };

type AuditWrite = {
  action: string;
  summary: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
};

export type SavedDriverProfile = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  city: string | null;
  state: string | null;
  sms_consent: boolean | null;
};

export type SaveDriverProfileResult = {
  ok: true;
  unchanged: boolean;
  profile: SavedDriverProfile;
  syncWarning: string | null;
};

function relationMissing(error: { code?: string; message?: string } | null | undefined, relation: string): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const message = String(error.message ?? "");
  return new RegExp(relation, "i").test(message) && /does not exist|schema cache/i.test(message);
}

function asRows(data: unknown): any[] {
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

async function syncPrimaryContact(admin: Admin, applicationId: string, kind: "phone" | "email", value: string) {
  const listed = await admin
    .from("driver_contacts")
    .select("id,kind,value,is_primary")
    .eq("application_id", applicationId)
    .eq("kind", kind);
  if (listed.error) {
    if (relationMissing(listed.error, "driver_contacts")) return;
    throw new Error(listed.error.message);
  }
  const rows = asRows(listed.data);
  const match = rows.find((row) => (kind === "phone" ? samePhone(row.value, value) : sameEmail(row.value, value)));
  if (match) {
    if (!match.is_primary) {
      const up = await admin.from("driver_contacts").update({ is_primary: true, receives_messages: true }).eq("id", match.id);
      if (up.error) throw new Error(up.error.message);
    }
    for (const other of rows) {
      if (other.id === match.id || !other.is_primary) continue;
      const demote = await admin.from("driver_contacts").update({ is_primary: false }).eq("id", other.id);
      if (demote.error) throw new Error(demote.error.message);
    }
    return;
  }
  const primary = rows.find((row) => row.is_primary);
  if (primary) {
    const up = await admin
      .from("driver_contacts")
      .update({ value, is_primary: true, receives_messages: true })
      .eq("id", primary.id);
    if (up.error) throw new Error(up.error.message);
    return;
  }
  const inserted = await admin.from("driver_contacts").insert({
    application_id: applicationId,
    kind,
    value,
    is_primary: true,
    receives_messages: true,
  });
  if (inserted.error) {
    if (relationMissing(inserted.error, "driver_contacts")) return;
    throw new Error(inserted.error.message);
  }
}

async function syncPrimaryAddress(
  admin: Admin,
  applicationId: string,
  city: string | null,
  state: string | null,
) {
  const listed = await admin
    .from("driver_addresses")
    .select("id,line1,line2,city,state,zip,is_primary")
    .eq("application_id", applicationId);
  if (listed.error) {
    if (relationMissing(listed.error, "driver_addresses")) return;
    throw new Error(listed.error.message);
  }
  const rows = asRows(listed.data);
  const primary = rows.find((row) => row.is_primary) ?? null;
  if (primary) {
    const line1 = String(primary.line1 ?? "");
    const line2 = String(primary.line2 ?? "");
    const zip = String(primary.zip ?? "");
    const empty = !line1.trim() && !line2.trim() && !zip.trim() && !city && !state;
    if (empty) return;
    if ((primary.city ?? null) === city && (primary.state ?? null) === state) return;
    const up = await admin.from("driver_addresses").update({ city, state }).eq("id", primary.id);
    if (up.error) throw new Error(up.error.message);
    return;
  }
  if (!city && !state) return;
  const inserted = await admin.from("driver_addresses").insert({
    application_id: applicationId,
    line1: "",
    city,
    state,
    label: "Application address",
    source: "application",
    is_primary: true,
  });
  if (inserted.error) {
    if (relationMissing(inserted.error, "driver_addresses")) return;
    throw new Error(inserted.error.message);
  }
}

function savedFrom(id: string, next: NormalizedDriverProfile, smsConsent: boolean | null): SavedDriverProfile {
  return {
    id,
    full_name: next.fullName,
    email: next.email,
    phone: next.phone,
    city: next.city,
    state: next.state,
    sms_consent: smsConsent,
  };
}

export async function saveDriverProfileEdit(
  admin: Admin,
  actor: ProfileEditActor,
  draft: DriverProfileDraft & { applicationId: string },
  audit: (entry: AuditWrite) => Promise<void>,
): Promise<SaveDriverProfileResult> {
  if (!tierAllows(actor.tier, "manager")) throw new Error("Forbidden");
  const parsed = normalizeDriverProfileEdit(draft);
  if (!parsed.ok) throw new Error(parsed.error);
  const next = parsed.value;
  if (!draft.applicationId) throw new Error("Application not found");

  const loaded = await admin
    .from("applications")
    .select("id,full_name,email,phone,city,state,status,deleted_at,sms_consent")
    .eq("id", draft.applicationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (loaded.error) throw new Error(loaded.error.message);
  const before = loaded.data;
  if (!before?.id) throw new Error("Application not found");

  const current = profileIdentityFromRow(before);
  const changed = profileFieldsChanged(current, next);
  const resetConsent = changed.includes("phone") && phoneIdentityChanged(before.phone, next.phone);

  if (changed.includes("email")) {
    const holders = await admin
      .from("applications")
      .select("id,status,deleted_at,email")
      .ilike("email", literalIlike(next.email))
      .is("deleted_at", null)
      .neq("id", before.id)
      .limit(20);
    if (holders.error) throw new Error(holders.error.message);
    if (emailBelongsToAnotherProfile(before.id, asRows(holders.data))) {
      throw new Error("That email is already on another driver profile.");
    }
  }

  const linked = await admin
    .from("waitlist")
    .select("id,status,email,phone,full_name,city,state,market_id")
    .eq("promoted_application_id", before.id);
  const waitlistMissing = !!linked.error && relationMissing(linked.error, "waitlist");
  if (linked.error && !waitlistMissing) throw new Error(linked.error.message);
  const waitlistRows = waitlistMissing ? [] : asRows(linked.data);

  if (changed.includes("email")) {
    for (const row of waitlistRows) {
      if (String(row.status ?? "") !== "waiting") continue;
      const others = await admin
        .from("waitlist")
        .select("id,status,email,market_id")
        .ilike("email", literalIlike(next.email))
        .eq("status", "waiting")
        .limit(20);
      if (others.error) {
        if (relationMissing(others.error, "waitlist")) break;
        throw new Error(others.error.message);
      }
      if (waitingEmailTaken([row.id], row.market_id ?? null, next.email, asRows(others.data))) {
        throw new Error("That email is already on the waitlist for this market.");
      }
    }
  }

  const smsConsent = resetConsent ? false : (before.sms_consent ?? null);

  if (!changed.length) {
    return {
      ok: true,
      unchanged: true,
      profile: {
        id: before.id,
        full_name: before.full_name,
        email: before.email,
        phone: before.phone,
        city: before.city ?? null,
        state: before.state ?? null,
        sms_consent: before.sms_consent ?? null,
      },
      syncWarning: null,
    };
  }

  const patch: Record<string, unknown> = {};
  if (changed.includes("fullName")) patch.full_name = next.fullName;
  if (changed.includes("email")) patch.email = next.email;
  if (changed.includes("phone")) patch.phone = next.phone;
  if (changed.includes("city")) patch.city = next.city;
  if (changed.includes("state")) patch.state = next.state;
  if (resetConsent) {
    patch.sms_consent = false;
    patch.sms_opt_out_at = null;
  }

  let query = admin.from("applications").update(patch).eq("id", before.id).is("deleted_at", null);
  query = before.full_name == null ? query.is("full_name", null) : query.eq("full_name", before.full_name);
  query = before.email == null ? query.is("email", null) : query.eq("email", before.email);
  query = before.phone == null ? query.is("phone", null) : query.eq("phone", before.phone);
  const written = await query.select("id,full_name,email,phone,city,state,sms_consent");
  if (written.error) throw new Error(written.error.message);
  const rows = asRows(written.data);
  if (rows.length !== 1) {
    throw new Error("No application was updated. Refresh and retry; it may have changed or been removed.");
  }
  const stored = savedFrom(before.id, {
    ...next,
    fullName: rows[0].full_name ?? next.fullName,
    email: rows[0].email ?? next.email,
    phone: rows[0].phone ?? next.phone,
    city: rows[0].city ?? null,
    state: rows[0].state ?? null,
  }, rows[0].sms_consent ?? smsConsent);

  let syncWarning: string | null = null;
  try {
    if (changed.includes("phone")) await syncPrimaryContact(admin, before.id, "phone", next.phone);
    if (changed.includes("email")) await syncPrimaryContact(admin, before.id, "email", next.email);
    if (changed.includes("city") || changed.includes("state")) {
      await syncPrimaryAddress(admin, before.id, next.city, next.state);
    }
    if (!waitlistMissing) {
      const waitlistPatch: Record<string, unknown> = {};
      if (changed.includes("fullName")) waitlistPatch.full_name = next.fullName;
      if (changed.includes("email")) waitlistPatch.email = next.email;
      if (changed.includes("phone")) waitlistPatch.phone = next.phone;
      if (changed.includes("city")) waitlistPatch.city = next.city;
      if (changed.includes("state")) waitlistPatch.state = next.state;
      if (Object.keys(waitlistPatch).length) {
        for (const row of waitlistRows) {
          const up = await admin.from("waitlist").update(waitlistPatch).eq("id", row.id);
          if (up.error) throw new Error(up.error.message);
        }
      }
    }
  } catch (error) {
    syncWarning = error instanceof Error ? error.message : "The contact list could not be updated.";
  }

  try {
    await audit({
      action: "application.profile_updated",
      summary: profileUpdatedSummary(actor.email),
      entityType: "application",
      entityId: before.id,
      metadata: {
        fields: changed,
        sms_consent_reset: resetConsent,
        from: { full_name: before.full_name ?? null, email: before.email ?? null, phone: before.phone ?? null, city: before.city ?? null, state: before.state ?? null },
        to: { full_name: next.fullName, email: next.email, phone: next.phone, city: next.city, state: next.state },
      },
    });
  } catch {
    return {
      ok: true,
      unchanged: false,
      profile: stored,
      syncWarning: syncWarning ?? "Profile saved, but its activity entry could not be recorded.",
    };
  }

  return { ok: true, unchanged: false, profile: stored, syncWarning };
}
