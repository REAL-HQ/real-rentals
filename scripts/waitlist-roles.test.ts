// Server-side gate: Coordinators cannot add, remove or promote Waitlist entries.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

let roles: string[] = [];
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: async () => ({ data: roles.map((role) => ({ role })) }) }) }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: null } } }) } },
  },
}));

const { requireManager } = await import("../src/lib/roles.server");

describe("waitlist write gate", () => {
  it("refuses Coordinators", async () => {
    roles = ["coordinator"];
    await expect(requireManager("u")).rejects.toThrow("Forbidden");
  });
  it("refuses drivers / no role", async () => {
    roles = ["driver"];
    await expect(requireManager("u")).rejects.toThrow("Forbidden");
  });
  it("allows Manager and Owner", async () => {
    roles = ["team"];
    await expect(requireManager("u")).resolves.toMatchObject({ tier: "manager" });
    roles = ["admin"];
    await expect(requireManager("u")).resolves.toMatchObject({ tier: "owner" });
  });

  it("every waitlist write action is gated by requireManager", () => {
    const src = readFileSync("src/lib/waitlist.functions.ts", "utf8");
    for (const fn of ["setWaitlistHold", "promoteToApplicant", "notifyWaitlistTop", "setCarsAvailable"]) {
      const body = src.slice(src.indexOf(`export const ${fn}`)).split("export const ")[1];
      expect(body, fn).toMatch(/await requireManager\(context\.userId\)/);
      expect(body, fn).not.toMatch(/requireStaff\(/);
    }
  });
});
