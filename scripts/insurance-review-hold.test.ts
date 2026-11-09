import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { holdsVerifiedUntilReview, reviewFollowUp, supersedeQuery } from "../src/lib/insurance-review-hold";

describe("insurance review hold", () => {
  test("only renter insurance uploads hold", () => {
    expect(holdsVerifiedUntilReview("insurance", "driver")).toBe(true);
    expect(holdsVerifiedUntilReview("insurance", undefined)).toBe(true);
    expect(holdsVerifiedUntilReview("insurance", "admin")).toBe(false);
    expect(holdsVerifiedUntilReview("license_front", "driver")).toBe(false);
  });
  test("supersede skips verified rows only when holding", () => {
    const calls: string[] = [];
    const q: any = { neq: (c: string, v: string) => (calls.push(`${c}!=${v}`), q) };
    supersedeQuery(q, false);
    expect(calls).toEqual([]);
    supersedeQuery(q, true);
    expect(calls).toEqual(["review_status!=verified"]);
  });
  test("review follow-ups", () => {
    expect(reviewFollowUp("insurance", "verified", { is_current: true }, true)).toBe("supersede_others");
    expect(reviewFollowUp("insurance", "rejected", { is_current: true }, true)).toBe("demote_rejected");
    expect(reviewFollowUp("insurance", "rejected", { is_current: true }, false)).toBe("none");
    expect(reviewFollowUp("insurance", "uploaded", { is_current: true }, true)).toBe("none");
    expect(reviewFollowUp("insurance", "verified", { is_current: false }, true)).toBe("none");
    expect(reviewFollowUp("license_front", "verified", { is_current: true }, true)).toBe("none");
  });
  test("both supersede sites and the review step are wired", () => {
    const src = readFileSync("src/lib/documents.functions.ts", "utf8");
    expect(src.match(/supersedeQuery\(/g)?.length).toBe(2);
    expect(src).toMatch(/holdsVerifiedUntilReview\(args\.category/);
    expect(src).toMatch(/holdsVerifiedUntilReview\(fields\.category, fields\.uploaded_by_role\)/);
    expect(src).toMatch(/follow === "supersede_others"/);
  });
});
