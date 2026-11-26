import { ADDITIONAL_DRIVER_WEEKLY_CENTS } from "@/lib/additional-driver-copy";
import { ADDITIONAL_DRIVER_PRICE_SETTING, additionalDriverPriceProblem, type AdditionalDriverInput, type AdditionalDriverRow } from "@/lib/additional-drivers";
import { includedDriverCount, moneyNumber, weeklyFeeOnAgreement } from "@/lib/agreement-prep";
import { currentAgreementMerge } from "@/lib/agreement-weekly.server";
import { logAudit } from "@/lib/audit.server";
import type { Actor } from "@/lib/roles.server";

const COLS = "id,rental_id,application_id,name,email,phone,dob,license_number,license_state,license_expiration,license_photo_path,relationship,screening_status,approved_at,insurance_added_at,signed_at,removed_at,sms_consent,stripe_subscription_item_id";

function mapRow(r: any): AdditionalDriverRow {
  return {
    id: String(r.id),
    applicationId: r.application_id ?? null,
    rentalId: r.rental_id ?? null,
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    phone: String(r.phone ?? ""),
    dob: r.dob ? String(r.dob).slice(0, 10) : "",
    licenseNumber: String(r.license_number ?? ""),
    licenseState: String(r.license_state ?? ""),
    licenseExpiration: r.license_expiration ? String(r.license_expiration).slice(0, 10) : "",
    licensePhotoPath: r.license_photo_path ?? null,
    relationship: String(r.relationship ?? ""),
    smsConsent: r.sms_consent === true,
    status: r.screening_status,
    approvedAt: r.approved_at ?? null,
    insuranceAddedAt: r.insurance_added_at ?? null,
    signedAt: r.signed_at ?? null,
    removedAt: r.removed_at ?? null,
    stripeSubscriptionItemId: r.stripe_subscription_item_id ?? null,
  };
}

export function additionalDriverDbMessage(message: unknown): string | null {
  const m = String(message ?? "");
  if (/additional_driver_under_age/.test(m)) return "Additional drivers must be at least 23.";
  if (/additional_driver_blacklisted/.test(m)) return "This driver can't be added.";
  if (/rental_additional_drivers/.test(m) && /does not exist|schema cache|could not find/i.test(m)) return "Additional drivers are not enabled on this database yet.";
  return null;
}

export async function listAdditionalDrivers(admin: any, filter: { applicationId?: string | null; rentalId?: string | null }): Promise<AdditionalDriverRow[]> {
  let q = admin.from("rental_additional_drivers").select(COLS).order("created_at", { ascending: true });
  if (filter.applicationId) q = q.eq("application_id", filter.applicationId);
  else if (filter.rentalId) q = q.eq("rental_id", filter.rentalId);
  else return [];
  const { data, error } = await q;
  if (error) {
    const known = additionalDriverDbMessage(error.message);
    if (known?.includes("not enabled")) return [];
    throw new Error(known ?? error.message);
  }
  return (data ?? []).map(mapRow);
}

/**
 * Approved drivers whose fee is already inside the agreement or rental weekly
 * amount. A separate Stripe line is refused for those drivers.
 * Order matches listAdditionalDrivers (created_at ascending).
 */
export async function includedAdditionalDriverCount(
  admin: any,
  filter: { applicationId?: string | null; rentalId?: string | null },
): Promise<number> {
  let applicationId = filter.applicationId ?? null;
  let rentalWeekly: number | null = null;
  let vehicleId: string | null = null;
  if (filter.rentalId) {
    const { data: rental } = await admin.from("rentals").select("application_id,weekly_rate,vehicle_id").eq("id", filter.rentalId).maybeSingle();
    applicationId = applicationId ?? (rental?.application_id as string | null) ?? null;
    rentalWeekly = moneyNumber(rental?.weekly_rate);
    vehicleId = (rental?.vehicle_id as string | null) ?? null;
  }
  if (!vehicleId && applicationId) {
    const { data: app } = await admin.from("applications").select("vehicle_id").eq("id", applicationId).maybeSingle();
    vehicleId = (app?.vehicle_id as string | null) ?? null;
  }
  let vehicleWeekly: number | null = null;
  if (vehicleId) {
    const { data: vehicle } = await admin.from("vehicles").select("weekly_rate").eq("id", vehicleId).maybeSingle();
    vehicleWeekly = moneyNumber(vehicle?.weekly_rate);
  }
  const rows = await listAdditionalDrivers(admin, { applicationId, rentalId: filter.rentalId });
  const approvedCount = rows.filter((r) => r.status === "approved" && !r.removedAt).length;
  const merge = await currentAgreementMerge(admin, applicationId);
  return includedDriverCount({
    merge,
    rentalWeekly,
    vehicleWeekly,
    approvedCount,
    feeEach: ADDITIONAL_DRIVER_WEEKLY_CENTS / 100,
  });
}

async function driverFeeIncludedFor(
  admin: any,
  input: { applicationId: string | null; rentalId: string; rentalWeekly: unknown; vehicleId: string | null; driverId: string },
): Promise<boolean> {
  const rows = await listAdditionalDrivers(admin, { rentalId: input.rentalId });
  const approved = rows.filter((r) => r.status === "approved" && !r.removedAt);
  const index = approved.findIndex((r) => r.id === input.driverId);
  if (index < 0) return false;
  let vehicleWeekly: number | null = null;
  if (input.vehicleId) {
    const { data: vehicle } = await admin.from("vehicles").select("weekly_rate").eq("id", input.vehicleId).maybeSingle();
    vehicleWeekly = moneyNumber(vehicle?.weekly_rate);
  }
  const merge = await currentAgreementMerge(admin, input.applicationId);
  const included = includedDriverCount({
    merge,
    rentalWeekly: moneyNumber(input.rentalWeekly),
    vehicleWeekly,
    approvedCount: approved.length,
    feeEach: ADDITIONAL_DRIVER_WEEKLY_CENTS / 100,
  });
  return index < included;
}

export async function reservationFeeSettled(admin: any, applicationId: string | null): Promise<boolean> {
  const { data: setting } = await admin.from("app_settings").select("value").eq("key", "reservation_fee_auto").maybeSingle();
  const value = setting?.value as { enabled?: boolean; amount?: number } | null;
  if (!value?.enabled || !(Number(value.amount) > 0)) return true;
  if (!applicationId) return false;
  const { data } = await admin.from("payments").select("id,status,type,reason").eq("driver_id", applicationId).eq("status", "paid").limit(40);
  return (data ?? []).some((p: any) => String(p.type) === "fee" && String(p.reason) === "reservation_fee");
}

async function audit(actor: Actor | null, action: string, id: string, summary: string) {
  await logAudit(actor, { action, summary, entityType: "rental_additional_driver", entityId: id });
}

export async function insertAdditionalDriver(admin: any, actor: Actor | null, input: AdditionalDriverInput & { applicationId?: string | null; rentalId?: string | null }): Promise<AdditionalDriverRow> {
  const { data, error } = await admin.from("rental_additional_drivers").insert({
    application_id: input.applicationId ?? null,
    rental_id: input.rentalId ?? null,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    dob: input.dob,
    license_number: input.licenseNumber.trim(),
    license_state: input.licenseState.trim().toUpperCase(),
    license_expiration: input.licenseExpiration,
    license_photo_path: input.licensePhotoPath,
    relationship: input.relationship.trim(),
    sms_consent: input.smsConsent === true,
    screening_status: "pending",
  }).select(COLS).single();
  if (error) throw new Error(additionalDriverDbMessage(error.message) ?? "Could not save this driver.");
  await audit(actor, "additional_driver.added", data.id, `Additional driver added: ${input.name.trim()}`);
  return mapRow(data);
}

export async function setAdditionalDriverStatus(admin: any, actor: Actor, id: string, status: "approved" | "declined" | "removed"): Promise<AdditionalDriverRow> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { screening_status: status };
  if (status === "approved") patch.approved_at = now;
  if (status === "removed") {
    patch.removed_at = now;
    patch.screening_status = "removed";
  }
  const { data, error } = await admin.from("rental_additional_drivers").update(patch).eq("id", id).is("removed_at", null).select(COLS).single();
  if (error || !data) throw new Error(additionalDriverDbMessage(error?.message) ?? "Could not update this driver.");
  await audit(actor, `additional_driver.${status}`, id, `Additional driver ${status}`);
  return mapRow(data);
}

export async function markAdditionalDriverInsured(admin: any, actor: Actor, id: string): Promise<AdditionalDriverRow> {
  const { data: row, error: readErr } = await admin.from("rental_additional_drivers").select(COLS).eq("id", id).maybeSingle();
  if (readErr || !row) throw new Error(additionalDriverDbMessage(readErr?.message) ?? "Driver not found.");
  if (row.screening_status !== "approved" || row.removed_at) throw new Error("Approve this driver before adding them to the policy.");
  if (!row.signed_at) throw new Error("This driver signs the agreement before they are added to the policy.");
  const settled = await reservationFeeSettled(admin, row.application_id ?? null);
  if (!settled) throw new Error("The reservation fee is paid before this driver is added to the policy.");
  const now = new Date().toISOString();
  const { data, error } = await admin.from("rental_additional_drivers").update({ insurance_added_at: now }).eq("id", id).select(COLS).single();
  if (error || !data) throw new Error("Could not record the policy endorsement.");
  await audit(actor, "additional_driver.insurance_added", id, "Additional driver added to the policy");
  return mapRow(data);
}

/** Explicit staff action. Does nothing when the Stripe price setting is missing. */
export async function billAdditionalDriver(admin: any, actor: Actor, id: string, stripe: { subscriptions: { retrieve: (id: string) => Promise<any>; update: (id: string, body: any) => Promise<any> } }): Promise<AdditionalDriverRow> {
  const { data: row, error } = await admin.from("rental_additional_drivers").select(COLS).eq("id", id).maybeSingle();
  if (error || !row) throw new Error("Driver not found.");
  if (row.screening_status !== "approved" || row.removed_at) throw new Error("Only an approved driver can be added to the weekly bill.");
  if (row.stripe_subscription_item_id) throw new Error("This driver is already on the weekly bill.");
  const rentalId = row.rental_id as string | null;
  if (!rentalId) throw new Error("This driver is not on a rental yet. Nothing was charged.");
  const { data: rental } = await admin.from("rentals").select("id,stripe_subscription_id,weekly_rate,vehicle_id,application_id").eq("id", rentalId).maybeSingle();
  const subId = rental?.stripe_subscription_id as string | null;
  if (!subId) throw new Error("This rental has no weekly subscription yet. Nothing was charged.");
  // The weekly subscription charges rentals.weekly_rate once. When that amount
  // already includes this driver's fee, a second subscription item would bill it again.
  const included = await driverFeeIncludedFor(admin, {
    applicationId: (row.application_id as string | null) ?? (rental?.application_id as string | null) ?? null,
    rentalId,
    rentalWeekly: rental?.weekly_rate,
    vehicleId: (rental?.vehicle_id as string | null) ?? null,
    driverId: id,
  });
  if (included) throw new Error("Included In Weekly Rate. Nothing was charged.");
  const merge = await currentAgreementMerge(admin, (row.application_id as string | null) ?? (rental?.application_id as string | null) ?? null);
  const agreedFee = weeklyFeeOnAgreement(merge, String(row.name ?? ""));
  if (agreedFee === 0) throw new Error("No Weekly Fee. Nothing was charged.");
  const cents = agreedFee != null ? Math.round(agreedFee * 100) : ADDITIONAL_DRIVER_WEEKLY_CENTS;
  const custom = agreedFee != null && cents !== ADDITIONAL_DRIVER_WEEKLY_CENTS;
  let priceId = "";
  if (!custom) {
    const { data: setting } = await admin.from("app_settings").select("value").eq("key", ADDITIONAL_DRIVER_PRICE_SETTING).maybeSingle();
    const problem = additionalDriverPriceProblem(setting?.value);
    if (problem) throw new Error(problem);
    priceId = String((setting.value as { price_id: string }).price_id);
  }
  const updated = await stripe.subscriptions.update(subId, custom
    ? {
        items: [{ price_data: { currency: "usd", unit_amount: cents, recurring: { interval: "week" }, product_data: { name: "Additional Driver" } } }],
        proration_behavior: "none",
        metadata: { additional_driver_id: id, additional_driver_weekly_cents: String(cents) },
      }
    : {
        items: [{ price: priceId, quantity: 1 }],
        proration_behavior: "none",
        metadata: { additional_driver_id: id, additional_driver_weekly_cents: String(cents) },
      });
  const item = (updated.items?.data ?? []).find((it: any) => !it.deleted && (custom ? it.price?.unit_amount === cents : it.price?.id === priceId));
  if (!item?.id) throw new Error("Stripe did not add the weekly line. Nothing was saved.");
  const { data, error: upErr } = await admin.from("rental_additional_drivers").update({ stripe_subscription_item_id: item.id }).eq("id", id).select(COLS).single();
  if (upErr || !data) throw new Error("The Stripe line was added but could not be saved. Check the subscription before trying again.");
  await audit(actor, "additional_driver.billed", id, `Added $${(cents / 100).toFixed(2)} per week to the primary renter subscription`);
  return mapRow(data);
}

export async function unbillAdditionalDriver(admin: any, actor: Actor, id: string, stripe: { subscriptionItems: { del: (id: string, body?: any) => Promise<any> } }): Promise<void> {
  const { data: row } = await admin.from("rental_additional_drivers").select("stripe_subscription_item_id").eq("id", id).maybeSingle();
  const itemId = row?.stripe_subscription_item_id as string | null;
  if (!itemId) return;
  await stripe.subscriptionItems.del(itemId, { proration_behavior: "none" });
  await admin.from("rental_additional_drivers").update({ stripe_subscription_item_id: null }).eq("id", id);
  await audit(actor, "additional_driver.unbilled", id, "Removed the $100 per week line from the primary renter subscription");
}

export async function consentedAdditionalDriverPhones(admin: any, filter: { applicationId?: string | null; rentalId?: string | null }): Promise<{ id: string; phone: string; name: string }[]> {
  try {
    const rows = await listAdditionalDrivers(admin, filter);
    return rows
      .filter((r) => r.status === "approved" && !r.removedAt && r.smsConsent && r.phone.trim())
      .map((r) => ({ id: r.id, phone: r.phone, name: r.name }));
  } catch {
    return [];
  }
}
