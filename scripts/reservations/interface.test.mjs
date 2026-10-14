import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const dir = mkdtempSync(join(tmpdir(), "rr-reservation-ui-"));
let n = 0;
const test = async (label, fn) => {
  await fn();
  console.log("PASS " + label);
  n++;
};
try {
  writeFileSync(
    join(dir, "start.mjs"),
    `export const createServerFn=()=>{let validate=x=>x;const b={middleware:()=>b,inputValidator:f=>(validate=f,b),handler:f=>args=>f({...args,data:validate(args.data)})};return b;};`,
  );
  writeFileSync(join(dir, "auth.mjs"), "export const requireSupabaseAuth={};");
  writeFileSync(
    join(dir, "admin.mjs"),
    `export const supabaseAdmin={from:()=>({select:()=>({eq:async()=>({data:globalThis.roles.map(role=>({role}))})})}),auth:{admin:{getUserById:async()=>({data:{user:{email:null}}})}}};`,
  );
  await build({
    entryPoints: ["src/lib/reservations.functions.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(dir, "fn.mjs"),
    alias: {
      "@": resolve("src"),
      "@tanstack/react-start": join(dir, "start.mjs"),
      "@/integrations/supabase/auth-middleware": join(dir, "auth.mjs"),
      "@/integrations/supabase/client.server": join(dir, "admin.mjs"),
    },
    logLevel: "silent",
  });
  await build({
    entryPoints: ["src/lib/reservations.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(dir, "rules.mjs"),
    logLevel: "silent",
  });
  const f = await import(join(dir, "fn.mjs")),
    rules = await import(join(dir, "rules.mjs"));
  const id = "11111111-1111-4111-8111-111111111111";
  const record = {
    id,
    application_id: id,
    vehicle_id: id,
    state: "reserved",
    pickup_at: "2030-01-10T15:00:00Z",
    timezone: "America/New_York",
    agreed_end_at: null,
    hold_expires_at: "2030-01-09T15:00:00Z",
    version: 2,
    applicant_name: "Synthetic Applicant",
    vehicle_label: "Synthetic Car",
    warnings: [],
  };
  let calls = [],
    reply = { data: [], error: null },
    reject = false;
  const context = {
    userId: id,
    supabase: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (reject) throw Error("network");
        return reply;
      },
    },
  };
  const call = async (name, data) => f[name]({ context, data });
  function setup(role = "team") {
    globalThis.roles = role ? [role] : [];
    process.env.RESERVATIONS_ENABLED = "true";
    calls = [];
    reply = { data: [], error: null };
    reject = false;
  }
  for (const role of ["admin", "team", "coordinator"])
    await test(role + " disabled gate never reaches schema", async () => {
      setup(role);
      delete process.env.RESERVATIONS_ENABLED;
      assert.equal((await call("listReservations", { view: "upcoming" })).available, false);
      assert.equal(calls.length, 0);
    });
  for (const role of ["driver", ""])
    await test(role + " staff reads denied", async () => {
      setup(role);
      await assert.rejects(() => call("listReservations", { view: "upcoming" }), /Forbidden/);
      assert.equal(calls.length, 0);
    });
  for (const role of ["coordinator", "driver", ""])
    await test(role + " all mutation/choice access denied", async () => {
      setup(role);
      for (const action of ["create", "edit", "reserve", "confirm", "cancel", "expire"])
        await assert.rejects(
          () =>
            call("changeReservation", {
              action,
              id,
              version: 2,
              applicationId: id,
              pickupAt: record.pickup_at,
            }),
          /Forbidden/,
        );
      await assert.rejects(() => call("getReservationOptions", {}), /Forbidden/);
      assert.equal(calls.length, 0);
    });
  for (const role of ["admin", "team"])
    await test(role + " caller-scoped mutation and strict response projection", async () => {
      setup(role);
      reply = { data: { id, secret: "must strip" }, error: null };
      const r = await call("changeReservation", { action: "reserve", id, version: 2 });
      assert.deepEqual(r.value, { id });
      assert.equal(calls[0].name, "reservation_change");
      assert.equal("_actor" in calls[0].args, false);
    });
  await test("Coordinator list strips unexpected sensitive fields", async () => {
    setup("coordinator");
    reply = { data: [{ ...record, ssn: "synthetic-secret", weekly_rate: 999 }], error: null };
    const r = await call("listReservations", { view: "upcoming" });
    assert.equal(r.canManage, false);
    assert.deepEqual(r.value, [record]);
  });
  for (const code of ["PGRST202", "42P01", "42883", "42501"])
    await test("controlled missing schema " + code, async () => {
      setup();
      reply = { data: null, error: { code, message: "secret database detail" } };
      for (const [fn, data] of [
        ["listReservations", { view: "drafts" }],
        ["getReservationOptions", {}],
        ["getReservationHistory", { id }],
        ["changeReservation", { action: "reserve", id, version: 2 }],
      ]) {
        const r = await call(fn, data);
        assert.equal(r.available, false);
        assert.match(r.message, /unavailable/);
        assert.ok(!r.message.includes("secret"));
      }
      assert.ok(calls.every((c) => c.name.startsWith("reservation_")));
    });
  await test("no conversion or rental fallback accepted", async () => {
    setup();
    await assert.rejects(() => call("changeReservation", { action: "convert", id, version: 2 }));
    assert.equal(calls.length, 0);
  });
  await test("malformed response cannot pass", async () => {
    setup();
    reply = { data: [{ id }], error: null };
    assert.equal((await call("listReservations", { view: "upcoming" })).available, false);
  });
  await test("transport failure returns unknown outcome without retry", async () => {
    setup();
    reject = true;
    const r = await call("changeReservation", { action: "confirm", id, version: 2 });
    assert.equal(r.available, false);
    assert.match(r.message, /verify/);
    assert.equal(calls.length, 1);
  });
  await test("conflict and stale-version messages", async () => {
    setup();
    reply = { data: null, error: { code: "23P01" } };
    assert.match(
      (await call("changeReservation", { action: "reserve", id, version: 2 })).message,
      /conflict/,
    );
    reply = { data: null, error: { message: "stale_version" } };
    assert.match(
      (await call("changeReservation", { action: "confirm", id, version: 2 })).message,
      /Reload/,
    );
  });
  await test("state actions preserve manager no-show decision and expiry rules", () => {
    assert.deepEqual(rules.reservationActions(record, false), []);
    assert.deepEqual(
      rules.reservationActions({ ...record, hold_expires_at: "2000-01-01T00:00Z" }, true),
      ["expire", "cancel"],
    );
    assert.deepEqual(rules.reservationActions({ ...record, state: "confirmed" }, true), [
      "edit",
      "cancel",
    ]);
    assert.deepEqual(rules.reservationActions({ ...record, state: "converted" }, true), []);
  });
  await test("DST gaps rejected and folds disambiguated", () => {
    assert.throws(() => rules.reservationInstant("2030-03-10T02:30", "-05:00", "America/New_York"));
    assert.notEqual(
      rules.reservationInstant("2030-11-03T01:30", "-04:00", "America/New_York"),
      rules.reservationInstant("2030-11-03T01:30", "-05:00", "America/New_York"),
    );
    assert.throws(() => rules.reservationInstant("2030-01-10T10:07", "-05:00", "America/New_York"));
    assert.throws(() => rules.reservationInstant("2030-01-10T10:00", "", "America/New_York"));
  });
  await test("Manager create/edit/confirm/cancel/expire use only approved RPC contract", async () => {
    for (const action of ["create", "edit", "confirm", "cancel", "expire"]) {
      setup();
      reply = { data: action === "create" ? id : { id }, error: null };
      const r = await call("changeReservation", {
        action,
        id,
        version: 2,
        applicationId: id,
        vehicleId: id,
        pickupAt: record.pickup_at,
        reason: "Synthetic reason",
      });
      assert.equal(r.available, true);
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].name,
        action === "create" ? "reservation_create" : "reservation_change",
      );
    }
  });
  await test("disabled Manager mutations and options never touch database", async () => {
    setup();
    delete process.env.RESERVATIONS_ENABLED;
    assert.equal(
      (await call("changeReservation", { action: "reserve", id, version: 2 })).available,
      false,
    );
    assert.equal((await call("getReservationOptions", {})).available, false);
    assert.equal(calls.length, 0);
  });
  await test("PostgREST composite response accepts exactly one row only", async () => {
    setup();
    reply = { data: [{ id }], error: null };
    assert.equal(
      (await call("changeReservation", { action: "confirm", id, version: 2 })).available,
      true,
    );
    for (const data of [[], [{ id }, { id }]]) {
      reply = { data, error: null };
      assert.equal(
        (await call("changeReservation", { action: "confirm", id, version: 2 })).available,
        false,
      );
    }
  });

  const conversion={id,version:2,weeklyRate:350,deposit:0,depositHeld:false,pickupMileage:null};
  const preview={id,version:2,rentalId:null,state:"confirmed",blockers:[],agreement:"No signed agreement recorded",payment:"Unknown"};
  for(const role of ["coordinator","driver",""])await test("conversion endpoints denied "+role,async()=>{setup();globalThis.roles=role?[role]:[];await assert.rejects(()=>call("getReservationConversion",{id}),/Forbidden/);await assert.rejects(()=>call("convertReservation",conversion),/Forbidden/);assert.equal(calls.length,0)});
  await test("conversion gate off makes zero RPCs",async()=>{setup();delete process.env.RESERVATIONS_ENABLED;assert.equal((await call("convertReservation",conversion)).available,false);assert.equal((await call("getReservationConversion",{id})).available,false);assert.equal(calls.length,0)});
  for(const code of ["PGRST202","42P01","42501"])await test("conversion supplemental schema required "+code,async()=>{setup();reply={data:null,error:{code}};assert.equal((await call("convertReservation",conversion)).available,false);assert.equal(calls.length,1);assert.equal(calls[0].name,"reservation_conversion_preview")});
  await test("conversion transport failure has no automatic retry",async()=>{setup();reject=true;const r=await call("convertReservation",conversion);assert.equal(r.available,false);assert.equal(calls.length,1)});
  await test("conversion blockers and stale version never mutate",async()=>{for(const value of [{...preview,blockers:["Unsafe"]},{...preview,version:3}]){setup();reply={data:value,error:null};assert.equal((await call("convertReservation",conversion)).available,false);assert.equal(calls.length,1)}});
  await test("Owner and Manager use caller RPC; success and ambiguous mutation response",async()=>{
   const old=context.supabase.rpc;
   try{for(const role of ["admin","team"]){setup();globalThis.roles=[role];context.supabase.rpc=async(name,args)=>{calls.push({name,args});return {data:name==="reservation_conversion_preview"?preview:id,error:null}};assert.equal((await call("convertReservation",conversion)).value,id);assert.deepEqual(calls.map(x=>x.name),["reservation_conversion_preview","reservation_convert"])}
    setup();context.supabase.rpc=async(name,args)=>{calls.push({name,args});if(name==="reservation_convert")throw Error("lost response");return {data:preview,error:null}};assert.equal((await call("convertReservation",conversion)).available,false);assert.equal(calls.length,2);
   }finally{context.supabase.rpc=old}
  });
  console.log(`${n} interface/server checks passed; no network`);
} finally {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.RESERVATIONS_ENABLED;
}
