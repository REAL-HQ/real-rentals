/**
 * FLEET reads and writes one vehicle's mileage log, oil next service due,
 * and monthly inspection.
 *
 *   POST /api/public/fleet/vehicle-maintenance   read
 *   POST /api/public/fleet/mileage-reading       append one reading
 *   POST /api/public/fleet/service-due           oil next due miles and date
 *   POST /api/public/fleet/monthly-inspection    last done, next due, notes, photo
 *
 * Bearer FLEET_API_KEY. Writes are Off until Automations → Vehicle
 * Maintenance (FLEET) (fleet_vehicle_maintenance). Reads stay available.
 * Audited as "FLEET (automated)". Sends nothing to renters. Does not write
 * vehicles.current_odometer (the odometer trigger does that) and does not
 * touch rentals or billing.
 *
 * Photos: JPEG, PNG, WebP, or HEIC, 20 MB decoded, one per call. A mileage
 * photo is source_type odometer_photo. An inspection photo is stored on
 * that history row. See docs/fleet-api.md.
 */
import { decodeBase64 } from "@/lib/fleet-document.server";
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
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";
import { vinLast6 } from "@/lib/vehicle-label";
import {
  FLEET_VEHICLE_MAINTENANCE_KEY,
  MAINTENANCE_PHOTO_MAX_BYTES,
  businessToday,
  normalizePlate,
  parseMileageWrite,
  parseMonthlyWrite,
  parseServiceDueWrite,
} from "@/lib/vehicle-maintenance";

type Admin = any;

const MILEAGE_ACTION = "fleet.mileage_reading";
const SERVICE_DUE_ACTION = "fleet.service_due";
const MONTHLY_ACTION = "fleet.monthly_inspection";

export type MaintenanceDeps = FleetDeps & {
  gate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  today?: () => string;
};

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}

async function gateWrites(admin: Admin, deps: MaintenanceDeps): Promise<Response | null> {
  const gate = await (deps.gate ?? defaultGate)(admin, FLEET_VEHICLE_MAINTENANCE_KEY).catch(
    () => "held" as const,
  );
  if (gate === "off")
    return fleetJson(409, {
      ok: false,
      error:
        "The Vehicle Maintenance (FLEET) switch is Off (Back Office → Automations). Nothing was saved.",
      reason: "switched_off",
    });
  if (gate !== "send")
    return fleetJson(503, {
      ok: false,
      error: "Automation switches could not be read; try again later. Nothing was saved.",
      reason: "controls_unreadable",
    });
  return null;
}

const VEHICLE_COLUMNS = "id,license_plate,vin,archived_at,oil_interval_miles";

async function resolveVehicle(
  admin: Admin,
  body: Record<string, unknown>,
): Promise<{ vehicle: any } | { response: Response }> {
  const id = body.vehicle_id == null || body.vehicle_id === "" ? null : String(body.vehicle_id);
  const plate =
    body.license_plate == null || body.license_plate === ""
      ? null
      : normalizePlate(body.license_plate);
  if (body.license_plate != null && body.license_plate !== "" && !plate)
    return {
      response: fleetJson(400, {
        ok: false,
        error: "license_plate must be 2–12 letters or numbers.",
      }),
    };
  if (id && !UUID_RE.test(id))
    return { response: fleetJson(400, { ok: false, error: "vehicle_id must be a UUID." }) };
  if (!id && !plate)
    return { response: fleetJson(400, { ok: false, error: "Send vehicle_id or license_plate." }) };
  if (id) {
    const res = await admin.from("vehicles").select(VEHICLE_COLUMNS).eq("id", id).maybeSingle();
    if (res.error)
      return { response: fleetJson(503, { ok: false, error: "Could not read the vehicle." }) };
    if (!res.data) return { response: fleetJson(404, { ok: false, error: "Vehicle not found." }) };
    if (res.data.archived_at)
      return { response: fleetJson(409, { ok: false, error: "This vehicle is archived." }) };
    if (plate && normalizePlate(res.data.license_plate) !== plate)
      return {
        response: fleetJson(409, {
          ok: false,
          error: "vehicle_id and license_plate do not match.",
        }),
      };
    return { vehicle: res.data };
  }
  const res = await admin
    .from("vehicles")
    .select(VEHICLE_COLUMNS)
    .ilike("license_plate", plate)
    .limit(5);
  if (res.error)
    return { response: fleetJson(503, { ok: false, error: "Could not read the vehicle." }) };
  const rows = (res.data ?? []) as any[];
  const active = rows.filter((row) => !row.archived_at);
  if (active.length === 1) return { vehicle: active[0] };
  if (active.length > 1)
    return {
      response: fleetJson(409, {
        ok: false,
        error: "More than one vehicle has that plate. Send vehicle_id.",
      }),
    };
  if (rows.length)
    return { response: fleetJson(409, { ok: false, error: "This vehicle is archived." }) };
  return { response: fleetJson(404, { ok: false, error: "Vehicle not found." }) };
}

function vehicleRef(vehicle: any) {
  return {
    vehicle_id: vehicle.id as string,
    license_plate: vehicle.license_plate ? String(vehicle.license_plate).toUpperCase() : null,
    vin_last6: vinLast6(vehicle.vin) || null,
  };
}

async function prior(admin: Admin, action: string, idem: string | null) {
  if (!idem) return null;
  const res = await admin
    .from("audit_log")
    .select("entity_id,metadata")
    .eq("action", action)
    .eq("metadata->>idempotency_key", idem)
    .limit(5);
  if (res.error) throw new Error("audit_unreadable");
  return ((res.data ?? []) as Array<{ entity_id: string | null; metadata: any }>)[0] ?? null;
}

function photoBytes(
  body: Record<string, unknown>,
): { bytes: Uint8Array } | { response: Response } | { bytes: null } {
  if (body.content_base64 == null || body.content_base64 === "") return { bytes: null };
  if (
    typeof body.content_base64 === "string" &&
    body.content_base64.length > Math.ceil(MAINTENANCE_PHOTO_MAX_BYTES / 3) * 4 + 200
  ) {
    return {
      response: fleetJson(413, { ok: false, error: "The photo is over 20 MB. Nothing was saved." }),
    };
  }
  const bytes = decodeBase64(body.content_base64);
  if (!bytes || !bytes.length)
    return {
      response: fleetJson(400, {
        ok: false,
        error: "content_base64 must be the photo, base64-encoded.",
      }),
    };
  if (bytes.length > MAINTENANCE_PHOTO_MAX_BYTES)
    return {
      response: fleetJson(413, { ok: false, error: "The photo is over 20 MB. Nothing was saved." }),
    };
  return { bytes };
}

function photoError(err: unknown): Response | null {
  const msg = err instanceof Error ? err.message : "";
  if (/over 20 MB/i.test(msg))
    return fleetJson(413, { ok: false, error: "The photo is over 20 MB. Nothing was saved." });
  if (/JPEG, PNG/i.test(msg))
    return fleetJson(415, {
      ok: false,
      error: "Only JPEG, PNG, WebP, or HEIC photos are accepted. Nothing was saved.",
    });
  return null;
}

export async function handleFleetVehicleMaintenance(
  request: Request,
  deps: MaintenanceDeps = {},
): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const admin = await fleetAdmin(deps);
  const found = await resolveVehicle(admin, parsed.body);
  if ("response" in found) return found.response;
  try {
    const { loadVehicleMaintenance } = await import("@/lib/maintenance.server");
    const view = await loadVehicleMaintenance(admin, found.vehicle.id);
    if (!view) return fleetJson(404, { ok: false, error: "Vehicle not found." });
    return fleetJson(200, { ok: true, ...view });
  } catch {
    return fleetJson(503, { ok: false, error: "Could not load maintenance." });
  }
}

export async function handleFleetMileageReading(
  request: Request,
  deps: MaintenanceDeps = {},
): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const admin = await fleetAdmin(deps);
  const blocked = await gateWrites(admin, deps);
  if (blocked) return blocked;
  const today = (deps.today ?? businessToday)();
  const write = parseMileageWrite(parsed.body, today);
  if (!write.ok) return fleetJson(write.status, { ok: false, error: write.error });
  const idem = idempotencyKey(parsed.body.idempotency_key);
  if (idem === "invalid")
    return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  const photo = photoBytes(parsed.body);
  if ("response" in photo) return photo.response;
  if (write.value.hasPhoto && !photo.bytes)
    return fleetJson(400, {
      ok: false,
      error: "content_base64 must be the photo, base64-encoded.",
    });
  const found = await resolveVehicle(admin, parsed.body);
  if ("response" in found) return found.response;
  const audit = fleetAudit(deps);
  try {
    const hit = await prior(admin, MILEAGE_ACTION, idem);
    if (hit) {
      const m = hit.metadata ?? {};
      if (
        m.vehicle_id !== found.vehicle.id ||
        m.mileage !== write.value.mileage ||
        m.observed_on !== write.value.observedOn
      ) {
        return fleetJson(409, {
          ok: false,
          error: "idempotency_key was already used for a different reading.",
        });
      }
      return fleetJson(200, {
        ok: true,
        duplicate: true,
        ...vehicleRef(found.vehicle),
        reading_id: m.reading_id ?? hit.entity_id,
        observed_on: write.value.observedOn,
        mileage: write.value.mileage,
        source_type: m.source_type ?? write.value.sourceType,
        document_id: m.document_id ?? null,
        status: m.status ?? null,
      });
    }
  } catch {
    return fleetJson(503, {
      ok: false,
      error: "Could not check for an earlier reading. Nothing was saved.",
    });
  }
  let documentId: string | null = null;
  let sha: string | null = null;
  if (photo.bytes) {
    try {
      const { saveMaintenancePhoto } = await import("@/lib/maintenance.server");
      const saved = await saveMaintenancePhoto(admin, {
        vehicleId: found.vehicle.id,
        bytes: photo.bytes,
        fileName: cleanText(parsed.body.file_name, 200) || "odometer-photo",
        label: "Odometer Photo",
        kind: "odometer_photo",
        uploadedBy: null,
        uploadedByRole: "team",
      });
      documentId = saved.id;
      sha = saved.sha256;
    } catch (err) {
      return (
        photoError(err) ??
        fleetJson(503, { ok: false, error: "Could not store the photo. Nothing was saved." })
      );
    }
  }
  const evidenceKey = idem ? `fleet:mileage:${idem}` : null;
  try {
    const { addOdometerReading } = await import("@/lib/maintenance.server");
    const reading = await addOdometerReading(admin, null, {
      vehicleId: found.vehicle.id,
      mileage: write.value.mileage,
      observedOn: write.value.observedOn,
      sourceType: write.value.sourceType,
      documentId,
      evidenceKey,
      note: write.value.note,
    });
    if (reading.duplicate) {
      const existing = evidenceKey
        ? await admin
            .from("odometer_readings")
            .select("id,status,document_id")
            .eq("evidence_key", evidenceKey)
            .maybeSingle()
        : { data: null };
      return fleetJson(200, {
        ok: true,
        duplicate: true,
        ...vehicleRef(found.vehicle),
        reading_id: existing.data?.id ?? null,
        observed_on: write.value.observedOn,
        mileage: write.value.mileage,
        source_type: write.value.sourceType,
        document_id: existing.data?.document_id ?? documentId,
        status: existing.data?.status ?? null,
      });
    }
    await audit({
      action: MILEAGE_ACTION,
      summary:
        `${FLEET_ACTOR_LABEL} recorded ${write.value.mileage.toLocaleString("en-US")} mi on ${write.value.observedOn}.`.slice(
          0,
          300,
        ),
      entityType: "vehicle",
      entityId: found.vehicle.id,
      metadata: {
        by: FLEET_ACTOR_LABEL,
        vehicle_id: found.vehicle.id,
        reading_id: reading.id,
        idempotency_key: idem,
        mileage: write.value.mileage,
        observed_on: write.value.observedOn,
        source_type: write.value.sourceType,
        document_id: documentId,
        sha256: sha,
        status: reading.status,
      },
    });
    return fleetJson(201, {
      ok: true,
      duplicate: false,
      ...vehicleRef(found.vehicle),
      reading_id: reading.id,
      observed_on: write.value.observedOn,
      mileage: write.value.mileage,
      source_type: write.value.sourceType,
      note: write.value.note,
      status: reading.status,
      document_id: documentId,
      has_photo: Boolean(documentId),
    });
  } catch {
    return fleetJson(503, { ok: false, error: "Could not record the mileage reading." });
  }
}

export async function handleFleetServiceDue(
  request: Request,
  deps: MaintenanceDeps = {},
): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const admin = await fleetAdmin(deps);
  const blocked = await gateWrites(admin, deps);
  if (blocked) return blocked;
  const write = parseServiceDueWrite(parsed.body);
  if (!write.ok) return fleetJson(write.status, { ok: false, error: write.error });
  const idem = idempotencyKey(parsed.body.idempotency_key);
  if (idem === "invalid")
    return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  const found = await resolveVehicle(admin, parsed.body);
  if ("response" in found) return found.response;
  const audit = fleetAudit(deps);
  try {
    const hit = await prior(admin, SERVICE_DUE_ACTION, idem);
    if (hit) {
      const m = hit.metadata ?? {};
      const miles = write.value.nextDueMiles === undefined ? "omit" : write.value.nextDueMiles;
      const on = write.value.nextDueOn === undefined ? "omit" : write.value.nextDueOn;
      if (
        m.vehicle_id !== found.vehicle.id ||
        m.requested_next_due_miles !== miles ||
        m.requested_next_due_on !== on
      ) {
        return fleetJson(409, {
          ok: false,
          error: "idempotency_key was already used for a different next service due.",
        });
      }
      return fleetJson(200, {
        ok: true,
        duplicate: true,
        ...vehicleRef(found.vehicle),
        schedule_id: m.schedule_id ?? null,
        item: "Oil Change",
        next_due_miles: m.next_due_miles ?? null,
        next_due_on: m.next_due_on ?? null,
      });
    }
  } catch {
    return fleetJson(503, {
      ok: false,
      error: "Could not check for an earlier update. Nothing was saved.",
    });
  }
  try {
    const { saveOilNextDue } = await import("@/lib/maintenance.server");
    const saved = await saveOilNextDue(admin, {
      vehicleId: found.vehicle.id,
      nextDueMiles: write.value.nextDueMiles,
      nextDueOn: write.value.nextDueOn,
      notes: write.value.notes,
      intervalMiles: write.value.intervalMiles,
    });
    await audit({
      action: SERVICE_DUE_ACTION,
      summary:
        `${FLEET_ACTOR_LABEL} set next oil service due${saved.row.next_due_miles != null ? ` at ${Number(saved.row.next_due_miles).toLocaleString("en-US")} mi` : ""}${saved.row.next_due_on ? ` on ${saved.row.next_due_on}` : ""}.`.slice(
          0,
          300,
        ),
      entityType: "vehicle",
      entityId: found.vehicle.id,
      metadata: {
        by: FLEET_ACTOR_LABEL,
        vehicle_id: found.vehicle.id,
        schedule_id: saved.scheduleId,
        idempotency_key: idem,
        item: "Oil Change",
        next_due_miles: saved.row.next_due_miles ?? null,
        next_due_on: saved.row.next_due_on ?? null,
        requested_next_due_miles:
          write.value.nextDueMiles === undefined ? "omit" : write.value.nextDueMiles,
        requested_next_due_on: write.value.nextDueOn === undefined ? "omit" : write.value.nextDueOn,
      },
    });
    return fleetJson(saved.created ? 201 : 200, {
      ok: true,
      duplicate: false,
      ...vehicleRef(found.vehicle),
      schedule_id: saved.scheduleId,
      item: "Oil Change",
      next_due_miles: saved.row.next_due_miles ?? null,
      next_due_on: saved.row.next_due_on ?? null,
      interval_miles: saved.row.interval_miles ?? null,
      notes: saved.row.notes ?? null,
    });
  } catch {
    return fleetJson(503, { ok: false, error: "Could not save the next service due." });
  }
}

export async function handleFleetMonthlyInspection(
  request: Request,
  deps: MaintenanceDeps = {},
): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const admin = await fleetAdmin(deps);
  const blocked = await gateWrites(admin, deps);
  if (blocked) return blocked;
  const today = (deps.today ?? businessToday)();
  const write = parseMonthlyWrite(parsed.body, today);
  if (!write.ok) return fleetJson(write.status, { ok: false, error: write.error });
  const idem = idempotencyKey(parsed.body.idempotency_key);
  if (idem === "invalid")
    return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  const photo = photoBytes(parsed.body);
  if ("response" in photo) return photo.response;
  if (write.value.hasPhoto && !photo.bytes)
    return fleetJson(400, {
      ok: false,
      error: "content_base64 must be the photo, base64-encoded.",
    });
  const found = await resolveVehicle(admin, parsed.body);
  if ("response" in found) return found.response;
  const audit = fleetAudit(deps);
  try {
    const hit = await prior(admin, MONTHLY_ACTION, idem);
    if (hit) {
      const m = hit.metadata ?? {};
      const last = write.value.lastDoneOn === undefined ? "omit" : write.value.lastDoneOn;
      const on = write.value.nextDueOn === undefined ? "omit" : write.value.nextDueOn;
      const notes = write.value.notes === undefined ? "omit" : write.value.notes;
      if (
        m.vehicle_id !== found.vehicle.id ||
        m.requested_last_done_on !== last ||
        m.requested_next_due_on !== on ||
        m.requested_notes !== notes ||
        Boolean(m.has_photo) !== write.value.hasPhoto
      ) {
        return fleetJson(409, {
          ok: false,
          error: "idempotency_key was already used for a different monthly inspection.",
        });
      }
      return fleetJson(200, {
        ok: true,
        duplicate: true,
        ...vehicleRef(found.vehicle),
        schedule_id: m.schedule_id ?? null,
        record_id: m.record_id ?? null,
        item: "Monthly Inspection",
        last_done_on: m.last_done_on ?? null,
        next_due_on: m.next_due_on ?? null,
        document_id: m.document_id ?? null,
      });
    }
  } catch {
    return fleetJson(503, {
      ok: false,
      error: "Could not check for an earlier inspection. Nothing was saved.",
    });
  }
  let documentId: string | null = null;
  let sha: string | null = null;
  if (photo.bytes) {
    try {
      const { saveMaintenancePhoto } = await import("@/lib/maintenance.server");
      const saved = await saveMaintenancePhoto(admin, {
        vehicleId: found.vehicle.id,
        bytes: photo.bytes,
        fileName: cleanText(parsed.body.file_name, 200) || "monthly-inspection",
        label: "Monthly Inspection",
        kind: "inspection_photo",
        uploadedBy: null,
        uploadedByRole: "team",
      });
      documentId = saved.id;
      sha = saved.sha256;
    } catch (err) {
      return (
        photoError(err) ??
        fleetJson(503, { ok: false, error: "Could not store the photo. Nothing was saved." })
      );
    }
  }
  try {
    const { saveMonthlyInspection } = await import("@/lib/maintenance.server");
    const saved = await saveMonthlyInspection(admin, null, {
      vehicleId: found.vehicle.id,
      lastDoneOn: write.value.lastDoneOn,
      nextDueOn: write.value.nextDueOn,
      notes: write.value.notes,
      odometer: write.value.odometer,
      documentId,
      source: "fleet",
    });
    await audit({
      action: MONTHLY_ACTION,
      summary:
        `${FLEET_ACTOR_LABEL} updated the monthly inspection${saved.row.last_done_on ? ` (last done ${saved.row.last_done_on})` : ""}.`.slice(
          0,
          300,
        ),
      entityType: "vehicle",
      entityId: found.vehicle.id,
      metadata: {
        by: FLEET_ACTOR_LABEL,
        vehicle_id: found.vehicle.id,
        schedule_id: saved.scheduleId,
        record_id: saved.recordId,
        idempotency_key: idem,
        item: "Monthly Inspection",
        last_done_on: saved.row.last_done_on ?? null,
        next_due_on: saved.row.next_due_on ?? null,
        document_id: documentId,
        sha256: sha,
        has_photo: Boolean(documentId),
        requested_last_done_on:
          write.value.lastDoneOn === undefined ? "omit" : write.value.lastDoneOn,
        requested_next_due_on: write.value.nextDueOn === undefined ? "omit" : write.value.nextDueOn,
        requested_notes: write.value.notes === undefined ? "omit" : write.value.notes,
      },
    });
    return fleetJson(saved.recordId ? 201 : 200, {
      ok: true,
      duplicate: false,
      ...vehicleRef(found.vehicle),
      schedule_id: saved.scheduleId,
      record_id: saved.recordId,
      item: "Monthly Inspection",
      interval_days: 30,
      last_done_on: saved.row.last_done_on ?? null,
      next_due_on: saved.row.next_due_on ?? null,
      notes: saved.row.notes ?? null,
      document_id: documentId,
      has_photo: Boolean(documentId),
    });
  } catch {
    return fleetJson(503, { ok: false, error: "Could not save the monthly inspection." });
  }
}
