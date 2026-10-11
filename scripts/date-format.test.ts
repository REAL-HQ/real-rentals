import { describe, it, expect } from "vitest";
import { fmtDate, fmtDateTime, fmtDateNumeric } from "../src/lib/date-format";

describe("date-format", () => {
  it("date-only strings never shift by timezone", () => {
    expect(fmtDate("2026-10-11")).toBe("Oct 11, 2026");
    expect(fmtDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(fmtDateNumeric("2026-10-11")).toBe("10/11/2026");
  });
  it("date with time", () => {
    expect(fmtDateTime(new Date(2026, 9, 11, 7, 30))).toBe("Oct 11, 2026, 7:30 AM");
  });
  it("empty/invalid", () => {
    expect(fmtDate(null)).toBe("");
    expect(fmtDate("nope")).toBe("");
    expect(fmtDateNumeric(undefined)).toBe("");
  });
});
