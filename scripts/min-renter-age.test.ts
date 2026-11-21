// Minimum renter age is 23 (Dolmar, Nov 21 2026, 2:37 PM ET): matches Uber's
// minimum driver age in Florida. One constant (src/lib/renter-age.ts) drives
// FLEET review, readiness, screening, public copy and the v1.15 agreement.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MIN_RENTER_AGE, MIN_AGE_FAQ, UNDER_MIN_AGE_LABEL } from "../src/lib/renter-age";
import { V115_TERM_DEFAULTS, V115_SOURCE } from "../src/lib/agreement-v115";
import { V116_TERM_DEFAULTS, V116_SOURCE } from "../src/lib/agreement-v116";
import { V114_TERM_DEFAULTS } from "../src/lib/agreement-v114";
import { resolveTerms, writeTerms } from "../src/lib/agreement-builder";
import { FLEET_ESCALATION_DEFAULTS } from "../src/lib/fleet-review";

const read = (p: string) => readFileSync(p, "utf8");
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

describe("minimum renter age 23", () => {
  test("one constant, and every rule uses it", () => {
    expect(MIN_RENTER_AGE).toBe(23);
    expect(UNDER_MIN_AGE_LABEL).toBe("Driver under 23");
    expect(FLEET_ESCALATION_DEFAULTS.minAge).toBe(23);
    expect(FLEET_ESCALATION_DEFAULTS.youngDriverAge).toBe(23);
    expect(read("src/lib/readiness.ts")).toContain("age < MIN_RENTER_AGE");
    expect(read("src/components/admin/DriverScreening.tsx")).toContain("s.driver_age < MIN_RENTER_AGE");
    expect(read("src/components/admin/DriverScreening.tsx")).toContain("`Driver Under ${MIN_RENTER_AGE}`");
  });

  test("FAQ entry: wording, and it is on /faq, the home page and every city page", () => {
    expect(MIN_AGE_FAQ.q).toBe("How old do I have to be to rent?");
    expect(MIN_AGE_FAQ.a).toBe("You must be at least 23 with a valid U.S. driver's license. That matches Uber's minimum driver age in Florida, so every renter can drive for Uber right away.");
    // Never an insurer, broker or rep; never "deposit".
    expect(MIN_AGE_FAQ.a).not.toMatch(/insur|broker|agent|\brep\b|deposit/i);
    for (const f of ["src/routes/faq.tsx", "src/routes/index.tsx", "src/routes/$slug.tsx"]) {
      expect(read(f)).toMatch(/^\s*MIN_AGE_FAQ,$/m);
    }
  });

  test("no public page still says 21 or 25 is old enough", () => {
    const files = [...walk("src/routes"), ...walk("src/components/site"), ...walk("src/components/portal")]
      .filter((f) => !/src\/routes\/admin\.tsx$|src\/routes\/api\//.test(f));
    const stale = /\b2[15]\s*\+|\b2[15]\s+(years|or older)\b|at least 2[15]\b|\b2[15] Years Or Older/i;
    const hits = files.filter((f) => stale.test(read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")));
    expect(hits).toEqual([]);
    // /tampa (and every city page) prints the constant.
    expect(read("src/routes/$slug.tsx")).toContain("`Active U.S. driver's license, ${MIN_RENTER_AGE} or older.");
    expect(read("src/routes/terms.tsx")).toContain("You must be at least {MIN_RENTER_AGE} years old");
    expect(read("src/routes/how-it-works.tsx")).toContain("`${MIN_RENTER_AGE} Years Or Older`");
  });

  test("v1.15 agreement prints 23 for economy (premium stays 25); v1.14 keeps its signed wording", () => {
    expect(V115_TERM_DEFAULTS.min_age_economy).toBe(String(MIN_RENTER_AGE));
    expect(V115_TERM_DEFAULTS.min_age_premium).toBe("25");
    const body = resolveTerms(writeTerms(V115_SOURCE, V115_TERM_DEFAULTS));
    expect(body).toContain("be at least 23 to rent an economy vehicle and at least 25 to rent a luxury or premium vehicle");
    expect(V114_TERM_DEFAULTS.min_age_economy).toBe("21");
    expect(V116_TERM_DEFAULTS.min_age_economy).toBe(String(MIN_RENTER_AGE));
    expect(resolveTerms(writeTerms(V116_SOURCE, V116_TERM_DEFAULTS))).toContain("be at least 23 to rent an economy vehicle and at least 25 to rent a luxury or premium vehicle");
  });
});
