import { describe, expect, it, vi } from "vitest";
import { readIsolatedDatabaseSource, collectSourcePages } from "../src/lib/unified-finance-db-readers.server";
import { readIsolatedProvider } from "../src/lib/unified-finance-provider-reader.server";
import { actor, charge, client, ledger, scope } from "./fixtures/unified-finance-live-readers";
import { readFileSync } from "node:fs";
describe("Mocked source-reader authorization and completeness", () => {
  it.each(["admin", "team"])("%s uses current RLS roles before source reads", async role => {
    const c = client({ ledger: { rows: [ledger()], nextCursor: null, complete: true } }, [role]);
    const roles = vi.spyOn(c, "readCurrentRoles"), read = vi.spyOn(c, "readPage");
    expect((await readIsolatedDatabaseSource(c, actor, "ledger")).coverage.state).toBe("complete");
    expect(roles.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0] as number);
  });
  it.each(["coordinator", "driver", "user"])("denies current %s despite claimed Owner roles", async role => {
    const c = client({}, [role]); const read = vi.spyOn(c, "readPage");
    await expect(readIsolatedDatabaseSource(c, actor, "payments")).rejects.toThrow("Forbidden"); expect(read).not.toHaveBeenCalled();
  });
  it("denies anonymous, wrong-user and missing current roles with no fallback", async () => {
    const c = client(); const read = vi.spyOn(c, "readPage");
    await expect(readIsolatedDatabaseSource(c, { ...actor, userId: null }, "payments")).rejects.toThrow("Forbidden");
    await expect(readIsolatedDatabaseSource(c, { ...actor, userId: "other" }, "payments")).rejects.toThrow("Forbidden");
    await expect(readIsolatedDatabaseSource(client({}, []), actor, "payments")).rejects.toThrow("Forbidden"); expect(read).not.toHaveBeenCalled();
  });
  it("role revocation and role-read errors deny before financial lookup", async () => {
    const c = client(); await readIsolatedDatabaseSource(c, actor, "payments");
    c.readCurrentRoles = async () => []; const read = vi.spyOn(c, "readPage");
    await expect(readIsolatedDatabaseSource(c, actor, "payments")).rejects.toThrow("Forbidden"); expect(read).not.toHaveBeenCalled();
    c.readCurrentRoles = async () => { throw new Error("synthetic-denial"); };
    await expect(readIsolatedDatabaseSource(c, actor, "payments")).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
  });
  it("Manager receives no Owner-only values or identifying diagnostics", async () => {
    const secret = ledger({ id: "SECRET-ID", amountCents: 900000, currency: null, visibility: "owner_only" });
    const r = await readIsolatedDatabaseSource(client({ ledger: { rows: [secret], complete: true, nextCursor: null } }, ["team"]), actor, "ledger");
    expect(r.rows).toEqual([]); expect(JSON.stringify(r)).not.toContain("SECRET-ID"); expect(JSON.stringify(r)).not.toContain("900000");
  });
  it("missing source facts mark coverage incomplete", async () => {
    const r = await readIsolatedDatabaseSource(client({ ledger: { rows: [ledger({ currency: null })], complete: true, nextCursor: null } }), actor, "ledger");
    expect(r.coverage.state).toBe("incomplete");
  });
  it("denied page never returns empty complete data", async () => {
    const c = client(); c.readPage = async () => { throw new Error("RLS denied"); };
    const r = await readIsolatedDatabaseSource(c, actor, "expenses"); expect(r.coverage.state).toBe("unavailable"); expect(r.rows).toEqual([]);
  });
  it("overlap is deduplicated; contradictions discard partial pages", async () => {
    const a = vi.fn().mockResolvedValueOnce({ rows: [charge()], complete: true, nextCursor: "next" }).mockResolvedValueOnce({ rows: [charge()], complete: true, nextCursor: null });
    expect((await collectSourcePages(a)).rows).toHaveLength(1);
    const b = vi.fn().mockResolvedValueOnce({ rows: [charge()], complete: true, nextCursor: "next" }).mockResolvedValueOnce({ rows: [charge({ amountCents: 1 })], complete: true, nextCursor: null });
    expect((await collectSourcePages(b)).complete).toBe(false);
  });
  it("unattested pages, page errors and loops are incomplete", async () => {
    expect((await collectSourcePages(async () => ({ rows: [], complete: false, nextCursor: null }))).complete).toBe(false);
    const read = vi.fn().mockResolvedValueOnce({ rows: [charge()], complete: true, nextCursor: "next" }).mockRejectedValueOnce(new Error("synthetic"));
    expect((await collectSourcePages(read)).rows).toEqual([]);
    expect((await collectSourcePages(async () => ({ rows: [], complete: true, nextCursor: "same" }))).complete).toBe(false);
  });
  it("mock provider refuses production scope or unauthorized access before page calls", async () => {
    const read = vi.fn();
    await expect(readIsolatedProvider(read, actor, { ...scope, environment: "live" })).rejects.toThrow("synthetic");
    await expect(readIsolatedProvider(read, { ...actor, roles: ["driver"] }, scope)).rejects.toThrow("Forbidden"); expect(read).not.toHaveBeenCalled();
  });
  it("provider identity failure yields incomplete coverage", async () => {
    const r = await readIsolatedProvider(async () => ({ rows: [charge({ identities: [] })], complete: true, nextCursor: null }), actor, scope);
    expect(r.coverage.state).toBe("incomplete");
  });
  it("role revocation during a delayed page refuses the response", async () => {
    const c = client(); let calls = 0;
    c.readCurrentRoles = async () => ++calls === 1 ? ["admin"] : ["driver"];
    await expect(readIsolatedDatabaseSource(c, actor, "payments")).rejects.toThrow("Forbidden");
  });
  it("Owner-to-Manager downgrade refuses already-read Owner data", async () => {
    const c = client(); let calls = 0;
    c.readCurrentRoles = async () => ++calls === 1 ? ["admin"] : ["team"];
    await expect(readIsolatedDatabaseSource(c, actor, "ledger")).rejects.toThrow("Authorization changed");
  });
  it.each(["source-contracts", "db-readers.server", "provider-reader.server", "live-mapping", "session"])("%s has no finance mutations, provider client or fetch", name => {
    const text = readFileSync(new URL(`../src/lib/unified-finance-${name}.ts`, import.meta.url), "utf8");
    expect(text).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(|\bfetch\s*\(|supabaseAdmin|client\.server|vehicle_pl/);
  });
});