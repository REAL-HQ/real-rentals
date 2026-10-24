/**
 * Hash-only compatibility build: Release A with DOCUMENT_CONTENT_SHA256_ENABLED
 * true and IDENTITY_VERIFICATION_ENABLED still false. One line of source differs
 * from Release A.
 *
 * Purpose: from M2 step 2 on, every new upload is hashed (so the backfill never
 * has to be re-run), while identity verification stays off. Before step 3 the
 * approval path is exactly Release A's. From step 3 until Release B is
 * published, no identity can be verified, so approve_application_checked
 * refuses every new approval and nothing is written: the owner's approval
 * freeze, enforced by the build.
 *
 * Run: bun scripts/m2-hash-only.test.ts
 */
import { readFileSync } from "node:fs";
import { approveThroughPacket } from "../src/lib/approval-rpc.server";
import {
  DOCUMENT_CONTENT_SHA256_ENABLED,
  recordUploadedContentSha,
  resetUploadedContentShaProbe,
} from "../src/lib/document-content-sha";
import { IDENTITY_VERIFICATION_ENABLED } from "../src/lib/identity-verification";

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

assert(DOCUMENT_CONTENT_SHA256_ENABLED === true, "hash-only ships the content-sha flag on");
assert(IDENTITY_VERIFICATION_ENABLED === false, "hash-only ships the identity flag off");
for (const f of ["../src/lib/document-content-sha.ts", "../src/lib/identity-verification.ts"]) {
  assert(!readFileSync(new URL(f, import.meta.url), "utf8").includes("process.env"), `${f} must not read the environment`);
}

// 1. Uploads: hashed when step 2 is installed, confirmed with a null hash (no
//    throw, probed once) when it is not.
const BYTES = new TextEncoder().encode("m2-hash-only-licence");
function admin(rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: any }>) {
  return {
    storage: {
      from() {
        return {
          info: async () => ({ data: { id: "obj-1", version: "v1", updatedAt: "2026-10-24T00:00:00Z" }, error: null }),
          download: async () => ({ data: { arrayBuffer: async () => BYTES.buffer }, error: null }),
        };
      },
    },
    rpc,
  };
}
resetUploadedContentShaProbe();
const digest = await crypto.subtle.digest("SHA-256", BYTES as unknown as BufferSource);
const expected = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
const hashed = await recordUploadedContentSha(
  admin(async (name, args) => {
    assert(name === "record_uploaded_content_sha", "the step 2 function is called");
    assert(args.p_object_id === "obj-1" && args.p_version === "v1", "bound to the hashed object id and version");
    return { data: args.p_sha256, error: null };
  }) as any,
  "driver-docs",
  "app-1/licence.jpg",
  "doc-1",
);
assert(hashed === expected, "step 2 present: the stored hash is the SHA-256 of the bytes");
resetUploadedContentShaProbe();
let probes = 0;
const absent = admin(async () => {
  probes += 1;
  return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
});
assert((await recordUploadedContentSha(absent as any, "driver-docs", "a.jpg", "d1")) === null, "step 2 absent: upload confirms, null hash");
assert((await recordUploadedContentSha(absent as any, "driver-docs", "b.jpg", "d2")) === null, "still null");
assert(probes === 1, "the missing function is probed once");

// 2. Before step 3: approvals take Release A's legacy path unchanged. The
//    legacy status refusals need BOTH flags, so they stay off here.
const approve = readFileSync(new URL("../src/lib/applications.functions.ts", import.meta.url), "utf8");
assert(approve.includes("if (DOCUMENT_CONTENT_SHA256_ENABLED && IDENTITY_VERIFICATION_ENABLED) {"),
  "legacy refusals require both flags, so hash-only approves exactly as Release A");
let legacy = 0;
const before = await approveThroughPacket({
  applicationId: "44444444-4444-4444-8444-444444444444",
  readVersion: async () => ({ version: null, error: { code: "42703", message: "column applications.approval_evidence_version does not exist" } }),
  rpc: async () => { throw new Error("the RPC must not be called before step 3"); },
  legacy: async () => { legacy += 1; return { error: null }; },
});
assert(before.ok && (before as any).via === "legacy" && legacy === 1, "before step 3: legacy approval, once");

// 3. Step 3 installed: the packet path is taken, the RPC refuses without a
//    verified identity, and the legacy write is never attempted.
legacy = 0;
const after = await approveThroughPacket({
  applicationId: "44444444-4444-4444-8444-444444444444",
  readVersion: async () => ({ version: 0, error: null }),
  rpc: async (name) => {
    assert(name === "approve_application_checked", "packet RPC");
    return { data: null, error: { code: "P0001", message: "positive_identity_required" } };
  },
  legacy: async () => { legacy += 1; return { error: null }; },
});
assert(!after.ok && (after as any).error === "positive_identity_required" && legacy === 0,
  "after step 3: refused with positive_identity_required, no legacy write: the freeze");

// 4. Identity verification cannot be reached: the hold is the first statement
//    in the handler, and the Verify Identity control renders nothing.
const identityFn = readFileSync(new URL("../src/lib/identity-verification.functions.ts", import.meta.url), "utf8");
const handler = identityFn.slice(identityFn.indexOf(".handler"));
const beforeRole = handler.slice(0, handler.indexOf("requireManager"));
assert(beforeRole.includes("if (!IDENTITY_VERIFICATION_ENABLED)"), "the hold precedes the manager lookup");
assert(!beforeRole.includes(".rpc("), "the hold precedes either identity RPC");
const ui = readFileSync(new URL("../src/components/admin/ApplicantDocuments.tsx", import.meta.url), "utf8");
assert(ui.includes("if (!IDENTITY_VERIFICATION_ENABLED) return null;"), "the Verify Identity control is absent");

// 5. Re-approving an approved application still writes nothing (Release A).
const h = approve.slice(approve.indexOf("export const approveApplication"));
assert(h.indexOf('if (app.status !== "approved")') > 0 && h.indexOf('if (app.status !== "approved")') < h.indexOf("approveThroughPacket"),
  "already-approved guard precedes the packet call");

console.log(
  "hash-only: content-sha on and identity off; uploads hashed with step 2 and null without it (probed once); " +
  "before step 3 approvals are Release A's legacy path; after step 3 they are refused with positive_identity_required " +
  "and nothing is written; identity verification is unreachable",
);
