// PR 461: every status label reads in Title Case. Display only; stored values never change.
// Run: bun test scripts/status-title-case.test.ts
import { describe, expect, test } from "bun:test";
import { formatStatusLabel } from "../src/lib/ui-display-labels";
import { applicationStatusLabel } from "../src/lib/application-status";

describe("formatStatusLabel", () => {
  test("lower-case and snake_case statuses read in Title Case", () => {
    expect(formatStatusLabel("partial")).toBe("Partial");
    expect(formatStatusLabel("declined")).toBe("Declined");
    expect(formatStatusLabel("past_due")).toBe("Past Due");
    expect(formatStatusLabel("partially_paid")).toBe("Partially Paid");
    expect(formatStatusLabel("Past-Due")).toBe("Past Due");
  });
  test("empty values show a dash", () => {
    expect(formatStatusLabel(null)).toBe("—");
    expect(formatStatusLabel(undefined)).toBe("—");
    expect(formatStatusLabel("  ")).toBe("—");
  });
});

describe("applicationStatusLabel", () => {
  test("known statuses use their labels", () => {
    expect(applicationStatusLabel("partial")).toBe("Partial");
    expect(applicationStatusLabel("declined")).toBe("Declined");
  });
  test("an unknown status falls back to Title Case, empty reads Select Status", () => {
    expect(applicationStatusLabel("needs_follow_up")).toBe("Needs Follow Up");
    expect(applicationStatusLabel("past_due")).toBe("Past Due");
    expect(applicationStatusLabel("")).toBe("Select Status");
    expect(applicationStatusLabel(null)).toBe("Select Status");
  });
});
