import assert from "node:assert/strict";
import { build } from "esbuild";
const state = { rows: [], roles: [], reads: [], fail: false };
globalThis.__leadTest = state;
const stub = `
const s=()=>globalThis.__leadTest;
export const supabaseAdmin={auth:{admin:{getUserById:async()=>({data:{user:{email:null}}})}},from(table){
 s().reads.push(table);let filters=[],start=0,end=Infinity,head=false,sorts=[];
 const q={select(_cols,opts={}){head=opts.head;return q;},
 is(k,v){filters.push(r=>r[k]===v);return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},
 neq(k,v){filters.push(r=>r[k]!==v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},
 lt(k,v){filters.push(r=>r[k]!=null && r[k]<v);return q;},gt(k,v){filters.push(r=>r[k]!=null && r[k]>v);return q;},
 not(k,op,v){if(op!=='in')throw Error('unsupported');filters.push(r=>!v.slice(1,-1).split(',').includes(r[k]));return q;},
 or(expr){filters.push(r=>expr.split(',').some(x=>{const [k,op,v]=x.split('.');return op==='is'?r[k]===null:op==='gte'?r[k]!=null&&r[k]>=v:r[k]!=null&&r[k]>v;}));return q;},
 order(k,opts){sorts.push([k,opts]);return q;},range(a,b){start=a;end=b;return q;},
 then(resolve,reject){try{let rows=table==='user_roles'?s().roles:s().rows;
 rows=rows.filter(r=>filters.every(f=>f(r))).sort((a,b)=>{for(const [k,o] of sorts){if(a[k]===b[k])continue;if(a[k]==null)return o.nullsFirst?-1:1;if(b[k]==null)return o.nullsFirst?1:-1;return (a[k]<b[k]?-1:1)*(o.ascending?1:-1);}return 0;});
 return Promise.resolve({data:head?null:rows.slice(start,end+1),count:rows.length,error:s().fail&&table==='applications'?{message:'synthetic failure'}:null}).then(resolve,reject);
 }catch(e){return Promise.reject(e).then(resolve,reject);}}
 };return q;}};
`;
const bundled = await build({
  entryPoints: ["src/lib/lead-priorities.functions.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "synthetic",
      setup(b) {
        b.onResolve({ filter: /^@tanstack\/react-start$/ }, () => ({
          path: "start",
          namespace: "mock",
        }));
        b.onResolve({ filter: /integrations\/supabase\/auth-middleware/ }, () => ({
          path: "auth",
          namespace: "mock",
        }));
        b.onResolve({ filter: /integrations\/supabase\/client.server/ }, () => ({
          path: "db",
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
          contents:
            path === "db"
              ? stub
              : path === "auth"
                ? "export const requireSupabaseAuth={};"
                : `export const createServerFn=()=>{const a={middleware:()=>a,inputValidator:v=>(a.v=v,a),handler:f=>args=>f({...args,data:a.v(args.data)})};return a;};`,
          loader: "js",
        }));
      },
    },
  ],
});
const { getLeadPriorities } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
const pure = await build({
  entryPoints: ["src/lib/lead-priorities.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { leadToday, leadBucket, projectLead, overdueAge } = await import(
  "data:text/javascript;base64," + Buffer.from(pure.outputFiles[0].text).toString("base64")
);
let checks = 0;
const check = (v, m) => {
  assert(v, m);
  checks++;
};
check(leadToday(new Date("2026-10-14T03:59:59Z")) === "2026-10-13", "Eastern midnight before");
check(leadToday(new Date("2026-10-14T04:00:00Z")) === "2026-10-14", "Eastern midnight after");
check(leadToday(new Date("2026-03-08T06:59:00Z")) === "2026-03-08", "DST date stable");
check(overdueAge("2026-10-13", "2026-10-14") === "1 day overdue", "singular overdue age");
check(overdueAge("2026-03-07", "2026-03-09") === "2 days overdue", "spring DST calendar age");
check(overdueAge("2026-10-31", "2026-11-02") === "2 days overdue", "fall DST calendar age");
check(overdueAge("2026-10-14", "2026-10-14") === null, "today is not overdue");
check(overdueAge("2026-10-15", "2026-10-14") === null, "future is not overdue");
check(overdueAge("bad", "2026-10-14") === null, "invalid age not displayed");
const today = leadToday();
const row = (id, contact, date = null, status = "new") => ({
  id,
  full_name: "Synthetic " + id,
  phone: "8135550100",
  status,
  created_at: "2026-01-01",
  deleted_at: null,
  contact_status: contact,
  contact_status_note: "Please follow up in Spanish.",
  contact_follow_up_on: date,
  contact_status_at: null,
  contact_status_by: null,
  license_number: "MUST_NOT_LEAK",
  dob: "MUST_NOT_LEAK",
  payment_status: "MUST_NOT_LEAK",
  notes: "MUST_NOT_LEAK",
});
state.rows = [
  row("a", "interested", "2000-01-01"),
  row("b", "new"),
  row("c", "interested"),
  row("d", "follow_up", today),
  row("e", "documents"),
  row("f", "contacted", "2099-01-01"),
  row("g", "new", null, "closed"),
  row("h", "interested", null, "declined"),
  row("i", "unqualified", "2000-01-01"),
  { ...row("j", "new"), deleted_at: "2026-01-01" },
  row("k", "new", null, "active"),
  row("l", "new", null, "partial"),
];
const before = JSON.stringify(state.rows);
for (const role of ["admin", "team", "coordinator"]) {
  state.roles = [{ user_id: "staff", role }];
  state.reads = [];
  const first = await getLeadPriorities({
    context: { userId: "staff" },
    data: { limit: 5, offset: 0 },
  });
  check(first.total === 6, role + " eligible total");
  check(
    JSON.stringify(first.counts) === JSON.stringify({ overdue: 1, new: 1, hot: 1 }),
    role + " disjoint counters",
  );
  check(first.rows.map((r) => r.id).join(",") === "a,b,c,d,e", role + " deterministic priorities");
  check(
    !JSON.stringify(first).includes("MUST_NOT_LEAK"),
    role + " projection excludes sensitive fields even with overbroad adapter",
  );
  check(
    first.rows[2].action.includes("does not establish rental readiness"),
    role + " interested is not ready",
  );
  check(
    first.rows[0].contact_status_note === "Please follow up in Spanish.",
    role + " latest note preserved",
  );
  check(
    first.rows.every((r) => !r.action.includes("Spanish")),
    role + " recommendation does not invent a note interpretation",
  );
  check(
    state.reads.every((t) => ["user_roles", "applications"].includes(t)),
    role + " no document/history reads",
  );
  const next = await getLeadPriorities({
    context: { userId: "staff" },
    data: { limit: 5, offset: 5 },
  });
  check(
    next.rows.map((r) => r.id).join(",") === "f" && next.nextOffset === null,
    role + " bounded next page",
  );
}
for (const role of ["driver", null]) {
  state.roles = role ? [{ user_id: "denied", role }] : [];
  state.reads = [];
  await assert.rejects(
    () => getLeadPriorities({ context: { userId: "denied" }, data: { limit: 5 } }),
    /Forbidden/,
  );
  checks++;
  check(!state.reads.includes("applications"), "denial before applicant read");
}
state.roles = [{ user_id: "staff", role: "coordinator" }];
state.fail = true;
await assert.rejects(
  () => getLeadPriorities({ context: { userId: "staff" }, data: { limit: 5 } }),
  /could not be loaded/,
);
checks++;
state.fail = false;
assert.throws(() => getLeadPriorities({ context: { userId: "staff" }, data: { limit: 1000 } }));
checks++;
check(JSON.stringify(state.rows) === before, "no records changed");
state.rows = Array.from({ length: 81 }, (_, i) => row(String(i).padStart(3, "0"), "new"));
const pages = [];
for (let offset = 0; offset < 81; offset += 25) {
  const p = await getLeadPriorities({ context: { userId: "staff" }, data: { limit: 25, offset } });
  pages.push(...p.rows);
  check(p.counts.new === 81, "counts not limited to page");
}
check(
  pages.length === 81 && new Set(pages.map((r) => r.id)).size === 81,
  "all pages unique and complete",
);
for (const r of state.rows) check(leadBucket(r, today) === "new", "query and pure priority agree");
console.log(checks + " Lead Priorities checks passed");

await assert.rejects(
  () => getLeadPriorities({ context: { userId: "staff" }, data: { offset: 999, limit: 5 } }),
  /changed/,
);
console.log("Stale pagination offset rejected");
