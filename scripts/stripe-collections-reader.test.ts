// Isolated verification of the Stripe Collections reader that PR #266
// refactored. Every Stripe response here is a literal object handed to an
// injected read function. No Stripe client is constructed, no credential is
// read, no network call is made, and no customer data is touched.
//
// Preview cannot exercise this path at all (it has no Stripe secret), so this
// is the only pre-publish evidence that the refactor preserves behaviour.
//
// Run: bun test scripts/stripe-collections-reader.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STRIPE_READER_MAX_PAGES,
  STRIPE_READER_TTL_MS,
  STRIPE_READER_TIMEOUT_MS,
  StripeTemporarilyUnavailable,
  isStripeTemporarilyUnavailable,
  paginateStripeList,
} from "../src/lib/stripe-reader.ts";
import {
  aggregateCollections,
  collectionsWindow,
  readAllPages,
  type CollectionCharge,
  type CollectionRefund,
  type CollectionSubscription,
} from "../src/lib/stripe-collections.ts";

/** A fake Stripe list: pages of rows, cursor-driven, exactly like the API. */
function pagedReader(pages: { id: string }[][]) {
  let calls = 0;
  const read = async (cursor?: string) => {
    calls++;
    const index = cursor === undefined ? 0 : pages.findIndex((p) => p.at(-1)?.id === cursor) + 1;
    const data = pages[index] ?? [];
    return { data, has_more: index < pages.length - 1 };
  };
  return { read, calls: () => calls };
}

const charge = (over: Partial<CollectionCharge> = {}): CollectionCharge => ({
  id: "ch_1", customerId: "cus_1", currency: "usd", amount: 35000, fee: 1045,
  created: 1000, paid: true, captured: true, status: "succeeded", ...over,
} as CollectionCharge);

const refund = (over: Partial<CollectionRefund> = {}): CollectionRefund => ({
  id: "re_1", chargeId: "ch_1", currency: "usd", amount: 5000, fee: 0,
  created: 1000, status: "succeeded", ...over,
} as CollectionRefund);

const WINDOW = { gte: 0, lt: 10_000 };

describe("Stripe collections reader — pagination", () => {
  it("walks every page and returns all rows", async () => {
    const p = pagedReader([[{ id: "a" }, { id: "b" }], [{ id: "c" }], [{ id: "d" }]]);
    const rows = await readAllPages(p.read as any);
    assert.deepEqual(rows.map((r: any) => r.id).sort(), ["a", "b", "c", "d"]);
    assert.equal(p.calls(), 3, "did not request exactly one call per page");
  });

  it("collapses a row repeated across pages — a duplicate cannot be collected twice", async () => {
    // Stripe can repeat a row across page boundaries when data shifts underneath.
    const p = pagedReader([[{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]]);
    const rows = await readAllPages(p.read as any);
    assert.deepEqual(rows.map((r: any) => r.id).sort(), ["a", "b", "c"]);
    assert.equal(rows.length, 3, "a duplicate id was counted twice");
  });

  it("refuses a partial total when a cursor stops advancing", async () => {
    const read = async () => ({ data: [{ id: "same" }], has_more: true });
    await assert.rejects(() => readAllPages(read as any), /Stripe pagination incomplete/);
  });

  it("refuses a partial total at the page cap rather than returning one", async () => {
    const read = async (cursor?: string) => ({
      data: [{ id: `row_${cursor ?? "0"}_${Math.random()}` }], has_more: true,
    });
    await assert.rejects(
      () => readAllPages(read as any),
      /exceeds the safe page limit; no partial totals returned/,
      "a capped read returned a total instead of refusing",
    );
  });

  it("stops at exactly STRIPE_READER_MAX_PAGES requests", async () => {
    let calls = 0;
    const read = async () => { calls++; return { data: [{ id: `r${calls}` }], has_more: true }; };
    const out = await paginateStripeList(read, { label: "t", dedupe: true });
    assert.deepEqual(out, { ok: false, reason: "capped" });
    assert.equal(calls, STRIPE_READER_MAX_PAGES);
  });
});

describe("Stripe collections reader — failures and timeouts", () => {
  it("a past deadline raises StripeTemporarilyUnavailable before reading", async () => {
    let called = false;
    const read = async () => { called = true; return { data: [], has_more: false }; };
    await assert.rejects(
      () => paginateStripeList(read, { label: "t", deadline: 100, now: () => 500 }),
      (e: unknown) => e instanceof StripeTemporarilyUnavailable,
    );
    assert.equal(called, false, "it read Stripe after the deadline had passed");
  });

  it("a rate limit becomes StripeTemporarilyUnavailable, not a raw provider error", async () => {
    const read = async () => { throw Object.assign(new Error("slow down"), { statusCode: 429 }); };
    await assert.rejects(
      () => paginateStripeList(read, { label: "t" }),
      (e: unknown) => e instanceof StripeTemporarilyUnavailable,
    );
  });

  it("a connection timeout becomes StripeTemporarilyUnavailable", async () => {
    for (const shape of [{ code: "ETIMEDOUT" }, { name: "AbortError" }, { type: "StripeConnectionError" }]) {
      const read = async () => { throw Object.assign(new Error("x"), shape); };
      await assert.rejects(
        () => paginateStripeList(read, { label: "t" }),
        (e: unknown) => e instanceof StripeTemporarilyUnavailable,
        `${JSON.stringify(shape)} was not treated as temporary`,
      );
    }
  });

  it("an ordinary provider error is NOT disguised as a timeout", async () => {
    const read = async () => { throw Object.assign(new Error("No such customer"), { statusCode: 404 }); };
    await assert.rejects(
      () => paginateStripeList(read, { label: "t" }),
      (e: unknown) => e instanceof Error && /No such customer/.test(e.message) && !isStripeTemporarilyUnavailable(e),
    );
  });

  it("an aborted signal stops the walk", async () => {
    const controller = new AbortController();
    controller.abort();
    const read = async () => ({ data: [{ id: "a" }], has_more: true });
    await assert.rejects(() => paginateStripeList(read, { label: "t", signal: controller.signal }));
  });

  it("a malformed page is reported, not silently treated as the end", async () => {
    const read = async () => ({ data: [{ id: "a" }] } as any);
    const out = await paginateStripeList(read, { label: "t", strict: true });
    assert.deepEqual(out, { ok: false, reason: "malformed" });
  });
});

describe("Stripe collections reader — gross, refunds, fees, net", () => {
  it("reports gross, refunds, fees and net for one currency", async () => {
    const out = aggregateCollections({
      charges: [charge({ id: "ch_1", amount: 35000, fee: 1045 }), charge({ id: "ch_2", amount: 20000, fee: 610 })],
      refunds: [refund({ id: "re_1", chargeId: "ch_1", amount: 5000, fee: 0 })],
      subscriptions: [], window: WINDOW, now: 5000,
    });
    const usd = out.totals.find((t) => t.currency === "usd")!;
    assert.equal(usd.gross, 55000);
    assert.equal(usd.refunds, 5000);
    assert.equal(usd.fees, 1655);
    assert.equal(usd.net, 55000 - 5000 - 1655, "net is not gross minus refunds minus fees");
    assert.equal(usd.successful, 2);
  });

  it("an unknown fee makes net unknown rather than wrong", async () => {
    const out = aggregateCollections({
      charges: [charge({ id: "ch_1", fee: null as any })],
      refunds: [], subscriptions: [], window: WINDOW, now: 5000,
    });
    const usd = out.totals.find((t) => t.currency === "usd")!;
    assert.equal(usd.fees, null);
    assert.equal(usd.net, null, "net was computed from an unknown fee");
  });

  it("counts failed charges without adding them to gross", async () => {
    const out = aggregateCollections({
      charges: [charge({ id: "ch_1" }), charge({ id: "ch_f", status: "failed", paid: false, captured: false })],
      refunds: [], subscriptions: [], window: WINDOW, now: 5000,
    });
    const usd = out.totals.find((t) => t.currency === "usd")!;
    assert.equal(usd.gross, 35000);
    assert.equal(usd.successful, 1);
    assert.equal(usd.failed, 1);
  });

  it("ignores charges and refunds outside the window", async () => {
    const out = aggregateCollections({
      charges: [charge({ id: "ch_old", created: -1 }), charge({ id: "ch_new", created: 99_999 })],
      refunds: [refund({ id: "re_old", chargeId: "ch_old", created: -1 })],
      subscriptions: [], window: WINDOW, now: 5000,
    });
    assert.equal(out.totals.length, 0, "a charge outside the window was counted");
  });

  it("does not subtract a refund in a different currency from its charge", async () => {
    const out = aggregateCollections({
      charges: [charge({ id: "ch_1", currency: "usd", amount: 35000, fee: 0 })],
      refunds: [refund({ id: "re_1", chargeId: "ch_1", currency: "eur", amount: 5000 })],
      subscriptions: [], window: WINDOW, now: 5000,
    });
    const usd = out.totals.find((t) => t.currency === "usd")!;
    assert.equal(usd.refunds, 0, "a cross-currency refund was subtracted");
  });

  it("keeps currencies in separate buckets", async () => {
    const out = aggregateCollections({
      charges: [charge({ id: "ch_1", currency: "usd", amount: 100, fee: 1 }),
                charge({ id: "ch_2", currency: "eur", amount: 200, fee: 2 })],
      refunds: [], subscriptions: [], window: WINDOW, now: 5000,
    });
    assert.equal(out.totals.length, 2);
    assert.equal(out.totals.find((t) => t.currency === "usd")!.gross, 100);
    assert.equal(out.totals.find((t) => t.currency === "eur")!.gross, 200);
  });

  it("a charge or refund delivered twice is counted once", async () => {
    const out = aggregateCollections({
      charges: [charge({ id: "ch_1" }), charge({ id: "ch_1" })],
      refunds: [refund({ id: "re_1" }), refund({ id: "re_1" })],
      subscriptions: [], window: WINDOW, now: 5000,
    });
    const usd = out.totals.find((t) => t.currency === "usd")!;
    assert.equal(usd.gross, 35000, "a duplicate charge inflated gross");
    assert.equal(usd.refunds, 5000, "a duplicate refund was subtracted twice");
    assert.equal(usd.successful, 1);
  });

  it("counts only active subscriptions and de-duplicates them", async () => {
    const sub = (id: string, status: string): CollectionSubscription =>
      ({ id, customerId: "cus_1", name: "A", status, nextAt: 1 } as CollectionSubscription);
    const out = aggregateCollections({
      charges: [], refunds: [],
      subscriptions: [sub("sub_1", "active"), sub("sub_1", "active"), sub("sub_2", "canceled")],
      window: WINDOW, now: 5000,
    });
    assert.equal(out.subscriptions.length, 2);
    assert.equal(out.activeSubscriptions, 1);
  });
});

describe("Stripe collections reader — production behaviour preserved", () => {
  // The implementation PR #266 replaced, transcribed from the diff. Both are
  // run over the same pages and must agree.
  async function legacyReadAllPages<T extends { id: string }>(
    read: (cursor?: string) => Promise<{ data: T[]; has_more: boolean }>,
  ): Promise<T[]> {
    const rows = new Map<string, T>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const result = await read(cursor);
      for (const row of result.data) rows.set(row.id, row);
      if (!result.has_more) return [...rows.values()];
      const next = result.data.at(-1)?.id;
      if (!next || next === cursor) throw new Error("Stripe pagination incomplete");
      cursor = next;
    }
    throw new Error("Stripe report exceeds the safe page limit; no partial totals returned");
  }

  const cases: { name: string; pages: { id: string }[][] }[] = [
    { name: "single page", pages: [[{ id: "a" }]] },
    { name: "three pages", pages: [[{ id: "a" }, { id: "b" }], [{ id: "c" }], [{ id: "d" }]] },
    { name: "repeat across a boundary", pages: [[{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]] },
    { name: "empty final page", pages: [[{ id: "a" }], []] },
  ];

  for (const c of cases) {
    it(`matches the pre-refactor result: ${c.name}`, async () => {
      const a = await readAllPages(pagedReader(c.pages).read as any);
      const b = await legacyReadAllPages(pagedReader(c.pages).read as any);
      assert.deepEqual(
        a.map((r: any) => r.id).sort(), b.map((r: any) => r.id).sort(),
        "the refactored reader returned a different set of rows",
      );
    });
  }

  it("matches the pre-refactor failure on a stalled cursor", async () => {
    const read = async () => ({ data: [{ id: "same" }], has_more: true });
    await assert.rejects(() => readAllPages(read as any), /Stripe pagination incomplete/);
    await assert.rejects(() => legacyReadAllPages(read as any), /Stripe pagination incomplete/);
  });

  it("keeps the same page cap and window shape as production", () => {
    assert.equal(STRIPE_READER_MAX_PAGES, 100, "the page cap moved away from the pre-refactor 100");
    const w = collectionsWindow({ from: "2026-10-01T00:00:00Z", to: "2026-10-07T00:00:00Z" });
    assert.ok(w && typeof w.gte === "number" && typeof w.lt === "number" && w.lt > w.gte);
  });

  it("documents the cache contract the refactor introduced", () => {
    // The TTL cache lives in stripe-reader.server.ts and is only reachable
    // through a constructed Stripe client, so it cannot be exercised without a
    // credential. The constants are pinned here so a silent change is caught.
    assert.equal(STRIPE_READER_TTL_MS, 60_000);
    assert.equal(STRIPE_READER_TIMEOUT_MS, 20_000);
  });
});
