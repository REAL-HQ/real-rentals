import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  planShots, spendRefusal, identityCheck, carSetStatus, readStudioSettings, effectiveModel,
  PLATE_MISMATCH_REASON, VIN_MISMATCH_REASON, IDENTITY_REREAD_FAILED, plateBar, countsTowardDailyImage,
  publicFailureReason, slotReasonsFromAudits, parseIdentityRead, IDENTITY_READ_PROMPT,
  buildIsolationPrompt, buildPrompt, PHOTO_STUDIO_DEFAULTS, PHOTO_STUDIO_GENERATIONS_PER_SHOT, PHOTO_STUDIO_SCENES, pickScene, NEVER_GENERATE, vinLast6, PHOTO_CLASS_OPTIONS, photoClassLabel,
  isMissingPhotoClassColumn, marketingPublishBlock, RETIRE_LIVE_SHOT, leadMarketingShotId, marketingShotNote,
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
  const secret = /CZ07|XLK331|1FA6|3FA6|F5118769/;
  test("nothing legible passes", () => expect(identityCheck(car, { plates: [], vins: [] }).ok).toBe(true));
  test("a readable plate outside a redaction is rejected without echoing it", () => {
    const result = identityCheck(car, { plates: ["CZ0 7DA"], vins: [], plateBoxes: [{ x: 0.1, y: 0.6, w: 0.2, h: 0.08 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(PLATE_MISMATCH_REASON);
      expect(result.reason).not.toMatch(secret);
    }
  });
  test("a plate token centered on the black bar passes", () => {
    const box = { x: 0.4, y: 0.7, w: 0.2, h: 0.1 };
    const result = identityCheck(car, { plates: ["XLK331"], vins: [], plateBoxes: [box] }, [plateBar(box)]);
    expect(result.ok).toBe(true);
  });
  test("text that remains beside the bar is rejected", () => {
    const plate = { x: 0.4, y: 0.7, w: 0.2, h: 0.1 };
    const edge = { x: 0.4, y: 0.7, w: 0.02, h: 0.1 };
    const result = identityCheck(car, { plates: ["XLK331"], vins: [], plateBoxes: [edge] }, [plateBar(plate)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(PLATE_MISMATCH_REASON);
  });
  test("wrong VIN rejected without echoing it", () => {
    const result = identityCheck(car, { plates: [], vins: ["3FA6P0HRXDR153036"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(VIN_MISMATCH_REASON);
      expect(result.reason).not.toMatch(secret);
    }
  });
  test("partial VIN must be the tail", () => expect(identityCheck(car, { plates: [], vins: ["F5118769"] }).ok).toBe(true));
  test("a stored reason never keeps the plate text", () => {
    const legacy = 'Generated plate "XLK331" does not match CZ07DA';
    expect(publicFailureReason(legacy)).toBe(PLATE_MISMATCH_REASON);
    expect(publicFailureReason(legacy)).not.toMatch(secret);
    expect(publicFailureReason("Could not parse identity read.")).toBe(IDENTITY_REREAD_FAILED);
    expect(publicFailureReason("Daily limit reached (60 images).")).toBe("Daily Limit Reached");
    expect(publicFailureReason("surprise CZ07DA")).toBeNull();
  });
  test("the latest safe reason wins, and a later save clears it", () => {
    const reasons = slotReasonsFromAudits([
      { created_at: "2026-11-01T00:00:00.000Z", metadata: { outcomes: [{ slot: "rear", status: "rejected", reason: 'Generated plate "XLK331" does not match CZ07DA' }] } },
      { created_at: "2026-11-02T00:00:00.000Z", metadata: { outcomes: [{ slot: "rear", status: "saved" }] } },
      { created_at: "2026-11-03T00:00:00.000Z", metadata: { outcomes: [{ slot: "front", status: "failed", reason: IDENTITY_REREAD_FAILED }] } },
    ]);
    expect(reasons.rear).toBeUndefined();
    expect(reasons.front).toBe(IDENTITY_REREAD_FAILED);
    expect(JSON.stringify(reasons)).not.toMatch(secret);
  });
  test("the read prompt asks for plate boxes and joins like the labeler", () => {
    expect(IDENTITY_READ_PROMPT).toMatch(/plate_boxes/);
    const fenced = '```json\n{"plates":[],"vins":[],"plate_boxes":[{"x":0.2,"y":0.6,"w":0.3,"h":0.1}]}\n```';
    expect(parseIdentityRead(fenced)?.plateBoxes).toEqual([{ x: 0.2, y: 0.6, w: 0.3, h: 0.1 }]);
    expect(parseIdentityRead("not json")).toBeNull();
  });
  test("daily cap still counts a paid image and ignores an empty provider error", () => {
    expect(countsTowardDailyImage("ok", 3.9)).toBe(true);
    expect(countsTowardDailyImage("rejected_check", 3.9)).toBe(true);
    expect(countsTowardDailyImage("provider_error", 0)).toBe(false);
    expect(countsTowardDailyImage("provider_error", 3.9)).toBe(true);
  });
});

describe("approval", () => {
  test("pending blocks", () => expect(carSetStatus([{ id: "1", slot: "front", status: "pending" }])).toBe("pending"));
  test("needs all 4 exterior", () => {
    const ok = ["front", "driver_side", "passenger_side", "rear"].map((s, i) => ({ id: String(i), slot: s as any, status: "approved" as const }));
    expect(carSetStatus(ok)).toBe("approved");
    expect(carSetStatus(ok.slice(0, 3))).toBe("incomplete");
  });
});

describe("photo class labels", () => {
  test("every class staff can pick has a label, and a missing column is recognized", () => {
    for (const value of ["exterior_front", "exterior_driver", "exterior_passenger", "exterior_rear", "interior_dash", "interior_front", "interior_rear", "damage", "document", "odometer", "vin_plate"] as const) {
      expect(PHOTO_CLASS_OPTIONS.some((o) => o.value === value)).toBe(true);
      expect(photoClassLabel(value).length).toBeGreaterThan(0);
    }
    expect(photoClassLabel(null)).toBe("Unknown");
    expect(photoClassLabel("exterior_front")).toBe("Front 3/4");
    expect(isMissingPhotoClassColumn("column vehicle_media.photo_class does not exist")).toBe(true);
    expect(isMissingPhotoClassColumn("Could not find the 'photo_class' column of 'vehicle_media' in the schema cache")).toBe(true);
    expect(isMissingPhotoClassColumn("Could not update.")).toBe(false);
  });
  test("rejecting a published shot without unpublishing is blocked; retiring it is not", () => {
    const live = { kind: "marketing", published: true, studio_review_status: "approved", approved_by: "owner" };
    expect(marketingPublishBlock({ ...live, studio_review_status: "rejected" })).toMatch(/cannot be published/);
    expect(marketingPublishBlock({ ...live, ...RETIRE_LIVE_SHOT })).toBeNull();
  });
  test("the approved Front 3/4 shot is the lead", () => {
    expect(leadMarketingShotId([
      { id: "side", slot: "driver_side", status: "approved" },
      { id: "front", slot: "front", status: "approved" },
    ])).toBe("front");
    expect(leadMarketingShotId([{ id: "front", slot: "front", status: "pending" }])).toBeNull();
  });
});

test("prompt forbids invention and blanks the plate", () => {
  const scene = pickScene("car-1");
  const p = buildPrompt("front", { id: "car-1", year: 2015, make: "Ford", model: "Fusion", color: "silver" });
  expect(p).toMatch(/Do NOT add/);
  expect(p).toMatch(/license plate blank, plain, and unreadable/);
  expect(p).not.toMatch(/exactly as shown/);
  expect(p).not.toMatch(/license plate text exactly/);
  expect(p).toMatch(/realistic outdoor listing photo/);
  expect(p).not.toMatch(/dealership/);
  expect(p).not.toMatch(/light-grey studio/);
  expect(p).toContain(scene.background);
  expect(p).toMatch(/palm trees/);
  expect(p).toMatch(/No houses or residential homes/);
  expect(p).toMatch(/Sign bands stay blank/);
  expect(p).toMatch(/No other readable plates/);
  expect(p).toMatch(/Other cars only far back and blurred/);
  expect(p).toMatch(/roof antenna/);
  expect(p).toMatch(/true paint color and brightness/);
  expect(p).toMatch(/Natural shadows matching the sun/);
  expect(p).toMatch(/Do NOT add badges or parts/);
  const isolated = buildIsolationPrompt("front", { year: 2015, make: "Ford", model: "Fusion", color: "silver" });
  expect(isolated).toMatch(/neutral grey/);
  expect(isolated).toMatch(/license plate blank, plain, and unreadable/);
  expect(isolated).not.toMatch(/exactly as shown/);
  expect(isolated).not.toMatch(/license plate text exactly/);
  for (const s of PHOTO_STUDIO_SCENES) expect(isolated).not.toContain(s.background);
  expect(PHOTO_STUDIO_GENERATIONS_PER_SHOT).toBe(2);
});

test("one car keeps one scene, and all 25 scenes are reachable", () => {
  expect(PHOTO_STUDIO_SCENES).toHaveLength(25);
  expect(new Set(PHOTO_STUDIO_SCENES.map((s) => s.id)).size).toBe(25);
  expect(new Set(PHOTO_STUDIO_SCENES.map((s) => s.name)).size).toBe(25);
  expect(new Set(PHOTO_STUDIO_SCENES.map((s) => s.background)).size).toBe(25);
  for (const s of PHOTO_STUDIO_SCENES) {
    expect(s.background).toMatch(/palm trees/);
    expect(s.background).not.toMatch(/house|home|residential/i);
  }
  const carId = "11111111-1111-4111-8111-111111111111";
  const scene = pickScene(carId);
  expect(pickScene(carId)).toEqual(scene);
  const front = buildPrompt("front", { id: carId });
  const rear = buildPrompt("rear", { id: carId });
  expect(front).toContain(scene.background);
  expect(rear).toContain(scene.background);
  expect(front).not.toContain(PHOTO_STUDIO_SCENES.find((s) => s.id !== scene.id)!.background);
  const seen = new Set<string>();
  let different = "";
  for (let n = 0; n < 400 && (seen.size < 25 || !different); n++) {
    const id = `vehicle-${n}`;
    const picked = pickScene(id);
    seen.add(picked.id);
    if (!different && picked.id !== scene.id) different = id;
  }
  expect(seen.size).toBe(25);
  expect(pickScene(different).id).not.toBe(scene.id);
});
test("vinLast6", () => expect(vinLast6("1FA6P0H74F5118769")).toBe("118769"));

describe("marketing shot notes stay off the photo", () => {
  test("the note is plain text, and Angle Inferred is added only when the angle was inferred", () => {
    expect(marketingShotNote(false)).toBe("AI-Generated");
    expect(marketingShotNote(true)).toBe("AI-Generated · Angle Inferred");
  });

  test("the studio panel prints the note under the image and does not overlay it", () => {
    const panel = readFileSync(new URL("../src/components/admin/PhotoStudioPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("slotReasons");
    expect(panel).toContain("{reason || FAILED_CHECK_ATTENTION}");
    expect(panel).toContain('bg-[#F4F4F6]');
    expect(panel).not.toContain("bg-gradient");
    expect(panel).not.toContain("border-l-");
    expect(panel).toContain("marketingShotNote(");
    expect(panel).not.toContain("absolute left-1 top-1");
    expect(panel).not.toContain("absolute right-1 top-1");
    expect(panel).not.toMatch(/<span[^>]*absolute[^>]*>\s*AI-Generated/);
    expect(panel).not.toMatch(/<span[^>]*absolute[^>]*>\s*\{?Angle Inferred/);
  });

  test("shot actions are icon buttons that stay inside the card", () => {
    const panel = readFileSync(new URL("../src/components/admin/PhotoStudioPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain('size="icon"');
    expect(panel).toContain('variant="ghost"');
    expect(panel).toContain('label="Approve"');
    expect(panel).toContain('label="Reject"');
    expect(panel).toContain('label="Regenerate"');
    expect(panel).toContain("min-w-0");
    expect(panel).toContain("flex-wrap");
    expect(panel).toContain("<Check ");
    expect(panel).toContain("<X ");
    expect(panel).toContain("<RefreshCw ");
    expect(panel).toContain("<Clock ");
    expect(panel).toContain("<CheckCircle ");
    expect(panel).toContain("<XCircle ");
    expect(panel).toContain("aria-label={label}");
    expect(panel).toContain('decide(s.id, "approved")');
    expect(panel).toContain('decide(s.id, "rejected")');
    expect(panel).toContain("run([slot])");
    expect(panel).toContain("marketingShotNote(");
    expect(panel).toContain("{shots.length ? \"Regenerate All\" : \"Generate Shots\"}");
    expect(panel).not.toMatch(/>\s*Approve\s*</);
    expect(panel).not.toMatch(/>\s*Reject\s*</);
    expect(panel).not.toMatch(/>\s*Regenerate\s*</);
  });

  test("public, driver, and fleet photo views do not render those labels", () => {
    const files = [
      "../src/components/site/VehicleCard.tsx",
      "../src/components/site/VehicleDetailView.tsx",
      "../src/components/portal/MyCarCard.tsx",
      "../src/components/portal/DriverStaffPhotos.tsx",
      "../src/components/admin/AvailableCarsBoard.tsx",
      "../src/components/admin/PhotoStudioFleet.tsx",
      "../src/routes/api/public/vehicle-photos/$.ts",
    ];
    for (const file of files) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(text).not.toContain("AI-Generated");
      expect(text).not.toContain("Angle Inferred");
    }
  });
});
