/**
 * FLEET adds to a rental's records (Dolmar, 11/27 7:29 PM ET, with the
 * expense API):
 *
 *   POST  /api/public/fleet/rental-inspection-photo   one Pickup or Return photo, "Ours"
 *   PATCH /api/public/fleet/rental-pickup-odometer    set the pickup odometer (POST is accepted too)
 *
 * Bearer FLEET_API_KEY. Both are Off until Automations → Rental Records
 * (FLEET) (fleet_rental_records) is On. Audited as "FLEET (automated)". Neither
 * sends anything to the renter, and neither touches payments, billing, rental
 * status, the vehicle or the driver.
 *
 * Photo: stored exactly like a staff upload on the driver's Pickup / Return
 * tab (condition-media bucket, one condition_media row, captured_by_role
 * "staff" so it shows under Ours, taken-at from the photo's EXIF). The
 * original keeps its GPS for staff; the renter-facing share copy is rebuilt
 * with all metadata (including GPS) removed, or the renter sees the entry
 * without the file (HEIC, oversize). No notification is sent.
 *
 * Pickup odometer: a rental's pickup mileage is the odometer_readings row
 * rentals.pickup_reading_id points at, and a reading is never edited. A change
 * adds a correcting reading (source rental_checkout), marks the old one
 * superseded and repoints the rental, the same way a staff correction works. A
 * lower number than the one on file needs force: true and a note.
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
import { fleetVehicleRef, type FleetVehicleRow } from "@/lib/fleet-vehicle-lookup.server";
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";
import { businessToday } from "@/lib/vehicle-maintenance";
import {
  FLEET_RENTAL_RECORDS_KEY,
  INSPECTION_STAGES,
  parseInspectionLabel,
  parseInspectionStage,
  parsePickupOdometer,
} from "@/lib/fleet-expenses";
import { CONDITION_BUCKET_NAME } from "@/lib/trip-media-bucket";
import { sniffMediaType, tripMediaPrefix, TRIP_MEDIA_TYPES } from "@/lib/trip-media";

type Admin = any;

export const FLEET_INSPECTION_PHOTO_ACTION = "fleet.rental_inspection_photo";
export const FLEET_PICKUP_ODOMETER_ACTION = "fleet.rental_pickup_odometer";
export const INSPECTION_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const ODOMETER_HISTORY_TOLERANCE = 500;

export type RentalRecordsDeps = FleetDeps & {
  gate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  today?: () => string;
  /** The staff save step for a stored original; injectable for tests. */
  store?: (admin: Admin, args: any) => Promise<{ id: string; missingExifTime: boolean; sharePreview: boolean }>;
};

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}

async function gateWrites(admin: Admin, deps: RentalRecordsDeps): Promise<Response | null> {
  const gate = await (deps.gate ?? defaultGate)(admin, FLEET_RENTAL_RECORDS_KEY).catch(() => "held" as const);
  if (gate === "off")
    return fleetJson(409, { ok: false, error: "The Rental Records (FLEET) switch is Off (Back Office → Automations). Nothing was saved.", reason: "switched_off" });
  if (gate !== "send")
    return fleetJson(503, { ok: false, error: "Automation switches could not be read; try again later. Nothing was saved.", reason: "controls_unreadable" });
  return null;
}

async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

async function priorAudit(admin: Admin, action: string, col: string, val: string) {
  const res = await admin.from("audit_log").select("entity_id,metadata").eq("action", action).eq(col, val).limit(5);
  if (res.error) throw new Error("audit_unreadable");
  return (res.data ?? []) as Array<{ entity_id: string | null; metadata: any }>;
}

const RENTAL_COLUMNS = "id,vehicle_id,driver_id,application_id,status,start_date,pickup_reading_id,return_reading_id";

async function loadRental(admin: Admin, body: Record<string, any>): Promise<{ rental: any; vehicle: FleetVehicleRow } | { response: Response }> {
  const id = body.rental_id == null ? "" : String(body.rental_id);
  if (!UUID_RE.test(id)) return { response: fleetJson(400, { ok: false, error: "rental_id must be a UUID." }) };
  const res = await admin.from("rentals").select(RENTAL_COLUMNS).eq("id", id).maybeSingle();
  if (res.error) return { response: fleetJson(503, { ok: false, error: "Could not read the rental." }) };
  if (!res.data) return { response: fleetJson(404, { ok: false, error: "Rental not found." }) };
  const status = String(res.data.status ?? "").toLowerCase();
  if (status === "cancelled" || status === "canceled")
    return { response: fleetJson(409, { ok: false, error: "This rental was cancelled. Nothing was saved." }) };
  if (!res.data.vehicle_id) return { response: fleetJson(409, { ok: false, error: "This rental has no vehicle yet. Nothing was saved." }) };
  const v = await admin.from("vehicles").select("id,license_plate,vin,archived_at").eq("id", res.data.vehicle_id).maybeSingle();
  if (v.error || !v.data) return { response: fleetJson(503, { ok: false, error: "Could not read the rental's vehicle." }) };
  return { rental: res.data, vehicle: v.data };
}

async function defaultStore(admin: Admin, args: any) {
  const { storeConditionMedia } = await import("@/lib/trip-media.server");
  return storeConditionMedia(admin, args);
}

// ------------------------------------------------------------------ photo

export async function handleFleetInspectionPhoto(request: Request, deps: RentalRecordsDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  const admin = await fleetAdmin(deps);
  const blocked = await gateWrites(admin, deps);
  if (blocked) return blocked;
  const audit = fleetAudit(deps);

  const stage = parseInspectionStage(body.stage);
  if (!stage.ok) return fleetJson(stage.status, { ok: false, error: stage.error });
  const label = parseInspectionLabel(body.label);
  if (!label.ok) return fleetJson(label.status, { ok: false, error: label.error });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });

  if (typeof body.content_base64 === "string" && body.content_base64.length > Math.ceil(INSPECTION_PHOTO_MAX_BYTES / 3) * 4 + 200)
    return fleetJson(413, { ok: false, error: "The photo is over 20 MB. Nothing was saved." });
  const bytes = decodeBase64(body.content_base64);
  if (!bytes || !bytes.length) return fleetJson(400, { ok: false, error: "content_base64 must be the photo, base64-encoded." });
  if (bytes.length > INSPECTION_PHOTO_MAX_BYTES) return fleetJson(413, { ok: false, error: "The photo is over 20 MB. Nothing was saved." });
  const mime = sniffMediaType(bytes);
  if (!mime || TRIP_MEDIA_TYPES[mime] !== "photo")
    return fleetJson(415, { ok: false, error: "Only JPEG, PNG, WebP or HEIC photos are accepted. Nothing was saved." });
  const sha = await sha256Hex(bytes);

  const found = await loadRental(admin, body);
  if ("response" in found) return found.response;
  const { rental, vehicle } = found;
  const phase = INSPECTION_STAGES[stage.value];

  const sameRequest = (m: any) =>
    m.rental_id === rental.id && m.stage === stage.value && m.sha256 === sha && m.label === label.value.label;
  try {
    if (idem) {
      const hit = (await priorAudit(admin, FLEET_INSPECTION_PHOTO_ACTION, "metadata->>idempotency_key", idem))[0];
      if (hit) {
        const m = hit.metadata ?? {};
        if (!sameRequest(m))
          return fleetJson(409, { ok: false, error: "idempotency_key was already used for a different photo. Nothing was saved.", reason: "idempotency_key_reused" });
        return fleetJson(200, { ok: true, duplicate: true, matched_by: "idempotency_key", ...photoOut(rental, vehicle, stage.value, label.value.label, m.photo_id ?? hit.entity_id, m.mime_type, m.renter_preview) });
      }
    }
    const same = (await priorAudit(admin, FLEET_INSPECTION_PHOTO_ACTION, "metadata->>sha256", sha)).find((r) => r.metadata?.rental_id === rental.id && r.metadata?.stage === stage.value);
    if (same)
      return fleetJson(200, { ok: true, duplicate: true, matched_by: "content", ...photoOut(rental, vehicle, stage.value, same.metadata?.label ?? label.value.label, same.metadata?.photo_id ?? same.entity_id, same.metadata?.mime_type, same.metadata?.renter_preview) });
  } catch {
    return fleetJson(503, { ok: false, error: "Could not check for an earlier copy. Nothing was saved." });
  }

  const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" } as Record<string, string>)[mime];
  // Same folder rule as a staff trip upload: <vehicle>/trip/<application>/<rental>/<phase>-<uuid>.<ext>
  const path = `${tripMediaPrefix(rental.vehicle_id, rental.application_id ?? "no-application", rental.id)}${phase}-${crypto.randomUUID()}.${ext}`;
  const up = await admin.storage.from(CONDITION_BUCKET_NAME).upload(path, bytes, { contentType: mime, upsert: false });
  if (up?.error) return fleetJson(503, { ok: false, error: "Could not store the photo. Nothing was saved." });

  let saved: { id: string; missingExifTime: boolean; sharePreview: boolean };
  try {
    saved = await (deps.store ?? defaultStore)(admin, {
      vehicleId: rental.vehicle_id,
      rentalId: rental.id,
      applicationId: rental.application_id ?? null,
      inspectionId: null,
      phase,
      angle: label.value.angle,
      path,
      fileName: cleanText(body.file_name, 200).replace(/[\\/\u0000-\u001f]/g, "_") || `${stage.value}-photo.${ext}`,
      mimeType: mime,
      sizeBytes: bytes.length,
      caption: label.value.label,
      capturedBy: null,
      capturedByRole: "staff",
    });
  } catch {
    await admin.storage.from(CONDITION_BUCKET_NAME).remove([path, `${path}.share`]).catch(() => undefined);
    return fleetJson(503, { ok: false, error: "Could not save the photo. Nothing was saved." });
  }

  await audit({
    action: FLEET_INSPECTION_PHOTO_ACTION,
    summary: `${FLEET_ACTOR_LABEL} added a ${stage.value} photo (${label.value.label}) to a rental. Renter not notified.`.slice(0, 300),
    entityType: "rental",
    entityId: rental.id,
    metadata: {
      actor: FLEET_ACTOR_LABEL,
      rental_id: rental.id,
      vehicle_id: rental.vehicle_id,
      photo_id: saved.id,
      stage: stage.value,
      phase,
      label: label.value.label,
      sha256: sha,
      mime_type: mime,
      size_bytes: bytes.length,
      renter_preview: saved.sharePreview,
      idempotency_key: idem,
    },
  });
  return fleetJson(201, { ok: true, duplicate: false, ...photoOut(rental, vehicle, stage.value, label.value.label, saved.id, mime, saved.sharePreview), taken_at_from_photo: !saved.missingExifTime, renter_notified: false });
}

function photoOut(rental: any, vehicle: FleetVehicleRow, stage: string, label: string, photoId: string | null, mime: string | null, renterPreview: boolean | null) {
  return {
    photo_id: photoId,
    rental_id: rental.id as string,
    ...fleetVehicleRef(vehicle),
    stage,
    label,
    shown_as: "Ours",
    mime_type: mime ?? null,
    renter_preview: renterPreview === true,
  };
}

// --------------------------------------------------------------- odometer

export async function handleFleetPickupOdometer(request: Request, deps: RentalRecordsDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps, ["PATCH", "POST"]);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  const admin = await fleetAdmin(deps);
  const blocked = await gateWrites(admin, deps);
  if (blocked) return blocked;
  const audit = fleetAudit(deps);

  const odo = parsePickupOdometer(body.odometer);
  if (!odo.ok) return fleetJson(odo.status, { ok: false, error: odo.error });
  if (body.force != null && typeof body.force !== "boolean") return fleetJson(400, { ok: false, error: "force must be true or false." });
  const force = body.force === true;
  const note = body.note == null || body.note === "" ? null : cleanText(body.note, 500);
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });

  const found = await loadRental(admin, body);
  if ("response" in found) return found.response;
  const { rental, vehicle } = found;
  const miles = odo.value;
  const refOut = { rental_id: rental.id as string, ...fleetVehicleRef(vehicle) };

  try {
    if (idem) {
      const hit = (await priorAudit(admin, FLEET_PICKUP_ODOMETER_ACTION, "metadata->>idempotency_key", idem))[0];
      if (hit) {
        const m = hit.metadata ?? {};
        if (m.rental_id !== rental.id || m.odometer !== miles)
          return fleetJson(409, { ok: false, error: "idempotency_key was already used for a different odometer change. Nothing was saved.", reason: "idempotency_key_reused" });
        return fleetJson(200, { ok: true, duplicate: true, matched_by: "idempotency_key", ...refOut, pickup_odometer: m.odometer, previous_odometer: m.previous ?? null, reading_id: m.reading_id ?? null, status: m.status ?? null });
      }
    }
  } catch {
    return fleetJson(503, { ok: false, error: "Could not check for an earlier change. Nothing was saved." });
  }

  // The reading on file now.
  let current: { id: string; mileage: number; observed_on: string; observed_at: string | null; status: string } | null = null;
  if (rental.pickup_reading_id) {
    const r = await admin.from("odometer_readings").select("id,mileage,observed_on,observed_at,status").eq("id", rental.pickup_reading_id).maybeSingle();
    if (r.error) return fleetJson(503, { ok: false, error: "Could not read the current pickup odometer. Nothing was saved." });
    current = r.data ?? null;
  }
  if (current && current.mileage === miles)
    return fleetJson(200, { ok: true, unchanged: true, ...refOut, pickup_odometer: miles, previous_odometer: miles, reading_id: current.id, status: current.status, note: "The pickup odometer already reads this. Nothing was changed." });

  const lowering = !!current && miles < current.mileage;
  if (lowering && !force)
    return fleetJson(409, { ok: false, error: `The pickup odometer on file is ${current!.mileage.toLocaleString("en-US")}. To lower it to ${miles.toLocaleString("en-US")}, send force: true with a note saying why. Nothing was saved.`, reason: "would_lower", pickup_odometer: current!.mileage });
  if (lowering && !note)
    return fleetJson(400, { ok: false, error: "A lower pickup odometer needs a note saying why. Nothing was saved." });

  // Pickup cannot be above the return reading on the same rental.
  if (rental.return_reading_id) {
    const r = await admin.from("odometer_readings").select("mileage").eq("id", rental.return_reading_id).maybeSingle();
    if (r.error) return fleetJson(503, { ok: false, error: "Could not read the return odometer. Nothing was saved." });
    if (r.data && miles > Number(r.data.mileage))
      return fleetJson(409, { ok: false, error: `The return odometer is ${Number(r.data.mileage).toLocaleString("en-US")}; pickup cannot be higher. Nothing was saved.`, reason: "above_return" });
  }

  const today = (deps.today ?? (() => businessToday()))();
  const startDate = typeof rental.start_date === "string" ? rental.start_date.slice(0, 10) : null;
  // The correction keeps the old reading's date; a first reading is dated the pickup day, never in the future.
  const observedOn = current?.observed_on ?? (startDate && startDate <= today ? startDate : today);
  // Against the vehicle's other valid readings dated on or before this one (the same rule the database
  // uses): a pickup more than 500 miles below one of those would be flagged a Conflict.
  const hist = await admin.from("odometer_readings").select("id,mileage,observed_on").eq("vehicle_id", rental.vehicle_id).eq("status", "valid").lte("observed_on", observedOn);
  if (hist.error) return fleetJson(503, { ok: false, error: "Could not read the vehicle's mileage history. Nothing was saved." });
  const top = ((hist.data ?? []) as Array<{ id: string; mileage: number }>).filter((r) => r.id !== current?.id).reduce((n, r) => Math.max(n, Number(r.mileage)), 0);
  const conflicts = miles + ODOMETER_HISTORY_TOLERANCE < top;
  if (conflicts && !force)
    return fleetJson(409, { ok: false, error: `The vehicle already has a valid reading of ${top.toLocaleString("en-US")} on or before that date, more than 500 miles above ${miles.toLocaleString("en-US")}. Check the number, or send force: true with a note. Nothing was saved.`, reason: "below_vehicle_history", highest_reading: top });
  if (conflicts && !note) return fleetJson(400, { ok: false, error: "A pickup odometer below the vehicle's history needs a note saying why. Nothing was saved." });

  const evidenceKey = idem ? `fleet:pickup:${idem}` : `fleet:pickup:${rental.id}:${miles}:${current?.id ?? "none"}`;

  // Retire the old reading first, so the new one is judged against the history without it
  // (the same order as a staff correction would need to avoid a false Conflict). Undone on any failure.
  const priorStatus = current?.status ?? null;
  const restoreOld = async () => {
    if (current && priorStatus) await admin.from("odometer_readings").update({ status: priorStatus }).eq("id", current.id);
  };
  if (current) {
    const sup = await admin.from("odometer_readings").update({ status: "superseded" }).eq("id", current.id);
    if (sup?.error) return fleetJson(503, { ok: false, error: "Could not retire the old pickup reading. Nothing was changed." });
  }
  const ins = await admin
    .from("odometer_readings")
    .insert({
      vehicle_id: rental.vehicle_id,
      mileage: miles,
      observed_on: observedOn,
      observed_at: current?.observed_at ?? null,
      source_type: "rental_checkout",
      source_id: rental.id,
      evidence_key: evidenceKey,
      note: [note, current ? `FLEET correction of ${current.mileage}` : "Set by FLEET"].filter(Boolean).join(" — ").slice(0, 500),
      entered_by: null,
      rental_id: rental.id,
      driver_id: rental.driver_id ?? null,
      supersedes_id: current?.id ?? null,
    })
    .select("id,status")
    .single();
  if (ins.error || !ins.data) {
    await restoreOld();
    if (/duplicate|unique/i.test(String(ins.error?.message ?? "")))
      return fleetJson(409, { ok: false, error: "This change was already applied (or is being applied). Read the rental and try again if needed.", reason: "already_applied" });
    return fleetJson(503, { ok: false, error: "Could not record the reading. Nothing was changed." });
  }
  const reading = ins.data as { id: string; status: string };

  let link = admin.from("rentals").update({ pickup_reading_id: reading.id }).eq("id", rental.id);
  link = current ? link.eq("pickup_reading_id", current.id) : link.is("pickup_reading_id", null);
  const linked = await link.select("id");
  if (linked.error || !(linked.data ?? []).length) {
    // Do not leave a live reading no rental points at.
    await admin.from("odometer_readings").update({ status: "superseded" }).eq("id", reading.id);
    await restoreOld();
    return fleetJson(409, { ok: false, error: "The rental's pickup odometer changed while this was running. Read it again and retry. Nothing was changed.", reason: "changed_concurrently" });
  }

  await audit({
    action: FLEET_PICKUP_ODOMETER_ACTION,
    summary: `${FLEET_ACTOR_LABEL} set a rental's pickup odometer to ${miles.toLocaleString("en-US")}${current ? ` (was ${current.mileage.toLocaleString("en-US")}${lowering ? ", lowered with force" : ""})` : ""}.`.slice(0, 300),
    entityType: "rental",
    entityId: rental.id,
    metadata: {
      actor: FLEET_ACTOR_LABEL,
      rental_id: rental.id,
      vehicle_id: rental.vehicle_id,
      odometer: miles,
      previous: current?.mileage ?? null,
      superseded_reading_id: current?.id ?? null,
      reading_id: reading.id,
      status: reading.status,
      forced: force && (lowering || conflicts),
      note,
      idempotency_key: idem,
    },
  });
  return fleetJson(200, {
    ok: true,
    ...refOut,
    pickup_odometer: miles,
    previous_odometer: current?.mileage ?? null,
    reading_id: reading.id,
    superseded_reading_id: current?.id ?? null,
    status: reading.status,
    ...(reading.status !== "valid" ? { warning: "The vehicle's mileage history has a higher reading, so this one is flagged Conflict for staff to review." } : {}),
  });
}
