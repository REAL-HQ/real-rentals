// Fleet Inbox rental-agreement filing. Run: bun test scripts/inbox-agreement-filing.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { planAgreementFiling, looksLikeRentalAgreement, roleFromLabel, agreementLabel, type InboxDocFact } from "../src/lib/inbox-agreement-filing";
import { DOC_CLASSES, docGroupOf } from "../src/lib/fleet-inbox";
import { isAuditedPaperAgreement } from "../src/lib/activation-readiness";

const doc = (o: Partial<InboxDocFact> = {}): InboxDocFact => ({
  id: "c5de1ab6-6676-4b0d-a3d1-bf5f63cc4691", driver_id: null, vehicle_id: null, category: "purchase_agreement", source: "fleet_inbox",
  storage_bucket: "vehicle-docs", storage_path: "inbox/b/x.pdf", content_sha256: "04ba".padEnd(64, "0"), is_current: true, file_name: "Damon Sykes.pdf", ...o });
const app = { id: "789433ea-2ff5-4499-9687-5a15a60d30a6", deleted_at: null, purged_at: null, full_name: "Damon T Sykes" };
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("classification", () => {
  test("rental_agreement is a class in its own Renters group, not Ownership", () => {
    expect(DOC_CLASSES).toContain("rental_agreement");
    expect(docGroupOf("rental_agreement")).toBe("Renters");
  });
  test("reader prompt separates rental from purchase agreements", () => {
    expect(src("lib/fleet-inbox-core.server.ts")).toMatch(/RENTAL agreement[^\n]+"rental_agreement", never "purchase_agreement"/);
  });
  test("rental_agreement routes to renter filing, never vehicle proposals", () => {
    const core = src("lib/fleet-inbox-core.server.ts");
    const i = core.indexOf('if (docClass === "rental_agreement")');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(core.indexOf("await buildItemProposals(sb, data.itemId);"));
    expect(src("lib/fleet-inbox.functions.ts")).toContain('if (data.docClass === "rental_agreement")');
  });
  test("historical misfiled agreements are recognized from the reader's warning", () => {
    expect(looksLikeRentalAgreement("purchase_agreement", ["This is a rental agreement, not a purchase/acquisition document"])).toBe(true);
    expect(looksLikeRentalAgreement("purchase_agreement", ["Seller signature missing"])).toBe(false);
  });
});

describe("filing an existing stored file", () => {
  test("original: re-points the row only, staff-only, unverified, audited, no byte copy", () => {
    const p = planAgreementFiling({ doc: doc(), app, role: "original", filed: [] });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.patch).toMatchObject({ driver_id: app.id, category: "agreement", review_status: "uploaded", visibility: ["admin"], reviewed_by: null });
    expect(Object.keys(p.patch)).not.toContain("storage_path");
    expect(Object.keys(p.patch)).not.toContain("storage_bucket");
    expect(p.audit).toMatchObject({ copied_bytes: false, signature_certified: false, storage_path: "inbox/b/x.pdf", agreement_role: "original" });
  });
  test("filed but unverified does NOT count as a signed agreement for activation", () => {
    const p = planAgreementFiling({ doc: doc(), app, role: "original", filed: [] });
    if (!p.ok) throw new Error("plan");
    const row = { ...doc(), ...p.patch, reviewed_at: null } as any;
    expect(isAuditedPaperAgreement(row, [])).toBe(false);
  });
  test("refuses already filed, non-inbox, missing original, superseded, deleted renter", () => {
    expect(planAgreementFiling({ doc: doc({ driver_id: app.id }), app, role: "original", filed: [] }).ok).toBe(false);
    expect(planAgreementFiling({ doc: doc({ source: "upload" }), app, role: "original", filed: [] }).ok).toBe(false);
    expect(planAgreementFiling({ doc: doc({ storage_path: null }), app, role: "original", filed: [] }).ok).toBe(false);
    expect(planAgreementFiling({ doc: doc({ is_current: false }), app, role: "original", filed: [] }).ok).toBe(false);
    expect(planAgreementFiling({ doc: doc({ category: "title" }), app, role: "original", filed: [] }).ok).toBe(false);
    expect(planAgreementFiling({ doc: doc(), app: { ...app, deleted_at: "2026-11-01" }, role: "original", filed: [] }).ok).toBe(false);
    expect(planAgreementFiling({ doc: null, app, role: "original", filed: [] }).ok).toBe(false);
  });
  test("swap history: a swap must follow an original already filed; both stay current", () => {
    expect(planAgreementFiling({ doc: doc({ id: "53cfaaa1-c2c4-4cbf-b1c8-2d062963a1d2" }), app, role: "swap", filed: [] }).ok).toBe(false);
    const p = planAgreementFiling({ doc: doc({ id: "53cfaaa1-c2c4-4cbf-b1c8-2d062963a1d2" }), app, role: "swap", relatedDocumentId: "c5de1ab6-6676-4b0d-a3d1-bf5f63cc4691", filed: [{ id: "c5de1ab6-6676-4b0d-a3d1-bf5f63cc4691", agreement_role: "original" }] });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.patch.is_current).toBe(true);
    expect(roleFromLabel(p.patch.label)).toBe("swap");
    expect(p.audit.related_document_id).toBe("c5de1ab6-6676-4b0d-a3d1-bf5f63cc4691");
    expect(planAgreementFiling({ doc: doc(), app, role: "original", relatedDocumentId: "c5de1ab6-6676-4b0d-a3d1-bf5f63cc4691", filed: [] }).ok).toBe(false);
    expect(roleFromLabel(agreementLabel("original", null))).toBe("original");
  });
});

describe("server guards", () => {
  const fn = src("lib/inbox-agreement.functions.ts");
  test("Manager-only, audit first and fail closed, guarded update, no storage writes", () => {
    expect(fn.match(/requireManager\(context\.userId\)/g)?.length).toBe(4);
    expect(fn.indexOf('action: "document.filed_from_fleet_inbox"')).toBeLessThan(fn.indexOf('.update(plan.patch)'));
    expect(fn).toContain('if (auditErr) return { ok: false');
    expect(fn).toMatch(/\.update\(plan\.patch\)\s*\.eq\("id", data\.documentId\)\.is\("driver_id", null\)\.eq\("source", "fleet_inbox"\)/);
    expect(fn).not.toMatch(/storage\.from|\.upload\(|\.remove\(|review_status: "verified"/);
  });
  test("no sends or billing from filing", () => {
    expect(fn).not.toMatch(/sendEmail|sendSms|stripe/i);
  });
});

describe("dedup never strands the uploader", () => {
  const reg = src("lib/fleet-inbox.functions.ts");
  test("duplicate returns the import holding the original; filed inbox files still dedupe", () => {
    expect(reg).toContain("existingBatchId: (orig?.batch_id ?? null)");
    expect(reg).toMatch(/eq\("source", "fleet_inbox"\)\.not\("driver_id", "is", null\)/);
  });
  test("all-duplicate upload opens the existing import instead of an empty one", () => {
    const ui = src("components/admin/FleetInboxPanel.tsx");
    expect(ui).toMatch(/if \(existingBatches\.size === 1\) onOpen\(\[\.\.\.existingBatches\]\[0\]\)/);
    expect(ui).toContain("<AgreementFilingPanel />");
  });
  test("filing menus open as white in-page lists, never the browser's dark system popup", () => {
    const ui = src("components/admin/AgreementFilingPanel.tsx");
    expect(ui).not.toMatch(/<select[\s>]/);
    expect(ui).toContain('from "@/components/ui/select"');
    expect(ui).toMatch(/<SelectTrigger aria-label="Renter" className="[^"]*bg-white/);
    expect(ui).toMatch(/<SelectTrigger aria-label="Agreement Type" className="[^"]*bg-white/);
    expect(ui).toMatch(/<SelectTrigger aria-label="Follows" className="[^"]*bg-white/);
  });
});

describe("activation welcome suppression", () => {
  const r = src("lib/rentals.functions.ts");
  test("owner-only, audited, gates both email and SMS, defaults to sending", () => {
    expect(r).toContain('if (data.suppressWelcome === true && actor.tier !== "owner")');
    expect(r).toContain("welcome_suppressed: !sendWelcome");
    expect(r).toMatch(/if \(sendWelcome\) try \{\s*const \{ sendEmail \}/);
    expect(r).toMatch(/if \(sendWelcome\) try \{\s*const \{ sendSms \}/);
    expect(r).toContain("const sendWelcome = data.suppressWelcome !== true;");
  });
  test("suppression check runs after hard-blocker decision (no bypass of readiness)", () => {
    expect(r.indexOf("if (!decision.ok) return")).toBeLessThan(r.indexOf("data.suppressWelcome === true"));
  });
});

describe("swap option refresh", () => {
  const ui = src("components/admin/AgreementFilingPanel.tsx");
  test("rows re-read filed agreements after every reload, so a just-filed Original enables Swap", () => {
    expect(ui).toContain("setVersion((v) => v + 1)");
    expect(ui).toContain("}, [app, filed, version]);");
    expect(ui).toMatch(/<FileRow [^>]*version=\{version\}/);
    expect(ui).toMatch(/disabled=\{!originals\.length\}/);
  });
});
