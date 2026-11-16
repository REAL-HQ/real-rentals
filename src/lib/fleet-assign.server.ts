/**
 * FLEET assigns an available car to an Approved applicant at the car's listed
 * rate, earliest available first (Dolmar, t298s1611).
 *
 *   POST /api/public/fleet/assign-vehicle   (Bearer FLEET_API_KEY)
 *   { "action": "list" }
 *     -> the cars FLEET may assign, earliest available first.
 *   { "action": "assign", "lead_id": "…", "vehicle_id"?: "…", "start_date"?: "2026-11-18",
 *     "idempotency_key"?: "…" }
 *     -> puts the car on the application: vehicle_id, weekly_rent = the car's
 *        listed weekly rate, deposit_amount = the car's listed deposit ($0
 *        when none is listed), and the contract start date when sent (must be
 *        a day with an open pickup slot). Without vehicle_id the first car in
 *        the list is used.
 *
 * One car, one person: a car is assignable only when it is Available, not
 * archived, has a listed weekly rate, has no Reserved or Active rental, and
 * is not already assigned to another Approved applicant (the same checks
 * Reserve makes, plus the assignment itself). The write is conditional on the
 * applicant having no car yet, re-checked afterwards, and backed by the
 * unique index in proposed/fleet-assign-vehicle-v1.sql so two calls at the
 * same moment cannot both win. A car already assigned to someone else, or an
 * applicant who already has a different car, is refused (staff change it).
 *
 * Nothing here reserves the car, sends anything, or touches insurance,
 * screening or verification. Audited as "FLEET (automated)".
 */
import { fleetAdmin, fleetAudit, fleetJson, fleetRequestBody, idempotencyKey, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";
import { isCalendarDate, type PickupScheduleSettings } from "@/lib/pickup-schedule";

type Admin = any;
export type AssignDeps = FleetDeps & { settings?: PickupScheduleSettings };

const VEHICLE_SELECT = "id,year,make,model,trim,color,unit_number,status,archived_at,weekly_rate,deposit,created_at,license_plate,vin";

export function vehicleLabel(v: any): string {
  return [v?.year, v?.make, v?.model, v?.trim].filter(Boolean).join(" ").trim() || "Vehicle";
}

/**
 * Cars FLEET may assign, earliest available first: the car whose last rental
 * ended longest ago (never rented counts as earliest), then the oldest in
 * the fleet, then id, so the order is stable.
 */
export async function assignableVehicles(admin: Admin, opts: { exceptApplicationId?: string } = {}) {
  const v = await admin.from("vehicles").select(VEHICLE_SELECT).eq("status", "available").is("archived_at", null).limit(200);
  if (v.error) throw new Error("Could not read vehicles.");
  const cars = ((v.data ?? []) as any[]).filter((c) => Number(c.weekly_rate) > 0);
  if (!cars.length) return [];
  const ids = cars.map((c) => c.id);
  const [rentals, assigned] = await Promise.all([
    admin.from("rentals").select("vehicle_id,status,end_date,start_date").in("vehicle_id", ids),
    admin.from("applications").select("id,vehicle_id,status,deleted_at").in("vehicle_id", ids).eq("status", "approved"),
  ]);
  if (rentals.error || assigned.error) throw new Error("Could not read rentals.");
  const busy = new Set<string>();
  const lastEnd = new Map<string, string>();
  for (const r of (rentals.data ?? []) as any[]) {
    if (r.status === "active" || r.status === "reserved") busy.add(r.vehicle_id);
    const end = String(r.end_date ?? r.start_date ?? "");
    if (end && end > (lastEnd.get(r.vehicle_id) ?? "")) lastEnd.set(r.vehicle_id, end);
  }
  for (const a of (assigned.data ?? []) as any[]) if (!a.deleted_at && a.id !== opts.exceptApplicationId) busy.add(a.vehicle_id);
  return cars
    .filter((c) => !busy.has(c.id))
    .sort((a, b) => (lastEnd.get(a.id) ?? "").localeCompare(lastEnd.get(b.id) ?? "") || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id)))
    .map((c) => ({
      vehicle_id: c.id,
      vehicle: vehicleLabel(c),
      color: c.color ?? null,
      unit_number: c.unit_number ?? null,
      weekly_rate: Number(c.weekly_rate),
      deposit: c.deposit == null ? 0 : Number(c.deposit),
      available_since: lastEnd.get(c.id) ?? null,
    }));
}

export async function handleFleetAssignVehicle(request: Request, deps: AssignDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const now = (deps.now ?? (() => new Date()))();
  const admin = await fleetAdmin(deps);
  const action = String(body.action ?? "list");

  if (action === "list") {
    try {
      return fleetJson(200, { ok: true, vehicles: await assignableVehicles(admin) });
    } catch {
      return fleetJson(503, { ok: false, error: "Database unavailable." });
    }
  }
  if (action !== "assign") return fleetJson(400, { ok: false, error: 'action must be "list" or "assign".' });

  const leadId = String(body.lead_id ?? "").trim();
  if (!UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const wanted = body.vehicle_id == null || body.vehicle_id === "" ? null : String(body.vehicle_id).trim();
  if (wanted && !UUID_RE.test(wanted)) return fleetJson(400, { ok: false, error: "vehicle_id must be a UUID." });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  const startDate = body.start_date == null || body.start_date === "" ? null : String(body.start_date).trim();
  if (startDate && !isCalendarDate(startDate)) return fleetJson(400, { ok: false, error: "start_date must be YYYY-MM-DD." });

  const appRes = await admin.from("applications").select("id,status,deleted_at,vehicle_id,weekly_rent,deposit_amount,contract_start_date,full_name").eq("id", leadId).maybeSingle();
  if (appRes.error) return fleetJson(503, { ok: false, error: "Database unavailable." });
  const app = appRes.data;
  if (!app || app.deleted_at) return fleetJson(404, { ok: false, error: "Applicant not found." });
  if (String(app.status) !== "approved") return fleetJson(409, { ok: false, error: `Only an Approved applicant can be assigned a car (this one is ${app.status}).` });

  if (startDate) {
    // The contract start is the pickup day: it must have an open pickup slot.
    try {
      const s = deps.settings ?? (await (await import("@/lib/reservation-confirmation.server")).loadPickupSchedule(admin));
      const { listOpenSlots } = await import("@/lib/fleet-pickup.server");
      const open = await listOpenSlots(admin, s, now, { days: 30, limit: 200 });
      if (!open.some((o) => o.date === startDate)) {
        const days = [...new Set(open.map((o) => o.date))].slice(0, 5);
        return fleetJson(409, { ok: false, error: `No open pickup slot on ${startDate}. Pick a day with an open slot.`, next_open_days: days });
      }
    } catch {
      return fleetJson(503, { ok: false, error: "Database unavailable." });
    }
  }

  let cars: Awaited<ReturnType<typeof assignableVehicles>>;
  try {
    cars = await assignableVehicles(admin, { exceptApplicationId: leadId });
  } catch {
    return fleetJson(503, { ok: false, error: "Database unavailable." });
  }

  // Already holds a car.
  if (app.vehicle_id) {
    if (wanted && wanted !== app.vehicle_id) return fleetJson(409, { ok: false, error: "This applicant already has a different car assigned. Staff change it." });
    const same = await admin.from("vehicles").select(VEHICLE_SELECT).eq("id", app.vehicle_id).maybeSingle();
    const v = same.data;
    const patch: Record<string, unknown> = {};
    if (startDate && String(app.contract_start_date ?? "") !== startDate) patch.contract_start_date = startDate;
    if (Object.keys(patch).length) {
      const up = await admin.from("applications").update(patch).eq("id", leadId);
      if (up.error) return fleetJson(503, { ok: false, error: "Could not update the start date." });
    }
    return fleetJson(200, {
      ok: true, duplicate: true, lead_id: leadId, vehicle_id: app.vehicle_id, vehicle: v ? vehicleLabel(v) : null,
      weekly_rate: app.weekly_rent ?? v?.weekly_rate ?? null, deposit: app.deposit_amount ?? v?.deposit ?? null,
      start_date: startDate ?? app.contract_start_date ?? null, start_date_updated: !!patch.contract_start_date,
    });
  }

  const car = wanted ? cars.find((c) => c.vehicle_id === wanted) : cars[0];
  if (!car) {
    return fleetJson(409, {
      ok: false,
      error: wanted ? "That car is not free to assign (reserved, rented, assigned to someone else, not Available, or no listed rate)." : "No car is free to assign right now.",
      vehicles: cars.slice(0, 5),
    });
  }

  const patch: Record<string, unknown> = { vehicle_id: car.vehicle_id, weekly_rent: car.weekly_rate, deposit_amount: car.deposit };
  if (startDate) patch.contract_start_date = startDate;
  // Conditional: only while the applicant still has no car.
  const up = await admin.from("applications").update(patch).eq("id", leadId).is("vehicle_id", null).eq("status", "approved").select("id");
  if (up.error) {
    if (String(up.error.code) === "23505" || /one_approved_per_vehicle/i.test(String(up.error.message))) {
      return fleetJson(409, { ok: false, error: "That car was just assigned to someone else. List again and retry." });
    }
    return fleetJson(503, { ok: false, error: "Could not assign the car. Nothing was changed." });
  }
  if (!up.data?.length) return fleetJson(409, { ok: false, error: "The applicant changed while assigning (a car was just set or the stage changed). Read again." });

  // Re-check: if another Approved applicant holds the same car, the earlier one keeps it.
  const holders = await admin.from("applications").select("id,vehicle_id,status,deleted_at").eq("vehicle_id", car.vehicle_id).eq("status", "approved");
  const others = ((holders.data ?? []) as any[]).filter((r) => r.id !== leadId && !r.deleted_at);
  const rentals = await admin.from("rentals").select("id,status").eq("vehicle_id", car.vehicle_id).in("status", ["reserved", "active"]);
  if (others.length || (rentals.data ?? []).length) {
    await admin.from("applications").update({ vehicle_id: null, weekly_rent: app.weekly_rent ?? null, deposit_amount: app.deposit_amount ?? null, contract_start_date: app.contract_start_date ?? null }).eq("id", leadId).eq("vehicle_id", car.vehicle_id);
    return fleetJson(409, { ok: false, error: "That car was just taken. Nothing was changed. List again and retry." });
  }

  const audit = fleetAudit(deps);
  await audit({
    action: "application.fleet_vehicle_assigned",
    summary: `Car assigned by ${FLEET_ACTOR_LABEL}: ${car.vehicle} at its listed $${car.weekly_rate}/week${car.deposit ? `, $${car.deposit} deposit` : ", no deposit"}${startDate ? `, start ${startDate}` : ""}`.slice(0, 300),
    entityType: "application",
    entityId: leadId,
    metadata: { decided_by: FLEET_ACTOR_LABEL, vehicle_id: car.vehicle_id, weekly_rate: car.weekly_rate, deposit: car.deposit, start_date: startDate, idempotency_key: idem, earliest_available: !wanted || cars[0]?.vehicle_id === car.vehicle_id },
  }).catch(() => {});
  return fleetJson(201, {
    ok: true,
    lead_id: leadId,
    vehicle_id: car.vehicle_id,
    vehicle: car.vehicle,
    weekly_rate: car.weekly_rate,
    deposit: car.deposit,
    start_date: startDate,
    next: startDate
      ? "Text the terms (car, weekly rate, deposit, start date) and send the agreement after a YES."
      : "Send start_date (a day with an open pickup slot) before the agreement: the agreement prints the start date.",
  });
}
