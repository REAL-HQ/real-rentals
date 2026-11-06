import { describe, expect, test } from "bun:test";
import {
  planShots, spendRefusal, identityCheck, carSetStatus, readStudioSettings, effectiveModel,
  buildPrompt, PHOTO_STUDIO_DEFAULTS, NEVER_GENERATE, vinLast6,
} from "../src/lib/photo-studio";

const on = { ...PHOTO_STUDIO_DEFAULTS, enabled: true };

describe("defaults", () => {
  test("off by default and $100 cap", () => {
    const s = readStudioSettings(null);
    expect(s.enabled).toBe(false);
    expect(s.monthlyCapCents).toBe(10000);
    expect(spendRefusal(s, { todayImages: 0, monthCents: 0 }, 1, s.model)).toMatch(/off/);
  });
});

describe("planShots", () => {
  test("full set from matching angles", () => {
    const p = planShots([
      { id: "f", photoClass: "exterior_front" }, { id: "d", photoClass: "exterior_driver" },
      { id: "p", photoClass: "exterior_passenger" }, { id: "r", photoClass: "exterior_rear" },
      { id: "i", photoClass: "interior_dash" },
    ]);
    expect(p.map((x) => x.slot)).toEqual(["front", "driver_side", "passenger_side", "rear", "interior_1"]);
    expect(p.find((x) => x.slot === "front")!.inferred).toBe(false);
    expect(p.some((x) => x.slot === "interior_2")).toBe(false);
  });
  test("missing sides inferred from other exterior angles", () => {
    const p = planShots([{ id: "f", photoClass: "exterior_front" }]);
    expect(p.map((x) => x.slot)).toEqual(["front", "driver_side", "passenger_side", "rear"]);
    expect(p.filter((x) => x.inferred).length).toBe(3);
  });
  test("damage, documents, odometer, VIN plates are never sources", () => {
    const p = planShots([
      { id: "dmg", photoClass: "damage" }, { id: "doc", photoClass: "document" },
      { id: "odo", photoClass: "odometer" }, { id: "vin", photoClass: "vin_plate" },
    ]);
    expect(p).toEqual([]);
    expect(NEVER_GENERATE.has("damage")).toBe(true);
  });
  test("rear bench is never invented from a dashboard photo", () => {
    const p = planShots([{ id: "i", photoClass: "interior_dash" }]);
    expect(p.some((x) => x.slot === "interior_3")).toBe(false);
  });
});

describe("spend caps", () => {
  test("daily limit", () => expect(spendRefusal(on, { todayImages: 58, monthCents: 0 }, 7, "gemini-2.5-flash-image")).toMatch(/Daily/));
  test("monthly cap", () => expect(spendRefusal(on, { todayImages: 0, monthCents: 9990 }, 7, "gemini-2.5-flash-image")).toMatch(/Monthly/));
  test("allowed", () => expect(spendRefusal(on, { todayImages: 0, monthCents: 0 }, 7, "gemini-2.5-flash-image")).toBeNull());
});

describe("model migration", () => {
  test("switches to 3.1 Flash Lite on 2027-03-15", () => {
    expect(effectiveModel(on, "2027-03-14")).toBe("gemini-2.5-flash-image");
    expect(effectiveModel(on, "2027-03-15")).toBe("gemini-3.1-flash-lite-image");
  });
  test("unknown model falls back", () => expect(readStudioSettings({ model: "x" }).model).toBe("gemini-2.5-flash-image"));
});

describe("identity re-read", () => {
  const car = { plate: "CZ07DA", vin: "1FA6P0H74F5118769" };
  test("matching plate passes", () => expect(identityCheck(car, { plates: ["CZ0 7DA"], vins: [] }).ok).toBe(true));
  test("nothing legible passes", () => expect(identityCheck(car, { plates: [], vins: [] }).ok).toBe(true));
  test("invented plate rejected", () => expect(identityCheck(car, { plates: ["XLK331"], vins: [] }).ok).toBe(false));
  test("wrong VIN rejected", () => expect(identityCheck(car, { plates: [], vins: ["3FA6P0HRXDR153036"] }).ok).toBe(false));
  test("partial VIN must be the tail", () => expect(identityCheck(car, { plates: [], vins: ["F5118769"] }).ok).toBe(true));
});

describe("approval", () => {
  test("pending blocks", () => expect(carSetStatus([{ id: "1", slot: "front", status: "pending" }])).toBe("pending"));
  test("needs all 4 exterior", () => {
    const ok = ["front", "driver_side", "passenger_side", "rear"].map((s, i) => ({ id: String(i), slot: s as any, status: "approved" as const }));
    expect(carSetStatus(ok)).toBe("approved");
    expect(carSetStatus(ok.slice(0, 3))).toBe("incomplete");
  });
});

test("prompt forbids invention and keeps plate", () => {
  const p = buildPrompt("front", { year: 2015, make: "Ford", model: "Fusion", color: "silver" });
  expect(p).toMatch(/Do NOT add/);
  expect(p).toMatch(/license plate/);
});
test("vinLast6", () => expect(vinLast6("1FA6P0H74F5118769")).toBe("118769"));
