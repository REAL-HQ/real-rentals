import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HOLD_VERIFIED_CATEGORIES, holdsVerifiedUntilReview, reviewFollowUp, supersedeQuery } from "../src/lib/insurance-review-hold";

// Insurance keeps every card active now (multi-file sections), so the old
// "verified card stays until the new one is reviewed" hold has nothing to hold.
describe("insurance review hold (retired for multi-file sections)", () => {
  test("no category holds a verified file", () => {
    expect(HOLD_VERIFIED_CATEGORIES).toEqual([]);
    expect(holdsVerifiedUntilReview("insurance", "driver")).toBe(false);
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
  test("reviewing never demotes or supersedes another file", () => {
    expect(reviewFollowUp("insurance", "verified", { is_current: true }, true)).toBe("none");
    expect(reviewFollowUp("insurance", "rejected", { is_current: true }, true)).toBe("none");
    expect(reviewFollowUp("license_front", "verified", { is_current: true }, true)).toBe("none");
  });
  test("single-slot supersede sites still call the helper", () => {
    const src = readFileSync("src/lib/documents.functions.ts", "utf8");
    expect(src.match(/supersedeQuery\(/g)?.length).toBe(2);
  });
});
