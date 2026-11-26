/**
 * Standalone third-party PDF signing. No hosted database and no email is sent.
 * Run: bun test scripts/standalone-doc.test.ts
 */
import { describe, expect, test, mock } from "bun:test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon";
process.env.RESEND_API_KEY ??= "test-resend";
globalThis.fetch = (async (url: unknown) => {
  throw new Error(`network refused in test: ${String(url)}`);
}) as typeof fetch;

const calls = { fleet: 0, reservation: 0, fee: 0 };
mock.module("@/lib/fleet-webhook.server", () => ({
  notifyFleetAgreementSigned: async () => { calls.fleet += 1; },
}));
mock.module("@/lib/reservation-confirmation.server", () => ({
  maybeConfirmReservation: async () => { calls.reservation += 1; },
}));
mock.module("@/lib/reservation-fee.server", () => ({
  chargeReservationFeeAfterSigning: async () => { calls.fee += 1; return { status: "off" }; },
  existingReservationFeeStep: async () => { calls.fee += 1; return null; },
}));
mock.module("@/lib/audit.server", () => ({ logAudit: async () => {} }));

const { sha256Hex } = await import("@/lib/esign-pdf.server");
const { stampStandalonePdf, deliverSignedStandalone, inspectStandalonePdf } = await import("@/lib/standalone-doc.server");
const { completeSigning } = await import("@/lib/esign.server");
const {
  standaloneSignatureProblems,
  refuseStandaloneLink,
  sourcePdfAllowed,
  deliverTo,
  TEAM_CC,
  fieldAtClick,
  adoptionProblems,
} = await import("@/lib/standalone-doc").then(async (mod) => ({
  ...mod,
  adoptionProblems: (await import("@/lib/signature-adoption")).adoptionProblems,
}));
const { buildResendPayload, emailRecipients } = await import("@/lib/email.server");
const { SEND_DOCUMENT_FOR_SIGNATURE_ENABLED } = await import("@/lib/send-document-flag");

type Row = Record<string, any>;

function memoryAdmin(seed: Record<string, Row[]>, files: Map<string, Uint8Array>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const uploads: string[] = [];
  function from(table: string) {
    tables[table] ??= [];
    const filters: ((row: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let insertRow: Row | null = null;
    const q: any = {
      select() { return q; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return q; },
      neq(col: string, val: unknown) { filters.push((r) => r[col] !== val); return q; },
      is(col: string, val: unknown) { filters.push((r) => (r[col] ?? null) === val); return q; },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return q; },
      ilike() { return q; },
      order() { return q; },
      limit() { return q; },
      update(p: Row) { patch = p; return q; },
      insert(p: Row) { insertRow = { id: p.id ?? `id-${table}-${tables[table].length + 1}`, ...p }; return q; },
      maybeSingle() { return run(true); },
      single() { return run(true); },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve(run(false)).then(resolve, reject);
      },
    };
    function run(one: boolean) {
      let rows = tables[table].filter((r) => filters.every((f) => f(r)));
      if (insertRow) {
        tables[table].push(insertRow);
        rows = [insertRow];
      }
      if (patch) for (const row of rows) Object.assign(row, patch);
      return { data: one ? (rows[0] ?? null) : rows, error: null };
    }
    return q;
  }
  return {
    from,
    uploads,
    tables,
    storage: {
      from() {
        return {
          async download(path: string) {
            const data = files.get(path);
            if (!data) return { data: null, error: { message: "missing" } };
            return { data: new Blob([data as BlobPart]), error: null };
          },
          async upload(path: string, body: Blob) {
            uploads.push(path);
            files.set(path, new Uint8Array(await body.arrayBuffer()));
            return { error: null };
          },
          async createSignedUrl(path: string) {
            if (!files.has(path)) return { data: null, error: { message: "missing" } };
            return { data: { signedUrl: `https://storage.example/sign/${path}` }, error: null };
          },
        };
      },
    },
    async rpc(name: string, args: any) {
      if (name === "esign_claim") {
        const row = tables.agreements?.find((r) => r.id === args._id);
        if (!row) return { data: "invalid", error: null };
        if (row.status === "voided") return { data: "voided", error: null };
        if (row.status === "signed") return { data: "already_signed", error: null };
        if (args._token_hash && row.token_hash !== args._token_hash) return { data: "invalid", error: null };
        if (args._token_hash && row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now()) {
          return { data: "expired", error: null };
        }
        row.status = "signing";
        return { data: "won", error: null };
      }
      if (name === "renter_blacklist_suppressed") {
        return { data: args._email === "blocked@rentermail.com", error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    },
  };
}

const adoption = {
  signature: { method: "typed" as const, text: "Riley Morgan", style: "script1" as const },
  initials: { method: "typed" as const, text: "RM", style: "script1" as const },
  acks: [] as boolean[],
};

async function twoPagePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const a = pdf.addPage([612, 792]);
  a.drawText("ONLY PAGE ONE", { x: 72, y: 720, size: 18, font, color: rgb(0, 0, 0) });
  pdf.addPage([612, 792]);
  return pdf.save({ useObjectStreams: false });
}

async function pageItems(bytes: Uint8Array, pageNumber: number): Promise<{ str: string; x: number; y: number }[]> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const page = await doc.getPage(pageNumber);
  const tc = await page.getTextContent();
  return (tc.items as any[])
    .filter((it) => it.str)
    .map((it) => ({ str: String(it.str), x: it.transform[4] as number, y: it.transform[5] as number }));
}

function agreement(over: Row): Row {
  return {
    id: "a1",
    source: "standalone",
    status: "sent",
    title: "Cancellation Request / Policy Release",
    body: "Uploaded document",
    application_id: "app-1",
    signer_email: "riley@renter.test",
    signer_name: null,
    company_signer_name: "REAL RENTALS",
    company_signer_title: null,
    token_hash: "aa".repeat(32),
    token_expires_at: "2099-01-01T00:00:00.000Z",
    created_at: "2026-11-26T14:00:00.000Z",
    sent_at: "2026-11-26T14:05:00.000Z",
    viewed_at: "2026-11-26T14:10:00.000Z",
    archive_status: "none",
    archive_attempts: 0,
    metadata: {},
    ...over,
  };
}

describe("standalone document signing", () => {
  test("the send flag is on and still gates the upload when turned off", () => {
    expect(SEND_DOCUMENT_FOR_SIGNATURE_ENABLED).toBe(true);
    const src = readFileSync("src/lib/agreements.functions.ts", "utf8");
    const gate = src.indexOf("if (!SEND_DOCUMENT_FOR_SIGNATURE_ENABLED) throw new Error");
    const upload = src.indexOf("createStandaloneDocument");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(upload);
    const esign = readFileSync("src/lib/esign.server.ts", "utf8");
    expect(esign).toContain("REAL RENTALS: Your document is ready to sign:");
    const signing = esign.slice(esign.indexOf("export async function completeSigning"), esign.indexOf("export async function archiveDocument"));
    expect(signing.indexOf('if (ag.source === "standalone") return')).toBeLessThan(signing.indexOf("notifyFleetAgreementSigned"));
    const emails = src.slice(src.indexOf("async function sendSignedEmails"), src.indexOf("export const signAgreement"));
    expect(emails.indexOf('source === "standalone") return false')).toBeLessThan(emails.indexOf("chargeReservationFeeAfterSigning"));
    const sign = src.slice(src.indexOf("export const signAgreement"), src.indexOf("export const getMyAgreements"));
    expect(sign.indexOf("deliverSignedStandalone")).toBeLessThan(sign.lastIndexOf("sendSignedEmails"));
  });

  test("a signature is required for standalone and still optional for an unstructured agreement", () => {
    expect(adoptionProblems("Please sign.", undefined, "Riley Morgan")).toEqual([]);
    expect(standaloneSignatureProblems(undefined, "Riley Morgan")).toEqual(["Adopt a signature before signing this document."]);
    expect(standaloneSignatureProblems(adoption, "Someone Else")[0]).toMatch(/legal name/i);
    expect(standaloneSignatureProblems(adoption, "Riley Morgan")).toEqual([]);
    expect(standaloneSignatureProblems({ signature: adoption.signature }, "Riley Morgan")).toEqual([]);
  });

  test("voided and expired links are refused and do not expose the source PDF", () => {
    expect(() => refuseStandaloneLink({ status: "voided", token_expires_at: null })).toThrow(/cancelled/i);
    expect(() => refuseStandaloneLink(
      { status: "sent", token_expires_at: "2000-01-01T00:00:00.000Z" },
      Date.parse("2026-01-01T00:00:00.000Z"),
    )).toThrow(/expired/i);
    expect(() => refuseStandaloneLink({ status: "signed", token_expires_at: null })).toThrow(/no longer valid/i);
    expect(sourcePdfAllowed({ source: "standalone", status: "voided" })).toBe(false);
    expect(sourcePdfAllowed({ source: "standalone", status: "sent", token_expires_at: "2000-01-01T00:00:00.000Z" })).toBe(false);
    expect(sourcePdfAllowed({ source: "standalone", status: "signed" })).toBe(false);
    expect(sourcePdfAllowed({ source: "standalone", status: "sent", token_expires_at: "2099-01-01T00:00:00.000Z" })).toBe(true);
    expect(sourcePdfAllowed({ source: "rental", status: "sent" })).toBe(false);
  });

  test("hash mismatch is refused before a signed file is uploaded", async () => {
    const original = await twoPagePdf();
    const files = new Map<string, Uint8Array>([["standalone-src/a1/real.pdf", original]]);
    const admin = memoryAdmin({ agreements: [], documents: [] }, files);
    await expect(stampStandalonePdf(admin, {
      id: "a1",
      title: "ACORD 35",
      body: "original",
      application_id: "app",
      signer_name: "Riley Morgan",
      signed_at: "2026-11-26T15:00:00.000Z",
      metadata: {
        source_pdf: { path: "standalone-src/a1/real.pdf", sha256: "ab".repeat(32), pages: 2 },
        fields: [{ type: "name", page: 2, x: 72, y: 700, w: 200, h: 20 }],
        signature: { adoption },
      },
    })).rejects.toThrow(/hash does not match/i);
    expect(admin.uploads).toEqual([]);
  });

  test("the printed name is stamped on the page that was marked", async () => {
    const original = await twoPagePdf();
    const sha = await sha256Hex(original);
    const path = `standalone-src/a1/${sha}.pdf`;
    const files = new Map<string, Uint8Array>([[path, original]]);
    const admin = memoryAdmin({ agreements: [], documents: [] }, files);
    const field = { type: "name" as const, page: 2, x: 72, y: 700, w: 220, h: 20 };
    const stamped = await stampStandalonePdf(admin, {
      id: "a1",
      title: "Cancellation Request / Policy Release",
      body: "uploaded",
      application_id: "app",
      signer_name: "Riley Morgan",
      signer_email: "riley@renter.test",
      signed_at: "2026-11-26T15:00:00.000Z",
      created_at: "2026-11-26T14:00:00.000Z",
      sent_at: "2026-11-26T14:05:00.000Z",
      viewed_at: "2026-11-26T14:10:00.000Z",
      signer_ip: "203.0.113.9",
      signer_user_agent: "test",
      auth_method: "email_link",
      company_signer_name: "REAL RENTALS",
      metadata: {
        source_pdf: { path, sha256: sha, pages: 2 },
        fields: [field],
        signature: { adoption: { signature: adoption.signature, acks: [] }, sha256: "cd".repeat(32) },
      },
    });
    expect(admin.uploads.some((p) => p.startsWith("standalone-signed/a1/"))).toBe(true);
    const page1 = await pageItems(stamped.pdf, 1);
    const page2 = await pageItems(stamped.pdf, 2);
    expect(page1.map((i) => i.str).join(" ")).not.toContain("Riley Morgan");
    const hit = page2.find((i) => i.str.includes("Riley"));
    expect(hit).toBeTruthy();
    expect(Math.abs((hit?.x ?? 0) - field.x)).toBeLessThan(20);
    expect(Math.abs((hit?.y ?? 0) - field.y)).toBeLessThan(30);
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: stamped.pdf.slice(), isEvalSupported: false }).promise;
    const last = await pageItems(stamped.pdf, doc.numPages);
    const certificate = last.map((i) => i.str).join(" ");
    expect(certificate).toContain(sha);
    expect(certificate).toContain("Not required");
    const click = fieldAtClick({ type: "name", page: 2, fx: 0.2, fy: 0.1, pageWidth: 612, pageHeight: 792 });
    expect(click.page).toBe(2);
    expect(click.y).toBeGreaterThan(600);
  });

  test("an encrypted PDF falls back to a signature page", async () => {
    const fake = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Encrypt 2 0 R >>\nendobj\n%%EOF");
    const inspected = await inspectStandalonePdf(fake);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.fallback).toBe(true);
    const path = `standalone-src/enc/${inspected.sha256}.pdf`;
    const files = new Map<string, Uint8Array>([[path, fake]]);
    const admin = memoryAdmin({ agreements: [], documents: [] }, files);
    const stamped = await stampStandalonePdf(admin, {
      id: "enc",
      title: "Encrypted Release",
      body: "uploaded",
      signer_name: "Riley Morgan",
      signed_at: "2026-11-26T15:00:00.000Z",
      company_signer_name: "REAL RENTALS",
      metadata: {
        source_pdf: { path, sha256: inspected.sha256, pages: 0 },
        signature_page_fallback: true,
        fields: [],
        signature: { adoption },
      },
    });
    const page1 = await pageItems(stamped.pdf, 1);
    const text = page1.map((i) => i.str).join(" ");
    expect(text).toContain("Riley Morgan");
    expect(text).toMatch(/attached unchanged/i);
  });

  test("standalone signing does not call FLEET or reservation confirmation", async () => {
    calls.fleet = 0;
    calls.reservation = 0;
    const original = await twoPagePdf();
    const sha = await sha256Hex(original);
    const path = `standalone-src/stand/${sha}.pdf`;
    const files = new Map<string, Uint8Array>([[path, original]]);
    const token = "bb".repeat(32);
    const admin = memoryAdmin({
      agreements: [agreement({
        id: "stand",
        token_hash: token,
        metadata: {
          source_pdf: { path, sha256: sha, pages: 2 },
          fields: [{ type: "name", page: 2, x: 72, y: 700, w: 200, h: 20 }],
        },
      })],
      esign_recipients: [{
        id: "r1", document_id: "stand", status: "sent", email: "riley@renter.test",
        name: "Riley Morgan", signing_order: 1, token_hash: token, role: "signer",
      }],
      documents: [],
      rental_additional_drivers: [],
    }, files);
    const result = await completeSigning(admin, {
      id: "stand",
      tokenHash: token,
      signerName: "Riley Morgan",
      ip: "203.0.113.9",
      userAgent: "test",
      authMethod: "email_link",
      adoption,
      recipientId: "r1",
    });
    expect(result).toEqual({ result: "won", archived: true });
    expect(calls.fleet).toBe(0);
    expect(calls.reservation).toBe(0);
    expect(admin.tables.agreements[0].status).toBe("signed");
  });

  test("a rental signing still notifies FLEET and confirms the reservation", async () => {
    calls.fleet = 0;
    calls.reservation = 0;
    const token = "cc".repeat(32);
    const admin = memoryAdmin({
      agreements: [agreement({
        id: "rent",
        source: "rental",
        token_hash: token,
        body: "This rental agreement is the control row.",
        title: "Vehicle Rental Agreement",
        metadata: {},
      })],
      esign_recipients: [{
        id: "r2", document_id: "rent", status: "sent", email: "riley@renter.test",
        name: "Riley Morgan", signing_order: 1, token_hash: token, role: "signer",
      }],
      documents: [],
      rental_additional_drivers: [],
    }, new Map());
    const result = await completeSigning(admin, {
      id: "rent",
      tokenHash: token,
      signerName: "Riley Morgan",
      ip: "203.0.113.9",
      userAgent: "test",
      authMethod: "email_link",
      adoption: null,
      recipientId: "r2",
    });
    expect(result.result).toBe("won");
    expect(calls.fleet).toBe(1);
    expect(calls.reservation).toBe(1);
  });

  test("insurer Cc and the signed PDF attachment are built together", async () => {
    const plan = deliverTo({ insurerEmail: "Claims@Acme-Insurance.com", cc: ["extra@brokermail.com"], copyRenter: true });
    expect(plan.insurer_email).toBe("claims@acme-insurance.com");
    expect(plan.cc).toEqual([TEAM_CC, "extra@brokermail.com"]);
    const payload = buildResendPayload({
      from: "REAL RENTALS <team@drivereal.com>",
      to: [plan.insurer_email],
      cc: plan.cc,
      subject: "Signed Document — ACORD 35",
      html: "<p>Signed</p>",
      text: "Signed\n",
      replyTo: "team@drivereal.com",
      attachments: [{ filename: "REAL-RENTALS-Signed-Document-aaaaaaaa.pdf", content: "QQ==", contentType: "application/pdf" }],
    });
    expect(payload.cc).toEqual([TEAM_CC, "extra@brokermail.com"]);
    expect(payload.to).toEqual(["claims@acme-insurance.com"]);
    expect((payload.attachments as { filename: string; content_type: string }[])[0]).toMatchObject({
      filename: "REAL-RENTALS-Signed-Document-aaaaaaaa.pdf",
      content_type: "application/pdf",
    });
    const unchanged = buildResendPayload({
      from: "REAL RENTALS <team@drivereal.com>",
      to: ["a@b.co"],
      subject: "S",
      html: "<p>x</p>",
      text: "x\n",
      replyTo: "team@drivereal.com",
    });
    expect("cc" in unchanged).toBe(false);
    expect(emailRecipients("a@b.co", plan.cc)).toEqual(["a@b.co", TEAM_CC, "extra@brokermail.com"]);

    const pdf = new TextEncoder().encode("%PDF-1.4 signed %%EOF");
    const files = new Map<string, Uint8Array>([["standalone-signed/doc/abc.pdf", pdf]]);
    const admin = memoryAdmin({
      agreements: [{
        id: "doc1",
        source: "standalone",
        status: "signed",
        title: "ACORD 35",
        application_id: "app",
        signer_email: "blocked@rentermail.com",
        signer_name: "Riley Morgan",
        document_id: "d1",
        archive_status: "archived",
        metadata: { deliver_to: plan },
      }],
      documents: [{ id: "d1", storage_bucket: "rental-agreements", storage_path: "standalone-signed/doc/abc.pdf" }],
      email_deliveries: [],
    }, files);
    const sent: any[] = [];
    const outcome = await deliverSignedStandalone(admin, "doc1", async (args) => {
      sent.push(args);
      return { ok: true };
    });
    expect(outcome).toEqual({ insurer: "sent", renter: "blocked" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("claims@acme-insurance.com");
    expect(sent[0].cc).toEqual([TEAM_CC, "extra@brokermail.com"]);
    expect(sent[0].copyFor).toBe("insurer");
    expect(sent[0].attachment.filename).toBe("REAL-RENTALS-Signed-Document-doc1.pdf");
    expect(sent[0].attachment.contentType).toBe("application/pdf");
    expect(sent[0].attachment.content.length).toBeGreaterThan(8);

    const bad = memoryAdmin({
      agreements: [{
        id: "doc2",
        source: "standalone",
        status: "signed",
        title: "ACORD 35",
        application_id: "app",
        signer_email: "riley@rentermail.com",
        signer_name: "Riley Morgan",
        document_id: "d1",
        archive_status: "archived",
        metadata: { deliver_to: { ...plan, insurer_email: "claims@gmail.vom" } },
      }],
      documents: [{ id: "d1", storage_bucket: "rental-agreements", storage_path: "standalone-signed/doc/abc.pdf" }],
      email_deliveries: [],
    }, files);
    const blockedSends: unknown[] = [];
    const blocked = await deliverSignedStandalone(bad, "doc2", async (args) => {
      blockedSends.push(args);
      return { ok: true };
    });
    expect(blocked.insurer).toBe("blocked");
    expect(blockedSends.map((s: any) => s.to)).toEqual(["riley@rentermail.com"]);
  });
});
