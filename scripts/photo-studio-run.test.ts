import { describe, expect, test } from "bun:test";
import { runCar } from "../src/lib/photo-studio-run.server";
import { mockProvider, geminiProvider } from "../src/lib/photo-studio-provider.server";
import { decodePng, encodePng } from "../src/lib/photo-studio-redact.server";
import {
  IDENTITY_REREAD_FAILED,
  PHOTO_STUDIO_DEFAULTS,
  PLATE_MISMATCH_REASON,
  VIN_MISMATCH_REASON,
  countsTowardDailyImage,
  costCentsFor,
  pickScene,
} from "../src/lib/photo-studio";

const car = {
  id: "c",
  year: 2015,
  make: "Ford",
  model: "Fusion",
  color: "silver",
  plate: "CZ07DA",
  vin: "1FA6P0H74F5118769",
};
const originals = [
  { id: "f", photoClass: "exterior_front" as const },
  { id: "r", photoClass: "exterior_rear" as const },
  { id: "dmg", photoClass: "damage" as const },
  { id: "i", photoClass: "interior_dash" as const },
];
function deps(over: any = {}) {
  const saved: any[] = [];
  const spend: any[] = [];
  let images = 0;
  return {
    saved,
    spend,
    d: {
      provider: mockProvider(),
      settings: { ...PHOTO_STUDIO_DEFAULTS, enabled: true },
      model: "gemini-2.5-flash-image",
      usage: async () => ({ todayImages: images, monthCents: 0 }),
      loadOriginal: async (id: string) => ({
        bytes: new TextEncoder().encode(id),
        mime: "image/jpeg",
      }),
      saveShot: async (s: any) => {
        saved.push(s);
        images++;
      },
      logSpend: async (e: any) => {
        spend.push(e);
      },
      ...over,
    },
  };
}

describe("runCar", () => {
  test("4 exterior + dashboard, never from damage", async () => {
    const t = deps();
    const r = await runCar(car, originals, null, t.d as any);
    expect(r.ok).toBe(true);
    expect(t.saved.map((s) => s.slot)).toEqual([
      "front",
      "driver_side",
      "passenger_side",
      "rear",
      "interior_1",
    ]);
    expect(t.saved.every((s) => !s.sources.includes("dmg"))).toBe(true);
    expect(t.spend.every((e) => e.costCents === 0 && e.outcome === "mock")).toBe(true);
  });
  test("off → nothing generated", async () => {
    const t = deps({ settings: { ...PHOTO_STUDIO_DEFAULTS } });
    const r = await runCar(car, originals, null, t.d as any);
    expect(r.ok).toBe(false);
    expect(t.saved.length).toBe(0);
  });
  test("a plate with no box is rejected on the cutout, then retried once", async () => {
    let calls = 0;
    const prompts: string[] = [];
    const base = mockProvider({ plates: ["ABC123"] });
    const provider = {
      name: base.name,
      generate: async (
        model: string,
        input: { prompt: string; images: { bytes: Uint8Array; mime: string }[] },
      ) => {
        calls++;
        prompts.push(input.prompt);
        return base.generate(model, input);
      },
      readIdentity: base.readIdentity.bind(base),
    };
    const t = deps({ provider });
    const r = await runCar(car, originals, ["front"], t.d as any);
    expect(r.outcomes.at(-1)?.status).toBe("rejected");
    expect(r.outcomes.at(-1)?.reason).toBe(PLATE_MISMATCH_REASON);
    expect(JSON.stringify(r.outcomes)).not.toMatch(/ABC123|CZ07|1FA6/);
    expect(t.saved.length).toBe(0);
    expect(calls).toBe(2);
    expect(prompts.every((prompt) => /neutral grey/.test(prompt))).toBe(true);
    expect(t.spend).toEqual([
      { slot: "front", costCents: 0, outcome: "rejected_check" },
      { slot: "front", costCents: 0, outcome: "rejected_check" },
    ]);
  });
  test("a wrong plate on the cutout is retried once and both attempts are billed", async () => {
    let calls = 0;
    const provider = {
      name: "gemini",
      generate: async () => {
        calls++;
        return { ok: true as const, bytes: new Uint8Array([calls]), mime: "image/png" };
      },
      readIdentity: async () => ({
        ok: true as const,
        plates: ["XLK331"],
        vins: [] as string[],
        plateBoxes: [] as { x: number; y: number; w: number; h: number }[],
      }),
    };
    const t = deps({ provider });
    const r = await runCar(car, originals, ["rear"], t.d as any);
    expect(r.outcomes.at(-1)?.status).toBe("rejected");
    expect(r.outcomes.at(-1)?.reason).toBe(PLATE_MISMATCH_REASON);
    expect(JSON.stringify(r)).not.toMatch(/XLK331|CZ07|1FA6/);
    expect(calls).toBe(2);
    expect(t.saved).toHaveLength(0);
    const unit = costCentsFor("gemini-2.5-flash-image");
    expect(t.spend).toEqual([
      { slot: "rear", costCents: unit, outcome: "rejected_check" },
      { slot: "rear", costCents: unit, outcome: "rejected_check" },
    ]);
  });
  test("a plate that first appears in the scene is retried once", async () => {
    let reads = 0;
    let calls = 0;
    const provider = {
      name: "gemini",
      generate: async () => {
        calls++;
        return { ok: true as const, bytes: new Uint8Array([calls]), mime: "image/png" };
      },
      readIdentity: async () => {
        reads++;
        const scene = reads % 2 === 0;
        return {
          ok: true as const,
          plates: scene ? ["XLK331"] : [],
          vins: [] as string[],
          plateBoxes: [] as { x: number; y: number; w: number; h: number }[],
        };
      },
    };
    const t = deps({ provider });
    const r = await runCar(car, originals, ["front"], t.d as any);
    expect(r.outcomes.at(-1)?.status).toBe("rejected");
    expect(calls).toBe(4);
    expect(t.saved).toHaveLength(0);
    const unit = costCentsFor("gemini-2.5-flash-image");
    expect(t.spend).toEqual([
      { slot: "front", costCents: unit, outcome: "ok" },
      { slot: "front", costCents: unit, outcome: "rejected_check" },
      { slot: "front", costCents: unit, outcome: "ok" },
      { slot: "front", costCents: unit, outcome: "rejected_check" },
    ]);
  });
  test("provider failure saves nothing", async () => {
    const t = deps({ provider: mockProvider({ fail: true }) });
    await runCar(car, originals, null, t.d as any);
    expect(t.saved.length).toBe(0);
  });
  test("monthly cap stops before spending", async () => {
    const t = deps({ usage: async () => ({ todayImages: 0, monthCents: 9999 }) });
    const r = await runCar(car, originals, null, t.d as any);
    expect(r.ok).toBe(false);
  });
  test("isolates the car, then places that cutout in the plaza", async () => {
    const prompts: string[] = [];
    const base = mockProvider();
    const provider = {
      name: base.name,
      generate: async (
        model: string,
        input: { prompt: string; images: { bytes: Uint8Array; mime: string }[] },
      ) => {
        prompts.push(input.prompt);
        return base.generate(model, input);
      },
      readIdentity: base.readIdentity.bind(base),
    };
    const t = deps({ provider });
    const r = await runCar(car, originals, ["front"], t.d as any);
    expect(r.outcomes[0].status).toBe("saved");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toMatch(/neutral grey/);
    expect(prompts[1]).toContain(pickScene(car.id).background);
    expect(t.spend).toHaveLength(2);
    expect(t.spend.every((e) => e.outcome === "mock" && e.costCents === 0)).toBe(true);
  });
  test("a failed isolation does not spend the scene call", async () => {
    let calls = 0;
    const provider = {
      name: "mock",
      generate: async () => {
        calls++;
        return { ok: false as const, error: "mock failure", status: 500 };
      },
      readIdentity: async () => ({ ok: true as const, plates: [], vins: [] }),
    };
    const t = deps({ provider });
    await runCar(car, originals, ["front"], t.d as any);
    expect(calls).toBe(1);
    expect(t.saved.length).toBe(0);
  });
  test("a detected plate is blacked out and the covered plate passes", async () => {
    const width = 40;
    const height = 20;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = 245;
      rgba[i * 4 + 1] = 215;
      rgba[i * 4 + 2] = 110;
      rgba[i * 4 + 3] = 255;
    }
    const png = await encodePng({ width, height, rgba });
    const box = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 };
    const provider = {
      name: "mock",
      generate: async () => ({ ok: true as const, bytes: png, mime: "image/png" }),
      readIdentity: async (image: { bytes: Uint8Array }) => {
        const decoded = await decodePng(image.bytes);
        const cx = Math.floor(width / 2);
        const cy = Math.floor(height / 2);
        const i = (cy * decoded!.width + cx) * 4;
        const covered =
          decoded!.rgba[i] === 0 && decoded!.rgba[i + 1] === 0 && decoded!.rgba[i + 2] === 0;
        return {
          ok: true as const,
          plates: ["FAKE7"],
          vins: [] as string[],
          plateBoxes: covered ? [box] : [box],
        };
      },
    };
    const t = deps({ provider });
    const r = await runCar(car, originals, ["rear"], t.d as any);
    expect(r.outcomes[0].status).toBe("saved");
    expect(JSON.stringify(t.saved)).not.toMatch(/FAKE7|CZ07|1FA6/);
    const saved = (await decodePng(t.saved[0].bytes))!;
    const mid = (Math.floor(height / 2) * saved.width + Math.floor(width / 2)) * 4;
    expect(saved.rgba[mid]).toBe(0);
    expect(saved.rgba[mid + 1]).toBe(0);
    expect(saved.rgba[mid + 2]).toBe(0);
    const edge = (Math.floor(height / 2) * saved.width + 1) * 4;
    expect(saved.rgba[edge]).toBe(245);
  });
  test("a VIN mismatch is rejected and retried once, with no VIN in the reason", async () => {
    const provider = {
      name: "mock",
      generate: async (_m: string, input: { images: { bytes: Uint8Array }[] }) => ({
        ok: true as const,
        bytes: input.images[0].bytes,
        mime: "image/png",
      }),
      readIdentity: async () => ({
        ok: true as const,
        plates: [] as string[],
        vins: ["3FA6P0HRXDR153036"],
        plateBoxes: [] as { x: number; y: number; w: number; h: number }[],
      }),
    };
    const t = deps({ provider });
    const r = await runCar(car, originals, ["front"], t.d as any);
    expect(r.outcomes.at(-1)?.reason).toBe(VIN_MISMATCH_REASON);
    expect(JSON.stringify(r.outcomes)).not.toMatch(/3FA6|1FA6|CZ07/);
    expect(t.spend.filter((e) => e.outcome === "rejected_check")).toHaveLength(2);
    expect(t.saved).toHaveLength(0);
  });
  test("a re-read error is retryable and is not a rejected check", async () => {
    let reads = 0;
    const provider = {
      name: "gemini",
      generate: async () => ({ ok: true as const, bytes: new Uint8Array([1]), mime: "image/png" }),
      readIdentity: async () => {
        reads++;
        if (reads === 1)
          return { ok: false as const, error: "Could not parse identity read.", status: 200 };
        return {
          ok: true as const,
          plates: [] as string[],
          vins: [] as string[],
          plateBoxes: [] as { x: number; y: number; w: number; h: number }[],
        };
      },
    };
    const t = deps({ provider });
    const r = await runCar(car, originals, ["front"], t.d as any);
    expect(r.outcomes.at(-1)?.status).toBe("saved");
    expect(t.spend[0]).toEqual({
      slot: "front",
      costCents: costCentsFor("gemini-2.5-flash-image"),
      outcome: "provider_error",
    });
    expect(t.spend.some((e) => e.outcome === "rejected_check")).toBe(false);
    expect(JSON.stringify(r.outcomes)).not.toContain("Could not parse");
  });
  test("a rate-limited re-read does not retry inside the run", async () => {
    let calls = 0;
    const provider = {
      name: "gemini",
      generate: async () => {
        calls++;
        return { ok: true as const, bytes: new Uint8Array([1]), mime: "image/png" };
      },
      readIdentity: async () => ({
        ok: false as const,
        error: "Provider returned 429",
        status: 429,
      }),
    };
    const t = deps({ provider });
    const r = await runCar(car, originals, ["front"], t.d as any);
    expect(calls).toBe(1);
    expect(r.outcomes[0].reason).toBe(IDENTITY_REREAD_FAILED);
    expect(t.spend[0].outcome).toBe("provider_error");
    expect(JSON.stringify(r.outcomes)).not.toMatch(/429/);
  });
  test("the automatic retry does not spend past the daily cap", async () => {
    let calls = 0;
    const t = deps({
      provider: {
        name: "gemini",
        generate: async () => {
          calls++;
          return { ok: true as const, bytes: new Uint8Array([calls]), mime: "image/png" };
        },
        readIdentity: async () => ({
          ok: true as const,
          plates: ["FAKE7"],
          vins: [] as string[],
          plateBoxes: [] as { x: number; y: number; w: number; h: number }[],
        }),
      },
      settings: { ...PHOTO_STUDIO_DEFAULTS, enabled: true, dailyImageLimit: 2 },
    });
    t.d.usage = async () => ({
      todayImages: t.spend.filter((e: { outcome: string; costCents: number }) =>
        countsTowardDailyImage(e.outcome, e.costCents),
      ).length,
      monthCents: t.spend.reduce((sum: number, e: { costCents: number }) => sum + e.costCents, 0),
    });
    const r = await runCar(car, originals, ["rear"], t.d as any);
    expect(calls).toBe(1);
    expect(r.outcomes.some((o) => /Daily limit/.test(o.reason ?? ""))).toBe(true);
    expect(r.outcomes.at(-1)?.reason).toBe(PLATE_MISMATCH_REASON);
    expect(t.saved).toHaveLength(0);
  });
});

describe("gemini provider (fetch mocked, no network)", () => {
  test("parses image and sends key only in header", async () => {
    let seen: any;
    const fake = (async (url: string, init: any) => {
      seen = { url, init };
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: Buffer.from("x").toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    }) as any;
    const p = geminiProvider("TEST-KEY", fake);
    const r = await p.generate("gemini-2.5-flash-image", {
      prompt: "p",
      images: [{ bytes: new Uint8Array([1]), mime: "image/jpeg" }],
    });
    expect(r.ok).toBe(true);
    expect(seen.url).not.toContain("TEST-KEY");
    expect(seen.init.headers["x-goog-api-key"]).toBe("TEST-KEY");
  });
  test("402 surfaces status", async () => {
    const p = geminiProvider("k", (async () => new Response("", { status: 402 })) as any);
    const r = await p.generate("m", { prompt: "p", images: [] });
    expect(r.ok).toBe(false);
    expect((r as any).status).toBe(402);
  });
  test("joins every part and strips a markdown fence", async () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [
              { text: "```json\n" },
              {
                text: '{"plates":[],"vins":[],"plate_boxes":[{"x":0.2,"y":0.5,"w":0.4,"h":0.12}]}',
              },
              { text: "\n```" },
            ],
          },
        },
      ],
    };
    const p = geminiProvider("k", (async () => new Response(JSON.stringify(body))) as any);
    const r = await p.readIdentity({ bytes: new Uint8Array([1]), mime: "image/png" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plateBoxes).toEqual([{ x: 0.2, y: 0.5, w: 0.4, h: 0.12 }]);
  });
  test("a timeout is a re-read failure with no upstream text", async () => {
    const p = geminiProvider("k", (async () => {
      throw new Error("The operation was aborted due to timeout");
    }) as any);
    const r = await p.readIdentity({ bytes: new Uint8Array([1]), mime: "image/png" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(IDENTITY_REREAD_FAILED);
      expect(r.error).not.toMatch(/aborted|timeout/i);
    }
  });
  test("an HTTP error is a re-read failure and keeps the status", async () => {
    const p = geminiProvider("k", (async () => new Response("nope", { status: 503 })) as any);
    const r = await p.readIdentity({ bytes: new Uint8Array([1]), mime: "image/png" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(503);
      expect(r.error).toBe(IDENTITY_REREAD_FAILED);
      expect(r.error).not.toContain("nope");
    }
  });
});
