import { describe, expect, test } from "bun:test";
import { PHOTO_CLASS_OPTIONS } from "../src/lib/photo-studio";
import {
  PHOTO_LABEL_COST_CENTS, PHOTO_LABEL_MIN_CONFIDENCE, PHOTO_LABEL_MODEL,
  canAutoLabel, decideLabel, formatLabelCost, parsePhotoLabel, photoLabelPrompt,
} from "../src/lib/photo-class-label";
import { classifyPhoto, labelOriginals, type LabelJobRow } from "../src/lib/photo-class-label.server";

const row = (over: Partial<LabelJobRow> = {}): LabelJobRow => ({
  id: "m1", vehicleId: "v1", photoClass: null, source: null, bucket: "vehicle-photos", path: "v1/a.jpg", mime: "image/jpeg",
  ...over,
});

describe("parsePhotoLabel", () => {
  test("accepts every existing class and nothing else", () => {
    for (const o of PHOTO_CLASS_OPTIONS) {
      const parsed = parsePhotoLabel(`{"photo_class":"${o.value}","confidence":0.9}`);
      expect(parsed).toEqual({ photoClass: o.value, confidence: 0.9 });
    }
    expect(parsePhotoLabel(`{"photo_class":"front","confidence":0.9}`)).toBeNull();
    expect(parsePhotoLabel(`{"photo_class":"exterior_front","confidence":0.9,"note":"x"}`)).toBeNull();
    expect(parsePhotoLabel("not json")).toBeNull();
  });
  test("prompt names the model classes", () => {
    const p = photoLabelPrompt();
    for (const o of PHOTO_CLASS_OPTIONS) expect(p).toContain(o.value);
    expect(PHOTO_LABEL_MODEL).toBe("gemini-2.5-flash");
    expect(PHOTO_LABEL_COST_CENTS).toBeGreaterThan(0);
  });
});

describe("decideLabel", () => {
  test("fills null and unknown, and never a manual or already set label", () => {
    expect(canAutoLabel({ photoClass: null, source: null })).toBe(true);
    expect(canAutoLabel({ photoClass: "unknown", source: "auto" })).toBe(true);
    expect(canAutoLabel({ photoClass: "unknown", source: "manual" })).toBe(false);
    expect(canAutoLabel({ photoClass: "exterior_front", source: null })).toBe(false);
    const guess = { photoClass: "exterior_front" as const, confidence: 0.91 };
    expect(decideLabel({ photoClass: null, source: null }, guess)).toEqual({ write: "exterior_front", outcome: "labeled" });
    expect(decideLabel({ photoClass: "unknown", source: null }, guess).write).toBe("exterior_front");
    expect(decideLabel({ photoClass: "exterior_rear", source: "manual" }, guess).outcome).toBe("skipped");
    expect(decideLabel({ photoClass: null, source: "manual" }, guess).outcome).toBe("skipped");
    expect(decideLabel({ photoClass: null, source: null }, { photoClass: "exterior_front", confidence: PHOTO_LABEL_MIN_CONFIDENCE - 0.01 }).outcome).toBe("low_confidence");
    expect(decideLabel({ photoClass: null, source: null }, null).outcome).toBe("unreadable");
    expect(decideLabel({ photoClass: null, source: null }, { photoClass: "unknown", confidence: 0.99 }).write).toBeNull();
  });
  test("cost note stays under a dollar for one photo", () => {
    expect(formatLabelCost(PHOTO_LABEL_COST_CENTS)).toBe("0.1¢");
    expect(formatLabelCost(12 * PHOTO_LABEL_COST_CENTS)).toBe("1.2¢");
  });
});

describe("classifyPhoto", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
  test("missing key does not call the network", async () => {
    let called = false;
    const r = await classifyPhoto({ bytes: jpeg, mime: "image/jpeg" }, undefined, (async () => { called = true; return new Response("{}"); }) as typeof fetch);
    expect(r.reason).toBe("no_key");
    expect(r.billed).toBe(false);
    expect(called).toBe(false);
  });
  test("reads strict JSON and keeps the key out of the url", async () => {
    let seen: { url: string; init: any } | undefined;
    const fake = (async (url: string, init: any) => {
      seen = { url, init };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"photo_class":"interior_dash","confidence":0.8}' }] } }] }));
    }) as typeof fetch;
    const r = await classifyPhoto({ bytes: jpeg, mime: "image/jpeg" }, "TEST-KEY", fake);
    expect(r.billed).toBe(true);
    expect(r.parsed).toEqual({ photoClass: "interior_dash", confidence: 0.8 });
    expect(seen?.url).toContain("gemini-2.5-flash");
    expect(seen?.url).not.toContain("TEST-KEY");
    expect(seen?.init.headers["x-goog-api-key"]).toBe("TEST-KEY");
    const body = JSON.parse(seen?.init.body);
    expect(body.generationConfig.responseModalities).toBeUndefined();
  });
  test("a failed call is not billed", async () => {
    const r = await classifyPhoto({ bytes: jpeg, mime: "image/jpeg" }, "k", (async () => new Response("", { status: 429 })) as typeof fetch);
    expect(r.billed).toBe(false);
    expect(r.reason).toBe("provider_error");
  });
});

describe("labelOriginals", () => {
  test("one confident guess is saved and a manual label is not sent", async () => {
    const seen: string[] = [];
    const writes: string[] = [];
    const rows = [
      row({ id: "open", photoClass: "unknown", source: null }),
      row({ id: "hand", photoClass: "unknown", source: "manual" }),
    ];
    const summary = await labelOriginals(["open", "hand"], {
      load: async () => rows,
      download: async (r) => { seen.push(r.id); return { bytes: new Uint8Array([1]), mime: "image/jpeg" }; },
      write: async (id, photoClass) => { writes.push(`${id}:${photoClass}`); return "wrote"; },
      classify: async () => ({ billed: true, parsed: { photoClass: "exterior_driver", confidence: 0.88 }, reason: "ok" }),
      log: async () => {},
    });
    expect(seen).toEqual(["open"]);
    expect(writes).toEqual(["open:exterior_driver"]);
    expect(summary).toMatchObject({ labeled: 1, skipped: 1, spentCents: PHOTO_LABEL_COST_CENTS });
  });

  test("low confidence and a provider error leave the photo unknown", async () => {
    let n = 0;
    const writes: string[] = [];
    const rows = [row({ id: "low" }), row({ id: "down" })];
    const summary = await labelOriginals(["low", "down"], {
      load: async () => rows,
      download: async () => ({ bytes: new Uint8Array([1]), mime: "image/jpeg" }),
      write: async (id) => { writes.push(id); return "wrote"; },
      classify: async () => {
        n++;
        return n === 1
          ? { billed: true, parsed: { photoClass: "damage" as const, confidence: 0.2 }, reason: "ok" as const }
          : { billed: false, parsed: null, reason: "provider_error" as const };
      },
      log: async () => {},
    });
    expect(writes).toEqual([]);
    expect(summary.labeled).toBe(0);
    expect(summary.leftUnknown).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.spentCents).toBe(PHOTO_LABEL_COST_CENTS);
  });
});
