/**
 * Release B is Release A with both M2 flags true. Two lines of source differ.
 *
 * This asserts what the flags turn on, and — the point of the exercise — that
 * Release B depends on HOSTED-INSTALL step 2. Published before step 2, every
 * licence uploaded confirms with a NULL content hash, and once step 3 lands
 * those applications cannot be approved. Published after step 2, every upload
 * is hashed, which is what lets the backfill finish the historical 24 and the
 * approval boundary meet no unhashed row.
 *
 * Run: bun scripts/m2-release-b-active.test.ts
 */
import { readFileSync } from "node:fs";
import {
  DOCUMENT_CONTENT_SHA256_ENABLED,
  recordUploadedContentSha,
  resetUploadedContentShaProbe,
  isMissingContentShaFunction,
} from "../src/lib/document-content-sha";
import { IDENTITY_VERIFICATION_ENABLED } from "../src/lib/identity-verification";

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

assert(DOCUMENT_CONTENT_SHA256_ENABLED === true, "Release B ships the content-sha flag on");
assert(IDENTITY_VERIFICATION_ENABLED === true, "Release B ships the identity flag on");
for (const f of ["../src/lib/document-content-sha.ts", "../src/lib/identity-verification.ts"]) {
  assert(!readFileSync(new URL(f, import.meta.url), "utf8").includes("process.env"),
    `${f} must not read the environment: activation is a publish, not a variable`);
}

const BYTES = new TextEncoder().encode("m2-release-b-licence");

/** A storage client that serves one object, and an rpc the test controls. */
function admin(rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: any }>) {
  return {
    storage: {
      from() {
        return {
          info: async () => ({ data: { id: "obj-1", version: "v1", updatedAt: "2026-10-23T00:00:00Z" }, error: null }),
          download: async () => ({ data: { arrayBuffer: async () => BYTES.buffer }, error: null }),
        };
      },
    },
    rpc,
  };
}

// 1. Flag on, step 2 PRESENT: the bytes are hashed and the hash is returned.
resetUploadedContentShaProbe();
let sent: Record<string, unknown> | null = null;
const digest = await crypto.subtle.digest("SHA-256", BYTES as unknown as BufferSource);
const expected = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
const hashed = await recordUploadedContentSha(
  admin(async (name, args) => {
    sent = args;
    assert(name === "record_uploaded_content_sha", "the packet function is the one called");
    return { data: args.p_sha256, error: null };
  }) as any,
  "driver-docs",
  "app-1/licence.jpg",
  "doc-1",
);
assert(hashed === expected, `step 2 present: the stored hash is the hash of the bytes, got ${hashed}`);
assert(sent?.p_object_id === "obj-1" && sent?.p_version === "v1",
  "the merge is conditional on the object id and version that were hashed");

// 2. Flag on, step 2 ABSENT: PostgREST reports PGRST202. The upload still
//    confirms, with a NULL hash, and nothing throws. This is the dependency:
//    those rows are unhashed, and approval closes for them after step 3.
resetUploadedContentShaProbe();
let calls = 0;
const notInstalled = admin(async () => {
  calls += 1;
  return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
});
assert(isMissingContentShaFunction({ code: "PGRST202" }), "PGRST202 is the missing-function code");
const first = await recordUploadedContentSha(notInstalled as any, "driver-docs", "a.jpg", "doc-1");
assert(first === null, "step 2 absent: the upload confirms with no hash");

// 3. And the probe is remembered, so a missing function is not re-probed on
//    every upload.
const second = await recordUploadedContentSha(notInstalled as any, "driver-docs", "b.jpg", "doc-2");
assert(second === null, "step 2 absent: still no hash");
assert(calls === 1, `the missing function is probed once per process, got ${calls} calls`);

// 4. A real storage or merge failure still throws, flag on. A missing function
//    is the ONLY tolerated gap.
resetUploadedContentShaProbe();
let threw = "";
try {
  await recordUploadedContentSha(
    admin(async () => ({ data: null, error: { code: "42501", message: "permission denied" } })) as any,
    "driver-docs",
    "c.jpg",
    "doc-3",
  );
} catch (e) {
  threw = e instanceof Error ? e.message : String(e);
}
assert(threw === "permission denied", `a real merge failure must throw, got ${JSON.stringify(threw)}`);

// 5. The backfill does NOT depend on the flag: it calls writeUploadedContentSha
//    directly, so it is driven by step 2 alone. That is what lets the
//    historical 24 be hashed in the same window.
const backfill = readFileSync(new URL("./backfill-document-content-sha.ts", import.meta.url), "utf8");
assert(backfill.includes("writeUploadedContentSha"), "the backfill calls the unflagged writer");
assert(!/DOCUMENT_CONTENT_SHA256_ENABLED\s*\)/.test(backfill) && !backfill.includes("if (!DOCUMENT_CONTENT_SHA256_ENABLED)"),
  "the backfill must not gate on the flag");

// 6. The identity action is reachable now, and still checks its flag before any
//    role lookup or RPC — the ordering must survive the flip.
const identityFn = readFileSync(new URL("../src/lib/identity-verification.functions.ts", import.meta.url), "utf8");
const handler = identityFn.slice(identityFn.indexOf(".handler"));
const beforeRole = handler.slice(0, handler.indexOf("requireManager"));
assert(beforeRole.includes("if (!IDENTITY_VERIFICATION_ENABLED)"), "the flag is still checked before the manager lookup");
assert(!beforeRole.includes(".rpc("), "the flag is still checked before either RPC");

// 7. The UI renders the action instead of returning null.
const ui = readFileSync(new URL("../src/components/admin/ApplicantDocuments.tsx", import.meta.url), "utf8");
assert(ui.includes("if (!IDENTITY_VERIFICATION_ENABLED) return null;"), "the guard stays, it just no longer fires");
assert(ui.includes("Verify Identity"), "the action label is Title Case");

console.log(
  "release B active: both flags true, bytes hashed through record_uploaded_content_sha with the object id and " +
  "version bound, step 2 absent confirms with a null hash and probes once, a real merge failure still throws, " +
  "the backfill is flag-independent, and the identity flag is still checked before any role lookup or RPC",
);
