/**
 * Length order is a full-list order. Completed and Cancelled page after it.
 * Run: bun test scripts/rental-length-order.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activeLengthDays,
  endedLengthCandidates,
  endedLengthDays,
  heldLengthDays,
  orderByLength,
  pageOf,
} from "../src/lib/rental-length-order";

describe("rental length order", () => {
  it("leaves the existing order alone until a length is picked", () => {
    const rows = [
      { id: "b", days: 1 },
      { id: "a", days: 40 },
    ];
    assert.deepEqual(
      orderByLength(rows, (row) => row.days, "default").map((row) => row.id),
      ["b", "a"],
    );
  });

  it("puts the longest first and keeps a missing length last either way", () => {
    const rows = [
      { id: "missing", days: null as number | null },
      { id: "short", days: 1 },
      { id: "long", days: 40 },
    ];
    const days = (row: (typeof rows)[number]) => row.days;
    assert.deepEqual(
      orderByLength(rows, days, "longest").map((row) => row.id),
      ["long", "short", "missing"],
    );
    assert.deepEqual(
      orderByLength(rows, days, "shortest").map((row) => row.id),
      ["short", "long", "missing"],
    );
  });

  it("pages the ordered list, not one page of the old order", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `r${String(i).padStart(2, "0")}`, days: i }));
    const ordered = orderByLength(rows, (row) => row.days, "longest");
    const page1 = pageOf(ordered, 1, 25);
    const page2 = pageOf(ordered, 2, 25);
    assert.equal(page1[0].id, "r29");
    assert.equal(page1[24].id, "r05");
    assert.equal(page2[0].id, "r04");
    assert.equal(page2.length, 5);
    assert.equal(pageOf(ordered, 1, 25).some((row) => row.id === "r04"), false);
  });

  it("measures active time from the start date and reserved time from the held date", () => {
    assert.equal(activeLengthDays("2026-11-20", "2026-11-26"), 6);
    assert.equal(activeLengthDays("2026-12-01", "2026-11-26"), 0);
    assert.equal(activeLengthDays(null, "2026-11-26"), null);
    assert.equal(heldLengthDays("2026-11-01T04:30:00.000Z", "2026-11-26"), 25);
    assert.equal(endedLengthDays("2026-05-01", "2026-05-15"), 14);
    assert.equal(endedLengthDays("2026-05-15", "2026-05-01"), null);
    assert.equal(endedLengthDays("2026-05-01", null), null);
  });

  it("keeps search-scoped ended rows and drops anything outside the tab", () => {
    const spans = [
      { id: "active", status: "active", startDate: "2026-01-01", endDate: null },
      { id: "long", status: "ended", startDate: "2026-01-01", endDate: "2026-04-01" },
      { id: "short", status: "ended", startDate: "2026-06-01", endDate: "2026-06-02" },
      { id: "swap", status: "cancelled", startDate: "2026-03-01", endDate: null },
    ];
    const present = (span: (typeof spans)[number]) =>
      span.id === "swap"
        ? { phase: "swap", endDate: "2026-08-01" }
        : { phase: span.status === "ended" ? "completed" : span.status, endDate: span.endDate };
    const completed = endedLengthCandidates(spans, present, {
      statusFilter: ["ended", "completed"],
      scope: "completed",
      phase: "all",
      showsEnded: true,
    });
    assert.deepEqual(
      orderByLength(completed, (row) => row.days, "longest").map((row) => row.id),
      ["long", "short"],
    );
    const cancelled = endedLengthCandidates(
      spans.filter((span) => span.id === "swap" || span.id === "short"),
      present,
      {
        statusFilter: ["cancelled", "canceled"],
        scope: "cancelled",
        phase: "all",
        showsEnded: true,
      },
    );
    assert.deepEqual(cancelled.map((row) => row.id), ["swap"]);
    assert.equal(cancelled[0].days, endedLengthDays("2026-03-01", "2026-08-01"));
  });
});
