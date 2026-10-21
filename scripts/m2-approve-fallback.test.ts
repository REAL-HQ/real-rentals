/**
 * Approve falls back to the legacy write only when the packet RPC is missing.
 * Wizard sync swallows a registration error only for the content-hash refusal,
 * and only while that flag is on.
 */
import { readFileSync } from "node:fs";
import {
  approveThroughPacket,
  isMissingApprovalRpc,
  isMissingEvidenceVersionColumn,
} from "../src/lib/approval-rpc.server";
import { isUploadedContentShaRefusal } from "../src/lib/document-content-sha";

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

assert(isMissingApprovalRpc({ code: "PGRST202", message: "missing" }), "PGRST202");
assert(isMissingApprovalRpc({ code: "42883", message: "undefined" }), "42883");
assert(!isMissingApprovalRpc({ code: "42501", message: "approval_rpc_required" }), "42501 is not a fallback");
assert(!isMissingApprovalRpc({ code: "PGRST204", message: "column" }), "PGRST204 is not a missing function");
assert(!isMissingApprovalRpc(null), "null error");

assert(isMissingEvidenceVersionColumn({ code: "42703", message: "column approval_evidence_version does not exist" }), "42703");
assert(
  isMissingEvidenceVersionColumn({ code: "PGRST204", message: "Could not find the approval_evidence_version column" }),
  "PGRST204 version",
);
assert(!isMissingEvidenceVersionColumn({ code: "PGRST204", message: "Could not find the email column" }), "other column");

const calls: string[] = [];
const missing = await approveThroughPacket({
  applicationId: "44444444-4444-4444-8444-444444444444",
  readVersion: async () => ({ version: null, error: { code: "42703", message: "approval_evidence_version" } }),
  rpc: async () => {
    calls.push("rpc");
    return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
  },
  legacy: async () => {
    calls.push("legacy");
    return { error: null };
  },
});
assert(missing.ok && missing.via === "legacy", "missing rpc uses legacy");
assert(calls.join(",") === "rpc,legacy", "legacy follows the missing rpc");

calls.length = 0;
const refused = await approveThroughPacket({
  applicationId: "44444444-4444-4444-8444-444444444444",
  readVersion: async () => ({ version: 2, error: null }),
  rpc: async (_name, params) => {
    calls.push(String(params._expected_version));
    return { data: null, error: { code: "42501", message: "positive_identity_required" } };
  },
  legacy: async () => {
    calls.push("legacy");
    return { error: null };
  },
});
assert(!refused.ok && refused.error === "positive_identity_required", "other errors stay errors");
assert(!calls.includes("legacy"), "no legacy fallback on a real refusal");

calls.length = 0;
const recorded = await approveThroughPacket({
  applicationId: "44444444-4444-4444-8444-444444444444",
  readVersion: async () => ({ version: 4, error: null }),
  rpc: async () => ({ data: { ok: true }, error: null }),
  legacy: async () => {
    calls.push("legacy");
    return { error: null };
  },
});
assert(recorded.ok && recorded.via === "rpc", "rpc success");
assert(calls.length === 0, "rpc success does not write the legacy audit");

assert(isUploadedContentShaRefusal(new Error("Uploaded object missing")), "missing object");
assert(isUploadedContentShaRefusal(new Error("Uploaded bytes missing")), "missing bytes");
assert(isUploadedContentShaRefusal(new Error("Uploaded object changed")), "changed object");
assert(!isUploadedContentShaRefusal(new Error("permission denied")), "other registration errors propagate");

const sync = readFileSync(new URL("../src/lib/documents.functions.ts", import.meta.url), "utf8");
const fn = sync.slice(sync.indexOf("async function registerSyncedUpload"), sync.indexOf("export async function syncApplicationUploads"));
assert(fn.includes("if (!DOCUMENT_CONTENT_SHA256_ENABLED)"), "flag gates the catch");
assert(fn.includes("isUploadedContentShaRefusal"), "catch checks the hash refusal");
const flagOff = fn.slice(fn.indexOf("if (!DOCUMENT_CONTENT_SHA256_ENABLED)"), fn.indexOf("try {"));
assert(!flagOff.includes("catch"), "flag off does not catch");

console.log("approve fallback pass");
