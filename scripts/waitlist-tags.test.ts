import { describe, expect, it } from "vitest";
import {
  filterWaitlistByTag,
  normalizeWaitlistTags,
  validateWaitlistTags,
  waitlistLocation,
} from "../src/lib/waitlist-tags";

describe("Waitlist staff tags", () => {
  it("trims, collapses whitespace and removes case-only duplicates", () => {
    expect(normalizeWaitlistTags(["  Hot ", "Needs   Callback", "hot", "", "Has Vehicle"])).toEqual([
      "Hot",
      "Needs Callback",
      "Has Vehicle",
    ]);
  });

  it("allows clearing every tag", () => {
    expect(validateWaitlistTags([])).toEqual([]);
  });

  it("refuses more than 12 tags", () => {
    expect(() => validateWaitlistTags(Array.from({ length: 13 }, (_, i) => `Tag ${i + 1}`))).toThrow(
      "no more than 12",
    );
  });

  it("refuses tags longer than 40 characters", () => {
    expect(() => validateWaitlistTags(["x".repeat(41)])).toThrow("40 characters");
  });

  it("filters by the whole tag without case-sensitive misses", () => {
    const entries = [
      { id: "one", tags: ["Hot", "Needs Callback"] },
      { id: "two", tags: ["Has Vehicle"] },
      { id: "three", tags: [] },
    ];
    expect(filterWaitlistByTag(entries, "needs callback").map((entry) => entry.id)).toEqual(["one"]);
    expect(filterWaitlistByTag(entries, "").map((entry) => entry.id)).toEqual(["one", "two", "three"]);
  });

  it("formats city and state without inventing a location", () => {
    expect(waitlistLocation("Orlando", "FL")).toBe("Orlando, FL");
    expect(waitlistLocation("Miami", null)).toBe("Miami");
    expect(waitlistLocation(null, null)).toBe("Location Not Set");
  });
});
