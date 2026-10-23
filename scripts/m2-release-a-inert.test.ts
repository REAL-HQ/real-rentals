/**
 * Release A is 67b62664 plus the M2 application code with both flags false.
 * "Inert" is the claim that it approves and stores documents exactly as the
 * accepted release does. These assertions pin the three places where that
 * claim is narrower than it sounds, so a reviewer sees them and a later edit
 * cannot quietly widen them.
 *
 * Run: bun scripts/m2-release-a-inert.test.ts
 */
import { readFileSync } from "node:fs";
import { approveThroughPacket } from "../src/lib/approval-rpc.server";
import { DOCUMENT_CONTENT_SHA256_ENABLED, recordUploadedContentSha } from "../src/lib/document-content-sha";
import { IDENTITY_VERIFICATION_ENABLED } from "../src/lib/identity-verification";
import { persistConfirmedDocument } from "../src/lib/documents.functions";

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

// Both flags are hard false in the shipped source. No environment can open them.
assert(DOCUMENT_CONTENT_SHA256_ENABLED === false, "content-sha flag must ship false");
assert(IDENTITY_VERIFICATION_ENABLED === false, "identity flag must ship false");
for (const f of ["../src/lib/document-content-sha.ts", "../src/lib/identity-verification.ts"]) {
  const text = readFileSync(new URL(f, import.meta.url), "utf8");
  assert(!text.includes("process.env"), `${f} must not read the environment`);
}

// 1. Flag off, the hasher returns null without touching storage. A throwing
//    storage client proves it is never consulted.
const hostile = {
  storage: {
    from() {
      throw new Error("storage was reached while the flag is off");
    },
  },
};
assert((await recordUploadedContentSha(hostile, "driver-docs", "a/b.jpg")) === null, "flag off returns null");

// 2. Flag off, persistConfirmedDocument writes the same rows the accepted
//    release wrote: one insert, no content_sha256 column, then the supersede.
const writes: Array<{ table: string; op: string; patch?: Record<string, unknown> }> = [];
function fakeAdmin() {
  return {
    from(table: string) {
      const chain: any = {
        insert(row: Record<string, unknown>) {
          writes.push({ table, op: "insert", patch: row });
          return chain;
        },
        update(patch: Record<string, unknown>) {
          writes.push({ table, op: "update", patch });
          return chain;
        },
        select: () => chain,
        single: async () => ({ data: { id: "doc-1" }, error: null }),
        eq: () => chain,
        neq: async () => ({ error: null }),
      };
      return chain;
    },
  };
}
const saved = await persistConfirmedDocument(fakeAdmin() as any, {
  driver_id: "app-1",
  kind: "license_front",
  category: "license_front",
  label: null,
  storage_bucket: "driver-docs",
  storage_path: "app-1/license.jpg",
  visibility: ["driver", "admin"],
  file_name: "license.jpg",
  mime_type: "image/jpeg",
  size_bytes: 10,
  expires_at: null,
  uploaded_by: "user-1",
  uploaded_by_role: "team",
});
assert(saved.id === "doc-1", "the inserted id is returned");
assert(writes.length === 2, `flag off writes insert + supersede only, got ${writes.length}`);
assert(writes[0].op === "insert" && writes[0].patch?.is_current === true, "first write is the current insert");
assert(!("content_sha256" in (writes[0].patch ?? {})), "flag off does not insert content_sha256");
assert(writes[1].op === "update" && writes[1].patch?.is_current === false, "second write is the supersede");
assert(writes[1].patch?.superseded_by === "doc-1", "the supersede points at the new row");
assert(!writes.some((w) => w.patch && "content_sha256" in w.patch), "flag off never stamps a hash");

// 3. The approval version read is NOT behind either flag. It runs on every
//    Approve from the moment Release A ships, and applications.approval_
//    evidence_version does not exist until packet step 3. Only 42703, and
//    PGRST204 naming that column, are tolerated; anything else refuses the
//    approval that the accepted release would have completed. This is the one
//    new failure mode Release A introduces, so it is pinned rather than
//    described.
const legacyRan: string[] = [];
const args = (versionError: { code?: string; message?: string } | null) => ({
  applicationId: "44444444-4444-4444-8444-444444444444",
  readVersion: async () => ({ version: null, error: versionError }),
  rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
  legacy: async () => {
    legacyRan.push("legacy");
    return { error: null };
  },
});

// The production shape: the column is absent, PostgREST reports 42703.
const absentColumn = await approveThroughPacket(args({ code: "42703", message: 'column applications.approval_evidence_version does not exist' }));
assert(absentColumn.ok && absentColumn.via === "legacy", "42703 on the version read still approves through legacy");
assert(legacyRan.length === 1, "the legacy write ran once");

// Any other code refuses, before either flag is consulted.
legacyRan.length = 0;
const unexpected = await approveThroughPacket(args({ code: "PGRST100", message: "unexpected" }));
assert(!unexpected.ok, "an unexpected version-read error refuses the approval");
assert(legacyRan.length === 0, "and the legacy write does not run");

// A PGRST204 that names another column is not tolerated either.
legacyRan.length = 0;
const otherColumn = await approveThroughPacket(args({ code: "PGRST204", message: "Could not find the email column" }));
assert(!otherColumn.ok, "PGRST204 naming another column refuses the approval");
assert(legacyRan.length === 0, "and the legacy write does not run");

// 4. Re-approving an already-approved application is handled in the caller, not
//    here: the accepted release rewrote status and logged a second
//    application.approved entry, Release A skips both and still re-sends the
//    agreement. Pin the guard so the skip is deliberate.
const approve = readFileSync(new URL("../src/lib/applications.functions.ts", import.meta.url), "utf8");
const handler = approve.slice(approve.indexOf("export const approveApplication"));
const guard = handler.indexOf('if (app.status !== "approved")');
const packetCall = handler.indexOf("approveThroughPacket");
assert(guard > 0, "the already-approved guard is present");
assert(guard < packetCall, "the guard precedes the packet call, so an approved row writes no status and no audit");

console.log(
  "release A inert: both flags false, storage untouched, 2 document writes with no content_sha256, " +
  "42703 version read still approves through legacy, any other version-read error refuses, " +
  "already-approved writes no status and no second audit",
);
