import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "driver-evidence-"));
const stubs = {
  react: "export const useCallback = (fn) => fn;",
  "@tanstack/react-start": "export const useServerFn = (fn) => fn;",
  "@/lib/documents.functions": "export const createDocumentUploadUrl=(args)=>globalThis.fixture.start(args); export const confirmDocumentUpload=(args)=>globalThis.fixture.confirm(args);",
  "@/integrations/supabase/client": "export const supabase={storage:{from:(bucket)=>({uploadToSignedUrl:(path,token,file)=>globalThis.fixture.storage(bucket,path,token,file)})}};",
};
try {
  await build({ entryPoints: ["src/components/admin/use-driver-document-upload.ts"], outfile: join(dir, "hook.mjs"), bundle: true, platform: "node", format: "esm", plugins: [{ name: "fixture-only", setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => stubs[args.path] ? { path: args.path, namespace: "fixture" } : null);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  } }] });
  const { useDriverDocumentUpload } = await import(join(dir, "hook.mjs"));
  const calls = [];
  const file = { name: "signed-copy.pdf", type: "application/pdf", size: 400 };
  const signed = { applicationId: "app-1", bucket: "driver-docs", path: "app-1/signed.pdf", token: "fixture-only" };
  globalThis.fixture = {
    start: async (args) => { calls.push(["start", args.data]); return signed; },
    storage: async (...args) => { calls.push(["storage", ...args]); return { error: null }; },
    confirm: async (args) => { calls.push(["confirm", args.data]); },
  };
  const upload = useDriverDocumentUpload("app-1", () => { calls.push(["refresh"]); });
  await upload("agreement", file, () => {});
  assert.deepEqual(calls.map((c) => c[0]), ["start", "storage", "confirm", "refresh"]);
  assert.equal(calls[0][1].category, "agreement");
  assert.equal(calls[1][1], "driver-docs");
  assert.equal(calls[2][1].applicationId, "app-1");
  assert.equal(calls[2][1].category, "agreement");
  assert.equal(calls[2][1].path, signed.path);
  assert.equal(Object.hasOwn(calls[2][1], "review_status"), false);
  console.log("PASS signed copy uses existing private vault sequence, without a verification write");
  calls.length = 0;
  globalThis.fixture.start = async () => ({ ...signed, applicationId: "another-app" });
  await assert.rejects(upload("license_front", file, () => {}), /destination could not be confirmed/);
  assert.equal(calls.length, 0);
  console.log("PASS mismatched applicant prevents storage and confirmation");
  globalThis.fixture.start = async () => signed;
  globalThis.fixture.storage = async () => ({ error: { message: "fixture storage failure" } });
  await assert.rejects(upload("insurance", file, () => {}), /fixture storage failure/);
  assert.equal(calls.length, 0);
  console.log("PASS failed storage never confirms a document or refreshes completion");
} finally {
  delete globalThis.fixture;
  rmSync(dir, { recursive: true, force: true });
}