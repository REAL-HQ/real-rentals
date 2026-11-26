import { describe, expect, test } from "bun:test";
import { PHOTO_CLASS_OPTIONS } from "../src/lib/photo-studio";
import {
  PHOTO_LABEL_COST_CENTS, PHOTO_LABEL_ERROR_MAX, PHOTO_LABEL_MIN_CONFIDENCE, PHOTO_LABEL_MODEL,
  canAutoLabel, decideLabel, formatLabelCost, labelAuditMetadata, parsePhotoLabel, photoLabelPrompt,
  providerErrorDetail, providerErrorOutcome,
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
    expect(PHOTO_LABEL_MODEL).toBe("gemini-3.5-flash");
    expect(PHOTO_LABEL_COST_CENTS).toBe(0.5);
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
    expect(formatLabelCost(PHOTO_LABEL_COST_CENTS)).toBe("0.5¢");
    expect(formatLabelCost(12 * PHOTO_LABEL_COST_CENTS)).toBe("6¢");
  });
});

describe("provider errors", () => {
  const key = "AIzaSySECRETKEY1234567890";
  test("keeps the status message, drops the key, and caps the length", () => {
    const body = JSON.stringify({
      error: {
        code: 404,
        message: `This model models/gemini-2.5-flash is no longer available to new users. key=${key} ${"x".repeat(400)}`,
        status: "NOT_FOUND",
      },
    });
    const detail = providerErrorDetail(body, key);
    expect(detail).toContain("no longer available");
    expect(detail).not.toContain(key);
    expect(detail).not.toContain("AIza");
    expect(detail.length).toBeLessThanOrEqual(PHOTO_LABEL_ERROR_MAX);
    expect(providerErrorOutcome(404, detail)).toBe(`provider_error:404 ${detail}`);
    expect(providerErrorOutcome(null, "")).toBe("provider_error");
  });
  test("audit metadata stores the status and snippet, and a success row stays bare", () => {
    const detail = providerErrorDetail("connect failed for AIzaSySECRETKEY1234567890", key);
    expect(detail).not.toContain(key);
    expect(labelAuditMetadata({
      mediaId: "m1", outcome: providerErrorOutcome(null, detail), costCents: 0, status: null, detail,
    })).toEqual({
      mediaId: "m1",
      model: PHOTO_LABEL_MODEL,
      outcome: `provider_error ${detail}`,
      cost_cents: 0,
      http_status: null,
      error: detail,
    });
    expect(labelAuditMetadata({ mediaId: "m1", outcome: "labeled", costCents: PHOTO_LABEL_COST_CENTS })).toEqual({
      mediaId: "m1", model: PHOTO_LABEL_MODEL, outcome: "labeled", cost_cents: PHOTO_LABEL_COST_CENTS,
    });
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
    expect(seen?.url).toContain("gemini-3.5-flash");
    expect(seen?.url).not.toContain("gemini-2.5-flash");
    expect(seen?.url).not.toContain("TEST-KEY");
    expect(seen?.init.body).not.toContain("TEST-KEY");
    expect(seen?.init.headers["x-goog-api-key"]).toBe("TEST-KEY");
    const body = JSON.parse(seen?.init.body);
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json" });
    expect(body.contents[0].parts[0].inline_data.mime_type).toBe("image/jpeg");
    expect(typeof body.contents[0].parts[1].text).toBe("string");
  });
  test("a failed call is not billed and keeps the status", async () => {
    const r = await classifyPhoto({ bytes: jpeg, mime: "image/jpeg" }, "k", (async () => new Response("", { status: 429 })) as typeof fetch);
    expect(r.billed).toBe(false);
    expect(r.reason).toBe("provider_error");
    if (r.reason !== "provider_error") return;
    expect(r.status).toBe(429);
    expect(r.detail).toBe("");
    expect(providerErrorOutcome(r.status, r.detail)).toBe("provider_error:429");
  });
  test("a 404 keeps a short snippet and never the key", async () => {
    const key = "AIzaSySECRETKEY1234567890";
    const message = `This model models/gemini-2.5-flash is no longer available to new users. ${"x".repeat(400)} key=${key}`;
    const fake = (async () => new Response(JSON.stringify({ error: { code: 404, message, status: "NOT_FOUND" } }), { status: 404 })) as typeof fetch;
    const r = await classifyPhoto({ bytes: jpeg, mime: "image/jpeg" }, key, fake);
    expect(r.billed).toBe(false);
    expect(r.reason).toBe("provider_error");
    if (r.reason !== "provider_error") return;
    expect(r.status).toBe(404);
    expect(r.detail).toContain("no longer available");
    expect(r.detail.length).toBeLessThanOrEqual(PHOTO_LABEL_ERROR_MAX);
    expect(r.detail).not.toContain(key);
    expect(JSON.stringify(r)).not.toContain(key);
  });
  test("a network failure has no status and drops the key", async () => {
    const key = "AIzaSySECRETKEY1234567890";
    const fake = (async () => { throw new Error(`connect failed for ${key}`); }) as typeof fetch;
    const r = await classifyPhoto({ bytes: jpeg, mime: "image/jpeg" }, key, fake);
    expect(r.billed).toBe(false);
    expect(r.reason).toBe("provider_error");
    if (r.reason !== "provider_error") return;
    expect(r.status).toBeNull();
    expect(r.detail).toContain("connect failed");
    expect(r.detail).not.toContain(key);
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
    const logs: { outcome: string; status?: number | null; detail?: string }[] = [];
    const rows = [row({ id: "low" }), row({ id: "down" })];
    const summary = await labelOriginals(["low", "down"], {
      load: async () => rows,
      download: async () => ({ bytes: new Uint8Array([1]), mime: "image/jpeg" }),
      write: async (id) => { writes.push(id); return "wrote"; },
      classify: async () => {
        n++;
        return n === 1
          ? { billed: true, parsed: { photoClass: "damage" as const, confidence: 0.2 }, reason: "ok" as const }
          : { billed: false, parsed: null, reason: "provider_error" as const, status: 404, detail: "no longer available" };
      },
      log: async (e) => { logs.push({ outcome: e.outcome, status: e.status, detail: e.detail }); },
    });
    expect(writes).toEqual([]);
    expect(summary.labeled).toBe(0);
    expect(summary.lowConfidence).toBe(1);
    expect(summary.leftUnknown).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.spentCents).toBe(PHOTO_LABEL_COST_CENTS);
    const failed = logs.find((e) => e.outcome.startsWith("provider_error"));
    expect(failed).toEqual({ outcome: "provider_error:404 no longer available", status: 404, detail: "no longer available" });
    expect(logs.some((e) => e.outcome === "low_confidence")).toBe(true);
  });

  test("a real 404 is logged with status and the key stays out of the outcome", async () => {
    const key = "AIzaSySECRETKEY1234567890";
    const logs: { outcome: string; status?: number | null; detail?: string }[] = [];
    const summary = await labelOriginals(["m1"], {
      load: async () => [row()],
      download: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: "image/jpeg" }),
      write: async () => "wrote",
      classify: (image) => classifyPhoto(image, key, (async () => new Response(JSON.stringify({
        error: { code: 404, message: `This model models/gemini-2.5-flash is no longer available to new users. key=${key}` },
      }), { status: 404 })) as typeof fetch),
      log: async (e) => { logs.push({ outcome: e.outcome, status: e.status, detail: e.detail }); },
    });
    expect(summary.failed).toBe(1);
    expect(summary.labeled).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe(404);
    expect(logs[0].outcome).toContain("provider_error:404");
    expect(logs[0].outcome).toContain("no longer available");
    expect(logs[0].detail).not.toContain(key);
    expect(JSON.stringify(logs)).not.toContain(key);
    expect(labelAuditMetadata({
      mediaId: "m1", outcome: logs[0].outcome, costCents: 0, status: logs[0].status, detail: logs[0].detail,
    }).error).not.toContain(key);
  });
});
