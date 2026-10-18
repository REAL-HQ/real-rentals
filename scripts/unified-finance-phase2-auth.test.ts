import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ roles: ["admin"], error: null as unknown, from: vi.fn(), middleware: vi.fn(), financialRead: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const builder = { middleware: (value: unknown) => { state.middleware(value); return builder; }, inputValidator: () => builder, handler: (fn: unknown) => fn }; return builder;
} }));
vi.mock("../src/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: "synthetic-auth-middleware" }));
import { getUnifiedFinanceReport } from "../src/lib/unified-finance.functions";
import { request } from "./fixtures/unified-finance-phase2";
const call = (userId: string | null = "synthetic-staff") => (getUnifiedFinanceReport as unknown as (args: unknown) => Promise<unknown>)({ data: request,
  context: { userId, supabase: { from: state.from } },
});
beforeEach(() => {
  state.roles = ["admin"]; state.error = null; state.from.mockReset(); state.financialRead.mockReset();
  state.from.mockImplementation((table: string) => {
    if (table !== "user_roles") { state.financialRead(); throw new Error("Forbidden financial read"); }
    return { select: (columns: string) => { expect(columns).toBe("role"); return { eq: async (field: string, value: string) => {
      expect(field).toBe("user_id"); expect(value).toBe("synthetic-staff");
      return { data: state.roles.map(role => ({ role })), error: state.error };
    } }; } };
  });
});
describe("Disabled unified finance server endpoint", () => {
  it("registers existing authenticated middleware", () => { expect(state.middleware).toHaveBeenCalledWith(["synthetic-auth-middleware"]); });
  it.each(["admin", "team"])("current %s role gets disabled response with zero financial reads", async role => {
    state.roles = [role]; expect(await call()).toEqual({ status: "disabled", report: null });
    expect(state.from).toHaveBeenCalledExactlyOnceWith("user_roles"); expect(state.financialRead).not.toHaveBeenCalled();
  });
  it.each(["coordinator", "driver", "user", "partner"])("denies current %s role before financial reads", async role => {
    state.roles = [role]; await expect(call()).rejects.toThrow("Forbidden"); expect(state.financialRead).not.toHaveBeenCalled();
  });
  it("refuses absent identity before even role lookup", async () => {
    await expect(call(null)).rejects.toThrow("Forbidden"); expect(state.from).not.toHaveBeenCalled();
  });
  it("fails closed on absent roles or failed role evidence", async () => {
    state.roles = []; await expect(call()).rejects.toThrow("Forbidden");
    state.roles = ["admin"]; state.error = new Error("synthetic denied"); await expect(call()).rejects.toThrow("Forbidden");
    expect(state.financialRead).not.toHaveBeenCalled();
  });
});