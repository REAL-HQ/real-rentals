// FLEET driver-document upload: team-only, never verified, Off by default,
// same bucket/path/save step as the staff upload, idempotent, audited.
// Network refused; fake database and storage.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const D = await import("@/lib/fleet-document.server");
const cat = await import("@/lib/automation-catalog");

type Row = Record<string, any>;
const pick = (r: Row, c: string) => {
  const m = /^(\w+)->>(\w+)$/.exec(c);
  return m ? (r[m[1]] == null ? undefined : r[m[1]][m[2]] == null ? undefined : String(r[m[1]][m[2]])) : r[c];
};
function fakeDb(seed: Record<string, Row[]>, opts: { failInsert?: string; failUpload?: boolean } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const removed: string[] = [];
  let n = 1;
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let lim: number | null = null; let wantRows = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => { wantRows = true; return q; },
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => pick(r, c) === v); return q; },
      neq: (c: string, v: any) => { f.push((r) => pick(r, c) !== v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      order: () => q,
      limit: (x: number) => { lim = x; return q; },
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = state[table];
      if (op === "insert") {
        if (opts.failInsert === table) return { data: null, error: { message: "insert failed" } };
        const r = { id: `${table}-${n++}`, review_status: table === "documents" ? "uploaded" : undefined, superseded_by: null, ...payload };
        rows.push(r);
        return { data: wantRows ? (single ? { id: r.id } : [{ id: r.id }]) : null, error: null };
      }
      let m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { for (const r of m) Object.assign(r, payload); return { data: null, error: null }; }
      if (lim != null) m = m.slice(0, lim);
      return { data: single ? m[0] ?? null : m, error: null };
    }
    return q;
  }
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, o: any) => {
        if (opts.failUpload) return { data: null, error: { message: "nope" } };
        if (objects.has(`${bucket}/${path}`)) return { data: null, error: { message: "exists" } };
        objects.set(`${bucket}/${path}`, { bytes, contentType: o?.contentType });
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => { for (const p of paths) { removed.push(`${bucket}/${p}`); objects.delete(`${bucket}/${p}`); } return { data: [], error: null }; },
    }),
  };
  return { from, storage, state, objects, removed };
}

const KEY = "k".repeat(40);
const ENV = { FLEET_API_KEY: KEY };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF");
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new TextEncoder().encode("RIFF\u0010\u0000\u0000\u0000WEBPVP8 ");
const HEIC = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const seed = (docs: Row[] = []) => ({
  applications: [{ id: A, deleted_at: null, status: "active" }, { id: B, deleted_at: "2026-11-01T00:00:00Z", status: "new" }],
  documents: docs,
  audit_log: [],
});
function call(db: any, body: any, o: { gate?: "send" | "off" | "held"; key?: string } = {}) {
  const audits: any[] = [];
  const req = new Request("https://x/api/public/fleet/driver-document", {
    method: "POST",
    headers: { authorization: `Bearer ${o.key ?? KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const p = D.handleFleetDriverDocument(req, {
    admin: db,
    env: ENV,
    gate: async () => o.gate ?? "send",
    audit: async (e) => { audits.push(e); db.state.audit_log.push({ action: e.action, entity_id: e.entityId, metadata: e.metadata }); },
  });
  return p.then(async (r) => ({ status: r.status, json: (await r.json()) as any, audits }));
}
const base = (extra: Row = {}) => ({ lead_id: A, category: "other", file_name: "Old agreement.pdf", content_base64: b64(PDF), label: "Original v1.13 agreement (superseded)", ...extra });

describe("FLEET driver-document upload", () => {
  test("Off by default in the Automations catalog, and refused while Off", async () => {
    expect(cat.isDefaultOff("fleet_document_uploads")).toBe(true);
    const db = fakeDb(seed());
    const r = await call(db, base(), { gate: "off" });
    expect(r.status).toBe(409);
    expect(r.json.reason).toBe("switched_off");
    const h = await call(db, base(), { gate: "held" });
    expect(h.status).toBe(503);
    expect(db.state.documents.length).toBe(0);
    expect(db.objects.size).toBe(0);
  });

  test("FLEET key required", async () => {
    const r = await call(fakeDb(seed()), base(), { key: "wrong".repeat(10) });
    expect(r.status).toBe(401);
  });

  test("saves team only, not reviewed, same bucket/path/save step as staff", async () => {
    const db = fakeDb(seed());
    const r = await call(db, base({ idempotency_key: "doc-1" }));
    expect(r.status).toBe(201);
    expect(r.json.verified).toBe(false);
    expect(r.json.review_status).toBe("uploaded");
    const doc = db.state.documents[0];
    expect(doc.storage_bucket).toBe("driver-docs");
    expect(doc.storage_path).toMatch(new RegExp(`^${A}/internal/other-[0-9a-f-]{36}\\.pdf$`));
    expect(doc.visibility).toEqual(["admin"]);
    expect(doc.is_current).toBe(true);
    expect(doc.review_status).toBe("uploaded");
    expect(doc.kind).toBe("other");
    expect(doc.label).toBe("Original v1.13 agreement (superseded)");
    expect(doc.mime_type).toBe("application/pdf");
    expect(doc.uploaded_by).toBe(null);
    expect(doc.uploaded_by_role).toBe("team");
    expect(doc.content_sha256 ?? null).toBe(null);
    expect(db.objects.get(`driver-docs/${doc.storage_path}`)?.contentType).toBe("application/pdf");
    expect(r.audits[0].action).toBe("document.fleet_upload");
    expect(r.audits[0].metadata).toMatchObject({ lead_id: A, category: "other", idempotency_key: "doc-1", verified: false, team_only: true });
    // Nothing on the application changed.
    expect(db.state.applications[0]).toEqual({ id: A, deleted_at: null, status: "active" });
  });

  test("agreement, rental_application and verification_recording are refused", async () => {
    for (const c of ["agreement", "rental_application", "verification_recording", "rental_agreement", "nope"]) {
      const db = fakeDb(seed());
      const r = await call(db, base({ category: c }));
      expect(r.status).toBe(400);
      expect(db.state.documents.length).toBe(0);
    }
  });

  test("other never supersedes, so a signed agreement stays current", async () => {
    const signed = { id: "sig", driver_id: A, category: "agreement", kind: "rental_agreement", is_current: true, review_status: "verified", superseded_by: null };
    const old = { id: "o1", driver_id: A, category: "other", kind: "other", is_current: true, review_status: "uploaded", superseded_by: null };
    const db = fakeDb(seed([signed, old]));
    const r = await call(db, base());
    expect(r.status).toBe(201);
    expect(db.state.documents.find((d: Row) => d.id === "sig")).toMatchObject({ is_current: true, superseded_by: null });
    expect(db.state.documents.find((d: Row) => d.id === "o1")).toMatchObject({ is_current: true, superseded_by: null });
  });

  test("a second file is added beside a verified one and an unreviewed one; nothing is superseded", async () => {
    const ver = { id: "lic", driver_id: A, category: "license_front", kind: "license_front", is_current: true, review_status: "verified" };
    const db = fakeDb(seed([ver]));
    const r = await call(db, base({ category: "license_front", content_base64: b64(JPG), file_name: "lic.jpg", label: null }));
    expect(r.status).toBe(201);
    expect(db.state.documents.find((d: Row) => d.id === "lic")).toMatchObject({ is_current: true, review_status: "verified" });
    const db2 = fakeDb(seed([{ ...ver, review_status: "uploaded" }]));
    const r2 = await call(db2, base({ category: "license_front", content_base64: b64(JPG), file_name: "lic.jpg", expires_at: "2029-01-21" }));
    expect(r2.status).toBe(201);
    expect(db2.state.documents.find((d: Row) => d.id === "lic")).toMatchObject({ is_current: true });
    expect(db2.state.documents.find((d: Row) => d.id === "lic")!.superseded_by ?? null).toBeNull();
    expect(db2.state.documents.find((d: Row) => d.id === r2.json.document_id)).toMatchObject({ is_current: true, expires_at: "2029-01-21", mime_type: "image/jpeg", review_status: "uploaded" });
  });

  test("types sniffed from bytes: PDF JPEG PNG WebP HEIC accepted, others refused", async () => {
    for (const [b, mime] of [[PDF, "application/pdf"], [JPG, "image/jpeg"], [PNG, "image/png"], [WEBP, "image/webp"], [HEIC, "image/heic"]] as const) {
      const db = fakeDb(seed());
      const r = await call(db, base({ content_base64: b64(b as Uint8Array), file_name: "x.pdf" }));
      expect(r.status).toBe(201);
      expect(r.json.mime_type).toBe(mime);
    }
    for (const bad of [new TextEncoder().encode("<html>hi</html>"), new TextEncoder().encode("GIF89a....")]) {
      const r = await call(fakeDb(seed()), base({ content_base64: b64(bad), file_name: "x.pdf" }));
      expect(r.status).toBe(415);
    }
    expect((await call(fakeDb(seed()), base({ content_base64: "not base64!!" }))).status).toBe(400);
    expect((await call(fakeDb(seed()), base({ content_base64: "" }))).status).toBe(400);
  });

  test("over 20 MB refused", async () => {
    const big = new Uint8Array(D.FLEET_DOCUMENT_MAX_BYTES + 1); big.set(PDF);
    const r = await call(fakeDb(seed()), base({ content_base64: b64(big) }));
    expect(r.status).toBe(413);
  });

  test("idempotent: same key or same bytes returns the first document", async () => {
    const db = fakeDb(seed());
    const first = await call(db, base({ idempotency_key: "k1" }));
    const again = await call(db, base({ idempotency_key: "k1" }));
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ duplicate: true, matched_by: "idempotency_key", document_id: first.json.document_id });
    const sameBytes = await call(db, base({ idempotency_key: "k2" }));
    expect(sameBytes.json).toMatchObject({ duplicate: true, matched_by: "content", document_id: first.json.document_id });
    const reused = await call(db, base({ idempotency_key: "k1", content_base64: b64(JPG) }));
    expect(reused.status).toBe(409);
    expect(db.state.documents.length).toBe(1);
    expect(db.objects.size).toBe(1);
  });

  test("validation: lead, deleted lead, expires_at, label length", async () => {
    expect((await call(fakeDb(seed()), base({ lead_id: "x" }))).status).toBe(400);
    expect((await call(fakeDb(seed()), base({ lead_id: "33333333-3333-4333-8333-333333333333" }))).status).toBe(404);
    expect((await call(fakeDb(seed()), base({ lead_id: B }))).status).toBe(409);
    expect((await call(fakeDb(seed()), base({ expires_at: "2029-01-01" }))).status).toBe(400);
    expect((await call(fakeDb(seed()), base({ category: "insurance", expires_at: "01/02/2029" }))).status).toBe(400);
    const db = fakeDb(seed());
    const r = await call(db, base({ label: "L".repeat(500) }));
    expect(db.state.documents[0].label.length).toBe(140);
    expect(r.status).toBe(201);
  });

  test("storage object removed when the row cannot be saved", async () => {
    const db = fakeDb(seed(), { failInsert: "documents" });
    const r = await call(db, base());
    expect(r.status).toBe(503);
    expect(db.objects.size).toBe(0);
    expect(db.removed.length).toBe(1);
    expect(r.audits.length).toBe(0);
    const db2 = fakeDb(seed(), { failUpload: true });
    expect((await call(db2, base())).status).toBe(503);
    expect(db2.state.documents.length).toBe(0);
  });

  test("route, docs and catalog wired", () => {
    const route = readFileSync("src/routes/api/public/fleet/driver-document.ts", "utf8");
    expect(route).toContain('"/api/public/fleet/driver-document"');
    const docs = readFileSync("docs/fleet-api.md", "utf8");
    expect(docs).toContain("/api/public/fleet/driver-document");
    expect(docs).toContain("fleet_document_uploads");
    const tree = readFileSync("src/routeTree.gen.ts", "utf8");
    expect(tree).toContain("/api/public/fleet/driver-document");
  });
});
