import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const out = mkdtempSync(join(tmpdir(), "rr-waitlist-tags-"));
const ENTRY_ID = "11111111-1111-4111-8111-111111111111";

try {
  await build({
    entryPoints: ["src/lib/waitlist.functions.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "handler.mjs"),
    plugins: [{
      name: "synthetic-only",
      setup(b) {
        const stubs = {
          "@tanstack/react-start": "export const createServerFn=()=>{let validator;const a={middleware:()=>a,inputValidator:v=>(validator=v,a),handler:f=>(args)=>f({...args,data:validator?validator(args.data):args.data})};return a}",
          "@/integrations/supabase/auth-middleware": "export const requireSupabaseAuth={}",
          "@/lib/roles.server": "export const requireStaff=async()=>({});export const requireManager=async()=>{if(!['manager','owner'].includes(globalThis.fixture.role))throw new Error('Forbidden');return {userId:'actor',role:globalThis.fixture.role==='owner'?'admin':'team',email:null,tier:globalThis.fixture.role}}",
          "@/lib/audit": "export const logAudit=async(...args)=>{globalThis.fixture.audits.push(args)}",
          "@/lib/waitlist-reads.server": "export const completeRead=async()=>[];export const readInBatches=async()=>[]",
          "@/lib/waitlist-claim": "export const WAITLIST_CLAIM_ENABLED=false;export const deliverOpeningEmails=async()=>({sent:0})",
          "@/integrations/supabase/client.server": "export const supabaseAdmin={from:(...args)=>globalThis.fixture.from(...args)}",
        };
        b.onResolve({ filter: /.*/ }, (args) => {
          if (stubs[args.path]) return { path: args.path, namespace: "stub" };
          if (args.path === "@/lib/waitlist-tags") return { path: resolve("src/lib/waitlist-tags.ts") };
          if (args.path.startsWith("@/")) return { path: args.path, external: true };
          return undefined;
        });
        b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
      },
    }],
  });

  const { setWaitlistTags } = await import(pathToFileURL(join(out, "handler.mjs")).href);
  let writes;
  let audits;
  globalThis.fixture = {
    role: "manager",
    audits: [],
    from(table) {
      assert.equal(table, "waitlist");
      let id;
      let patch;
      let failure = globalThis.fixture.failure;
      const q = {
        update(value) { patch = value; return q; },
        eq(column, value) { assert.equal(column, "id"); id = value; return q; },
        select() { return q; },
        async maybeSingle() {
          if (failure) return { data: null, error: { code: failure } };
          if (id !== ENTRY_ID) return { data: null, error: null };
          writes.push(patch);
          return { data: { id, tags: patch.tags }, error: null };
        },
      };
      return q;
    },
  };

  async function run(role = "manager", entryId = ENTRY_ID, failure = null) {
    globalThis.fixture.role = role;
    globalThis.fixture.failure = failure;
    writes = [];
    audits = globalThis.fixture.audits = [];
    return setWaitlistTags({ data: { entryId, tags: [" Hot ", "hot", "Needs   Callback"] }, context: { userId: "actor" } });
  }

  const saved = await run("manager");
  assert.deepEqual(saved, { ok: true, tags: ["Hot", "Needs Callback"] });
  assert.deepEqual(writes, [{ tags: ["Hot", "Needs Callback"] }]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0][1].action, "waitlist.tags_updated");

  const owner = await run("owner");
  assert.equal(owner.ok, true);

  await assert.rejects(run("coordinator"), /Forbidden/);
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);

  const missing = await run("manager", "22222222-2222-4222-8222-222222222222");
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not found/);
  assert.equal(audits.length, 0);

  const unavailable = await run("manager", ENTRY_ID, "PGRST204");
  assert.deepEqual(unavailable, { ok: false, error: "Tag storage is not connected yet. No changes were made." });
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);

  console.log("PASS 5 synthetic Waitlist tag mutation checks; no hosted calls or customer writes.");
} finally {
  delete globalThis.fixture;
  rmSync(out, { recursive: true, force: true });
}
