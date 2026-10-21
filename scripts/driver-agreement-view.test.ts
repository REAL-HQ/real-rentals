import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  AGREEMENT_PDF_STORAGE_GAP,
  AGREEMENT_PDF_URL_TTL_SECONDS,
  AGREEMENT_VERSION_GAP,
  DRIVER_AGREEMENT_VIEW_ENABLED,
  STAFF_PDF_LABEL,
  agreementPdfLink,
  assertAgreementPdfTtl,
  assertDriverAgreementViewEnabled,
  buildDriverAgreements,
  documentCanBeSigned,
  formatSignedAtEt,
  ownApplicationIds,
  type AgreementSourceRow,
} from "../src/lib/driver-agreement-view";

const lib = readFileSync("src/lib/driver-agreement-view.ts", "utf8");
const fn = readFileSync("src/lib/driver-agreement-view.functions.ts", "utf8");
const portal = readFileSync("src/routes/portal.tsx", "utf8");
const card = readFileSync("src/components/portal/DriverAgreementCard.tsx", "utf8");

function flagValue(source: string): string | null {
  return source.match(/const DRIVER_AGREEMENT_VIEW_ENABLED: boolean = (false|true)/)?.[1] ?? null;
}

function handlerOf(source: string): string {
  const at = source.indexOf(".handler(");
  assert.ok(at !== -1);
  return source.slice(at);
}

const listFn = fn.slice(fn.indexOf("export const getDriverAgreements"), fn.indexOf("export const getDriverAgreementPdf"));
const pdfFn = fn.slice(fn.indexOf("export const getDriverAgreementPdf"));

const mine = "app-1";
const other = "app-2";
const driver = "driver-1";

function row(partial: Partial<AgreementSourceRow> & Pick<AgreementSourceRow, "id" | "application_id">): AgreementSourceRow {
  return {
    title: "Vehicle Rental Agreement",
    status: "signed",
    signed_at: "2026-10-21T03:30:00.000Z",
    template_id: null,
    document_id: null,
    archive_status: "none",
    ...partial,
  };
}

describe("driver agreement view flag", () => {
  it("is off, and both handlers throw before auth or a table read", () => {
    assert.equal(DRIVER_AGREEMENT_VIEW_ENABLED, false);
    assert.equal(flagValue(lib), "false");
    assert.equal(flagValue(portal), null);
    assert.match(portal, /import \{ DRIVER_AGREEMENT_VIEW_ENABLED \} from "@\/lib\/driver-agreement-view"/);
    assert.throws(() => assertDriverAgreementViewEnabled(), /Driver agreement view is not enabled/);

    for (const source of [listFn, pdfFn]) {
      const handler = handlerOf(source);
      const body = handler.slice(handler.indexOf("=> {") + 4).trim();
      assert.equal(body.split("\n")[0]?.trim(), "assertDriverAgreementViewEnabled();");
      const guard = handler.indexOf("assertDriverAgreementViewEnabled()");
      const auth = handler.indexOf("getRequest(");
      const claims = handler.indexOf("auth.getClaims");
      const read = handler.indexOf('.from("');
      assert.ok(guard !== -1 && auth !== -1 && claims !== -1 && read !== -1);
      assert.ok(guard < auth && auth < claims && claims < read);
    }

    assert.match(fn, /\.eq\("user_id", userId\)/);
    assert.match(listFn, /select\("id,application_id,title,status,signed_at,template_id,document_id,archive_status"\)/);
    assert.match(listFn, /\.in\("application_id", ownIds\)/);
    assert.doesNotMatch(fn, /supabaseAdmin|SUPABASE_SERVICE_ROLE|\.insert\(|\.update\(|\.delete\(|\.or\(`|\.filter\(`|requireSupabaseAuth|esign\.server/);
    assert.doesNotMatch(fn, /select\("[^"]*body/);
    assert.doesNotMatch(card, /supabaseAdmin|\.from\(|uppercase/);
    assert.match(card, /min-h-11/);
    assert.match(card, /View PDF/);
    assert.match(card, /STAFF_PDF_LABEL/);
    assert.match(card, /enabled: DRIVER_AGREEMENT_VIEW_ENABLED === true/);
    assert.match(card, /No Agreement On File/);

    const gate = portal.slice(portal.indexOf("function DriverAgreementGate"));
    const check = gate.indexOf("DRIVER_AGREEMENT_VIEW_ENABLED !== true");
    const load = gate.indexOf('import("@/components/portal/DriverAgreementCard")');
    assert.ok(check !== -1 && load !== -1 && check < load);
    assert.doesNotMatch(portal, /from "@\/components\/portal\/DriverAgreementCard"/);
    assert.match(portal, /DRIVER_AGREEMENT_VIEW_ENABLED \? <DriverAgreementGate \/> : null/);
  });
});

describe("driver agreement view rows", () => {
  it("returns only the signed-in driver's agreements", () => {
    assert.deepEqual(
      ownApplicationIds(
        [
          { id: other, user_id: "driver-2" },
          { id: mine, user_id: driver },
        ],
        driver,
      ),
      [mine],
    );
    assert.equal(formatSignedAtEt("2026-10-21T03:30:00.000Z"), "Oct 20, 2026, 11:30 PM ET");
    assert.equal(formatSignedAtEt(null), "Not Signed");

    const items = buildDriverAgreements(
      [
        row({
          id: "other-agreement",
          application_id: other,
          template_id: "tpl-other",
          document_id: "doc-other",
          archive_status: "archived",
        }),
        row({
          id: "my-agreement",
          application_id: mine,
          template_id: "tpl-mine",
          document_id: "doc-mine",
          archive_status: "archived",
          status: "signed",
        }),
      ],
      [mine],
      [
        { id: "tpl-other", version: 99 },
        { id: "tpl-mine", version: 3 },
      ],
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.id, "my-agreement");
    assert.equal(items[0]?.version, 3);
    assert.equal(items[0]?.versionLabel, "v3");
    assert.equal(items[0]?.statusLabel, "Signed");
    assert.equal(items[0]?.signedLabel, "Oct 20, 2026, 11:30 PM ET");
    assert.equal(items[0]?.canRequestPdf, true);
    assert.equal(JSON.stringify(items).includes("doc-other"), false);
    assert.equal(JSON.stringify(items).includes("99"), false);
  });

  it("returns no agreement when the driver has none, and leaves a missing version blank", () => {
    assert.deepEqual(buildDriverAgreements([], [mine], []), []);
    assert.deepEqual(
      buildDriverAgreements([row({ id: "other-agreement", application_id: other })], [mine], [{ id: "tpl-other", version: 4 }]),
      [],
    );
    const missing = buildDriverAgreements(
      [row({ id: "my-agreement", application_id: mine, template_id: "tpl-mine", status: "sent", signed_at: null })],
      [mine],
      [],
    );
    assert.equal(missing.length, 1);
    assert.equal(missing[0]?.version, null);
    assert.equal(missing[0]?.versionLabel, "Not On File");
    assert.equal(missing[0]?.signedLabel, "Not Signed");
    assert.equal(missing[0]?.canRequestPdf, false);
    assert.match(AGREEMENT_VERSION_GAP, /no version column/);
    assert.match(lib, /AGREEMENT_VERSION_GAP/);
  });
});

describe("driver agreement PDF link", () => {
  it("returns no URL when signing fails, and keeps another driver's file closed", () => {
    const denied = agreementPdfLink(
      { error: { message: "new row violates row-level security" }, signedUrl: "https://example.invalid/secret.pdf" },
      AGREEMENT_PDF_URL_TTL_SECONDS,
    );
    assert.deepEqual(denied, { url: null, availability: STAFF_PDF_LABEL });
    assert.equal(STAFF_PDF_LABEL, "Available from staff");

    const empty = agreementPdfLink({ signedUrl: null, error: null }, 300);
    assert.equal(empty.url, null);
    assert.equal(empty.availability, "Available from staff");

    const script = agreementPdfLink({ signedUrl: "javascript:alert(1)", error: null }, 300);
    assert.equal(script.url, null);

    assert.equal(
      documentCanBeSigned(
        {
          driver_id: other,
          storage_bucket: "rental-agreements",
          storage_path: "other/agreement.pdf",
          visibility: ["driver", "admin"],
        },
        [mine],
      ),
      false,
    );
    assert.equal(
      documentCanBeSigned(
        {
          driver_id: mine,
          storage_bucket: "rental-agreements",
          storage_path: "mine/agreement.pdf",
          visibility: ["partner", "admin"],
        },
        [mine],
      ),
      false,
    );
    assert.match(pdfFn, /documentCanBeSigned/);
    const pdfHandler = handlerOf(pdfFn);
    assert.ok(pdfHandler.indexOf("agreementIsOwned") < pdfHandler.indexOf("createSignedUrl"));
    assert.ok(pdfHandler.indexOf("documentCanBeSigned") < pdfHandler.indexOf("createSignedUrl"));
    assert.match(AGREEMENT_PDF_STORAGE_GAP, /no driver SELECT policy/);
    const clientTypes = lib.slice(lib.indexOf("export type DriverAgreementItem"), lib.indexOf("export function buildDriverAgreements"));
    assert.doesNotMatch(clientTypes, /storage_path|document_id|application_id/);
    assert.doesNotMatch(lib.slice(lib.indexOf("export type AgreementPdfResult")), /storage_path/);
  });

  it("caps the signed URL at 5 minutes", () => {
    assert.equal(AGREEMENT_PDF_URL_TTL_SECONDS, 300);
    assert.ok(AGREEMENT_PDF_URL_TTL_SECONDS <= 300);
    assert.equal(assertAgreementPdfTtl(AGREEMENT_PDF_URL_TTL_SECONDS), 300);
    assert.equal(assertAgreementPdfTtl(1), 1);
    assert.throws(() => assertAgreementPdfTtl(301), /5 minutes or less/);
    assert.throws(() => agreementPdfLink({ signedUrl: "https://example.invalid/file.pdf" }, 301), /5 minutes or less/);
    assert.equal(
      agreementPdfLink({ signedUrl: "https://example.invalid/file.pdf", error: null }, 300).url,
      "https://example.invalid/file.pdf",
    );
    assert.match(pdfFn, /createSignedUrl\(doc\.storage_path, assertAgreementPdfTtl\(AGREEMENT_PDF_URL_TTL_SECONDS\)\)/);
    assert.doesNotMatch(fn, /createSignedUrl\([^)]*\b(?:3[0-9]{2}|[4-9]\d{2}|\d{4,})\b/);
  });
});
