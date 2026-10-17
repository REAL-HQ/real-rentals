// Execute the actual application handlers with transport/roles/I/O replaced.
// No external network, database or Stripe calls.
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const out = mkdtempSync(join(tmpdir(), "rr-release-holds-"));
try {
  writeFileSync(join(out, "start.js"), `export const createServerFn=()=>{const a={middleware:()=>a,inputValidator:v=>(a.v=v,a),handler:f=>args=>{if(!args.context.userId)throw Error('Unauthorized');return f({...args,data:a.v(args.data)})}};return a};`);
  writeFileSync(join(out, "auth.js"), "export const requireSupabaseAuth={};");
  writeFileSync(join(out, "roles.js"), `export const requireManager=async id=>{if(!['owner','manager'].includes(id))throw Error('Forbidden');return {userId:id,tier:id}};export const requireOwner=requireManager;export const requireStaff=requireManager;export const getActor=requireManager;export const requireTier=requireManager;`);
  writeFileSync(join(out, "db.js"), `export const supabaseAdmin=new Proxy({}, {get(){globalThis.io++;throw Error('Unexpected database or account I/O')}});`);
  await build({ entryPoints: ["src/lib/applications.functions.ts", "src/lib/rental-intake.functions.ts"],
    outdir: out, bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" },
    alias: { "@": resolve("src"), "@tanstack/react-start": join(out,"start.js"),
      "@/integrations/supabase/auth-middleware": join(out,"auth.js"),
      "@/lib/roles.server": join(out,"roles.js"), "@/integrations/supabase/client.server": join(out,"db.js") } });
  const { approveApplication, inviteDriverPortal } = await import(join(out,"applications.functions.mjs"));
  const { recordExistingRental } = await import(join(out,"rental-intake.functions.mjs"));
  const id = "11111111-1111-4111-8111-111111111111";
  let checks=0;
  for(const userId of ["owner","manager","coordinator","driver",null]) {
    for(const [call,data] of [
      [approveApplication,{id,mode:"approve_only"}], [approveApplication,{id,mode:"approve_invite"}],
      [inviteDriverPortal,{id}], [recordExistingRental,{applicationId:id,vehicleId:id,pickupDate:"2026-10-15",pickupMileage:null,weeklyRate:350,depositCollected:0,stripeCustomerId:null,stripeSubscriptionId:null,environment:"sandbox",confirm:"RECORD",reason:"Synthetic check"}],
    ]) {
      globalThis.io=0;
      if(["owner","manager"].includes(userId)) {
        const result=await call({data,context:{userId}});assert.equal(result.ok,false);
      } else await assert.rejects(async()=>call({data,context:{userId}}), /Forbidden|Unauthorized/);
      assert.equal(globalThis.io,0); checks++;
    }
  }
  console.log(`${checks} real-handler disabled-action/role checks passed; zero business I/O.`);
} finally { rmSync(out,{recursive:true,force:true}); }