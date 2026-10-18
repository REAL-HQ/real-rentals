import { beforeEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ roles: ["team"], error: null as unknown, load: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const builder = { middleware: () => builder, inputValidator: () => builder, handler: (fn: unknown) => fn }; return builder;
} }));
vi.mock("../src/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("../src/lib/stripe-collections.server", () => ({ loadStripeCollections: state.load }));
vi.mock("../src/lib/stripe.server", () => ({ getStripeErrorMessage: (e: Error) => e.message }));
import { getStripeCollections } from "../src/lib/stripe-collections.functions";
const call = () => (getStripeCollections as unknown as (args: unknown) => Promise<unknown>)({
  data: { environment: "live", from: "2026-10-15T00:00:00Z", to: "2026-10-17T00:00:00Z" },
  context: { userId: "staff_mock", supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: state.roles.map(role => ({ role })), error: state.error }) }) }) } },
});
beforeEach(() => { state.load.mockReset(); state.load.mockResolvedValue({ successful: 3 }); state.roles = ["team"]; state.error = null; });
describe("collections endpoint authorization", () => {
  it.each(["admin", "team"])("permits %s only after session role lookup", async role => { state.roles = [role]; expect(await call()).toEqual({ report: { successful: 3 } }); expect(state.load).toHaveBeenCalledOnce(); });
  it.each(["coordinator", "driver", "user"])("denies %s before Stripe access", async role => { state.roles = [role]; await expect(call()).rejects.toThrow("Forbidden"); expect(state.load).not.toHaveBeenCalled(); });
  it("denies absent roles and unavailable role evidence", async () => { state.roles = []; await expect(call()).rejects.toThrow("Forbidden"); state.error = new Error("Denied"); await expect(call()).rejects.toThrow("Forbidden"); expect(state.load).not.toHaveBeenCalled(); });
  it("returns serializable Stripe errors", async () => { state.load.mockRejectedValue(new Error("Stripe unavailable")); expect(await call()).toEqual({ error: "Stripe unavailable" }); });
});