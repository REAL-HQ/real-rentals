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
import { isUploadedContentShaRefusal, isMissingContentShaFunction } from "../src/lib/document-content-sha";
import { APPROVAL_SOURCE_STATUSES } from "../src/lib/approval-source-statuses";

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

assert(isMissingApprovalRpc({ code: "PGRST202", message: "missing" }), "PGRST202");
assert(!isMissingApprovalRpc({ code: "42883", message: "undefined" }), "42883 is not a fallback");
assert(!isMissingApprovalRpc({ code: "P0001", message: "function missing PGRST202" }), "message substring is not a fallback");
assert(!isMissingApprovalRpc({ message: "42883" }), "42883 in the message is not a fallback");
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

const identityFlag = readFileSync(new URL("../src/lib/identity-verification.ts", import.meta.url), "utf8");
assert(identityFlag.includes("IDENTITY_VERIFICATION_ENABLED = false"), "identity flag is false");
assert(!identityFlag.includes("process.env"), "identity flag does not read the environment");

const identityFn = readFileSync(new URL("../src/lib/identity-verification.functions.ts", import.meta.url), "utf8");
const identityHandler = identityFn.slice(identityFn.indexOf(".handler"));
const beforeRole = identityHandler.slice(0, identityHandler.indexOf("requireManager"));
assert(beforeRole.includes("if (!IDENTITY_VERIFICATION_ENABLED)"), "identity flag is checked before the manager lookup");
assert(!beforeRole.includes(".rpc("), "identity flag is checked before either RPC");
assert(identityFn.includes('rpc("preview_approval_identity"'), "identity action previews on the caller JWT");
assert(identityFn.includes('rpc("verify_approval_identity"'), "identity action calls verify_approval_identity");

const identityUi = readFileSync(new URL("../src/components/admin/ApplicantDocuments.tsx", import.meta.url), "utf8");
assert(identityUi.includes("if (!IDENTITY_VERIFICATION_ENABLED) return null;"), "identity action renders nothing while hidden");
assert(identityUi.includes("Verify Identity"), "identity action label is Title Case");

assert(!isMissingContentShaFunction({ code: "42883", message: "function does not exist" }), "42883 is not a missing content-sha function");
assert(isMissingContentShaFunction({ code: "PGRST202", message: "missing" }), "PGRST202 is the missing content-sha function");
assert(!isMissingContentShaFunction({ message: "Could not find the function public.record_uploaded_content_sha" }), "a message is not a missing content-sha function");

const boundary = readFileSync(new URL("../proposed/m2-with-approval-boundary/00-approval-boundary.sql", import.meta.url), "utf8");
const listed = boundary.slice(boundary.indexOf("ARRAY['partial'"), boundary.indexOf("]::text[]"));
for (const status of APPROVAL_SOURCE_STATUSES) assert(listed.includes(`'${status}'`), `sql list contains ${status}`);
assert(!listed.includes("'active'"), "sql list does not approve active");
assert(!listed.includes("'suspended'"), "sql list does not approve suspended");
assert(boundary.split("application_status_not_approvable").length - 1 === 4, "active and suspended are refused in all four gates");
const approveFn = readFileSync(new URL("../src/lib/applications.functions.ts", import.meta.url), "utf8");
const legacy = approveFn.slice(approveFn.indexOf("legacy: async ()"), approveFn.indexOf("const patch: Record<string, unknown> = { status: \"approved\" }"));
assert(legacy.includes("DOCUMENT_CONTENT_SHA256_ENABLED && IDENTITY_VERIFICATION_ENABLED"), "legacy refusal waits for the flag-on path");
assert(legacy.includes("APPROVAL_STATUS_NOT_APPROVABLE"), "legacy path names the running-renter refusal");

console.log("approve fallback pass");
