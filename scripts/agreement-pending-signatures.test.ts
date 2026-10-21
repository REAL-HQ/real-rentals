import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AGREEMENT_PENDING_SIGNATURE_ENABLED } from "../src/lib/agreement-pending-signatures-flag";
import {
  PENDING_SIGNATURE_READ_CAP,
  buildPendingSignatures,
  daysWaiting,
  lastSentLabel,
  type PendingAgreementRow,
} from "../src/lib/agreement-pending-signatures";

const flag = readFileSync("src/lib/agreement-pending-signatures-flag.ts", "utf8");
const rules = readFileSync("src/lib/agreement-pending-signatures.ts", "utf8");
const fn = readFileSync("src/lib/agreement-pending-signatures.functions.ts", "utf8");
const panel = readFileSync("src/components/admin/PendingSignatures.tsx", "utf8");
const settings = readFileSync("src/components/admin/SettingsWorkspace.tsx", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");

function agreement(over: Partial<PendingAgreementRow> & { id: string }): PendingAgreementRow {
  return {
    application_id: "app-1",
    title: "Rental Agreement",
    status: "sent",
    sent_at: "2026-10-19T15:00:00.000Z",
    signed_at: null,
    signer_name: "Ada Lopez",
    ...over,
  };
}

describe("pending signatures", () => {
  it("stays off and refuses before the role check and any read", () => {
    assert.equal(AGREEMENT_PENDING_SIGNATURE_ENABLED, false);
    assert.equal((flag.match(/const AGREEMENT_PENDING_SIGNATURE_ENABLED/g) ?? []).length, 1);
    assert.match(flag, /export const AGREEMENT_PENDING_SIGNATURE_ENABLED: boolean = false as boolean/);
    assert.doesNotMatch(flag, /process\.env/);
    for (const source of [rules, fn, panel, settings, admin]) {
      assert.equal((source.match(/const AGREEMENT_PENDING_SIGNATURE_ENABLED/g) ?? []).length, 0);
    }
    const middleware = fn.indexOf(".middleware([pendingSignatureGate, requireSupabaseAuth])");
    const gate = fn.indexOf("if (AGREEMENT_PENDING_SIGNATURE_ENABLED !== true) throw new Error(\"Pending signatures are not enabled.\")");
    assert.ok(gate !== -1 && middleware !== -1 && gate < middleware);
    const handler = fn.slice(fn.indexOf(".handler"));
    const thrown = handler.indexOf("if (AGREEMENT_PENDING_SIGNATURE_ENABLED !== true) throw new Error(\"Pending signatures are not enabled.\")");
    const role = handler.indexOf("requireOwner");
    const read = handler.indexOf("supabaseAdmin");
    assert.ok(thrown !== -1 && role !== -1 && read !== -1 && thrown < role && role < read);
    assert.ok(thrown < handler.indexOf("import("));
    assert.doesNotMatch(fn.slice(0, fn.indexOf("export const getPendingSignatures")), /roles\.server|client\.server/);
    assert.match(fn, /\.limit\(PENDING_SIGNATURE_READ_CAP \+ 1\)/);
    assert.match(fn, /\.limit\(PENDING_SIGNATURE_NAME_CHUNK \+ 1\)/);
    assert.match(fn, /PENDING_SIGNATURE_NAME_CHUNK/);
    assert.equal(PENDING_SIGNATURE_READ_CAP, 999);
    assert.match(fn, /\.in\("status", \["sent", "viewed"\]\)/);
    assert.match(fn, /\.is\("signed_at", null\)/);
    assert.doesNotMatch(fn, /resend|sendAgreement|sendEmail|sendSms|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    assert.doesNotMatch(panel, /resend|Resend|reason\.message|text-transform|uppercase/);
    assert.match(panel, /if \(AGREEMENT_PENDING_SIGNATURE_ENABLED !== true\) return null/);
    assert.match(panel, /Could Not Load Pending Signatures/);
    assert.match(panel, /Days Waiting/);
    assert.match(panel, /Last Sent/);
    assert.match(settings, /current\.id === "esign" && AGREEMENT_PENDING_SIGNATURE_ENABLED === true \? <PendingSignatures \/> : null/);
    assert.doesNotMatch(admin, /pending-signatures|PendingSignatures/);
    assert.doesNotMatch(nav, /pending_signatures|Pending Signatures/);
    assert.match(rules, /America\/New_York/);
    assert.doesNotMatch(rules, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("lists sent and viewed agreements with Eastern days and the last send", () => {
    const now = new Date("2026-10-21T15:00:00.000Z");
    const list = buildPendingSignatures({
      now,
      agreements: [
        agreement({ id: "new", sent_at: "2026-10-21T15:00:00.000Z", status: "viewed" }),
        agreement({ id: "old", sent_at: "2026-10-19T16:00:00.000Z", application_id: "app-2", signer_name: null }),
        agreement({ id: "signed", status: "signed", signed_at: "2026-10-20T12:00:00.000Z" }),
        agreement({ id: "draft", status: "draft", sent_at: null }),
        agreement({ id: "void", status: "voided" }),
        agreement({ id: "signing", status: "signing" }),
        agreement({ id: "blank-name", application_id: null, signer_name: "  " }),
      ],
      drivers: [{ id: "app-1", full_name: "Ada Lopez" }],
    });
    assert.equal(list.today, "2026-10-21");
    assert.deepEqual(
      list.rows.map((row) => `${row.agreementId}:${row.daysWaiting}:${row.statusLabel}:${row.driverName}`),
      ["blank-name:2:Sent:No Driver", "old:2:Sent:Unnamed Driver", "new:0:Viewed:Ada Lopez"],
    );
    assert.equal(list.rows[2].lastSentLabel, "Oct 21, 2026, 11:00 AM EDT");
    assert.equal(list.rows[2].driverSearch?.id, "app-1");
    assert.equal(list.rows[0].driverSearch, null);
    assert.equal(daysWaiting("not-a-date", now), null);
    assert.equal(lastSentLabel("not-a-date"), "Unknown");
    assert.equal(daysWaiting("2026-10-21T03:30:00.000Z", now), 1);
    assert.equal(daysWaiting("2026-03-08T06:30:00.000Z", new Date("2026-03-09T16:00:00.000Z")), 1);
  });

  it("does not treat a missing driver row as a capped read", () => {
    const now = new Date("2026-10-21T15:00:00.000Z");
    const missing = buildPendingSignatures({
      now,
      agreements: [agreement({ id: "gone", application_id: "missing" })],
      drivers: [],
    });
    assert.equal(missing.truncated, false);
    assert.equal(missing.rows[0].driverName, "Ada Lopez");
    const unchecked = buildPendingSignatures({
      now,
      agreements: [agreement({ id: "gone", application_id: "missing", signer_name: "Ada Lopez" })],
      drivers: [],
      namesUnchecked: ["missing"],
      truncated: true,
    });
    assert.equal(unchecked.truncated, true);
    assert.equal(unchecked.rows[0].driverName, "Driver Not Checked");
  });
});
