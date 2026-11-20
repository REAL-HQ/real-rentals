/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Multiple active files per document section.
 *
 * Run: bun test scripts/multi-file-documents.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DOC_CATEGORIES,
  MULTI_FILE_CATEGORIES,
  SINGLE_SLOT_CATEGORIES,
  isMultiFileCategory,
  persistConfirmedDocument,
  retireDocument,
} from "../src/lib/documents.functions";
import { computeReadiness } from "../src/lib/readiness";
import { docPicture, assessForFleet } from "../src/lib/fleet-review";
import { classifyActiveRenter } from "../src/lib/document-expiry";
import { addApplicantDocumentCore } from "../src/lib/applicant-document-replace.server";

const APP = "40000000-0000-4000-8000-000000000001";

type Row = Record<string, any>;
/** Enough PostgREST for these modules: eq / neq / in, select, insert, update. */
function fakeAdmin(seed: Record<string, Row[]> = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const from = (table: string) => {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q,
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => (f.push((r) => r[c] === v), q),
      neq: (c: string, v: any) => (f.push((r) => r[c] !== v), q),
      in: (c: string, v: any[]) => (f.push((r) => v.includes(r[c])), q),
      limit: () => q,
      order: () => q,
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (op === "insert") {
        const row = { id: `new-${n++}`, ...payload };
        state[table].push(row);
        return { data: single ? row : [row], error: null };
      }
      const hit = state[table].filter((r) => f.every((p) => p(r)));
      if (op === "update") { for (const r of hit) Object.assign(r, payload); return { data: hit, error: null }; }
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    return q;
  };
  return { state, from };
}

const doc = (over: Row = {}): Row => ({
  id: "d1", driver_id: APP, category: "income", kind: "income", is_current: true, superseded_by: null,
  review_status: "uploaded", storage_bucket: "driver-docs", storage_path: `${APP}/income-1.png`, created_at: "2026-11-20T10:00:00Z", ...over,
});

describe("which sections take several files", () => {
  test("every category except agreements and applications", () => {
    expect(SINGLE_SLOT_CATEGORIES).toEqual(["rental_application", "agreement"]);
    for (const c of ["income", "gig_profile", "license_front", "license_back", "insurance", "insurance_quote", "screening", "trip_history", "other"]) {
      expect(isMultiFileCategory(c)).toBe(true);
    }
    expect(isMultiFileCategory("agreement")).toBe(false);
    expect(isMultiFileCategory("rental_application")).toBe(false);
    expect(MULTI_FILE_CATEGORIES.length + SINGLE_SLOT_CATEGORIES.length).toBe(DOC_CATEGORIES.length);
  });
});

describe("a second upload adds, it does not supersede", () => {
  const fields = (path: string, category = "income") => ({
    driver_id: APP, kind: category, category, label: null, storage_bucket: "driver-docs", storage_path: path,
    visibility: ["driver", "admin"], file_name: "x.png", mime_type: "image/png", size_bytes: 10, expires_at: null,
    uploaded_by: null, uploaded_by_role: "driver",
  });
  test("income, gig profile and insurance keep both files active", async () => {
    for (const category of ["income", "gig_profile", "insurance", "license_back"]) {
      const db = fakeAdmin();
      await persistConfirmedDocument(db, fields("a.png", category), async () => null);
      await persistConfirmedDocument(db, fields("b.png", category), async () => null);
      const rows = db.state.documents;
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.is_current === true && !r.superseded_by)).toBe(true);
    }
  });
  test("an agreement still keeps one current record", async () => {
    const db = fakeAdmin();
    await persistConfirmedDocument(db, fields("a.pdf", "other_x_never"), async () => null);
    const a = await persistConfirmedDocument(db, { ...fields("a.pdf", "agreement") }, async () => null);
    await persistConfirmedDocument(db, { ...fields("b.pdf", "agreement") }, async () => null);
    expect(db.state.documents.find((r) => r.id === a.id)).toMatchObject({ is_current: false });
  });
  test("source: persist and register skip supersede for multi-file sections", () => {
    const src = readFileSync("src/lib/documents.functions.ts", "utf8");
    expect(src).toMatch(/if \(isMultiFileCategory\(fields\.category\)\) return/);
    expect(src).toMatch(/if \(!isMultiFileCategory\(args\.category\)\)/);
  });
});

describe("archive and replace are explicit", () => {
  test("archive takes one file off the list and keeps the row", async () => {
    const db = fakeAdmin({ documents: [doc({ id: "a" }), doc({ id: "b" })], agreements: [] });
    await retireDocument(db, { documentId: "a", supersededBy: null });
    expect(db.state.documents.find((r) => r.id === "a")).toMatchObject({ is_current: false, superseded_by: null });
    expect(db.state.documents.find((r) => r.id === "b")).toMatchObject({ is_current: true });
  });
  test("replace retires only the named file, pointing at the new one", async () => {
    const db = fakeAdmin({ documents: [doc({ id: "a" }), doc({ id: "b" })], agreements: [] });
    await retireDocument(db, { documentId: "a", applicationId: APP, category: "income", supersededBy: "new-9" });
    expect(db.state.documents.find((r) => r.id === "a")).toMatchObject({ is_current: false, superseded_by: "new-9" });
    expect(db.state.documents.find((r) => r.id === "b")).toMatchObject({ is_current: true });
  });
  test("refuses another driver's file and another section", async () => {
    const db = fakeAdmin({ documents: [doc({ id: "a" })], agreements: [] });
    await expect(retireDocument(db, { documentId: "a", applicationId: "other-app", supersededBy: null })).rejects.toThrow();
    await expect(retireDocument(db, { documentId: "a", applicationId: APP, category: "gig_profile", supersededBy: null })).rejects.toThrow();
  });
  test("a rental agreement can't be archived", async () => {
    const db = fakeAdmin({ documents: [doc({ id: "ag", category: "agreement", kind: "agreement" })], agreements: [] });
    await expect(retireDocument(db, { documentId: "ag", supersededBy: null })).rejects.toThrow();
  });
  test("archive and restore are staff server functions with audit rows", () => {
    const src = readFileSync("src/lib/documents.functions.ts", "utf8");
    expect(src).toMatch(/export const archiveDocument/);
    expect(src).toMatch(/export const restoreDocument/);
    expect(src).toMatch(/action: "document\.archived"/);
    expect(src).toMatch(/action: "document\.restored"/);
    expect(src).toMatch(/replacesDocumentId/);
    expect(src).toMatch(/Only team members can replace a document/);
  });
});

describe("readiness: any one good file satisfies a section", () => {
  const app = { id: APP, status: "new" };
  test("a rejected file does not cancel a good one, in either order", () => {
    for (const order of [["rejected", "uploaded"], ["uploaded", "rejected"]]) {
      const docs = order.map((review_status, i) => ({ category: "license_front", is_current: true, review_status, id: String(i) }));
      const only = [{ category: "license_front", is_current: true, review_status: "uploaded", id: "x" }];
      const rejectedOnly = [{ category: "license_front", is_current: true, review_status: "rejected", id: "y" }];
      const withTwo = JSON.stringify(computeReadiness(app as any, null, docs as any));
      // Same answer as having just the good file; different from only a rejected one.
      expect(withTwo).toBe(JSON.stringify(computeReadiness(app as any, null, only as any)));
      expect(withTwo).not.toBe(JSON.stringify(computeReadiness(app as any, null, rejectedOnly as any)));
    }
  });
  test("docPicture counts every file, flags unreviewed ones next to a verified one", () => {
    const docs = [
      { id: "1", category: "income", review_status: "verified", is_current: true },
      { id: "2", category: "income", review_status: "uploaded", is_current: true },
      { id: "3", category: "income", review_status: "rejected", is_current: true },
      { id: "4", category: "income", review_status: "uploaded", is_current: false },
      { id: "5", category: "license_front", review_status: "uploaded", is_current: true },
    ];
    const p = docPicture(docs);
    expect(p.files.income).toEqual({ active: 3, verified: 1, rejected: 1, unreviewed: 1 });
    expect(p.unreviewed_files.income).toBe(1);
    expect(p.have).toContain("income");
    expect(p.rejected).not.toContain("income");
  });
  test("FLEET gets a note naming files still unreviewed in a verified section", () => {
    const docs = [
      { id: "1", category: "license_front", review_status: "verified", is_current: true },
      { id: "2", category: "gig_profile", review_status: "verified", is_current: true },
      { id: "3", category: "gig_profile", review_status: "uploaded", is_current: true },
    ];
    const a: any = assessForFleet({
      app: { id: APP, status: "new", gig_status: "yes" }, screening: null, docs, disqualifiers: [], readinessState: null,
      openNeedsStaff: null, priorDeclined: 0, now: new Date("2026-11-20T12:00:00Z"),
    } as any);
    expect(a.docs.files.gig_profile.active).toBe(2);
    expect(a.notes.some((n: any) => n.code === "docs_files_unreviewed" && /gig profile \(1\)/.test(n.message))).toBe(true);
  });
  test("the FLEET packet lists every active document and the per-section counts", () => {
    const src = readFileSync("src/lib/fleet-review.server.ts", "utf8");
    expect(src).toMatch(/documents_by_category: assessment\.docs\.files/);
    expect(src).toMatch(/is_current !== false/);
  });
});

describe("an older expired file does not flag a renter whose newer file is good", () => {
  const base = { licenseExpiration: null, insuranceExpiresOn: null, hasActiveRental: true } as any;
  test("the longest-lasting insurance card counts", () => {
    const r = classifyActiveRenter(
      { ...base, documents: [
        { category: "insurance", expiresAt: "2026-10-01" },
        { category: "insurance", expiresAt: "2027-06-01" },
      ] } as any,
      "2026-11-20",
    );
    const cell = (r as any)?.cells?.find((c: any) => c.kind === "insurance");
    expect(cell?.status ?? "later").not.toBe("expired");
    const stale = classifyActiveRenter(
      { ...base, documents: [{ category: "insurance", expiresAt: "2026-10-01" }] } as any,
      "2026-11-20",
    ) as any;
    expect(stale?.cells?.find((c: any) => c.kind === "insurance")?.status).toBe("expired");
  });
});

describe("renter secure link: add keeps every file", () => {
  const issued = (n: number) => `${APP}/${1795000000000 + n}-abc${n}.jpg`;
  const appRow = (over: Row = {}) => ({ id: APP, status: "new", user_id: "u1", full_name: "Test Renter", income_proof_url: null, trip_screenshots: [], ...over });
  const deps = (registered: any[]) => ({
    pickedUp: async () => false,
    sync: async () => undefined,
    audit: async () => undefined,
    register: async (_a: any, args: any) => { registered.push(args); },
  });
  test("the first file goes in the application's main slot", async () => {
    const db = fakeAdmin({ applications: [appRow()], notifications: [] });
    const reg: any[] = [];
    const r = await addApplicantDocumentCore(db as any, APP, { kind: "income", path: issued(1) }, deps(reg));
    expect(r.asPrimary).toBe(true);
    expect(db.state.applications[0].income_proof_url).toBe(issued(1));
    expect(reg.length).toBe(0);
  });
  test("a second file is filed beside it and the main file is untouched", async () => {
    const db = fakeAdmin({ applications: [appRow({ income_proof_url: issued(1) })], notifications: [] });
    const reg: any[] = [];
    const r = await addApplicantDocumentCore(db as any, APP, { kind: "income", path: issued(2) }, deps(reg));
    expect(r.asPrimary).toBe(false);
    expect(db.state.applications[0].income_proof_url).toBe(issued(1));
    expect(reg[0]).toMatchObject({ applicationId: APP, category: "income", path: issued(2), label: "Additional Proof Of Income", uploadedByRole: "driver" });
  });
  test("refuses a path the server did not issue", async () => {
    const db = fakeAdmin({ applications: [appRow()] });
    await expect(addApplicantDocumentCore(db as any, APP, { kind: "income", path: "x/y.jpg" }, deps([]))).rejects.toThrow();
  });
  test("a decided application takes no more files", async () => {
    const db = fakeAdmin({ applications: [appRow({ status: "declined" })] });
    await expect(addApplicantDocumentCore(db as any, APP, { kind: "income", path: issued(3) }, deps([]))).rejects.toThrow();
  });
});

describe("UI wiring", () => {
  test("staff section card lists every file with its own actions, no Additional Files grid", () => {
    const src = readFileSync("src/components/admin/ApplicantDocuments.tsx", "utf8");
    expect(src).toMatch(/moreFiles/);
    expect(src).toMatch(/archiveDocument/);
    expect(src).toMatch(/replacesDocumentId|setReplacing/);
    expect(src).toMatch(/multiple=\{isMultiFileCategory\(uploadingCategory\)\}/);
    expect(src).not.toMatch(/Additional Files/);
  });
  test("renter side: Add Another and Replace are separate actions", () => {
    const panel = readFileSync("src/components/site/ApplicantDocumentsPanel.tsx", "utf8");
    expect(panel).toMatch(/Add Another/);
    expect(panel).toMatch(/label="Replace"/);
    const cap = readFileSync("src/components/site/DocumentCapture.tsx", "utf8");
    expect(cap).toMatch(/Add Another File/);
  });
  test("vault: multi-select upload and Title Case labels", () => {
    const v = readFileSync("src/components/admin/DocumentVault.tsx", "utf8");
    expect(v).toMatch(/multiple=\{multi\}/);
    expect(v).toMatch(/Previous Uploads/);
  });
});
