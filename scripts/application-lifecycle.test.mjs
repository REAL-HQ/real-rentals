// Synthetic executable handler tests: real schema, handler and role resolver;
// only framework transport, database I/O and audit sink are replaced.
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const out = mkdtempSync(join(tmpdir(), "rr-lifecycle-"));
const id = "11111111-1111-4111-8111-111111111111";
let passed = 0;
try {
  writeFileSync(
    join(out, "start.js"),
    `export const createServerFn=()=>{const a={middleware:()=>a,inputValidator:v=>(a.v=v,a),handler:f=>args=>f({...args,data:a.v(args.data)})};return a;};`,
  );
  writeFileSync(join(out, "auth.js"), "export const requireSupabaseAuth={};");
  writeFileSync(
    join(out, "audit.js"),
    "export const logAudit=async(actor,entry)=>globalThis.fixture.audit.push({actor,entry});",
  );
  writeFileSync(
    join(out, "db.js"),
    `
 export const supabaseAdmin={auth:{admin:{getUserById:async()=>({data:{user:{email:'synthetic@example.invalid'}}})}},from(name){
 const s=globalThis.fixture;let filters=[],patch,columns,cap;
 const result=()=>{
  s.reads.push(name);
  if(name==='user_roles') return {data:s.role?[{role:s.role}]:[],error:null};
  if(s.readError&&!patch) return {data:null,error:{message:'read failed'}};
  let rows=(name==='applications'?[s.row]:s.rentals).filter(Boolean).filter(r=>filters.every(([k,v])=>r[k]===v));
  if(cap) rows=rows.slice(0,cap);
  if(patch){
   s.attempts++;
   if(s.writeError)return {data:null,error:{message:'write failed'}};
   if(s.zero)rows=[];
   rows.forEach(r=>Object.assign(r,patch));s.writes+=rows.length;
  }
  return {data:rows.map(r=>Object.fromEntries(columns.split(',').map(k=>[k,r[k]??null]))),error:null};
 };
 const q={select:c=>(columns=c,q),eq:(k,v)=>(filters.push([k,v]),q),is:(k,v)=>(filters.push([k,v]),q),limit:n=>(cap=n,q),update:p=>(patch=p,s.conflict&&(s.row.status='closed'),q),maybeSingle:async()=>{const r=result();return {...r,data:r.data?.[0]??null}},then:(a,b)=>Promise.resolve(result()).then(a,b)};return q;
 }};`,
  );
  const aliases = {
    "@": resolve("src"),
    "@tanstack/react-start": join(out, "start.js"),
    "@/integrations/supabase/auth-middleware": join(out, "auth.js"),
    "@/integrations/supabase/client.server": join(out, "db.js"),
    "@/lib/audit": join(out, "audit.js"),
  };
  await build({
    entryPoints: ["src/lib/application-lifecycle.functions.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "handler.mjs"),
    alias: aliases,
  });
  const { updateApplicationLifecycle: call } = await import(join(out, "handler.mjs"));
  function reset(role = "coordinator", extra = {}) {
    globalThis.fixture = {
      role,
      row: {
        id,
        status: "new",
        contacted_at: null,
        deleted_at: null,
        license_number: "PRIVATE",
        contact_status: "follow_up",
      },
      rentals: [],
      reads: [],
      audit: [],
      writes: 0,
      attempts: 0,
      ...extra,
    };
  }
  const invoke = async (patch) =>
    call({ data: { id, patch }, context: { userId: "synthetic-user" } });
  async function test(name, fn) {
    await fn();
    passed++;
    console.log("PASS", name);
  }
  for (const role of ["admin", "team", "coordinator"])
    await test(role + " permitted lifecycle update", async () => {
      reset(role);
      const r = await invoke({ status: "reviewing" });
      assert.equal(r.status, "reviewing");
      assert.equal(fixture.writes, 1);
      assert.equal(fixture.audit.length, 1);
      assert.ok(r.contacted_at);
      assert.deepEqual(Object.keys(r).sort(), ["contacted_at", "id", "status"]);
      assert.equal(fixture.row.contact_status, "follow_up");
    });
  for (const role of ["driver", null])
    await test(String(role) + " denied before application read", async () => {
      reset(role);
      await assert.rejects(invoke({ status: "reviewing" }), /Forbidden/);
      assert.equal(fixture.attempts, 0);
      assert.ok(!fixture.reads.includes("applications"));
    });
  for (const patch of [
    { status: "approved" },
    { status: "active" },
    { user_id: id },
    { license_front_path: "private" },
    { contact_status: "contacted" },
    { reviewed_at: "2026-10-12" },
    { identity_verified: true },
  ])
    await test("forged/privileged payload " + JSON.stringify(patch), async () => {
      reset("admin");
      await assert.rejects(invoke(patch));
      assert.equal(fixture.attempts, 0);
    });
  for (const patch of [
    { license_number: "X" },
    { notes: "private" },
    { weekly_rent: 350 },
    { background_check_status: "passed" },
    { vehicle_id: id },
    { status: "suspended" },
  ])
    await test("Coordinator protected mutation " + JSON.stringify(patch), async () => {
      reset();
      await assert.rejects(invoke(patch), /Forbidden/);
      assert.equal(fixture.attempts, 0);
    });
  await test("Coordinator cannot undo approval", async () => {
    reset();
    fixture.row.status = "approved";
    await assert.rejects(invoke({ status: "new" }), /Forbidden/);
    assert.equal(fixture.attempts, 0);
  });
  for (const role of ["admin", "team"])
    await test(role + " existing profile permissions", async () => {
      reset(role);
      const r = await invoke({ license_number: "SYNTHETIC", weekly_rent: 350 });
      assert.equal(r.weekly_rent, 350);
      assert.equal(r.license_number, "SYNTHETIC");
      assert.ok(!JSON.stringify(fixture.audit).includes("SYNTHETIC"));
    });
  for (const extra of [
    { conflict: true },
    { zero: true },
    { writeError: true },
    { readError: true },
    { row: null },
  ])
    await test("failed write/read never successful " + JSON.stringify(extra), async () => {
      reset("team", extra);
      await assert.rejects(invoke({ status: "reviewing" }));
      assert.equal(fixture.writes, 0);
      assert.equal(fixture.audit.length, 0);
    });
  await test("active rental prevents lifecycle rewrite", async () => {
    reset("team", { rentals: [{ id: "r", application_id: id, status: "active" }] });
    await assert.rejects(invoke({ status: "closed" }), /active rental/);
    assert.equal(fixture.attempts, 0);
  });
  await test("first contact time preserved", async () => {
    reset();
    fixture.row.contacted_at = "2026-01-01T00:00:00.000Z";
    const r = await invoke({ contacted_at: "2099-01-01T00:00:00.000Z" });
    assert.equal(r.contacted_at, "2026-01-01T00:00:00.000Z");
  });
  await test("Coordinator permitted operational contact fields", async () => {
    reset();
    const r = await invoke({ phone: "8135550100", city: "Tampa", state: "FL" });
    assert.equal(r.phone, "8135550100");
    assert.ok(!("license_number" in r));
  });
  await test("active application cannot be rewritten by Manager", async () => {
    reset("team");
    fixture.row.status = "active";
    await assert.rejects(invoke({ status: "closed" }), /rental workflow/);
    assert.equal(fixture.attempts, 0);
  });
  const ui = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  await test("browser writer removed; saved callbacks do not write twice", async () => {
    assert.ok(!/from\("applications"\)\.update/.test(ui));
    assert.ok(ui.includes('onSaved({ status: "approved" })'));
    assert.ok(ui.includes("if (await update(id, { contacted_at:"));
  });
  // Negative control: removing the affected-row guard must make the zero-row
  // case return success, which the assertion above rejects.
  const original = readFileSync("src/lib/application-lifecycle.functions.ts", "utf8");
  const mutant = original.replace(
    /if \(!rows \|\| rows.length !== 1\)\s*throw new Error\([\s\S]*?\);/,
    "",
  );
  assert.notEqual(mutant, original);
  await build({
    stdin: { contents: mutant, resolveDir: resolve("src/lib"), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "mutant.mjs"),
    alias: aliases,
  });
  const mutation = await import(join(out, "mutant.mjs"));
  reset("team", { zero: true });
  await assert.rejects(async () =>
    assert.ok(
      await mutation.updateApplicationLifecycle({
        data: { id, patch: { status: "reviewing" } },
        context: { userId: "synthetic-user" },
      }),
    ),
  );
  console.log("PASS negative control: removed guard is detected");
  console.log(passed + " handler/security checks passed");
} finally {
  rmSync(out, { recursive: true, force: true });
}
