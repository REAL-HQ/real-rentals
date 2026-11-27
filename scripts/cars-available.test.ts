import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseCarsAvailable } from "../src/lib/cars-available";

describe("parseCarsAvailable", () => {
  test("SQL null and empty stay not set, never 0", () => {
    expect(parseCarsAvailable(null)).toBeNull();
    expect(parseCarsAvailable(undefined)).toBeNull();
    expect(parseCarsAvailable("")).toBeNull();
  });

  test("accepts a whole number ≥ 0, including 0 (intentional waitlist mode)", () => {
    expect(parseCarsAvailable(0)).toBe(0);
    expect(parseCarsAvailable(5)).toBe(5);
    expect(parseCarsAvailable("0")).toBe(0);
    expect(parseCarsAvailable("5")).toBe(5);
  });

  test("rejects booleans, fractions, and negatives", () => {
    expect(parseCarsAvailable(true)).toBeNull();
    expect(parseCarsAvailable(false)).toBeNull();
    expect(parseCarsAvailable(1.5)).toBeNull();
    expect(parseCarsAvailable(-1)).toBeNull();
    expect(parseCarsAvailable("nope")).toBeNull();
  });
});

describe("getAvailability wiring", () => {
  const src = readFileSync("src/lib/waitlist.functions.ts", "utf8");
  const hero = readFileSync("src/components/site/CityHeroLeadForm.tsx", "utf8");

  test("city pages use the parser so a cleared override is not 0", () => {
    expect(src).toContain("parseCarsAvailable(data)");
    expect(src).not.toMatch(/const n = typeof data === "number" \? data : Number\(data\)/);
  });

  test("the hero follows the server waitlistMode flag, not a local === 0 check", () => {
    expect(hero).toContain("setWaitlistMode(r.waitlistMode === true)");
    expect(hero).not.toContain("const waitlistMode = availability === 0");
    // A failed or still-loading read must not look like 0 cars or flip to waitlist.
    expect(hero).toContain("setAvailability(null)");
    expect(hero).toContain("setWaitlistMode(false)");
  });

  test("getAvailability computes waitlistMode from the override and the real count", () => {
    expect(src).toContain("publicWaitlistMode(carsAvailable, fleetAvailable)");
    expect(src).toContain("parseCarsAvailable(data)");
  });
});
