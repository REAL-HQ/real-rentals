import { describe, expect, test } from "bun:test";
import {
  ADMIN_ROLE_SUBSECTION,
  CONDITION_SECTIONS,
  ROLE_SUBSECTION,
  formatGps,
  groupConditionPhotos,
  phaseLabel,
  roleLabel,
  roleSubsection,
  sectionForPhase,
} from "../src/lib/condition-photos";
import { parseConditionExif } from "../src/lib/condition-exif";

describe("section titles", () => {
  test("are 1–2 words", () => {
    for (const s of CONDITION_SECTIONS) {
      expect(s.title.split(/\s+/).length).toBeLessThanOrEqual(2);
      expect(s.title.length).toBeLessThanOrEqual(12);
    }
    expect(CONDITION_SECTIONS.map((s) => s.title)).toEqual(["Pickup", "Return", "Issues"]);
    expect(ROLE_SUBSECTION).toEqual({ staff: "Ours", driver: "Yours" });
    expect(ADMIN_ROLE_SUBSECTION).toEqual({ staff: "Ours", driver: "Renter" });
    expect(roleSubsection("staff", "staff")).toBe("Ours");
    expect(roleSubsection("driver", "staff")).toBe("Renter");
    expect(roleSubsection("driver", "renter")).toBe("Yours");
  });
});

describe("phase mapping", () => {
  test("checkout → pickup, checkin → return, damage/other → during (Issues)", () => {
    expect(sectionForPhase("checkout")).toBe("pickup");
    expect(sectionForPhase("pickup")).toBe("pickup");
    expect(sectionForPhase("checkin")).toBe("return");
    expect(sectionForPhase("return")).toBe("return");
    expect(sectionForPhase("damage")).toBe("during");
    expect(sectionForPhase("other")).toBe("during");
    expect(sectionForPhase("weird")).toBe("during");
  });

  test("damage/other never group under Return", () => {
    const grouped = groupConditionPhotos([
      { id: "1", phase: "checkout", capturedByRole: "staff" },
      { id: "2", phase: "checkin", capturedByRole: "driver" },
      { id: "3", phase: "damage", capturedByRole: "driver" },
      { id: "4", phase: "other", capturedByRole: "staff" },
    ]);
    expect(grouped.return.driver.map((p) => p.id)).toEqual(["2"]);
    expect(grouped.return.staff).toEqual([]);
    expect(grouped.during.driver.map((p) => p.id)).toEqual(["3"]);
    expect(grouped.during.staff.map((p) => p.id)).toEqual(["4"]);
    expect(grouped.pickup.staff.map((p) => p.id)).toEqual(["1"]);
  });
});

describe("labels", () => {
  test("friendly role labels", () => {
    expect(roleLabel("staff")).toBe("Ours");
    expect(roleLabel("driver")).toBe("Yours");
    expect(phaseLabel("checkout")).toBe("Pickup");
    expect(phaseLabel("checkin")).toBe("Return");
  });
});

describe("admin mapping", () => {
  test("return-named phases group under Return, not Issues", () => {
    const grouped = groupConditionPhotos([
      { id: "c", phase: "Checkout", capturedByRole: "staff" },
      { id: "r", phase: "return", capturedByRole: "driver" },
    ]);
    expect(grouped.pickup.staff.map((p) => p.id)).toEqual(["c"]);
    expect(grouped.return.driver.map((p) => p.id)).toEqual(["r"]);
    expect(grouped.during.staff).toEqual([]);
    expect(grouped.during.driver).toEqual([]);
  });

  test("formatGps is staff-ready and null when incomplete", () => {
    expect(formatGps(26.14123, -80.12345)).toBe("26.14123, -80.12345");
    expect(formatGps(null, -80.1)).toBeNull();
    expect(formatGps(26.1, undefined)).toBeNull();
    expect(formatGps(Number.NaN, -80)).toBeNull();
  });
});

describe("EXIF parse", () => {
  test("empty buffer falls back to upload", async () => {
    const fallback = new Date("2026-11-05T12:00:00Z");
    const r = await parseConditionExif(new Uint8Array(), fallback);
    expect(r.takenAtSource).toBe("upload");
    expect(r.missingExifTime).toBe(true);
    expect(r.takenAt?.toISOString()).toBe(fallback.toISOString());
    expect(r.gpsLat).toBeNull();
  });

  test("minimal non-JPEG bytes fall back", async () => {
    const bytes = new TextEncoder().encode("not-an-image");
    const r = await parseConditionExif(bytes, new Date("2026-01-01T00:00:00Z"));
    expect(r.takenAtSource).toBe("upload");
    expect(r.missingExifTime).toBe(true);
  });
});
