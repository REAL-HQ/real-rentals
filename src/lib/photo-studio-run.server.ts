// Photo Studio — one car's generation run, with all I/O injected so the whole
// decision path is unit-testable with the mock provider.
import {
  IDENTITY_REREAD_FAILED,
  PHOTO_STUDIO_GENERATIONS_PER_SHOT,
  PLATE_MISMATCH_REASON,
  buildIsolationPrompt,
  buildPrompt,
  costCentsFor,
  identityCheck,
  planShots,
  spendRefusal,
  type Original,
  type PhotoStudioSettings,
  type PlateBox,
  type ShotSlot,
} from "@/lib/photo-studio";
import { redactPlates } from "@/lib/photo-studio-redact.server";
import type { StudioProvider } from "@/lib/photo-studio-provider.server";

export type Car = {
  id: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  plate?: string | null;
  vin?: string | null;
};
export type RunDeps = {
  provider: StudioProvider;
  settings: PhotoStudioSettings;
  model: string;
  usage: () => Promise<{ todayImages: number; monthCents: number }>;
  loadOriginal: (id: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Persist a passing shot as an UNPUBLISHED, pending marketing row. */
  saveShot: (s: {
    slot: ShotSlot;
    sources: string[];
    bytes: Uint8Array;
    mime: string;
    inferred: boolean;
    check: unknown;
  }) => Promise<void>;
  logSpend: (e: {
    slot: ShotSlot | null;
    costCents: number;
    outcome: "ok" | "rejected_check" | "provider_error" | "mock";
  }) => Promise<void>;
};
export type SlotOutcome = {
  slot: ShotSlot;
  status: "saved" | "rejected" | "failed";
  reason?: string;
};

const SLOT_ATTEMPTS = 2;

function haltStatus(status?: number): boolean {
  return status === 402 || status === 403 || status === 429;
}

type Attempt = SlotOutcome & { halt?: boolean };

export async function runCar(
  car: Car,
  originals: Original[],
  onlySlots: ShotSlot[] | null,
  deps: RunDeps,
) {
  let plan = planShots(originals);
  if (onlySlots) plan = plan.filter((p) => onlySlots.includes(p.slot));
  // Each shot is two image calls: isolate on grey, then place that cutout in the scene.
  const calls = PHOTO_STUDIO_GENERATIONS_PER_SHOT;
  const refusal = spendRefusal(deps.settings, await deps.usage(), plan.length * calls, deps.model);
  if (refusal) return { ok: false as const, error: refusal, outcomes: [] as SlotOutcome[] };

  const outcomes: SlotOutcome[] = [];
  const unitCost = deps.provider.name === "mock" ? 0 : costCentsFor(deps.model);
  const paidOutcome = deps.provider.name === "mock" ? "mock" : "ok";

  const gateImage = async (bytes: Uint8Array, mime: string) => {
    const read = await deps.provider.readIdentity({ bytes, mime });
    if (!read.ok) {
      return {
        ok: false as const,
        outcome: "provider_error" as const,
        reason: IDENTITY_REREAD_FAILED,
        status: read.status,
      };
    }
    let current = { bytes, mime };
    let bars: PlateBox[] = [];
    let judged = read;
    if ((read.plateBoxes ?? []).length > 0) {
      const painted = await redactPlates(bytes, mime, read.plateBoxes);
      if (!painted.ok)
        return {
          ok: false as const,
          outcome: "rejected_check" as const,
          reason: PLATE_MISMATCH_REASON,
        };
      current = { bytes: painted.bytes, mime: painted.mime };
      bars = painted.bars;
      const again = await deps.provider.readIdentity(current);
      if (!again.ok) {
        return {
          ok: false as const,
          outcome: "provider_error" as const,
          reason: IDENTITY_REREAD_FAILED,
          status: again.status,
        };
      }
      judged = again;
    }
    const verdict = identityCheck(car, judged, bars);
    if (!verdict.ok)
      return { ok: false as const, outcome: "rejected_check" as const, reason: verdict.reason };
    return { ok: true as const, bytes: current.bytes, mime: current.mime };
  };

  const attemptSlot = async (p: (typeof plan)[number]): Promise<Attempt> => {
    const imgs = (await Promise.all(p.sources.map(deps.loadOriginal))).filter(Boolean) as {
      bytes: Uint8Array;
      mime: string;
    }[];
    if (imgs.length === 0) return { slot: p.slot, status: "failed", reason: "source missing" };
    const isolated = await deps.provider.generate(deps.model, {
      prompt: buildIsolationPrompt(p.slot, car),
      images: imgs,
    });
    if (!isolated.ok) {
      await deps.logSpend({ slot: p.slot, costCents: 0, outcome: "provider_error" });
      return {
        slot: p.slot,
        status: "failed",
        reason: isolated.error,
        halt: haltStatus(isolated.status),
      };
    }
    // Every detected plate is blacked out before the scene, then read again.
    const cutout = await gateImage(isolated.bytes, isolated.mime);
    if (!cutout.ok) {
      await deps.logSpend({ slot: p.slot, costCents: unitCost, outcome: cutout.outcome });
      return {
        slot: p.slot,
        status: cutout.outcome === "rejected_check" ? "rejected" : "failed",
        reason: cutout.reason,
        halt: haltStatus(cutout.status),
      };
    }
    await deps.logSpend({ slot: p.slot, costCents: unitCost, outcome: paidOutcome });
    const sceneBudget = spendRefusal(deps.settings, await deps.usage(), 1, deps.model);
    if (sceneBudget) return { slot: p.slot, status: "failed", reason: sceneBudget, halt: true };
    const scene = await deps.provider.generate(deps.model, {
      prompt: buildPrompt(p.slot, car),
      images: [{ bytes: cutout.bytes, mime: cutout.mime }],
    });
    if (!scene.ok) {
      await deps.logSpend({ slot: p.slot, costCents: 0, outcome: "provider_error" });
      return {
        slot: p.slot,
        status: "failed",
        reason: scene.error,
        halt: haltStatus(scene.status),
      };
    }
    const finished = await gateImage(scene.bytes, scene.mime);
    if (!finished.ok) {
      await deps.logSpend({ slot: p.slot, costCents: unitCost, outcome: finished.outcome });
      return {
        slot: p.slot,
        status: finished.outcome === "rejected_check" ? "rejected" : "failed",
        reason: finished.reason,
        halt: haltStatus(finished.status),
      };
    }
    await deps.saveShot({
      slot: p.slot,
      sources: p.sources,
      bytes: finished.bytes,
      mime: finished.mime,
      inferred: p.inferred,
      check: { inferred: p.inferred, read: { ok: true } },
    });
    await deps.logSpend({ slot: p.slot, costCents: unitCost, outcome: paidOutcome });
    return { slot: p.slot, status: "saved" };
  };

  for (const p of plan) {
    let last: Attempt | null = null;
    for (let attempt = 0; attempt < SLOT_ATTEMPTS; attempt++) {
      const cap = spendRefusal(deps.settings, await deps.usage(), calls, deps.model);
      if (cap) {
        outcomes.push({ slot: p.slot, status: "failed", reason: cap });
        if (last) outcomes.push({ slot: last.slot, status: last.status, reason: last.reason });
        return { ok: true as const, outcomes };
      }
      last = await attemptSlot(p);
      const retryable =
        !last.halt &&
        attempt === 0 &&
        (last.status === "rejected" ||
          (last.status === "failed" && last.reason === IDENTITY_REREAD_FAILED));
      if (!retryable) break;
    }
    if (last) outcomes.push({ slot: last.slot, status: last.status, reason: last.reason });
    if (last?.halt) break;
  }
  return { ok: true as const, outcomes };
}
