// Renter insurance ID cards (t379u): an emailed card is filed to exactly one
// renter's portal Documents on VIN + name, never verified, never messaged;
// anything else goes to staff. Idempotent on the bytes. Network refused;
// fake database and storage; invented names, VINs and ids.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const R = await import("@/lib/renter-insurance-card");
const S = await import("@/lib/renter-insurance-card.server");
const F = await import("@/lib/fleet-insurance-card.server");
const cat = await import("@/lib/automation-catalog");

type Row = Record<string, any>;
const pick = (r: Row, c: string) => {
  const m = /^(\w+)->>(\w+)$/.exec(c);
  return m ? (r[m[1]] == null ? undefined : r[m[1]][m[2]] == null ? undefined : String(r[m[1]][m[2]])) : r[c];
};
function fakeDb(seed: Record<string, Row[]>, files: Record<string, Uint8Array> = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>(Object.entries(files).map(([k, v]) => [k, { bytes: v }]));
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
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      ilike: (c: string, v: string) => { f.push((r) => String(r[c] ?? "").toLowerCase() === v.toLowerCase()); return q; },
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
        const r = { id: `${table}-${n++}`, created_at: new Date(Date.UTC(2026, 10, 17, 0, n)).toISOString(), ...payload };
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
        if (objects.has(`${bucket}/${path}`)) return { data: null, error: { message: "exists" } };
        objects.set(`${bucket}/${path}`, { bytes, contentType: o?.contentType });
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const o = objects.get(`${bucket}/${path}`);
        return o ? { data: new Blob([o.bytes]), error: null } : { data: null, error: { message: "missing" } };
      },
      remove: async (paths: string[]) => { for (const p of paths) objects.delete(`${bucket}/${p}`); return { data: [], error: null }; },
    }),
  };
  return { from, storage, state, objects };
}

const VIN = "1HGCM82633A004352"; // valid check digit, invented
const VIN2 = "1M8GDM9AXKP042788";
const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF");
const SHA = "f".repeat(64);
const ex = (o: { vin?: string; insured?: string; drivers?: string; eff?: string; exp?: string; vinConf?: string; pages?: number } = {}) => ({
  shared: {
    ...(o.insured === "" ? {} : { named_insured: { value: o.insured ?? "JORDAN SAMPLE", confidence: "high" } }),
    insurance_carrier: { value: "Example Mutual", confidence: "high" },
    insurance_effective_on: { value: o.eff ?? "2026-11-16", confidence: "high" },
    ...(o.exp ? { insurance_expires_on: { value: o.exp, confidence: "high" } } : {}),
    ...(o.drivers ? { approved_drivers: { value: o.drivers, confidence: "high" } } : {}),
  },
  vehicles: Array.from({ length: o.pages ?? 2 }, (_, i) => ({ page: i + 1, fields: o.vin === "" ? {} : { vin: { value: o.vin ?? VIN, confidence: o.vinConf ?? "high" } } })),
});
function world(o: { extraction?: any; rentals?: Row[]; apps?: Row[]; vehicles?: Row[]; docs?: Row[]; channel?: string; docClass?: string; sha?: string | null } = {}) {
  return fakeDb({
    fleet_import_items: [{ id: "item-1", batch_id: "batch-1", document_id: "src-doc", doc_class: o.docClass ?? "insurance_card", extraction: o.extraction ?? ex(), warnings: [], content_sha256: o.sha === undefined ? SHA : o.sha, source_channel: o.channel ?? "email", file_name: "Example Mutual ID card.pdf", status: "matching" }],
    documents: [{ id: "src-doc", driver_id: null, storage_bucket: "vehicle-docs", storage_path: "inbox/email/e1/x.pdf", mime_type: "application/pdf", size_bytes: PDF.length, category: "insurance_card", content_sha256: SHA }, ...(o.docs ?? [])],
    vehicles: o.vehicles ?? [{ id: "veh-1", vin: VIN, unit_number: "7", archived_at: null }],
    rentals: o.rentals ?? [{ id: "rent-1", status: "active", application_id: APP, vehicle_id: "veh-1" }],
    applications: o.apps ?? [{ id: APP, full_name: "Jordan Sample Jr", deleted_at: null, status: "active" }],
    audit_log: [], notifications: [],
  }, { "vehicle-docs/inbox/email/e1/x.pdf": PDF });
}
const run = (db: any, gate: "send" | "off" | "held" = "send") => {
  const audits: any[] = [];
  return S.fileRenterInsuranceCard(db, "item-1", {
    gate: async () => gate, today: () => "2026-11-17", uuid: () => "00000000-0000-4000-8000-000000000001",
    audit: async (e) => { audits.push(e); db.state.audit_log.push({ action: e.action, entity_id: e.entityId, metadata: e.metadata }); },
  }).then((r) => ({ r, audits }));
};

describe("name and card rules", () => {
  test("names: first + last, suffixes, middle names, LAST, FIRST", () => {
    expect(R.namesMatch("JAMES SMITH", "James Smith Jr")).toBe(true);
    expect(R.namesMatch("SMITH, JAMES A", "James Smith")).toBe(true);
    expect(R.namesMatch("James Allen Smith", "JAMES SMITH")).toBe(true);
    expect(R.namesMatch("JAMES SMITH", "Jamie Smith")).toBe(false);
    expect(R.namesMatch("JAMES SMITH", "James Smithson")).toBe(false);
    expect(R.namesMatch("SMITH", "James Smith")).toBe(false);
    expect(R.namesMatch("Example Rentals LLC", "James Smith")).toBe(false);
  });
  test("a card repeated on two pages is one card; two VINs are two", () => {
    expect(R.insuranceCardFacts(ex()).length).toBe(1);
    expect(R.insuranceCardFacts(ex())[0].pages).toEqual([1, 2]);
    const two = ex(); two.vehicles[1].fields = { vin: { value: VIN2, confidence: "high" } };
    expect(R.insuranceCardFacts(two).length).toBe(2);
  });
  test("a page that omits the name or date is still the same card; conflicting dates are two cards", () => {
    const partial = { shared: {}, vehicles: [
      { page: 1, fields: { vin: { value: VIN, confidence: "high" }, named_insured: { value: "JORDAN SAMPLE" }, approved_drivers: { value: "JORDAN SAMPLE" }, insurance_effective_on: { value: "2026-11-16" } } },
      { page: 2, fields: { vin: { value: VIN, confidence: "high" } } },
    ] };
    const c = R.insuranceCardFacts(partial);
    expect(c.length).toBe(1);
    expect(c[0].names).toEqual(["JORDAN SAMPLE"]);
    expect(c[0].effectiveOn).toBe("2026-11-16");
    (partial.vehicles[1].fields as any).insurance_effective_on = { value: "2025-11-16" };
    expect(R.insuranceCardFacts(partial).length).toBe(2);
  });
  test("renter-facing label, file name and note never carry the carrier", () => {
    expect(R.RENTER_INSURANCE_LABEL).toBe("Insurance ID Card");
    expect(R.renterCardFileName("pdf")).toBe("Insurance ID Card.pdf");
    expect(R.renterCardNote({ effectiveOn: "2026-11-16", expiresOn: null })).toBe("Effective 11/16/2026");
  });
  test("switch is catalogued, default On, storing only (no channels)", () => {
    expect(cat.AUTOMATION_KEYS).toContain("renter_insurance_cards");
    expect(cat.isDefaultOff("renter_insurance_cards")).toBe(false);
    expect(cat.AUTOMATIONS.find((a: any) => a.key === "renter_insurance_cards")!.channels).toEqual([]);
  });
});

describe("filing an emailed card", () => {
  test("exact VIN + name: saved to the renter's Documents, not reviewed, generic name, older cards stay active", async () => {
    const db = world({ docs: [{ id: "old-1", driver_id: APP, category: "insurance", is_current: true, review_status: "uploaded", superseded_by: null }] });
    const { r, audits } = await run(db);
    expect(r).toMatchObject({ status: "filed", applicationId: APP, rentalId: "rent-1", superseded: 0 });
    const doc = db.state.documents.find((d) => d.id === (r as any).documentId)!;
    expect(doc).toMatchObject({
      driver_id: APP, category: "insurance", kind: "insurance", label: "Insurance ID Card", file_name: "Insurance ID Card.pdf",
      storage_bucket: "driver-docs", visibility: ["driver", "admin"], review_status: "uploaded", is_current: true,
      uploaded_by_role: "email", content_sha256: SHA, expires_at: null, notes: "Effective 11/16/2026",
    });
    expect(doc.storage_path).toBe(`${APP}/insurance-00000000-0000-4000-8000-000000000001.pdf`);
    expect(db.objects.get(`driver-docs/${doc.storage_path}`)!.bytes).toEqual(PDF);
    expect(JSON.stringify(doc)).not.toContain("Example Mutual");
    expect(db.state.documents.find((d) => d.id === "old-1")).toMatchObject({ is_current: true, superseded_by: null });
    expect(audits[0].action).toBe("document.insurance_card_auto_filed");
    expect(audits[0].metadata.verified).toBe(false);
    // Nothing verified, nothing sent, nothing else touched.
    expect(db.state.notifications.length).toBe(0);
    expect(db.state.applications[0].status).toBe("active");
    expect(db.state.rentals[0]).toEqual({ id: "rent-1", status: "active", application_id: APP, vehicle_id: "veh-1" });
    expect(db.state.driver_screenings ?? []).toEqual([]);
    expect(db.state.fleet_import_items[0].warnings[0]).toContain("Filed to the renter's Documents");
  });

  test("idempotent: same bytes again is a duplicate, no second document or upload", async () => {
    const db = world();
    const a = await run(db);
    const before = db.state.documents.length;
    const b = await run(db);
    expect(a.r.status).toBe("filed");
    expect(b.r).toMatchObject({ status: "duplicate", documentId: (a.r as any).documentId });
    expect(db.state.documents.length).toBe(before);
    expect([...db.objects.keys()].filter((k) => k.startsWith("driver-docs/")).length).toBe(1);
  });

  test("a staff-verified card stays current until staff review the new one", async () => {
    const db = world({ docs: [{ id: "ver-1", driver_id: APP, category: "insurance", is_current: true, review_status: "verified", superseded_by: null }] });
    const { r } = await run(db);
    expect(r.status).toBe("filed");
    expect(db.state.documents.find((d) => d.id === "ver-1")).toMatchObject({ is_current: true, superseded_by: null });
  });

  test("approved-driver name matches when the named insured is someone else", async () => {
    const db = world({ extraction: ex({ insured: "Example Rentals LLC", drivers: "Jordan Sample" }) });
    expect((await run(db)).r.status).toBe("filed");
  });

  test("reserved rental counts; active wins when the same renter has both", async () => {
    const db = world({ rentals: [{ id: "rent-r", status: "reserved", application_id: APP, vehicle_id: "veh-1" }, { id: "rent-a", status: "active", application_id: APP, vehicle_id: "veh-1" }] });
    expect((await run(db)).r).toMatchObject({ status: "filed", rentalId: "rent-a" });
  });

  const reviewCases: Array<[string, Parameters<typeof world>[0], string]> = [
    ["different name on the card", { extraction: ex({ insured: "Casey Example" }) }, "name_mismatch"],
    ["VIN on no fleet car", { vehicles: [{ id: "veh-1", vin: VIN2, archived_at: null }] }, "vehicle_not_found"],
    ["car has no active/reserved rental", { rentals: [{ id: "rent-1", status: "ended", application_id: APP, vehicle_id: "veh-1" }] }, "no_open_rental"],
    ["no VIN read", { extraction: ex({ vin: "" }) }, "no_vin"],
    ["bad VIN", { extraction: ex({ vin: "1HGCM82633A00435" }) }, "invalid_vin"],
    ["hard-to-read VIN", { extraction: ex({ vinConf: "low" }) }, "low_confidence_vin"],
    ["no name read", { extraction: ex({ insured: "" }) }, "no_name"],
    ["expired card", { extraction: ex({ exp: "2026-10-01" }) }, "expired"],
    ["two renters with the same name on one car", {
      rentals: [{ id: "rent-1", status: "active", application_id: APP, vehicle_id: "veh-1" }, { id: "rent-2", status: "reserved", application_id: APP2, vehicle_id: "veh-1" }],
      apps: [{ id: APP, full_name: "Jordan Sample", deleted_at: null }, { id: APP2, full_name: "Jordan Sample", deleted_at: null }],
    }, "ambiguous"],
  ];
  for (const [name, w, reason] of reviewCases) {
    test(`staff review, not filed: ${name}`, async () => {
      const db = world(w);
      const { r } = await run(db);
      expect(r).toMatchObject({ status: "review", reason, notified: true });
      expect(db.state.documents.filter((d) => d.driver_id).length).toBe(0);
      const item = db.state.fleet_import_items[0];
      expect(item.status).toBe("needs_attention");
      expect(item.warnings[0]).toStartWith(R.RENTER_INSURANCE_WARNING_PREFIX);
      expect(db.state.notifications.length).toBe(1);
      expect(db.state.notifications[0]).toMatchObject({ title: "Insurance Card Needs Filing", kind: "document", read: false });
      expect(db.state.notifications[0].driver_id ?? null).toBe(null); // staff bell, never the renter
      expect(db.state.notifications[0].body).not.toContain("Example Mutual");
    });
  }

  test("two different cards in one file go to staff", async () => {
    const two = ex(); two.vehicles[1].fields = { vin: { value: VIN2, confidence: "high" } };
    expect((await run(world({ extraction: two }))).r).toMatchObject({ status: "review", reason: "multiple_cards" });
  });

  test("re-analyzing an unmatched file raises one bell, not two", async () => {
    const db = world({ extraction: ex({ insured: "Casey Example" }) });
    await run(db); const b = await run(db);
    expect((b.r as any).notified).toBe(false);
    expect(db.state.notifications.length).toBe(1);
  });

  test("skips: other classes, non-email channels, switch Off or unreadable", async () => {
    expect((await run(world({ docClass: "registration" }))).r).toMatchObject({ status: "skipped", reason: "not_insurance_card" });
    expect((await run(world({ channel: "vehicle_profile" }))).r).toMatchObject({ status: "skipped", reason: "channel" });
    const off = world();
    expect((await run(off, "off")).r).toMatchObject({ status: "skipped", reason: "switched_off" });
    expect((await run(off, "held")).r).toMatchObject({ status: "skipped", reason: "controls_unreadable" });
    expect(off.state.documents.length).toBe(1);
  });

  test("analysis core calls the filer only for insurance cards and flags unmatched ones", () => {
    const src = readFileSync("src/lib/fleet-inbox-core.server.ts", "utf8");
    expect(src).toContain('if (docClass === "insurance_card")');
    expect(src).toContain("fileRenterInsuranceCard(sb, data.itemId)");
    expect(src).toContain("const needs = cardNeedsStaff ||");
    expect(src).toContain("approved_drivers");
  });
});

describe("FLEET hand-over from team@ Gmail (Spam included)", () => {
  const KEY = "k".repeat(40);
  const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
  function call(db: any, body: any, gate: "send" | "off" | "held" = "send") {
    const audits: any[] = [];
    const req = new Request("https://x/api/public/fleet/insurance-card", { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return F.handleFleetInsuranceCard(req, { admin: db, env: { FLEET_API_KEY: KEY }, gate: async () => gate, uuid: () => "u-1", audit: async (e) => { audits.push(e); } })
      .then(async (r) => ({ status: r.status, json: (await r.json()) as any, audits }));
  }
  const body = (x: Row = {}) => ({ message_id: "1a1e536abd7c5416", attachment_id: "att-1", folder: "spam", from: "agent@example.com", subject: "POLICY DOCS - JORDAN SAMPLE", received_at: "2026-11-16T16:35:12Z", file_name: "card.pdf", content_base64: b64(PDF), ...x });
  const empty = () => fakeDb({ inbound_emails: [], documents: [], fleet_import_batches: [], fleet_import_items: [], fleet_inbox_jobs: [] });

  test("queues the card into Fleet Inbox as an email item; FLEET never picks the renter", async () => {
    const db = empty();
    const r = await call(db, body());
    expect(r.status).toBe(201);
    expect(db.state.inbound_emails[0]).toMatchObject({ provider: "gmail", provider_email_id: "1a1e536abd7c5416:att-1", intake_address: "team@drivereal.com (spam)" });
    expect(db.state.fleet_import_batches[0].source_channel).toBe("email");
    expect(db.state.fleet_import_items[0]).toMatchObject({ source_channel: "email", doc_class: "insurance_card", status: "uploaded" });
    expect(db.state.documents[0].driver_id ?? null).toBe(null);
    expect(db.state.documents[0]).toMatchObject({ visibility: ["admin"], storage_bucket: "vehicle-docs" });
    expect(db.state.fleet_inbox_jobs.length).toBe(1);
    expect(r.audits[0].action).toBe("document.fleet_insurance_card_intake");
  });
  test("same message or same bytes again: duplicate, nothing new", async () => {
    const db = empty();
    await call(db, body());
    const again = await call(db, body());
    expect(again.json).toMatchObject({ ok: true, duplicate: true, matched_by: "message" });
    const sameBytes = await call(db, body({ message_id: "1a1e6272d44520eb", folder: "inbox" }));
    expect(sameBytes.json).toMatchObject({ ok: true, duplicate: true, matched_by: "content" });
    expect(db.state.fleet_import_items.length).toBe(1);
  });
  test("switch Off, bad folder, unsupported file", async () => {
    expect((await call(empty(), body(), "off")).status).toBe(409);
    expect((await call(empty(), body({ folder: "trash" }))).status).toBe(400);
    expect((await call(empty(), body({ content_base64: b64(new TextEncoder().encode("hello")) }))).status).toBe(415);
  });
});

describe("no real phone numbers in this feature's code", () => {
  test("source files", () => {
    for (const f of ["src/lib/renter-insurance-card.ts", "src/lib/renter-insurance-card.server.ts", "src/lib/fleet-insurance-card.server.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/\+1\d{10}|\(\d{3}\) \d{3}-\d{4}/);
    }
  });
});
