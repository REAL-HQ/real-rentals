// Fleet Photo Studio progress and who may be generated or published.
// Pure: the server loads rows, these rules decide.
import { EXTERIOR_SLOTS, planShots, type PhotoClass } from "@/lib/photo-studio";
import { isUnlabeledClass } from "@/lib/photo-class-label";
import { isPublicHiddenVehicleStatus } from "@/lib/fleet-summary";

export type FleetShot = {
  slot: string | null;
  status: string | null;
  published: boolean;
  check: unknown;
};

export type FleetCarInput = {
  id: string;
  unitNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  status: string | null;
  archivedAt: string | null;
  originals: { photoClass: string | null }[];
  shots: FleetShot[];
};

export type FleetRow = {
  vehicleId: string;
  label: string;
  labeled: number;
  unknown: number;
  generated: number;
  approved: number;
  published: number;
  ready: boolean;
  needsWork: boolean;
  state: "Published" | "Ready" | "Continues Tomorrow" | "Needs Shots" | "No Photos";
};

/** For Sale, Archived, Retired, and Sold stay out of the run. */
export function isStudioFleetCar(car: { status?: string | null; archivedAt?: string | null }): boolean {
  if (car.archivedAt) return false;
  return !isPublicHiddenVehicleStatus(car.status);
}

/** A saved shot passed the re-read. Rejected shots never get here. */
export function shotPassedIdentity(check: unknown): boolean {
  if (!check || typeof check !== "object") return false;
  const read = (check as { read?: { ok?: boolean } }).read;
  return read?.ok === true;
}

const liveShots = (shots: FleetShot[]) => shots.filter((s) => s.status !== "rejected");

/** Complete exterior set, and every live shot (interiors included) passed identity. */
export function carReadyToPublish(shots: FleetShot[]): boolean {
  const live = liveShots(shots);
  if (!live.every((s) => shotPassedIdentity(s.check))) return false;
  return EXTERIOR_SLOTS.every((slot) => live.some((s) => s.slot === slot));
}

export function fleetCarLabel(car: { unitNumber?: string | null; year?: number | null; make?: string | null; model?: string | null }): string {
  const name = [car.year, car.make, car.model].filter(Boolean).join(" ");
  return car.unitNumber ? `${car.unitNumber} · ${name}` : name || "Car";
}

export function fleetRow(car: FleetCarInput, dailyBlocked: boolean): FleetRow | null {
  if (!isStudioFleetCar(car)) return null;
  const live = liveShots(car.shots);
  const labeled = car.originals.filter((o) => !isUnlabeledClass(o.photoClass)).length;
  const unknown = car.originals.length - labeled;
  const generated = live.length;
  const approved = live.filter((s) => s.status === "approved").length;
  const published = live.filter((s) => s.published).length;
  const ready = carReadyToPublish(car.shots);
  const planned = planShots(car.originals.map((o, i) => ({ id: String(i), photoClass: (o.photoClass ?? "unknown") as PhotoClass })));
  const liveSlots = new Set(live.map((s) => s.slot));
  const missingPlan = planned.some((p) => !liveSlots.has(p.slot));
  const needsShots = car.originals.length > 0 && (unknown > 0 || missingPlan);
  const allLivePublished = live.length > 0 && live.every((s) => s.published);
  let state: FleetRow["state"];
  if (car.originals.length === 0) state = "No Photos";
  else if (ready && allLivePublished) state = "Published";
  else if (ready) state = "Ready";
  else if (dailyBlocked && needsShots) state = "Continues Tomorrow";
  else state = "Needs Shots";
  return {
    vehicleId: car.id,
    label: fleetCarLabel(car),
    labeled, unknown, generated, approved, published, ready,
    needsWork: needsShots,
    state,
  };
}

export function fleetProgress(cars: FleetCarInput[], dailyBlocked: boolean): FleetRow[] {
  return cars.map((c) => fleetRow(c, dailyBlocked)).filter((r): r is FleetRow => !!r);
}

export type StudioLabelCounts = { labeled: number; lowConfidence: number; failed: number };

export type StudioRunHold = "continues_tomorrow" | "monthly_cap" | null;

/** What Run All Cars says when a pass ends. Failures lead, so a finished fleet is not a plain success. */
export function describeStudioRun(cars: number, labels: StudioLabelCounts, held: StudioRunHold = null): string {
  const parts: string[] = [];
  if (labels.failed > 0) {
    parts.push(`${labels.failed} ${labels.failed === 1 ? "photo" : "photos"} could not be labeled.`);
  }
  if (held === "continues_tomorrow") {
    parts.push("Continues Tomorrow. The daily limit was reached. Run this again tomorrow.");
  } else if (held === "monthly_cap") {
    parts.push("The monthly cap was reached.");
  } else if (cars > 0) {
    parts.push(`Photo Studio finished ${cars} ${cars === 1 ? "car" : "cars"}.`);
  } else if (labels.failed === 0) {
    parts.push("Every car in the fleet already has its shots.");
  }
  if (labels.labeled > 0) parts.push(`${labels.labeled} labeled.`);
  if (labels.lowConfidence > 0) parts.push(`${labels.lowConfidence} low confidence.`);
  return parts.join(" ");
}

export function studioRunToast(
  cars: number,
  labels: StudioLabelCounts,
  held: StudioRunHold = null,
): { level: "error" | "message" | "success"; text: string } {
  const text = describeStudioRun(cars, labels, held);
  if (labels.failed > 0) return { level: "error", text };
  if (held) return { level: "message", text };
  return { level: "success", text };
}

/** Next car the Run All Cars button should pick, skipping ones already tried this click. */
export function nextFleetCar<T extends { id: string; status?: string | null; archivedAt?: string | null; needsWork: boolean }>(cars: T[], skipIds: string[]): T | null {
  const skip = new Set(skipIds);
  return cars.find((c) => !skip.has(c.id) && isStudioFleetCar(c) && c.needsWork) ?? null;
}
