// Photo Studio — one car's generation run, with all I/O injected so the whole
// decision path is unit-testable with the mock provider.
import {
  buildPrompt, costCentsFor, identityCheck, planShots, spendRefusal,
  type Original, type PhotoStudioSettings, type ShotSlot,
} from "@/lib/photo-studio";
import type { StudioProvider } from "@/lib/photo-studio-provider.server";

export type Car = { id: string; year?: number | null; make?: string | null; model?: string | null; color?: string | null; plate?: string | null; vin?: string | null };
export type RunDeps = {
  provider: StudioProvider;
  settings: PhotoStudioSettings;
  model: string;
  usage: () => Promise<{ todayImages: number; monthCents: number }>;
  loadOriginal: (id: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Persist a passing shot as an UNPUBLISHED, pending marketing row. */
  saveShot: (s: { slot: ShotSlot; sources: string[]; bytes: Uint8Array; mime: string; inferred: boolean; check: unknown }) => Promise<void>;
  logSpend: (e: { slot: ShotSlot | null; costCents: number; outcome: "ok" | "rejected_check" | "provider_error" | "mock" }) => Promise<void>;
};
export type SlotOutcome = { slot: ShotSlot; status: "saved" | "rejected" | "failed"; reason?: string };

export async function runCar(car: Car, originals: Original[], onlySlots: ShotSlot[] | null, deps: RunDeps) {
  let plan = planShots(originals);
  if (onlySlots) plan = plan.filter((p) => onlySlots.includes(p.slot));
  const refusal = spendRefusal(deps.settings, await deps.usage(), plan.length, deps.model);
  if (refusal) return { ok: false as const, error: refusal, outcomes: [] as SlotOutcome[] };

  const outcomes: SlotOutcome[] = [];
  const unitCost = deps.provider.name === "mock" ? 0 : costCentsFor(deps.model);
  for (const p of plan) {
    // Re-check before every image: a parallel run may have used the budget.
    const again = spendRefusal(deps.settings, await deps.usage(), 1, deps.model);
    if (again) { outcomes.push({ slot: p.slot, status: "failed", reason: again }); break; }
    const imgs = (await Promise.all(p.sources.map(deps.loadOriginal))).filter(Boolean) as { bytes: Uint8Array; mime: string }[];
    if (imgs.length === 0) { outcomes.push({ slot: p.slot, status: "failed", reason: "source missing" }); continue; }
    const g = await deps.provider.generate(deps.model, { prompt: buildPrompt(p.slot, car), images: imgs });
    if (!g.ok) {
      await deps.logSpend({ slot: p.slot, costCents: 0, outcome: "provider_error" });
      outcomes.push({ slot: p.slot, status: "failed", reason: g.error });
      if (g.status === 402 || g.status === 403 || g.status === 429) break; // stop spending
      continue;
    }
    const read = await deps.provider.readIdentity({ bytes: g.bytes, mime: g.mime });
    const check = read.ok ? identityCheck(car, read) : { ok: false as const, reason: "identity re-read failed" };
    if (!check.ok) {
      await deps.logSpend({ slot: p.slot, costCents: unitCost, outcome: "rejected_check" });
      outcomes.push({ slot: p.slot, status: "rejected", reason: check.reason });
      continue;
    }
    await deps.saveShot({ slot: p.slot, sources: p.sources, bytes: g.bytes, mime: g.mime, inferred: p.inferred, check: { inferred: p.inferred, read } });
    await deps.logSpend({ slot: p.slot, costCents: unitCost, outcome: deps.provider.name === "mock" ? "mock" : "ok" });
    outcomes.push({ slot: p.slot, status: "saved" });
  }
  return { ok: true as const, outcomes };
}
