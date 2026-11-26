import { describe, expect, test } from "bun:test";
import { runCar } from "../src/lib/photo-studio-run";
import { mockProvider, geminiProvider } from "../src/lib/photo-studio-provider.server";
import { PHOTO_STUDIO_DEFAULTS, pickScene } from "../src/lib/photo-studio";

const car = { id: "c", year: 2015, make: "Ford", model: "Fusion", color: "silver", plate: "CZ07DA", vin: "1FA6P0H74F5118769" };
const originals = [
  { id: "f", photoClass: "exterior_front" as const }, { id: "r", photoClass: "exterior_rear" as const },
  { id: "dmg", photoClass: "damage" as const }, { id: "i", photoClass: "interior_dash" as const },
];
function deps(over: any = {}) {
  const saved: any[] = []; const spend: any[] = [];
  let images = 0;
  return {
    saved, spend,
    d: {
      provider: mockProvider(), settings: { ...PHOTO_STUDIO_DEFAULTS, enabled: true }, model: "gemini-2.5-flash-image",
      usage: async () => ({ todayImages: images, monthCents: 0 }),
      loadOriginal: async (id: string) => ({ bytes: new TextEncoder().encode(id), mime: "image/jpeg" }),
      saveShot: async (s: any) => { saved.push(s); images++; },
      logSpend: async (e: any) => { spend.push(e); },
      ...over,
    },
  };
}

describe("runCar", () => {
  test("4 exterior + dashboard, never from damage", async () => {
    const t = deps();
    const r = await runCar(car, originals, null, t.d as any);
    expect(r.ok).toBe(true);
    expect(t.saved.map((s) => s.slot)).toEqual(["front", "driver_side", "passenger_side", "rear", "interior_1"]);
    expect(t.saved.every((s) => !s.sources.includes("dmg"))).toBe(true);
    expect(t.spend.every((e) => e.costCents === 0 && e.outcome === "mock")).toBe(true);
  });
  test("off → nothing generated", async () => {
    const t = deps({ settings: { ...PHOTO_STUDIO_DEFAULTS } });
    const r = await runCar(car, originals, null, t.d as any);
    expect(r.ok).toBe(false); expect(t.saved.length).toBe(0);
  });
  test("invented plate rejected, not saved", async () => {
    const t = deps({ provider: mockProvider({ plates: ["ABC123"] }) });
    const r = await runCar(car, originals, ["front"], t.d as any);
    expect(r.outcomes[0].status).toBe("rejected"); expect(t.saved.length).toBe(0);
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
      generate: async (model: string, input: { prompt: string; images: { bytes: Uint8Array; mime: string }[] }) => {
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
});

describe("gemini provider (fetch mocked, no network)", () => {
  test("parses image and sends key only in header", async () => {
    let seen: any;
    const fake = (async (url: string, init: any) => {
      seen = { url, init };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("x").toString("base64") } }] } }] }));
    }) as any;
    const p = geminiProvider("TEST-KEY", fake);
    const r = await p.generate("gemini-2.5-flash-image", { prompt: "p", images: [{ bytes: new Uint8Array([1]), mime: "image/jpeg" }] });
    expect(r.ok).toBe(true);
    expect(seen.url).not.toContain("TEST-KEY");
    expect(seen.init.headers["x-goog-api-key"]).toBe("TEST-KEY");
  });
  test("402 surfaces status", async () => {
    const p = geminiProvider("k", (async () => new Response("", { status: 402 })) as any);
    const r = await p.generate("m", { prompt: "p", images: [] });
    expect(r.ok).toBe(false); expect((r as any).status).toBe(402);
  });
});
