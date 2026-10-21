// Return closeout captured when a manager ends a rental.
//
// The constant stays false until the proposed SQL is installed. While it is
// false the End Rental dialog does not mount this checklist, and the server
// refuses before it reads or writes anything.

export const RETURN_CHECKLIST_ENABLED = false;

/** Existing private bucket. public = false. No public URL is ever stored. */
export const RETURN_PHOTO_BUCKET = "condition-media";

export const FUEL_OR_CHARGE_LEVELS = [
  { id: "empty", label: "Empty" },
  { id: "quarter", label: "One Quarter" },
  { id: "half", label: "Half" },
  { id: "three_quarter", label: "Three Quarters" },
  { id: "full", label: "Full" },
] as const;

export type FuelOrCharge = (typeof FUEL_OR_CHARGE_LEVELS)[number]["id"];

export const RETURN_DAMAGE_ITEMS = [
  { area: "exterior", key: "body", label: "Body" },
  { area: "exterior", key: "glass", label: "Glass" },
  { area: "exterior", key: "lights", label: "Lights" },
  { area: "exterior", key: "tires", label: "Tires" },
  { area: "exterior", key: "mirrors", label: "Mirrors" },
  { area: "interior", key: "seats", label: "Seats" },
  { area: "interior", key: "dashboard", label: "Dashboard" },
  { area: "interior", key: "cargo", label: "Cargo Area" },
  { area: "interior", key: "odor", label: "Odor" },
] as const;

export type DamageResult = "ok" | "damage" | "na";

export type ReturnDamageMark = {
  key: string;
  area: "exterior" | "interior";
  label: string;
  result: DamageResult;
  notes: string;
};

export type ReturnPhotoRef = {
  bucket: typeof RETURN_PHOTO_BUCKET;
  path: string;
  angle: string;
};

export type ReturnChecklistDraft = {
  returnedAtEt: string;
  odometer: string;
  fuelOrCharge: string;
  items: ReturnDamageMark[];
  keysReturned: boolean | null;
  tollsTicketsNote: string;
  depositDecisionNeeded: boolean | null;
  depositDecisionNote: string;
  photos: ReturnPhotoRef[];
};

export type ReturnChecklistRecord = {
  returnedAt: string;
  odometer: number;
  fuelOrCharge: FuelOrCharge;
  items: ReturnDamageMark[];
  keysReturned: boolean;
  tollsTicketsNote: string | null;
  depositDecisionNeeded: boolean;
  depositDecisionNote: string | null;
  photos: ReturnPhotoRef[];
};

const FUEL_IDS = new Set<string>(FUEL_OR_CHARGE_LEVELS.map((level) => level.id));
const ITEM_KEYS = new Set<string>(RETURN_DAMAGE_ITEMS.map((item) => item.key));

export function emptyReturnChecklist(now = new Date()): ReturnChecklistDraft {
  return {
    returnedAtEt: etWallTime(now),
    odometer: "",
    fuelOrCharge: "",
    items: RETURN_DAMAGE_ITEMS.map((item) => ({
      key: item.key,
      area: item.area,
      label: item.label,
      result: "na",
      notes: "",
    })),
    keysReturned: null,
    tollsTicketsNote: "",
    depositDecisionNeeded: null,
    depositDecisionNote: "",
    photos: [],
  };
}

/** Clock time in America/New_York as YYYY-MM-DDTHH:mm, for the datetime field. */
export function etWallTime(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = String(Number(pick("hour")) % 24).padStart(2, "0");
  return `${pick("year")}-${pick("month")}-${pick("day")}T${hour}:${pick("minute")}`;
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour") % 24, pick("minute"), pick("second"));
  return asUtc - instant.getTime();
}

/** Interpret a datetime-local value as Eastern Time and return a UTC instant. */
export function etWallTimeToIso(wall: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const first = new Date(guess.getTime() - zoneOffsetMs(guess, "America/New_York"));
  const instant = new Date(guess.getTime() - zoneOffsetMs(first, "America/New_York"));
  if (Number.isNaN(instant.getTime())) return null;
  return instant.toISOString();
}

export function isPrivateReturnPhoto(vehicleId: string, photo: { bucket: string; path: string }): boolean {
  if (photo.bucket !== RETURN_PHOTO_BUCKET) return false;
  if (!vehicleId || photo.path.includes("..") || photo.path.includes("://")) return false;
  return photo.path.startsWith(`${vehicleId}/`);
}

export function buildReturnChecklist(vehicleId: string, draft: ReturnChecklistDraft): ReturnChecklistRecord {
  const returnedAt = etWallTimeToIso(draft.returnedAtEt);
  if (!returnedAt) throw new Error("Enter the return date and time in Eastern Time.");
  const odometer = Number(String(draft.odometer).replace(/[^\d]/g, ""));
  if (!Number.isInteger(odometer) || odometer < 0 || odometer > 2_000_000) {
    throw new Error("Enter the return odometer.");
  }
  if (!FUEL_IDS.has(draft.fuelOrCharge)) throw new Error("Choose the fuel or charge level.");
  if (draft.keysReturned == null) throw new Error("Record whether the keys were returned.");
  if (draft.depositDecisionNeeded == null) throw new Error("Record whether a deposit decision is needed.");
  const items = RETURN_DAMAGE_ITEMS.map((spec) => {
    const mark = draft.items.find((item) => item.key === spec.key);
    const result = mark?.result ?? "na";
    if (result !== "ok" && result !== "damage" && result !== "na") throw new Error("Choose a result for each checklist item.");
    return {
      key: spec.key,
      area: spec.area,
      label: spec.label,
      result,
      notes: (mark?.notes ?? "").trim().slice(0, 500),
    };
  });
  if (draft.items.some((item) => !ITEM_KEYS.has(item.key))) throw new Error("Unknown checklist item.");
  const photos = draft.photos.map((photo) => {
    if (!isPrivateReturnPhoto(vehicleId, photo)) throw new Error("A return photo must stay in the private condition bucket.");
    return { bucket: RETURN_PHOTO_BUCKET as typeof RETURN_PHOTO_BUCKET, path: photo.path, angle: photo.angle.slice(0, 40) };
  });
  const tolls = draft.tollsTicketsNote.trim().slice(0, 2000);
  const depositNote = draft.depositDecisionNote.trim().slice(0, 2000);
  return {
    returnedAt,
    odometer,
    fuelOrCharge: draft.fuelOrCharge as FuelOrCharge,
    items,
    keysReturned: draft.keysReturned,
    tollsTicketsNote: tolls || null,
    depositDecisionNeeded: draft.depositDecisionNeeded,
    depositDecisionNote: depositNote || null,
    photos,
  };
}

/** What the End Rental dialog is allowed to add. False keeps the dialog as it is. */
export function returnChecklistVisible(enabled: boolean): boolean {
  return enabled === true;
}
