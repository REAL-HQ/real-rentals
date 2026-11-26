/**
 * FLEET pickup scheduling: POST /api/public/fleet/pickup-slots.
 *
 *   { "action": "list", "days"?: 14, "limit"?: 20 }
 *     -> open slots, earliest first, from Settings -> Pickup Schedule.
 *   { "action": "book", "lead_id", "start_at", "vehicle_id"?, "pickup_location"?, "note"?, "idempotency_key"? }
 *     -> reserves the car through the same code path as staff Reserved
 *        (createReservationCore): Approved/Active only, one booking per slot,
 *        Pickup Booked Email (no login details) per its automation switch.
 *
 * FLEET may only book a slot on the schedule; staff can still book any time.
 */
import {
  cleanText,
  fleetAdmin,
  fleetAudit,
  fleetJson,
  fleetRequestBody,
  idempotencyKey,
  UUID_RE,
  type FleetDeps,
} from "@/lib/fleet-api.server";
import {
  blockedDateReason,
  isScheduledSlot,
  openPickupSlots,
  parseSlotStart,
  slotIso,
  slotKey,
  slotLabel,
  type PickupScheduleSettings,
} from "@/lib/pickup-schedule";
import { readReservationDetails } from "@/lib/reservations";

const FLEET_ACTOR = "FLEET (automated)";

export type PickupDeps = FleetDeps & {
  settings?: PickupScheduleSettings;
  reserve?: (admin: any, data: { applicationId: string; vehicleId: string; pickupDate: string; pickupTime: string; pickupLocation: string; note?: string; requireReservationFee?: boolean }) => Promise<{ id: string; loginEmail: string }>;
};

/** slotKey(date, time) for every reserved rental from `fromDate` on. */
export async function bookedSlots(admin: any, fromDate: string): Promise<Set<string>> {
  const { data, error } = await admin.from("rentals").select("start_date,reservation_note").eq("status", "reserved").gte("start_date", fromDate).limit(1000);
  if (error) throw new Error(error.message);
  const out = new Set<string>();
  for (const r of (data ?? []) as any[]) {
    const t = readReservationDetails(r.reservation_note).pickupTime;
    if (r.start_date && t) out.add(slotKey(r.start_date, t));
  }
  return out;
}

export async function listOpenSlots(admin: any, s: PickupScheduleSettings, now: Date, opts: { days?: number; limit?: number } = {}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: s.timezone }).format(now);
  return openPickupSlots(s, now, await bookedSlots(admin, today), opts);
}

function scheduleView(s: PickupScheduleSettings) {
  return { timezone: s.timezone, days: s.days, start_times: s.startTimes, slot_minutes: s.slotMinutes, min_notice_minutes: s.minNoticeMinutes, blocked_dates: s.blockedDates, holidays_blocked: true, field_rep: { name: s.fieldRep.name } };
}

export async function handleFleetPickupSlots(request: Request, deps: PickupDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  const now = (deps.now ?? (() => new Date()))();
  let admin: any;
  let s: PickupScheduleSettings;
  try {
    admin = await fleetAdmin(deps);
    s = deps.settings ?? (await (await import("@/lib/reservation-confirmation.server")).loadPickupSchedule(admin));
  } catch {
    return fleetJson(503, { ok: false, error: "Database unavailable." });
  }
  const action = String(body.action ?? "list");

  if (action === "list") {
    const days = body.days == null ? undefined : Number(body.days);
    const limit = body.limit == null ? 20 : Number(body.limit);
    if (days != null && (!Number.isInteger(days) || days < 1 || days > 60)) return fleetJson(400, { ok: false, error: "days must be 1 to 60." });
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return fleetJson(400, { ok: false, error: "limit must be 1 to 200." });
    try {
      const slots = await listOpenSlots(admin, s, now, { days, limit });
      return fleetJson(200, { ok: true, schedule: scheduleView(s), slots });
    } catch {
      return fleetJson(503, { ok: false, error: "Database unavailable." });
    }
  }

  if (action !== "book") return fleetJson(400, { ok: false, error: 'action must be "list" or "book".' });

  const leadId = String(body.lead_id ?? "").trim();
  if (!UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const slot = parseSlotStart(body.start_at, s.timezone);
  if (!slot) return fleetJson(400, { ok: false, error: "start_at must be an ISO time with a zone, e.g. 2026-11-18T09:00:00-05:00." });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1 to 120 characters." });
  const note = cleanText(body.note, 140) || undefined;
  const location = cleanText(body.pickup_location, 180) || s.defaultLocation || "";
  if (location.length < 3) return fleetJson(400, { ok: false, error: "pickup_location is required (no default pickup location is set)." });

  const { data: app, error: appErr } = await admin.from("applications").select("id,status,full_name,vehicle_id,deleted_at").eq("id", leadId).maybeSingle();
  if (appErr) return fleetJson(503, { ok: false, error: "Database unavailable." });
  if (!app || app.deleted_at) return fleetJson(404, { ok: false, error: "Applicant not found." });
  const vehicleId = String(body.vehicle_id ?? app.vehicle_id ?? "").trim();
  if (!UUID_RE.test(vehicleId)) return fleetJson(409, { ok: false, error: "No vehicle: send vehicle_id or assign a vehicle to the applicant first." });

  // Idempotent repeat: same applicant already holds this exact slot + car.
  const { data: mine } = await admin.from("rentals").select("id,vehicle_id,start_date,reservation_note").eq("application_id", leadId).eq("status", "reserved").limit(5);
  const existing = ((mine ?? []) as any[]).find((r) => r.start_date === slot.date && r.vehicle_id === vehicleId && readReservationDetails(r.reservation_note).pickupTime === slot.time);
  const pickup = { date: slot.date, time: slot.time, start_at: slotIso(slot.date, slot.time, s.timezone), label: slotLabel(slot.date, slot.time), location, field_rep: s.fieldRep.name };
  if (existing) return fleetJson(200, { ok: true, duplicate: true, rental_id: existing.id, lead_id: leadId, pickup });

  if (!["approved", "active"].includes(String(app.status ?? "").toLowerCase())) {
    return fleetJson(409, { ok: false, error: "Only an Approved applicant can be booked." });
  }
  if (!isScheduledSlot(s, slot.date, slot.time)) return fleetJson(409, { ok: false, error: "That time is not a pickup slot.", schedule: scheduleView(s) });
  const open = await listOpenSlots(admin, s, now, { days: 60, limit: 200 }).catch(() => null);
  if (!open) return fleetJson(503, { ok: false, error: "Database unavailable." });
  const closed = blockedDateReason(s, slot.date);
  if (closed) {
    return fleetJson(409, { ok: false, error: `Pickups are closed on ${slot.date} (${closed}).`, next_open: open.slice(0, 5) });
  }
  if (!open.some((o) => o.date === slot.date && o.time === slot.time)) {
    return fleetJson(409, { ok: false, error: "That slot is booked or too soon.", next_open: open.slice(0, 5) });
  }

  const audit = fleetAudit(deps);
  let res: { id: string; loginEmail: string };
  try {
    const reserve = deps.reserve ?? (async (a: any, d: any) => (await import("@/lib/reservations.functions")).createReservationCore(a, d));
    // The car is held only once the $50 Reservation Fee is paid (t299s1618; no-op while that switch is off).
    res = await reserve(admin, { applicationId: leadId, vehicleId, pickupDate: slot.date, pickupTime: slot.time, pickupLocation: location, note, requireReservationFee: true });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 200);
    return fleetJson(409, { ok: false, error: msg });
  }
  await audit({
    action: "reservation.fleet_booked",
    summary: `Pickup booked ${pickup.label} (${FLEET_ACTOR})`,
    entityType: "rental",
    entityId: res.id,
    metadata: { decided_by: FLEET_ACTOR, application_id: leadId, vehicle_id: vehicleId, pickup_date: slot.date, pickup_time: slot.time, idempotency_key: idem },
  }).catch(() => {});
  {
    const { recordFleetLifecycleStep } = await import("@/lib/fleet-lifecycle.server");
    await recordFleetLifecycleStep(audit, { applicationId: leadId, step: "reserved", evidence: `Pickup booked ${pickup.label}.`, source: "pickup-slots", at: now, extra: { rental_id: res.id } });
  }
  return fleetJson(201, { ok: true, rental_id: res.id, lead_id: leadId, vehicle_id: vehicleId, pickup, login_email: res.loginEmail });
}
