// Photo Studio — pure rules (no I/O). Shared by the server, the UI and tests.
//
// Every car gets the same template shot set. Each shot is AI-generated from
// that car's own originals, and nothing generated reaches the team board or
// the public site until a person approves the car's whole set.

export const PHOTO_STUDIO_KEY = "photo_studio";
export const ORIGINALS_BUCKET = "vehicle-originals";
export const MARKETING_BUCKET = "vehicle-photos";

export const EXTERIOR_SLOTS = ["front", "driver_side", "passenger_side", "rear"] as const;
export const INTERIOR_SLOTS = ["interior_1", "interior_2", "interior_3"] as const;
export const SHOT_SLOTS = [...EXTERIOR_SLOTS, ...INTERIOR_SLOTS] as const;
export type ShotSlot = (typeof SHOT_SLOTS)[number];

export const SLOT_LABELS: Record<ShotSlot, string> = {
  front: "Front 3/4", driver_side: "Driver side", passenger_side: "Passenger side", rear: "Rear 3/4",
  interior_1: "Dashboard", interior_2: "Front seats", interior_3: "Rear seats",
};

/** The fixed template. Every car is framed the same way. */
export const SLOT_TEMPLATE: Record<ShotSlot, string> = {
  front: "front three-quarter view from the driver-side front corner, camera at headlight height, 35mm lens, whole car in frame",
  driver_side: "exact side profile of the driver (left) side, camera at door-handle height, whole car centered",
  passenger_side: "exact side profile of the passenger (right) side, camera at door-handle height, whole car centered",
  rear: "rear three-quarter view from the passenger-side rear corner, camera at taillight height, whole car in frame",
  interior_1: "dashboard and steering wheel from the rear seat center, eye level",
  interior_2: "front seats from the open driver door, eye level",
  interior_3: "rear bench from the open rear door, eye level",
};

export type PhotoClass =
  | "exterior_front" | "exterior_rear" | "exterior_driver" | "exterior_passenger" | "exterior_other"
  | "interior_dash" | "interior_front" | "interior_rear" | "interior_other"
  | "damage" | "document" | "odometer" | "vin_plate" | "unknown";

/** Labels staff pick on an original. The values are the photo_class set. */
export const PHOTO_CLASS_OPTIONS: { value: PhotoClass; label: string }[] = [
  { value: "exterior_front", label: "Front 3/4" },
  { value: "exterior_driver", label: "Driver Side" },
  { value: "exterior_passenger", label: "Passenger Side" },
  { value: "exterior_rear", label: "Rear 3/4" },
  { value: "interior_dash", label: "Dashboard" },
  { value: "interior_front", label: "Front Seats" },
  { value: "interior_rear", label: "Rear Seats" },
  { value: "exterior_other", label: "Other Exterior" },
  { value: "interior_other", label: "Other Interior" },
  { value: "damage", label: "Damage" },
  { value: "document", label: "Document" },
  { value: "odometer", label: "Odometer" },
  { value: "vin_plate", label: "VIN" },
  { value: "unknown", label: "Unknown" },
];

export function photoClassLabel(value: string | null | undefined): string {
  return PHOTO_CLASS_OPTIONS.find((o) => o.value === value)?.label ?? "Unknown";
}

/** Postgres / PostgREST when photo_class has not been migrated yet. */
export function isMissingPhotoClassColumn(message: string | null | undefined): boolean {
  const m = String(message ?? "");
  return /photo_class/i.test(m) && /column|schema cache|does not exist/i.test(m);
}

/**
 * Replacing a live marketing shot. Rejecting it while it is still published
 * trips vehicle_media_enhanced_unpublished; the unique slot index then
 * refuses the new row. Unpublish and reject in the same write.
 */
export const RETIRE_LIVE_SHOT = {
  published: false as const,
  studio_review_status: "rejected" as const,
  approved_by: null,
  approved_at: null,
};

/** Same rule as the vehicle_media marketing publish trigger. */
export function marketingPublishBlock(row: {
  kind?: string | null;
  published?: boolean | null;
  studio_review_status?: string | null;
  approved_by?: string | null;
}): string | null {
  if (row.kind && row.kind !== "marketing") return null;
  if (row.published && !(row.studio_review_status === "approved" && row.approved_by)) {
    return "marketing shot cannot be published before a person approves it";
  }
  return null;
}

/** The approved Front 3/4 shot, if the set has one. */
export function leadMarketingShotId(shots: { id: string; slot: string | null; status: string | null }[]): string | null {
  return shots.find((s) => s.slot === "front" && s.status === "approved")?.id ?? null;
}

/** Which original classes may inspire a slot, best first. */
export const SLOT_SOURCES: Record<ShotSlot, PhotoClass[]> = {
  front: ["exterior_front", "exterior_driver", "exterior_passenger", "exterior_other"],
  driver_side: ["exterior_driver", "exterior_front", "exterior_rear", "exterior_other"],
  passenger_side: ["exterior_passenger", "exterior_front", "exterior_rear", "exterior_other"],
  rear: ["exterior_rear", "exterior_driver", "exterior_passenger", "exterior_front", "exterior_other"],
  interior_1: ["interior_dash", "interior_front", "interior_other"],
  interior_2: ["interior_front", "interior_dash", "interior_other"],
  interior_3: ["interior_rear", "interior_front", "interior_other"],
};

/** Never generated from, never shown as marketing. Damage stays evidence. */
export const NEVER_GENERATE: ReadonlySet<PhotoClass> = new Set(["damage", "document", "odometer", "vin_plate", "unknown"]);

export type Original = { id: string; photoClass: PhotoClass; createdAt?: string };
export type SlotPlan = { slot: ShotSlot; sources: string[]; inferred: boolean };

/** Map a car's originals onto the template. Slots with no exact source are
 * "inferred" (generated from other angles) and labelled so in review. */
export function planShots(originals: Original[], maxSourcesPerSlot = 2): SlotPlan[] {
  const usable = originals.filter((o) => !NEVER_GENERATE.has(o.photoClass));
  const plans: SlotPlan[] = [];
  for (const slot of SHOT_SLOTS) {
    const order = SLOT_SOURCES[slot];
    const ranked = usable
      .filter((o) => order.includes(o.photoClass))
      .sort((a, b) => order.indexOf(a.photoClass) - order.indexOf(b.photoClass));
    if (ranked.length === 0) continue;
    const isInterior = (INTERIOR_SLOTS as readonly string[]).includes(slot);
    // Interior slots beyond the first need their own exact source; we never
    // invent a rear bench from a dashboard photo.
    if (isInterior && slot !== "interior_1" && ranked[0].photoClass !== order[0]) continue;
    plans.push({ slot, sources: ranked.slice(0, maxSourcesPerSlot).map((o) => o.id), inferred: ranked[0].photoClass !== order[0] });
  }
  return plans;
}

/** Florida outdoor listing scenes. Every one has palms and no houses. */
export type PhotoStudioScene = { id: string; name: string; background: string };

export const PHOTO_STUDIO_SCENES: readonly PhotoStudioScene[] = [
  { id: "shopping_plaza", name: "Shopping Plaza", background: "bright midday daylight, a clean Florida shopping-plaza parking lot with tall palm trees and a beige stucco plaza behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "office_park", name: "Glass Office Park", background: "late-morning daylight, a clean Florida office-park parking lot with tall palm trees and a modern glass-front office building behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "boulevard", name: "Palm Boulevard", background: "bright afternoon daylight, a palm-lined Florida commercial boulevard, the car parked at a clean curb with tall palm trees and low storefronts behind, asphalt and a painted curb" },
  { id: "spanish_tile", name: "Tile-Roof Retail", background: "warm late-afternoon daylight, a clean Florida retail-center parking lot with tall palm trees and a Spanish tile roof on the shops behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "marina", name: "Marina Lot", background: "clear morning daylight, a clean Florida waterfront marina parking lot with tall palm trees and calm water behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "covered_walkway", name: "Covered Walkway", background: "bright daylight with soft shade from a covered walkway, a clean Florida plaza parking lot with tall palm trees and a beige covered walkway behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "car_lot", name: "Outdoor Car Lot", background: "high-noon daylight, a clean Florida outdoor car lot with tall palm trees and a plain white commercial building behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "grocery_plaza", name: "Grocery Plaza", background: "early-afternoon daylight, a clean Florida grocery-plaza parking lot with tall palm trees and a low beige canopy behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "hotel_entrance", name: "Hotel Entrance", background: "golden late-day daylight, a clean Florida hotel arrival court with tall palm trees and a wide porte-cochère on a pale stucco commercial facade, the car parked on a paved court" },
  { id: "waterfront_promenade", name: "Waterfront Promenade", background: "soft morning daylight, a clean Florida parking lot beside a commercial waterfront promenade with tall palm trees and open water beyond, the car parked in a stall on asphalt with white stall lines" },
  { id: "bank_plaza", name: "Bank Plaza", background: "crisp midday daylight, a clean Florida bank-plaza parking lot with tall palm trees and a low white bank building behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "outlet_row", name: "Outlet Row", background: "hazy bright afternoon daylight, a clean Florida outlet-row parking lot with tall palm trees and a single-story storefront row behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "medical_plaza", name: "Medical Plaza", background: "cool late-morning daylight, a clean Florida medical-plaza parking lot with tall palm trees and a pale office building behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "convention_drive", name: "Convention Drive", background: "harsh high-noon daylight, a wide Florida drive in front of a convention center with tall palm trees along the curb, the car parked in a marked stall on asphalt" },
  { id: "restaurant_row", name: "Restaurant Row", background: "warm early-evening daylight, a clean Florida restaurant-row parking lot with tall palm trees and blank awnings on the shops behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "garage_apron", name: "Garage Apron", background: "pale morning daylight, an open Florida parking apron in front of a commercial parking garage with tall palm trees, the car parked in a stall on asphalt with white stall lines" },
  { id: "beachfront_shops", name: "Beachfront Shops", background: "brilliant morning daylight, a clean Florida lot in front of beachfront shops with tall palm trees and distant sand and water, the car parked in a stall on asphalt with white stall lines" },
  { id: "service_center", name: "Service Center", background: "bright overcast daylight, a clean Florida auto service-center lot with tall palm trees and a white service building behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "palm_courtyard", name: "Palm Courtyard", background: "dappled midday daylight, an open Florida commercial courtyard with tall palm trees and a stucco arcade behind, the car parked on clean pavers" },
  { id: "ferry_lot", name: "Ferry Lot", background: "clear early-morning daylight, a clean Florida ferry-terminal parking lot with tall palm trees and a small terminal and water behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "stadium_lot", name: "Stadium Lot", background: "late-morning daylight, the near edge of a Florida stadium parking lot with tall palm trees and a distant grandstand, the car parked in an empty stall on asphalt with white stall lines" },
  { id: "cell_phone_lot", name: "Cell Phone Lot", background: "bright afternoon daylight, a clean Florida airport cell-phone waiting lot with tall palm trees and a distant terminal, the car parked in a stall on asphalt with white stall lines" },
  { id: "commerce_park", name: "Commerce Park", background: "early-afternoon daylight, a clean Florida commerce-park lot with tall palm trees and low commercial buildings behind, the car parked in a stall on asphalt with white stall lines" },
  { id: "boardwalk_lot", name: "Boardwalk Lot", background: "soft late-afternoon daylight, a clean Florida lot beside a commercial boardwalk with tall palm trees and water beyond, the car parked in a stall on asphalt with white stall lines" },
  { id: "transit_plaza", name: "Transit Plaza", background: "midday daylight under high thin clouds, a clean Florida transit-plaza parking lot with tall palm trees and a simple canopy behind, the car parked in a stall on asphalt with white stall lines" },
];

/** Same vehicle always gets the same scene. Different ids spread across the list. */
export function pickScene(vehicleId: string): PhotoStudioScene {
  let h = 2166136261;
  const id = vehicleId ?? "";
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PHOTO_STUDIO_SCENES[(h >>> 0) % PHOTO_STUDIO_SCENES.length];
}

/** Isolate on grey, then place that cutout in the scene. Two paid image calls. */
export const PHOTO_STUDIO_GENERATIONS_PER_SHOT = 2;

type PromptCar = { id?: string | null; year?: number | null; make?: string | null; model?: string | null; color?: string | null };

function vehicleName(car: PromptCar): string {
  const name = [car.year, car.color, car.make, car.model].filter(Boolean).join(" ");
  return name ? ` (${name})` : "";
}

const VEHICLE_FIDELITY = [
  "Keep identical: true paint color and brightness, the same wheels and hubcaps, trim, existing badges, body shape, interior materials and colors, real details such as a roof antenna when one is present, and the license plate text exactly as shown.",
  "Do NOT add badges or parts. Do NOT add, remove or repair anything: no new wheels, no body kits, no removed scratches or dents beyond light cleaning, no extra accessories.",
  "If a detail is not visible in the references, keep it plain and factory-standard rather than inventing it.",
].join("\n");

/** First pass: lift the car off its real surroundings onto plain grey. */
export function buildIsolationPrompt(slot: ShotSlot, car: PromptCar): string {
  return [
    `Isolate THIS EXACT vehicle${vehicleName(car)} from the reference photos. Return only the car on a plain seamless neutral grey background.`,
    `Framing: ${SLOT_TEMPLATE[slot]}. Output 1024x768 landscape.`,
    "Completely replace the original surroundings with flat neutral grey. No plaza, no trees, no houses or residential homes, no people, no lettering, no logos, no other cars.",
    VEHICLE_FIDELITY,
  ].join("\n");
}

export function buildPrompt(slot: ShotSlot, car: PromptCar): string {
  return [
    `Place THIS EXACT vehicle${vehicleName(car)} into the scene as a realistic outdoor listing photo. The reference is the car already isolated on grey; do not bring back the original surroundings.`,
    `Framing: ${SLOT_TEMPLATE[slot]}.`,
    `Background: ${pickScene(car.id ?? "").background}. Natural shadows matching the sun. Eye-level, photoreal like a phone photo, 1024x768 landscape.`,
    "Completely replace the original surroundings. No houses or residential homes. Sign bands stay blank: no lettering, logos, or readable text anywhere. No people. No other readable plates. Other cars only far back and blurred, if any.",
    VEHICLE_FIDELITY,
  ].join("\n");
}

// ---------------------------------------------------------------- settings

export type PhotoStudioSettings = {
  enabled: boolean;
  dailyImageLimit: number;
  monthlyCapCents: number;
  provider: "gemini" | "mock";
  model: string;
  version: number;
};

export const PHOTO_STUDIO_DEFAULTS: PhotoStudioSettings = {
  enabled: false, dailyImageLimit: 60, monthlyCapCents: 10000, provider: "gemini", model: "gemini-2.5-flash-image", version: 0,
};

/** Gemini 2.5 Flash Image is shut down on 2027-03-15; its successor. */
export const GEMINI_MODELS = {
  "gemini-2.5-flash-image": { costCents: 3.9, retiresOn: "2027-03-15" },
  "gemini-3.1-flash-lite-image": { costCents: 4.2, retiresOn: null },
} as const;

export function readStudioSettings(v: unknown): PhotoStudioSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const num = (x: unknown, d: number, max: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.min(x, max) : d);
  return {
    enabled: o.enabled === true,
    dailyImageLimit: num(o.dailyImageLimit, PHOTO_STUDIO_DEFAULTS.dailyImageLimit, 500),
    monthlyCapCents: num(o.monthlyCapCents, PHOTO_STUDIO_DEFAULTS.monthlyCapCents, 100000),
    provider: o.provider === "mock" ? "mock" : "gemini",
    model: typeof o.model === "string" && o.model in GEMINI_MODELS ? o.model : PHOTO_STUDIO_DEFAULTS.model,
    version: num(o.version, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** Use the successor model automatically once the old one is past retirement. */
export function effectiveModel(s: PhotoStudioSettings, today: string): string {
  const m = GEMINI_MODELS[s.model as keyof typeof GEMINI_MODELS];
  if (m?.retiresOn && today >= m.retiresOn) return "gemini-3.1-flash-lite-image";
  return s.model;
}

export function costCentsFor(model: string): number {
  return GEMINI_MODELS[model as keyof typeof GEMINI_MODELS]?.costCents ?? 10;
}

/** Fails closed. Returns why a run of `images` generations may not start. */
export function spendRefusal(
  s: PhotoStudioSettings, usage: { todayImages: number; monthCents: number }, images: number, model: string,
): string | null {
  if (!s.enabled) return "Photo Studio is off.";
  if (images <= 0) return "Nothing to generate.";
  if (usage.todayImages + images > s.dailyImageLimit) return `Daily limit reached (${s.dailyImageLimit} images).`;
  const projected = usage.monthCents + images * costCentsFor(model);
  if (projected > s.monthlyCapCents) return `Monthly cap of $${(s.monthlyCapCents / 100).toFixed(2)} would be exceeded.`;
  return null;
}

// ---------------------------------------------------------- re-read check

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * After generation the image is read again. A shot that shows a plate or VIN
 * belonging to a different car — or a garbled plate — is rejected and never
 * stored. A shot where nothing is legible passes (most side/interior views).
 */
export function identityCheck(
  car: { plate?: string | null; vin?: string | null },
  read: { plates: string[]; vins: string[] },
): { ok: true } | { ok: false; reason: string } {
  const plate = norm(car.plate);
  const vin = norm(car.vin);
  for (const p of read.plates.map(norm).filter((x) => x.length >= 4)) {
    if (!plate || p !== plate) return { ok: false, reason: `Generated plate "${p}" does not match ${plate || "the car (no plate on file)"}` };
  }
  for (const v of read.vins.map(norm).filter((x) => x.length >= 11)) {
    if (!vin || (v.length === 17 ? v !== vin : !vin.endsWith(v))) return { ok: false, reason: "Generated VIN does not match the car" };
  }
  return { ok: true };
}

// ------------------------------------------------------------- approval

export type MarketingShot = { id: string; slot: ShotSlot; status: "pending" | "approved" | "rejected" };

/** A car is ready when all four exterior slots have an approved shot. */
export function carSetStatus(shots: MarketingShot[]): "none" | "pending" | "approved" | "incomplete" {
  const live = shots.filter((s) => s.status !== "rejected");
  if (live.length === 0) return "none";
  if (live.some((s) => s.status === "pending")) return "pending";
  const have = new Set(live.filter((s) => s.status === "approved").map((s) => s.slot));
  return EXTERIOR_SLOTS.every((s) => have.has(s)) ? "approved" : "incomplete";
}

export const vinLast6 = (vin: string | null | undefined) => norm(vin).slice(-6) || null;
