// Application Status: closure, reopen, Active evidence, and the untouched Contact Status list.
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const out = mkdtempSync(join(tmpdir(), "rr-app-status-"));
const id = "11111111-1111-4111-8111-111111111111";
const vehicleId = "22222222-2222-4222-8222-222222222222";
const rentalId = "33333333-3333-4333-8333-333333333333";
let passed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log("PASS", name);
    });
}

try {
  await build({
    entryPoints: ["src/lib/application-status.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "status.mjs"),
    alias: { "@": resolve("src") },
  });
  const status = await import(join(out, "status.mjs"));

  await test("menu includes Approved and Closed and cannot select Active", async () => {
    const menu = status.applicationStatusMenu("new");
    assert.deepEqual(
      menu.map((item) => item.label),
      ["New", "Reviewing", "Approved", "Suspended", "Declined", "Closed"],
    );
    assert.equal(menu.some((item) => item.value === "active"), false);
    const stored = status.applicationStatusMenu("active");
    const active = stored.find((item) => item.value === "active");
    assert.equal(active.disabled, true);
    assert.equal(stored.filter((item) => item.value === "closed").length, 1);
  });

  await test("closure reasons are the six labels", async () => {
    assert.deepEqual(
      status.CLOSURE_REASONS.map((reason) => reason.label),
      [
        "Unable to Qualify",
        "No Vehicle Available",
        "Pricing / Affordability",
        "Applicant Withdrew",
        "Unresponsive",
        "Other",
      ],
    );
  });

  await test("only Owner and Manager reopen Closed", async () => {
    assert.equal(status.canReopenClosedApplication("owner"), true);
    assert.equal(status.canReopenClosedApplication("manager"), true);
    assert.equal(status.canReopenClosedApplication("coordinator"), false);
  });

  const rental = {
    id: rentalId,
    application_id: id,
    status: "active",
    vehicle_id: vehicleId,
    pickup_reading_id: "reading-1",
  };
  const vehicle = { id: vehicleId, status: "rented", archived_at: null };
  const payment = {
    rental_id: rentalId,
    status: "paid",
    type: "rent",
    net_collected: 350,
    amount: 350,
    stripe_subscription_id: "sub_ignored",
  };

  await test("Active requires rental, vehicle, handover and collected payment", async () => {
    assert.deepEqual(
      status.authoritativeActiveApplicationIds({ rentals: [rental], vehicles: [vehicle], payments: [payment] }),
      [id],
    );
  });

  await test("approval and subscription status do not make a driver Active", async () => {
    assert.deepEqual(
      status.authoritativeActiveApplicationIds({
        rentals: [{ ...rental, pickup_reading_id: null }],
        vehicles: [vehicle],
        payments: [],
      }),
      [],
    );
    assert.deepEqual(
      status.authoritativeActiveApplicationIds({
        rentals: [rental],
        vehicles: [vehicle],
        payments: [{ ...payment, status: "pending" }],
      }),
      [],
    );
    assert.deepEqual(
      status.authoritativeActiveApplicationIds({
        rentals: [{ ...rental, status: "closed" }],
        vehicles: [vehicle],
        payments: [payment],
      }),
      [],
    );
    assert.deepEqual(
      status.authoritativeActiveApplicationIds({ rentals: [], vehicles: [], payments: [] }),
      [],
    );
  });

  await test("Active ids are unique and a late fee is not the initial payment", async () => {
    assert.deepEqual(
      status.authoritativeActiveApplicationIds({
        rentals: [rental, { ...rental, id: "44444444-4444-4444-8444-444444444444" }],
        vehicles: [vehicle],
        payments: [payment, { ...payment, type: "late_fee", rental_id: rentalId }],
      }),
      [id],
    );
    assert.deepEqual(
      status.authoritativeActiveApplicationIds({
        rentals: [rental],
        vehicles: [vehicle],
        payments: [{ ...payment, type: "late_fee" }],
      }),
      [],
    );
  });

  await test("filter counts use Active evidence and leave Closed historical rows", async () => {
    const drivers = [
      { id: "a", status: "new" },
      { id: "b", status: "closed" },
      { id: "c", status: "active" },
      { id: "d", status: "approved" },
      { id, status: "active" },
    ];
    const held = new Set(["a"]);
    const active = new Set([id]);
    assert.equal(status.applicationFilterCount("all", drivers, held, active, 0), 5);
    assert.equal(status.applicationFilterCount("new", drivers, held, active, 0), 0);
    assert.equal(status.applicationFilterCount("closed", drivers, held, active, 0), 1);
    assert.equal(status.applicationFilterCount("approved", drivers, held, active, 0), 1);
    assert.equal(status.applicationFilterCount("active", drivers, held, active, 0), 1);
    assert.equal(status.applicationFilterCount("waitlist", drivers, held, active, 2), 3);
  });

  await test("Active filter keeps an ongoing rental without handover or payment", async () => {
    const second = "44444444-4444-4444-8444-444444444444";
    const ids = status.activeFilterApplicationIds({
      rentals: [
        { ...rental, pickup_reading_id: null, vehicle_id: null },
        { id: second, application_id: "c", status: "active", vehicle_id: null, pickup_reading_id: null },
        { ...rental, id: "55555555-5555-4555-8555-555555555555", application_id: "ended", status: "closed" },
      ],
      recordRentalEnabled: false,
    });
    assert.deepEqual(ids, [id, "c"]);
    const rows = [
      { id, status: "approved" },
      { id: "c", status: "active" },
      { id: "missing", status: "active" },
      { id: "ended", status: "closed" },
    ];
    const active = new Set(ids);
    assert.equal(status.applicationFilterCount("active", rows, new Set(), active, 0), 2);
    assert.equal(status.applicationFilterCount("approved", rows, new Set(), active, 0), 1);
    assert.equal(status.applicationFilterCount("closed", rows, new Set(), active, 0), 1);
    assert.deepEqual(
      status.activeFilterApplicationIds({
        rentals: [{ ...rental, pickup_reading_id: null }],
        vehicles: [vehicle],
        payments: [],
        recordRentalEnabled: true,
      }),
      [],
    );
  });

  await test("Coordinator cannot leave Closed and Approved is not a reopen", async () => {
    const coordinator = status.applicationStatusMenu("closed", "coordinator");
    assert.equal(coordinator.find((item) => item.value === "closed").disabled, false);
    assert.equal(coordinator.find((item) => item.value === "reviewing").disabled, true);
    assert.equal(coordinator.find((item) => item.value === "approved").disabled, true);
    const manager = status.applicationStatusMenu("closed", "manager");
    assert.equal(manager.find((item) => item.value === "reviewing").disabled, false);
    assert.equal(manager.find((item) => item.value === "new").disabled, false);
    assert.equal(manager.find((item) => item.value === "approved").disabled, true);
    const owner = status.applicationStatusMenu("closed", "owner");
    assert.equal(owner.find((item) => item.value === "declined").disabled, false);
    assert.equal(status.applicationStatusChoiceDisabled("reviewing", "closed", "coordinator"), false);
    assert.equal(status.applicationStatusChoiceDisabled("closed", "approved", "owner"), true);
  });

  await test("closure history stays visible past the activity cap", async () => {
    const docs = Array.from({ length: 20 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 9, 20, 0, 0, index)).toISOString(),
      label: "Document Received",
      detail: `doc ${index}`,
    }));
    const events = [
      {
        at: "2026-10-01T00:00:00.000Z",
        label: "Application Closed",
        detail: "Pricing / Affordability · Called twice · owner@example.invalid",
      },
      ...docs,
      {
        at: "2026-10-21T00:00:00.000Z",
        label: "Application Reopened",
        detail: "Reviewing · manager@example.invalid",
      },
    ];
    const visible = status.visibleDriverActivity(events, 12);
    const closed = visible.find((event) => event.label === "Application Closed");
    const reopened = visible.find((event) => event.label === "Application Reopened");
    assert.equal(closed.detail.includes("Pricing / Affordability"), true);
    assert.equal(closed.detail.includes("Called twice"), true);
    assert.equal(reopened.detail.includes("Reviewing"), true);
    assert.equal(visible.filter((event) => event.label === "Document Received").length, 12);
    assert.equal(visible[0].label, "Application Reopened");
  });

  await test("closure history keeps reason, notes and actor", async () => {
    const event = status.applicationStatusEventFromAudit({
      created_at: "2026-10-22T12:00:00.000Z",
      actor_email: "owner@example.invalid",
      action: "application.closed",
      metadata: {
        closure_reason: "pricing_affordability",
        closure_notes: "Called twice",
        previous_status: "reviewing",
        status: "closed",
      },
    });
    assert.equal(event.reasonLabel, "Pricing / Affordability");
    assert.equal(event.notes, "Called twice");
    assert.equal(event.actor, "owner@example.invalid");
    assert.equal(event.previousStatus, "reviewing");
  });

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
 if(!s.tables)s.tables={};
 const result=()=>{
  s.reads.push(name);
  if(name==='user_roles') return {data:s.role?[{role:s.role}]:[],error:null};
  let rows=(name==='applications'?[s.row]:s.rentals).filter(Boolean).filter(r=>filters.every(([k,v])=>r[k]===v));
  if(cap) rows=rows.slice(0,cap);
  if(patch){
   s.attempts++;
   s.patches.push(patch);
   if(s.writeError)return {data:null,error:{message:'write failed'}};
   rows.forEach(r=>Object.assign(r,patch));s.writes+=rows.length;
  }
  return {data:rows.map(r=>Object.fromEntries(columns.split(',').map(k=>[k,r[k]??null]))),error:null};
 };
 const q={select:c=>(columns=c,q),eq:(k,v)=>(filters.push([k,v]),q),is:(k,v)=>(filters.push([k,v]),q),limit:n=>(cap=n,q),update:p=>(patch=p,q),insert:()=>{s.inserts++;throw new Error('insert');},maybeSingle:async()=>{const r=result();return {...r,data:r.data?.[0]??null}},then:(a,b)=>Promise.resolve(result()).then(a,b)};return q;
 }};`,
  );
  await build({
    entryPoints: ["src/lib/application-lifecycle.functions.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "handler.mjs"),
    alias: {
      "@": resolve("src"),
      "@tanstack/react-start": join(out, "start.js"),
      "@/integrations/supabase/auth-middleware": join(out, "auth.js"),
      "@/integrations/supabase/client.server": join(out, "db.js"),
      "@/lib/audit": join(out, "audit.js"),
    },
  });
  const { updateApplicationLifecycle: call } = await import(join(out, "handler.mjs"));
  function reset(role = "team", extra = {}) {
    globalThis.fixture = {
      role,
      row: {
        id,
        status: "reviewing",
        contacted_at: "2026-01-01T00:00:00.000Z",
        deleted_at: null,
        contact_status: "follow_up",
        contact_status_note: "left a voicemail",
        utm_source: "google",
        gclid: "gclid-1",
        source: "ads",
        notes: "original application note",
      },
      rentals: [],
      reads: [],
      audit: [],
      writes: 0,
      attempts: 0,
      inserts: 0,
      patches: [],
      ...extra,
    };
  }
  const invoke = (patch, role) => {
    if (role) fixture.role = role;
    return call({ data: { id, patch }, context: { userId: "synthetic-user" } });
  };

  await test("authorized close records reason and keeps history", async () => {
    reset("admin");
    const before = { ...fixture.row };
    const result = await invoke({
      status: "closed",
      closure_reason: "no_vehicle_available",
      closure_notes: "No sedan this week",
    });
    assert.equal(result.status, "closed");
    assert.equal(fixture.writes, 1);
    assert.equal(fixture.inserts, 0);
    assert.equal(fixture.rentals.length, 0);
    assert.equal(fixture.row.contact_status, "follow_up");
    assert.equal(fixture.row.contact_status_note, before.contact_status_note);
    assert.equal(fixture.row.utm_source, "google");
    assert.equal(fixture.row.gclid, "gclid-1");
    assert.equal(fixture.row.source, "ads");
    assert.equal(fixture.row.notes, "original application note");
    assert.equal(fixture.row.id, id);
    const patch = fixture.patches[0];
    for (const key of ["contact_status", "utm_source", "gclid", "source", "notes", "closure_reason"]) {
      assert.equal(key in patch, false);
    }
    assert.equal(fixture.audit[0].entry.action, "application.closed");
    assert.equal(fixture.audit[0].entry.metadata.closure_reason, "no_vehicle_available");
    assert.equal(fixture.audit[0].entry.metadata.closure_notes, "No sedan this week");
    assert.equal(fixture.audit[0].entry.metadata.previous_status, "reviewing");
    assert.ok(fixture.audit[0].actor.userId);
  });

  await test("coordinator can close with a reason", async () => {
    reset("coordinator");
    const result = await invoke({ status: "closed", closure_reason: "applicant_withdrew" });
    assert.equal(result.status, "closed");
    assert.equal(fixture.audit[0].entry.metadata.closure_notes, null);
  });

  await test("closure reason is required", async () => {
    reset("team");
    await assert.rejects(invoke({ status: "closed" }), /Closure reason is required/);
    assert.equal(fixture.attempts, 0);
    assert.equal(fixture.row.status, "reviewing");
  });

  await test("unauthorized role is denied before a write", async () => {
    reset(null);
    await assert.rejects(invoke({ status: "closed", closure_reason: "other" }), /Forbidden/);
    assert.equal(fixture.attempts, 0);
    assert.ok(!fixture.reads.includes("applications"));
  });

  await test("coordinator cannot reopen Closed", async () => {
    reset("coordinator");
    fixture.row.status = "closed";
    await assert.rejects(invoke({ status: "reviewing" }), /reopening a Closed application requires a Manager/);
    assert.equal(fixture.attempts, 0);
    assert.equal(fixture.row.status, "closed");
    assert.equal(fixture.row.contact_status, "follow_up");
  });

  await test("manager can reopen Closed without a new driver", async () => {
    reset("team");
    fixture.row.status = "closed";
    const result = await invoke({ status: "reviewing" });
    assert.equal(result.status, "reviewing");
    assert.equal(fixture.inserts, 0);
    assert.equal(fixture.writes, 1);
    assert.equal(fixture.audit[0].entry.action, "application.reopened");
    assert.equal(fixture.row.utm_source, "google");
    assert.equal(fixture.row.notes, "original application note");
  });

  await test("Active and Approved cannot be set through the lifecycle writer", async () => {
    reset("admin");
    await assert.rejects(async () => invoke({ status: "active" }));
    await assert.rejects(async () => invoke({ status: "approved" }));
    assert.equal(fixture.attempts, 0);
    assert.equal(fixture.row.status, "reviewing");
  });

  const contact = readFileSync("src/lib/contact-status.ts", "utf8");
  await test("Contact Status dropdown is unchanged", async () => {
    const keys = [...contact.matchAll(/key: "([^"]+)", label: "([^"]+)"/g)].map((match) => match.slice(1).join("|"));
    assert.deepEqual(keys, [
      "new|New",
      "attempted|Attempted",
      "voicemail|Voicemail",
      "contacted|Contacted",
      "interested|Interested",
      "follow_up|Follow-Up",
      "documents|Documents",
      "unqualified|Unqualified",
      "unresponsive|Unresponsive",
    ]);
  });

  const ui = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  const approve = readFileSync("src/lib/applications.functions.ts", "utf8");
  const flag = readFileSync("src/lib/end-rental-preserves-application.ts", "utf8");
  const record = readFileSync("src/lib/record-rental-contract.ts", "utf8");
  const proposed = readFileSync("proposed/end-rental-preserves-application-v1.sql", "utf8");
  await test("dropdown approves through the manager path and does not write Active", async () => {
    assert.match(ui, /status === "approved"/);
    assert.match(ui, /approveFromList\(\{ data: \{ id: a\.id \} \}\)/);
    assert.match(ui, /approveAndSend\(\)/);
    assert.match(approve, /const actor = await requireManager\(context\.userId\)/);
    assert.doesNotMatch(ui, /onUpdate\(\{ status: "active" \}\)/);
    assert.doesNotMatch(ui, /update\(a\.id, \{ status: "active" \}\)/);
    assert.match(ui, /aria-label="Application Status"/);
    assert.match(ui, /aria-label="Contact Status"/);
    assert.match(ui, /visibleDriverActivity\(ev\)/);
    assert.doesNotMatch(ui, /slice\(0, 12\)/);
    assert.match(ui, /recordRentalEnabled === true \? sets\.authoritativeIds : sets\.openRentalIds/);
    assert.match(ui, /applicationStatusChoiceDisabled\(a\.status, status, tier\)/);
    assert.match(ui, /applicationStatusChoiceDisabled\(driver\.status, v, panelTier\(isOwner, isManager\)\)/);
    const reader = readFileSync("src/lib/application-status.functions.ts", "utf8");
    const early = reader.indexOf("recordRentalEnabled !== true");
    const payments = reader.indexOf('.from("payments")');
    assert.ok(early > 0 && payments > early);
  });

  await test("ending a rental does not gain a new application write while the proposal is off", async () => {
    assert.match(flag, /export const END_RENTAL_PRESERVES_APPLICATION_ENABLED = false as boolean;/);
    assert.match(record, /export const RECORD_RENTAL_CONTRACT_ENABLED = false;/);
    assert.match(ui, /END_RENTAL_PRESERVES_APPLICATION_ENABLED !== true/);
    assert.doesNotMatch(ui, /from\("applications"\)\.update/);
    const forward = proposed.split("-- ROLLBACK")[0];
    assert.doesNotMatch(forward, /UPDATE public\.applications SET status = 'closed'/);
    assert.match(forward, /UPDATE public\.rentals SET status = 'closed'/);
    assert.match(proposed, /UPDATE public\.applications SET status = 'closed'/);
  });

  console.log(passed + " application status checks passed");
} finally {
  rmSync(out, { recursive: true, force: true });
}
