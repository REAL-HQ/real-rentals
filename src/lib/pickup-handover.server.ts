/**
 * Server side of the pickup checklist (see pickup-handover.ts for the rule).
 * Kept free of createServerFn so tests can drive it with a fake database.
 */
import {
  decideAutoActivation,
  handoverGates,
  hasCardOnFile,
  licenseHoldCaption,
  overrideReason,
  PICKUP_AUTO_ACTIVATE_KEY,
  readAutoActivateSetting,
  type AutoDecision,
  type HandoverGate,
} from "@/lib/pickup-handover";
import { readReservationDetails } from "@/lib/reservations";
import { tableMissing } from "@/lib/fleet-api.server";
import { tierAllows, type StaffTier } from "@/lib/roles";

type Admin = any;
export type HandoverActor = { userId: string; email: string | null; role: string; tier: StaffTier };

export type HandoverDeps = {
  readiness: (admin: Admin, applicationId: string, vehicleId: string) => Promise<{ blockers: { code: string; message?: string }[] }>;
  activate: (actor: HandoverActor, input: Record<string, unknown>) => Promise<{ ok: boolean; rentalId?: string; blockers?: { code: string; message: string }[] }>;
  now?: () => Date;
};

const AGREEMENT_CODES = new Set(["no_signed_agreement", "agreement_not_collected"]);

function etToday(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export type HandoverView = {
  rentalId: string;
  applicationId: string;
  vehicleId: string;
  renterName: string;
  vehicleLabel: string;
  plate: string | null;
  pickupDate: string;
  pickupTime: string | null;
  saved: { odometer: number | null; fuelLevel: string | null; renterSignatureName: string | null; renterSignedAt: string | null; completedAt: string | null; activationStatus: string | null } | null;
  licensePhoto: boolean;
  licensePhotoCaption: string;
  gates: HandoverGate[];
  autoActivate: boolean;
  canActivate: boolean;
  tableReady: boolean;
};

async function loadRental(admin: Admin, rentalId: string) {
  const { data: r } = await admin
    .from("rentals")
    .select("id,status,application_id,vehicle_id,start_date,reservation_note,weekly_rate,deposit_amount,reservation_deposit_required,reservation_deposit_status,card_last4,card_on_file_at")
    .eq("id", rentalId)
    .maybeSingle();
  return r ?? null;
}

async function loadState(admin: Admin, r: any) {
  const [{ data: app }, { data: v }, { data: photos }, handover, { data: setting }] = await Promise.all([
    admin.from("applications").select("id,full_name,email,weekly_rent,deposit_amount,card_last4,stripe_payment_method_id,card_on_file_at").eq("id", r.application_id).maybeSingle(),
    admin.from("vehicles").select("id,year,make,model,license_plate,weekly_rate,deposit").eq("id", r.vehicle_id).maybeSingle(),
    admin.from("condition_media").select("id").eq("rental_id", r.id).eq("phase", "checkout").eq("caption", licenseHoldCaption(r.application_id)).limit(1),
    admin.from("pickup_handovers").select("*").eq("rental_id", r.id).maybeSingle(),
    admin.from("app_settings").select("value").eq("key", PICKUP_AUTO_ACTIVATE_KEY).maybeSingle(),
  ]);
  const tableReady = !(handover?.error && tableMissing(handover.error, "pickup_handovers"));
  return { app, vehicle: v, licensePhoto: Array.isArray(photos) && photos.length > 0, handover: handover?.data ?? null, tableReady, setting: readAutoActivateSetting(setting?.value) };
}

function gatesFor(state: Awaited<ReturnType<typeof loadState>>, r: any, blockers: { code: string }[], form?: { odometer: number | null; fuelLevel: string | null; renterSignatureName: string | null; renterSignedAt: string | null }) {
  const h = form ?? {
    odometer: state.handover?.odometer ?? null,
    fuelLevel: state.handover?.fuel_level ?? null,
    renterSignatureName: state.handover?.renter_signature_name ?? null,
    renterSignedAt: state.handover?.renter_signed_at ?? null,
  };
  return handoverGates({
    licensePhoto: state.licensePhoto,
    odometer: h.odometer,
    fuelLevel: h.fuelLevel,
    renterSignatureName: h.renterSignatureName,
    renterSignedAt: h.renterSignedAt,
    agreementSigned: !blockers.some((b) => AGREEMENT_CODES.has(b.code)),
    cardOnFile: hasCardOnFile([state.app, r]),
    reservationFeeRequired: r.reservation_deposit_required === true,
    reservationFeeStatus: r.reservation_deposit_status ?? null,
  });
}

export async function loadHandover(admin: Admin, actor: HandoverActor, rentalId: string, deps: Pick<HandoverDeps, "readiness">): Promise<HandoverView | { error: string }> {
  const r = await loadRental(admin, rentalId);
  if (!r || !r.application_id || !r.vehicle_id) return { error: "Reservation not found." };
  if (!["reserved", "active"].includes(String(r.status))) return { error: "This reservation is no longer open." };
  const state = await loadState(admin, r);
  const readiness = r.status === "reserved" ? await deps.readiness(admin, r.application_id, r.vehicle_id) : { blockers: [] };
  const d = readReservationDetails(r.reservation_note);
  const v = state.vehicle;
  return {
    rentalId: r.id,
    applicationId: r.application_id,
    vehicleId: r.vehicle_id,
    renterName: String(state.app?.full_name ?? "Renter"),
    vehicleLabel: v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "Vehicle",
    plate: v?.license_plate ?? null,
    pickupDate: r.start_date,
    pickupTime: d.pickupTime,
    saved: state.handover
      ? {
          odometer: state.handover.odometer ?? null,
          fuelLevel: state.handover.fuel_level ?? null,
          renterSignatureName: state.handover.renter_signature_name ?? null,
          renterSignedAt: state.handover.renter_signed_at ?? null,
          completedAt: state.handover.completed_at ?? null,
          activationStatus: state.handover.activation_status ?? null,
        }
      : null,
    licensePhoto: state.licensePhoto,
    licensePhotoCaption: licenseHoldCaption(r.application_id),
    gates: gatesFor(state, r, readiness.blockers),
    autoActivate: state.setting.enabled,
    canActivate: tierAllows(actor.tier, "manager"),
    tableReady: state.tableReady,
  };
}

export type SubmitInput = {
  rentalId: string;
  odometer: number;
  fuelLevel: string;
  renterSignatureName: string;
  renterAgreed: boolean;
  ip?: string | null;
  userAgent?: string | null;
};

export type SubmitResult =
  | { ok: false; error: string }
  | { ok: true; saved: true; activation: "activated" | "not_activated"; rentalId?: string; decision: AutoDecision; blockers?: { code: string; message: string }[] };

export async function submitHandover(admin: Admin, actor: HandoverActor, input: SubmitInput, deps: HandoverDeps): Promise<SubmitResult> {
  const now = deps.now ? deps.now() : new Date();
  if (input.renterAgreed !== true) return { ok: false, error: "The renter must confirm the checklist before signing." };
  const r = await loadRental(admin, input.rentalId);
  if (!r || !r.application_id || !r.vehicle_id) return { ok: false, error: "Reservation not found." };
  if (r.status !== "reserved") return { ok: false, error: "This reservation is no longer open." };
  const state = await loadState(admin, r);
  if (!state.tableReady) return { ok: false, error: "The pickup checklist needs its database update first. Nothing was saved." };
  if (state.handover?.completed_at) return { ok: false, error: "This pickup checklist was already completed." };
  const signedAt = now.toISOString();
  const form = { odometer: input.odometer, fuelLevel: input.fuelLevel, renterSignatureName: input.renterSignatureName.trim(), renterSignedAt: signedAt };

  const readiness = await deps.readiness(admin, r.application_id, r.vehicle_id);
  const gates = gatesFor(state, r, readiness.blockers, form);
  const checklistKeys = ["license_photo", "odometer", "fuel", "renter_signature"];
  const missingChecklist = gates.filter((g) => checklistKeys.includes(g.key) && !g.met).map((g) => g.label);
  if (missingChecklist.length) return { ok: false, error: `Finish the checklist first: ${missingChecklist.join(", ")}.` };

  const row = {
    rental_id: r.id,
    application_id: r.application_id,
    vehicle_id: r.vehicle_id,
    odometer: form.odometer,
    fuel_level: form.fuelLevel,
    renter_signature_name: form.renterSignatureName,
    renter_signed_at: signedAt,
    renter_signature_ip: input.ip ?? null,
    renter_signature_user_agent: input.userAgent ?? null,
    completed_by: actor.userId,
    completed_at: signedAt,
    activation_status: "pending",
  };
  // One completed checklist per reservation (rental_id primary key).
  const { error: insErr } = await admin.from("pickup_handovers").insert(row);
  if (insErr) {
    if (String(insErr.code) === "23505" || /duplicate key/i.test(String(insErr.message))) return { ok: false, error: "This pickup checklist was already completed." };
    return { ok: false, error: String(insErr.message) };
  }
  await admin.from("audit_log").insert({
    actor_user_id: actor.userId,
    actor_email: actor.email,
    actor_role: actor.role,
    action: "rental.pickup_checklist_completed",
    entity_type: "rental",
    entity_id: r.id,
    summary: "Pickup checklist completed: license photo, odometer, fuel, renter signature",
    metadata: { application_id: r.application_id, vehicle_id: r.vehicle_id, odometer: form.odometer, fuel_level: form.fuelLevel },
  });

  const decision = decideAutoActivation({ setting: state.setting, actorIsManager: tierAllows(actor.tier, "manager"), gates, blockers: readiness.blockers });
  if (!decision.activate) {
    await admin.from("pickup_handovers").update({ activation_status: "not_activated", activation_detail: `${decision.reason}${decision.missing.length ? `: ${decision.missing.join(",")}` : ""}` }).eq("rental_id", r.id);
    return { ok: true, saved: true, activation: "not_activated", decision };
  }

  const v = state.vehicle;
  const weeklyRate = Number(r.weekly_rate ?? 0) > 0 ? Number(r.weekly_rate) : Number(state.app?.weekly_rent ?? 0) > 0 ? Number(state.app.weekly_rent) : Number(v?.weekly_rate ?? 0);
  const deposit = r.deposit_amount != null ? Number(r.deposit_amount) : state.app?.deposit_amount != null ? Number(state.app.deposit_amount) : Number(v?.deposit ?? 0);
  const result = await deps.activate(actor, {
    applicationId: r.application_id,
    vehicleId: r.vehicle_id,
    weeklyRate,
    depositAmount: Math.max(0, deposit || 0),
    startDate: etToday(now),
    endDate: null,
    pickupMileage: form.odometer,
    ...(decision.overrides.length
      ? { overrideBlockers: true, overrideReason: overrideReason(actor.email ?? "the field rep") }
      : {}),
  });
  if (!result.ok) {
    await admin.from("pickup_handovers").update({ activation_status: "failed", activation_detail: (result.blockers ?? []).map((b) => b.code).join(",") || "activation refused" }).eq("rental_id", r.id);
    return { ok: true, saved: true, activation: "not_activated", decision, blockers: result.blockers };
  }
  await admin.from("pickup_handovers").update({ activation_status: "activated", activated_rental_id: result.rentalId ?? null }).eq("rental_id", r.id);
  return { ok: true, saved: true, activation: "activated", rentalId: result.rentalId, decision };
}
