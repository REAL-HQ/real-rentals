import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const out = resolve(".inline-activation-test"); mkdirSync(out, { recursive: true });
const root = resolve("src");
await build({ entryPoints: ["src/lib/driver-list-activation.ts"], outfile: `${out}/rules.mjs`, bundle: true, format: "esm", platform: "node", alias: { "@": root } });
const { ACTIVATE_FROM_LIST, driverListStatusMenu, nextActivationResolution, activationAgreementPatch } = await import(`${out}/rules.mjs`);
let checks = 0;
for (const tier of ["owner", "manager", "coordinator"]) for (const rental of [false, true]) for (const status of ["new", "approved", "active", "closed"]) {
  const menu = driverListStatusMenu(status, tier, rental);
  const active = menu.filter((item) => item.label === "Active");
  assert.equal(active.length, 1); assert.equal(active[0].value, ACTIVATE_FROM_LIST);
  assert.equal(active[0].disabled, rental || tier === "coordinator");
  assert(!menu.some((item) => item.value === "active")); checks++;
}
for (const [code, expected] of [["missing_documents", "documents"], ["insurance_not_verified", "insurance"], ["no_interview", "interview"], ["not_approved", "approval"], ["no_signed_agreement", "agreement"], ["vehicle_not_ready", "vehicle"], ["no_passed_inspection", "inspection"], ["no_email", "email"]]) {
  assert.equal(nextActivationResolution([{ code, message: "Synthetic" }]).key, expected); checks++;
}
assert.equal(nextActivationResolution([{ code: "already_active", message: "Already active" }, { code: "insurance_not_verified", message: "Missing" }]), null);
assert.equal(nextActivationResolution([{ code: "not_approved", message: "Not approved" }, { code: "insurance_not_verified", message: "Missing" }]).key, "insurance");
const draft = { vehicleId: "synthetic-vehicle", weeklyRate: 350, depositAmount: 0, startDate: "2026-11-08", endDate: null };
assert.deepEqual(Object.keys(activationAgreementPatch(draft)).sort(), ["vehicle_id", "weekly_rent", "deposit_amount", "contract_start_date", "contract_end_date"].sort());
for (const patch of [{ weeklyRate: 0 }, { weeklyRate: Infinity }, { depositAmount: -1 }, { startDate: "2026-02-31" }, { endDate: "2026-11-01" }]) assert.throws(() => activationAgreementPatch({ ...draft, ...patch }));
checks += 6;
const source = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
assert(source.indexOf("status === ACTIVATE_FROM_LIST") < source.indexOf("if (applicationStatusChoiceDisabled(a.status"));
assert(source.includes("<InlineActivationFlow")); assert(source.includes("refreshDrivers();\n            refreshActiveRenters();\n            refreshOnboarding();"));
assert(source.includes("openRentals.has(a.id)") && source.includes("onCloseAutoFocus"));
const dialog = readFileSync("src/components/admin/ActivateRentalDialog.tsx", "utf8");
assert(dialog.includes("if (!canSubmit || inFlight.current) return;"));
assert(dialog.includes("!!readiness &&") && dialog.includes("setReadiness(null)"));
assert(dialog.includes("setFailure(msg") && dialog.includes("role=\"alert\""));
assert(dialog.includes("prefilledVehicle.current !== vehicleId")); checks += 8;

// Real endpoint + real role checks; only the storage/auth transport and audit sink are local fakes.
writeFileSync(`${out}/supabase.mjs`, readFileSync("scripts/fake-supabase.src.mjs", "utf8") + `\nsupabaseAdmin.auth = { admin: { getUserById: async id => ({ data: { user: globalThis.__fakeSb.authUsers?.[id] ?? null }, error: null }) } };`);
writeFileSync(`${out}/start.mjs`, `export const createServerFn=()=>{const a={middleware:()=>a,inputValidator:v=>(a.v=v,a),handler:f=>Object.assign(f,{validate:a.v})};return a};`);
writeFileSync(`${out}/auth.mjs`, `export const requireSupabaseAuth={};`);
writeFileSync(`${out}/audit.mjs`, `export const logAudit=async(actor,entry)=>{if(globalThis.__fakeSb.failAudit)throw Error('audit');(globalThis.__fakeSb.audit??=[]).push(entry)};`);
await build({ entryPoints: ["src/lib/activation-contact.functions.ts"], outfile: `${out}/contact.mjs`, bundle: true, format: "esm", platform: "node", alias: { "@": root,
  "@tanstack/react-start": `${out}/start.mjs`, "@/integrations/supabase/auth-middleware": `${out}/auth.mjs`,
  "@/integrations/supabase/client.server": `${out}/supabase.mjs`, "@/lib/audit": `${out}/audit.mjs` } });
const { fillActivationEmail } = await import(`${out}/contact.mjs`);
const state = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });
const id = "dddddddd-0000-4000-8000-000000000001";
function seed(patch = {}) {
  state.tables = { user_roles: [{ user_id: "owner", role: "admin" }, { user_id: "manager", role: "team" }, { user_id: "coordinator", role: "coordinator" }],
    applications: [{ id, email: null, user_id: null, deleted_at: null, status: "approved", insurance_status: "missing", ...patch }] };
  state.log = []; state.audit = []; state.authUsers = {}; state.failSelect = null; state.failAudit = false; state.interceptUpdate = null;
}
const call = (email = "synthetic@example.invalid", user = "manager", extra = {}) => fillActivationEmail({ data: fillActivationEmail.validate({ applicationId: id, email, ...extra }), context: { userId: user } });
for (const role of ["owner", "manager"]) { seed(); const result = await call(undefined, role); assert(result.ok); assert.equal(state.tables.applications[0].email, "synthetic@example.invalid"); assert.equal(state.tables.applications[0].status, "approved"); assert.equal(state.tables.applications[0].insurance_status, "missing"); assert.equal(state.audit.length, 1); assert.deepEqual(Object.keys(state.log.find(x => x.op === "update").patch), ["email"]); checks++; }
for (const role of ["coordinator", "outsider"]) { seed(); await assert.rejects(call(undefined, role), /Forbidden/); assert.equal(state.tables.applications[0].email, null); checks++; }
seed({ email: "existing@example.invalid" }); await assert.rejects(call(), /already on file/); checks++;
seed({ deleted_at: "2026-11-08" }); await assert.rejects(call(), /not found/); checks++;
seed({ user_id: "bound" }); state.authUsers.bound = { email: "bound@example.invalid" }; await assert.rejects(call(), /different login/); assert.equal(state.tables.applications[0].email, null); checks++;
seed({ user_id: "bound" }); state.authUsers.bound = { email: "synthetic@example.invalid" }; assert((await call()).ok); assert.equal(state.tables.applications[0].user_id, "bound"); checks++;
seed(); assert.throws(() => call("bad-email")); assert.throws(() => call(undefined, "manager", { user_id: "forged", status: "active" })); checks += 2;
seed(); state.failSelect = "applications"; await assert.rejects(call(), /Could not read/); assert.equal(state.tables.applications[0].email, null); checks++;
seed(); state.interceptUpdate = () => ({ data: [], error: null }); await assert.rejects(call(), /could not be confirmed/); checks++;
seed(); state.failAudit = true; assert((await call()).auditError); assert.equal(state.tables.applications[0].email, "synthetic@example.invalid"); checks++;
seed(); const raced = await Promise.allSettled([call("first@example.invalid"), call("second@example.invalid")]); assert.equal(raced.filter(x => x.status === "fulfilled").length, 1); assert.equal(state.log.filter(x => x.op === "update").length, 1); checks++;
console.log(`${checks} inline activation rules, integration and real role/endpoint regressions passed`);
