import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fmtDate, fmtDateTime, fmtDateNumeric } from "../src/lib/date-format";
describe("date-format", () => {
  it("preserves date-only calendar dates", () => {
    assert.equal(fmtDate("2026-10-21"), "Oct 21, 2026");
    assert.equal(fmtDate("2026-01-01"), "Jan 1, 2026");
    assert.equal(fmtDateNumeric("2026-10-21"), "10/21/2026");
  });
  it("retains local time formatting for actual instants", () => {
    assert.equal(fmtDateTime(new Date(2026, 9, 11, 7, 30)), "Oct 11, 2026, 7:30 AM");
  });
  it("handles empty and invalid inputs", () => {
    assert.equal(fmtDate(null), ""); assert.equal(fmtDate("nope"), ""); assert.equal(fmtDateNumeric(undefined), "");
  });
});
