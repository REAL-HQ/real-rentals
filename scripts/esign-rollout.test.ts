/**
 * Staged rollout + permission checks for eSign templates. No database, no email.
 * Run: bunx vitest run scripts/esign-rollout.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { activeTemplate } from "../src/lib/agreements.functions";

function mockAdmin(rows: any[], enforcement: boolean | null) {
  return {
    from(table: string) {
      const q: any = {
        select: () => q, order: () => q, eq: () => q,
        limit: async () => ({ data: rows }),
        maybeSingle: async () => ({ data: table === "app_settings" && enforcement !== null ? { value: { enabled: enforcement } } : null }),
      };
      return q;
    },
  };
}
const pre = [{ id: "a", name: "R", body: "OLD", version: 1, is_active: true }];
const draft = [{ id: "d", name: "R", body: "DRAFT", version: 1, is_active: false, approval_status: "draft" }];
const approved = [
  { id: "n", name: "R", body: "NEW DRAFT", version: 2, is_active: false, approval_status: "draft" },
  { id: "p", name: "R", body: "APPROVED", version: 1, is_active: false, approval_status: "approved", effective_date: "2026-10-09", approved_at: "x" },
];

describe("staged rollout", () => {
  it("before migration: current sending unchanged", async () => {
    const t = await activeTemplate(mockAdmin(pre, null));
    expect(t.meta.versioningActive).toBe(false);
    expect(t.body).toBe("OLD");
  });
  it("migration applied, nothing approved: sending NOT blocked", async () => {
    const t = await activeTemplate(mockAdmin(draft, null));
    expect(t.meta.schemaReady).toBe(true);
    expect(t.meta.versioningActive).toBe(false);
  });
  it("switch on but no approved version: still not enforced", async () => {
    const t = await activeTemplate(mockAdmin(draft, true));
    expect(t.meta.versioningActive).toBe(false);
  });
  it("approved version but switch off: not enforced", async () => {
    const t = await activeTemplate(mockAdmin(approved, false));
    expect(t.meta.versioningActive).toBe(false);
  });
  it("approved + switch on: enforced, uses the approved version, never the newer draft", async () => {
    const t = await activeTemplate(mockAdmin(approved, true));
    expect(t.meta.versioningActive).toBe(true);
    expect(t.body).toBe("APPROVED");
    expect(t.meta.approvalStatus).toBe("approved");
  });
});

describe("server-side permissions (source checks)", () => {
  const tpl = readFileSync("src/lib/agreement-templates.functions.ts", "utf8");
  const agr = readFileSync("src/lib/agreements.functions.ts", "utf8");
  for (const fn of ["saveTemplateDraft", "approveTemplateVersion", "retireTemplateVersion", "setTemplateEnforcement", "listTemplateVersions"]) {
    it(`${fn} is Owner-only on the server`, () => {
      const i = tpl.indexOf(`export const ${fn}`);
      expect(i).toBeGreaterThan(-1);
      const body = tpl.slice(i, tpl.indexOf("export const", i + 10) === -1 ? undefined : tpl.indexOf("export const", i + 10));
      expect(body).toMatch(/requireSupabaseAuth/);
      expect(body).toMatch(/await owner\(context\.userId\)/);
    });
  }
  it("enforcement refuses ON without an approved version and needs typed confirmation", () => {
    expect(tpl).toMatch(/Approve a version first/);
    expect(tpl).toMatch(/confirm: z\.enum\(\["ENABLE", "DISABLE"\]\)/);
    expect(tpl).toMatch(/A reason is required to turn enforcement off/);
  });
  it("preview/send require Manager+ and carry no editable body", () => {
    for (const fn of ["previewAgreement", "sendAgreement"]) {
      const i = agr.indexOf(`export const ${fn}`);
      expect(agr.slice(i, i + 900)).toMatch(/requireTierFor\(context\.userId, "manager"\)/);
    }
    expect(agr).not.toMatch(/body: z\.string\(\)/);
  });
  it("send refuses a changed fingerprint and incomplete company details without acknowledgment", () => {
    expect(agr).toMatch(/opts\.fingerprint !== prep\.fingerprint/);
    expect(agr).toMatch(/companyMissing\.length && opts\.companyAck !== true/);
  });
});
