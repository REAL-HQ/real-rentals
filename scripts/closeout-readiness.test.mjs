import { build } from "esbuild";
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "rr-closeout-"));
let checks = 0;
const check = (name, fn) => {
  fn();
  checks++;
  console.log("PASS", name);
};
try {
  writeFileSync(
    join(dir, "start.mjs"),
    `export const createServerFn=()=>{const b={middleware:()=>b,inputValidator:()=>b,handler:fn=>fn};return b;};`,
  );
  writeFileSync(join(dir, "auth.mjs"), "export const requireSupabaseAuth={};");
  writeFileSync(
    join(dir, "sb.mjs"),
    "export const supabaseAdmin={from:(...a)=>globalThis.sb.from(...a),auth:{admin:{getUserById:async()=>({data:{user:{email:null}}})}}};",
  );
  const bundle = async (source, out, extra = {}) =>
    build({
      stdin: source ? { contents: source, resolveDir: process.cwd(), loader: "ts" } : undefined,
      entryPoints: source ? undefined : ["src/lib/closeout-readiness.functions.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: join(dir, out),
      alias: {
        "@": join(process.cwd(), "src"),
        "@tanstack/react-start": join(dir, "start.mjs"),
        "@/integrations/supabase/auth-middleware": join(dir, "auth.mjs"),
        "@/integrations/supabase/client.server": join(dir, "sb.mjs"),
        ...extra,
      },
      logLevel: "silent",
    });
  await bundle(null, "fn.mjs");
  const { getRentalCloseoutReadiness: run } = await import(join(dir, "fn.mjs"));
  let tables, queries, errors, forcedCount;
  const id = "11111111-0000-4000-8000-000000000001";
  function reset(role = "team") {
    queries = [];
    errors = new Set();
    forcedCount = {};
    tables = {
      user_roles: [{ user_id: "u", role }],
      rentals: [
        {
          id,
          vehicle_id: "v",
          autopay_active: false,
          stripe_subscription_id: null,
          deposit_amount: 200,
          deposit_held: true,
          deposit_status: "held",
          deposit_settled_at: null,
        },
      ],
      vehicles: [
        {
          id: "v",
          year: 2020,
          make: "Ford",
          model: "Fusion",
          vin: "3FA6P0H77GR351009",
          weekly_rate: 300,
          status: "rented",
        },
      ],
      inspections: [
        {
          id: "i",
          rental_id: id,
          vehicle_id: "v",
          inspection_type: "return",
          status: "passed",
          completed_at: "2026-10-14T10:00:00Z",
          created_at: "2026-10-14",
        },
      ],
      inspection_items: [
        { inspection_id: "i", label: "Brakes", result: "pass", is_critical: true },
      ],
      incidents: [],
      payments: [],
      toll_charges: [],
    };
    globalThis.sb = {
      from(table) {
        queries.push(table);
        let rows = tables[table] ?? [],
          cols,
          cap = Infinity,
          single = false;
        const q = {
          select(c) {
            cols = c.split(",");
            return q;
          },
          eq(k, v) {
            rows = rows.filter((r) => r[k] === v);
            return q;
          },
          order() {
            return q;
          },
          limit(n) {
            cap = n;
            return q;
          },
          maybeSingle() {
            single = true;
            return q;
          },
          then(resolve, reject) {
            const result = rows
              .slice(0, cap)
              .map((r) => Object.fromEntries(cols.map((k) => [k, r[k]])));
            return Promise.resolve(
              errors.has(table)
                ? { data: null, error: { message: "private error" } }
                : {
                    data: single ? (result[0] ?? null) : result,
                    count: forcedCount[table] ?? rows.length,
                    error: null,
                  },
            ).then(resolve, reject);
          },
        };
        return q;
      },
    };
  }
  const call = () => run({ data: { rentalId: id }, context: { userId: "u" } });
  const section = (r, k) => r.checks.find((x) => x.key === k);
  for (const role of ["admin", "team"]) {
    reset(role);
    const r = await call();
    check(role + " authorized", () => assert.equal(section(r, "inspection").state, "Ready"));
  }
  for (const role of ["coordinator", "driver", "user", ""]) {
    reset(role);
    await assert.rejects(call, /Forbidden/);
    check(role + " denied before financial reads", () => assert.deepEqual(queries, ["user_roles"]));
  }
  reset();
  let r = await call();
  check("unknown provider is not Ready", () =>
    assert.equal(section(r, "billing").state, "Unknown"),
  );
  check("unsettled deposit needs attention", () =>
    assert.equal(section(r, "deposit").state, "Needs Attention"),
  );
  check("empty recorded charges ready", () => assert.equal(section(r, "charges").state, "Ready"));
  check("profile completeness is not safety certification", () =>
    assert.equal(section(r, "vehicle").state, "Unknown"),
  );
  check("no lifecycle mutations", () => assert.deepEqual(Object.keys(globalThis.sb), ["from"]));
  reset();
  tables.inspections = [];
  r = await call();
  check("missing inspection", () => assert.match(section(r, "inspection").explanation, /Missing/));
  reset();
  tables.inspections[0].status = "failed";
  tables.inspection_items[0].result = "fail";
  r = await call();
  check("failed inspection includes critical failure", () => {
    assert.equal(section(r, "inspection").state, "Needs Attention");
    assert.deepEqual(section(r, "inspection").criticalFailures, ["Brakes"]);
  });
  reset();
  tables.inspection_items = [];
  r = await call();
  check("empty checklist cannot pass", () =>
    assert.equal(section(r, "inspection").state, "Unknown"),
  );
  reset();
  errors.add("inspections");
  r = await call();
  check("query error Unknown", () => assert.equal(section(r, "inspection").state, "Unknown"));
  reset();
  tables.payments = [{ rental_id: id, status: "pending", amount: 300, balance_due: 125 }];
  tables.toll_charges = [{ rental_id: id, status: "rebilled" }];
  r = await call();
  check("canonical outstanding balance; rebilled toll not double counted", () => {
    assert.match(section(r, "charges").explanation, /\$125.00/);
    assert.match(section(r, "charges").explanation, /0 unposted/);
    assert.equal(section(r, "charges").state, "Needs Attention");
  });
  reset();
  tables.payments = [{ rental_id: "other", status: "pending", amount: 999 }];
  r = await call();
  check("other rental excluded", () => assert.match(section(r, "charges").explanation, /\$0.00/));
  for (const table of ["payments", "toll_charges", "vehicles", "incidents", "inspection_items"]) {
    reset();
    errors.add(table);
    r = await call();
    const k = ["payments", "toll_charges"].includes(table)
      ? "charges"
      : ["vehicles", "incidents"].includes(table)
        ? "vehicle"
        : "inspection";
    check(table + " failure cannot pass", () => assert.equal(section(r, k).state, "Unknown"));
  }
  reset();
  forcedCount.payments = 1001;
  r = await call();
  check("truncated totals Unknown", () => assert.equal(section(r, "charges").state, "Unknown"));
  reset();
  tables.incidents = [{ vehicle_id: "v", status: "repairing", drivable: false }];
  r = await call();
  check("unresolved damage needs attention", () =>
    assert.equal(section(r, "vehicle").state, "Needs Attention"),
  );
  reset();
  tables.rentals[0].stripe_subscription_id = "sub_SECRET";
  tables.rentals[0].deposit_settled_at = "2026-10-14";
  tables.rentals[0].deposit_status = "refunded";
  r = await call();
  check("no credential or subscription identifier in response", () =>
    assert(!JSON.stringify(r).includes("sub_SECRET")),
  );
  check("recorded refund not provider confirmation", () =>
    assert.equal(section(r, "deposit").state, "Unknown"),
  );
  check("linked subscription attention", () =>
    assert.equal(section(r, "billing").state, "Needs Attention"),
  );
  // Negative control: removing the real Manager guard must make the denial assertion fail.
  const source = readFileSync("src/lib/closeout-readiness.functions.ts", "utf8");
  await bundle(source.replace("await requireManager(context.userId);", ""), "unguarded.mjs");
  const unguarded = (await import(join(dir, "unguarded.mjs"))).getRentalCloseoutReadiness;
  reset("coordinator");
  await assert.rejects(async () =>
    assert.rejects(
      () => unguarded({ data: { rentalId: id }, context: { userId: "u" } }),
      /Forbidden/,
    ),
  );
  check("missing Manager guard detected", () => assert(queries.includes("rentals")));
  const ui = readFileSync("src/components/admin/BookingActions.tsx", "utf8");
  check("End Rental still disabled only while busy", () =>
    assert.match(ui, /disabled=\{busy\}\s+data-testid="end-rental-confirm"/),
  );
  check("new endpoint contains no mutation or provider invocation", () =>
    assert(!/\.(insert|update|delete|upsert|rpc)\(/.test(source)),
  );
  console.log(`${checks} closeout checks passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
