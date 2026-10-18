import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createFinanceSessionObserver, financeSessionSnapshot } from "../src/lib/unified-finance-session";
import { unifiedFinanceQueryOptions } from "../src/lib/unified-finance-query";
const hook = vi.hoisted(() => ({ effect: null as (() => (() => void)) | null, event: null as ((event: string, session: { user: { id: string } } | null) => void) | null,
  initial: null as ((value: { data: { session: { user: { id: string } } | null } }) => void) | null, clearedResume: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("react", () => ({ useRef: (current: unknown) => ({ current }), useEffect: (effect: () => (() => void)) => { hook.effect = effect; } }));
vi.mock("../src/lib/resume-token", () => ({ clearResumeToken: hook.clearedResume }));
vi.mock("../src/integrations/supabase/client", () => ({ supabase: { auth: {
  getSession: () => new Promise(resolve => { hook.initial = resolve; }),
  onAuthStateChange: (event: typeof hook.event) => { hook.event = event; return { data: { subscription: { unsubscribe: hook.unsubscribe } } }; },
} } }));
import { useSessionIsolation } from "../src/lib/session-isolation";
const request = { period: { from: "2026-10-01", to: "2026-11-01" }, basis: "cash" as const, currency: "USD" as const };
describe("Root subscriber finance epoch seam", () => {
  it.each(["SIGNED_OUT", "SIGNED_IN", "USER_UPDATED", "MFA_CHALLENGE_VERIFIED"])("%s invalidates prior same-user financial data", event => {
    const c = new QueryClient(); const o = createFinanceSessionObserver(c, () => {}); o.event("SIGNED_IN", "synthetic-a");
    const old = financeSessionSnapshot(c); c.setQueryData(["unified-finance", old.userId, old.revision], "private-data");
    c.setQueryData(["unrelated"], "preserved"); o.event(event, event === "SIGNED_OUT" ? null : "synthetic-a");
    expect(c.getQueriesData({ queryKey: ["unified-finance"] })).toEqual([]); expect(financeSessionSnapshot(c).revision).toBeGreaterThan(old.revision);
    expect(c.getQueryData(["unrelated"])).toBe("preserved");
  });
  it("switching accounts clears caches and scopes identity; clients are isolated", () => {
    const a = new QueryClient(), b = new QueryClient(); const o = createFinanceSessionObserver(a, () => {});
    o.event("SIGNED_IN", "synthetic-a"); o.event("SIGNED_IN", "synthetic-b");
    expect(financeSessionSnapshot(a).userId).toBe("synthetic-b"); expect(financeSessionSnapshot(b).userId).toBeNull();
  });
  it("refresh does not thrash same-user report cache", () => {
    const c = new QueryClient(); const o = createFinanceSessionObserver(c, () => {}); o.event("SIGNED_IN", "synthetic-a"); const old = financeSessionSnapshot(c);
    o.event("TOKEN_REFRESHED", "synthetic-a"); expect(financeSessionSnapshot(c)).toEqual(old);
  });
  it("delayed startup cannot overwrite a newer auth event or identity callback", () => {
    const c = new QueryClient(); const ids: Array<string | null> = []; const o = createFinanceSessionObserver(c, id => ids.push(id)); const ticket = o.initialTicket();
    o.event("SIGNED_IN", "synthetic-new"); o.initial(ticket, "synthetic-old");
    expect(financeSessionSnapshot(c).userId).toBe("synthetic-new"); expect(ids).toEqual(["synthetic-new"]);
    o.dispose(); o.event("SIGNED_OUT", null); expect(financeSessionSnapshot(c).userId).toBe("synthetic-new");
  });
  it("late startup after logout cannot restore the departed identity", () => {
    const c = new QueryClient(); const o = createFinanceSessionObserver(c, () => {}); const ticket = o.initialTicket();
    o.event("SIGNED_OUT", null); o.initial(ticket, "synthetic-old"); expect(financeSessionSnapshot(c).userId).toBeNull();
  });
  it("delayed same-user reauthentication response cannot repopulate cache", async () => {
    const c = new QueryClient(); const o = createFinanceSessionObserver(c, () => {}); o.event("SIGNED_IN", "synthetic-a");
    let finish: (() => void) | undefined;
    const options = unifiedFinanceQueryOptions(request, financeSessionSnapshot(c), () => financeSessionSnapshot(c), () => new Promise(resolve => { finish = () => resolve({ status: "disabled", report: null }); }));
    const pending = c.fetchQuery(options); const rejected = pending.catch(() => "rejected");
    o.event("SIGNED_IN", "synthetic-a"); if (!finish) throw new Error("Did not start mock"); finish();
    expect(await rejected).toBe("rejected"); expect(c.getQueryData(options.queryKey)).toBeUndefined();
  });
  it("existing root hook ignores delayed initial read and preserves sign-out resume cleanup", async () => {
    const c = new QueryClient(); useSessionIsolation(c); if (!hook.effect) throw new Error("Effect not registered");
    const dispose = hook.effect(); if (!hook.event || !hook.initial) throw new Error("Auth seam not registered");
    hook.event("SIGNED_IN", { user: { id: "synthetic-new" } });
    c.setQueryData(["unrelated"], "new-session-data");
    hook.initial({ data: { session: { user: { id: "synthetic-old" } } } }); await Promise.resolve();
    expect(financeSessionSnapshot(c).userId).toBe("synthetic-new"); expect(c.getQueryData(["unrelated"])).toBe("new-session-data");
    hook.event("SIGNED_OUT", null); expect(c.getQueryCache().getAll()).toHaveLength(0); expect(hook.clearedResume).toHaveBeenCalledTimes(1);
    dispose(); expect(hook.unsubscribe).toHaveBeenCalledTimes(1);
  });
});