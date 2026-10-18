import { describe, expect, it } from "vitest";
import { c1SourceContract, mapFinanceSource } from "../src/lib/unified-finance-live-mapping";
import { readIsolatedDatabaseSource } from "../src/lib/unified-finance-db-readers.server";
import { actor, client, facts, ledger } from "./fixtures/unified-finance-live-readers";
import type { C1Projection, SourceEvidence, RawSources } from "../src/lib/unified-finance-source-contracts";

const evidence: SourceEvidence = { customerId: "synthetic-customer", verified: true, feeCents: 0, currency: "USD", method: "cash", identities: [], cashDate: "2026-10-18", kind: "collection" };
const projection = { id: "synthetic-expense", amount: "50.00", currency: "USD", txn_type: "expense", status: "posted", direction: "out", sensitivity: "owner_only", recognition_date: "2026-10-18", cash_date: "2026-10-18", rental_id: null, payment_id: null, expense_id: null, reverses_id: null, corrects_id: null } satisfies C1Projection;

describe("Confirmed reader classification and completeness regressions", () => {
  it.each(["admin", "team"])("%s unknown visibility is incomplete, not an authorized empty result", async role => {
    const unknown = { ...ledger(), visibility: "unverified", id: "PRIVATE-UNKNOWN" } as unknown as RawSources["ledger"];
    const r = await readIsolatedDatabaseSource(client({ ledger: { rows: [unknown], nextCursor: null, complete: true } }, [role]), actor, "ledger");
    expect(r.coverage.state).toBe("incomplete"); expect(r.rows).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("PRIVATE-UNKNOWN");
  });
  it.each(["admin", "team"])("%s mixed visibility preserves authorized facts but not complete coverage", async role => {
    const known = ledger({ id: "operating", transactionId: "operating", amountCents: 1000 });
    const secret = ledger({ id: "OWNER-SECRET", transactionId: "OWNER-SECRET", visibility: "owner_only", amountCents: 990000 });
    const unknown = { ...ledger(), visibility: null } as unknown as RawSources["ledger"];
    const r = await readIsolatedDatabaseSource(client({ ledger: { rows: [known, secret, unknown], nextCursor: null, complete: true } }, [role]), actor, "ledger");
    expect(r.coverage.state).toBe("incomplete"); expect(r.rows).toHaveLength(role === "admin" ? 2 : 1);
    if (role === "team") { expect(JSON.stringify(r)).not.toContain("OWNER-SECRET"); expect(JSON.stringify(r)).not.toContain("990000"); }
  });
  it.each(["admin", "team"])("%s verified empty source remains complete", async role => {
    const r = await readIsolatedDatabaseSource(client({}, [role]), actor, "ledger");
    expect(r.coverage.state).toBe("complete"); expect(r.rows).toEqual([]);
  });
  it("known Owner-only exclusion is complete only within Manager operating scope", async () => {
    const r = await readIsolatedDatabaseSource(client({ ledger: { rows: [ledger({ visibility: "owner_only" })], complete: true, nextCursor: null } }, ["team"]), actor, "ledger");
    expect(r.coverage.state).toBe("complete"); expect(r.rows).toEqual([]);
  });
  it("permission failure is unavailable rather than an empty complete result", async () => {
    const c = client(); c.readPage = async () => { throw new Error("Denied"); };
    const r = await readIsolatedDatabaseSource(c, actor, "ledger"); expect(r.coverage.state).toBe("unavailable"); expect(r.rows).toEqual([]);
  });
  it("incomplete later page discards partial financial rows", async () => {
    const c = client(); let page = 0;
    c.readPage = async () => (++page === 1 ? { rows: [ledger()], nextCursor: "next", complete: true } : { rows: [], nextCursor: null, complete: false }) as never;
    const r = await readIsolatedDatabaseSource(c, actor, "ledger"); expect(r.coverage.state).toBe("incomplete"); expect(r.rows).toEqual([]);
  });
  it.each(["unknown", null, undefined])("unknown C1 sensitivity %s is refused before defaulting to operating", sensitivity => {
    expect(() => c1SourceContract({ ...projection, sensitivity } as unknown as C1Projection, evidence)).toThrow();
  });
  it.each(["acquisition", "financing", "lien", "payoff"])("%s expense is not classified as operating", category => {
    expect(() => c1SourceContract({ ...projection, category }, evidence)).toThrow();
  });
  it("missing expense category cannot certify operating classification", () => {
    expect(() => c1SourceContract(projection, evidence)).toThrow();
  });
  it("explicit repair category retains operating classification", () => {
    expect(c1SourceContract({ ...projection, category: "repair" }, evidence).kind).toBe("operating_expense");
  });
  it("unknown financial kind has no representation and incomplete source coverage", async () => {
    const row = { ...facts(), kind: "unrecognized", paymentId: "synthetic-payment", visibility: "operating" } as unknown as RawSources["payments"];
    const mapped = mapFinanceSource("payments", row); expect(mapped.row).toBeNull(); expect(mapped.reasons.length).toBeGreaterThan(0);
    const r = await readIsolatedDatabaseSource(client({ payments: { rows: [row], complete: true, nextCursor: null } }), actor, "payments");
    expect(r.coverage.state).toBe("incomplete"); expect(r.rows).toEqual([]);
  });
  it("outgoing payments remain explicitly incomplete, not invented collections", () => {
    const row = c1SourceContract({ ...projection, txn_type: "payment" }, evidence);
    expect(mapFinanceSource("ledger", row).reasons).toContain("Unsupported accounting direction");
  });
  it("noncash deposit applications remain explicitly incomplete without invented cash dates", () => {
    const row = c1SourceContract({ ...projection, txn_type: "deposit_applied", cash_date: null }, evidence);
    expect(row.cashDate).toBeNull(); expect(mapFinanceSource("ledger", row).reasons).toContain("Missing or invalid reporting date");
  });
});